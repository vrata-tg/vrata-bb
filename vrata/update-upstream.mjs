import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  })?.trim() ?? "";
const git = (...args) => run("git", args);
assert.equal(git("status", "--porcelain"), "", "Start from a clean checkout");
const configPath = resolve("vrata/distribution.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const tag =
  process.argv[2] ??
  run("gh", ["api", "repos/get-bb/bb/releases/latest", "--jq", ".tag_name"]);
assert.match(tag, /^desktop-v\d+\.\d+\.\d+$/);
if (tag === config.upstream.tag) {
  console.log(`Already tracking ${tag}`);
  process.exit(0);
}
const version = tag.slice("desktop-v".length);
const parts = (value) => value.split(".").map(Number);
const current = parts(config.upstream.version);
assert(
  parts(version).some(
    (value, index, next) =>
      value > current[index] &&
      next.slice(0, index).every((part, i) => part === current[i]),
  ),
  "Refusing an upstream downgrade",
);
const branch = `automation/bb-${version}`;
if (git("ls-remote", "--heads", "origin", branch)) {
  console.log(
    `${branch} already exists; review its PR before creating another update`,
  );
  process.exit(0);
}
git("fetch", config.upstream.repository, "tag", tag);
const commit = git("rev-parse", `${tag}^{commit}`);
git("switch", "-c", branch);
git("merge", "--no-edit", "--no-ff", commit);
assert.equal(
  JSON.parse(await readFile("apps/desktop/package.json", "utf8")).version,
  version,
);
config.upstream = { ...config.upstream, tag, commit, version };
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
run(
  process.execPath,
  ["--test", "vrata/overlay.test.mjs", "vrata/release.test.mjs"],
  { stdio: "inherit" },
);
const temporary = await mkdtemp(resolve(tmpdir(), "vrata-update-"));
const checkout = resolve(temporary, "checkout");
try {
  git("worktree", "add", "--detach", checkout, "HEAD");
  run(
    process.execPath,
    [resolve("vrata/prepare.mjs"), checkout, "--refresh-lock"],
    { stdio: "inherit" },
  );
} finally {
  git("worktree", "remove", "--force", checkout);
  await rm(temporary, { recursive: true, force: true });
}
git("add", "vrata/distribution.json", "vrata/pnpm-lock.patch");
git("commit", "-m", `build: update Vrata BB to upstream ${version}`);
git("push", "--set-upstream", "origin", branch);
run(
  "gh",
  [
    "workflow",
    "run",
    "vrata-desktop.yml",
    "--repo",
    config.releaseRepository,
    "--ref",
    branch,
    "-f",
    "publish=false",
  ],
  { stdio: "inherit" },
);
const bodyPath = resolve(tmpdir(), `vrata-bb-update-${version}.md`);
await writeFile(
  bodyPath,
  `## Human comments\n\n## What was wrong\n\nVrata BB was based on an older stable BB release.\n\n## What changed\n\nMerge BB ${version}, apply the existing Vrata distribution, regenerate its dependency lock, use the same ${version} version for Vrata BB.\n\n## How you verified\n\nOverlay and release validation tests passed. The desktop workflow is dispatched for this branch to verify the plugin, onboarding, and installers. Review its result before merging. No release is published by this update.\n\n> AGENT GENERATED\n`,
);
try {
  run(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      config.releaseRepository,
      "--base",
      "main",
      "--head",
      branch,
      "--draft",
      "--title",
      `Update Vrata BB to BB ${version}`,
      "--body-file",
      bodyPath,
    ],
    { stdio: "inherit" },
  );
} catch (error) {
  console.error(
    `Branch ${branch} is pushed and its desktop build is dispatched. PR creation failed; open https://github.com/${config.releaseRepository}/compare/main...${branch} or enable workflow PR creation.`,
  );
  throw error;
} finally {
  await rm(bodyPath, { force: true });
}
