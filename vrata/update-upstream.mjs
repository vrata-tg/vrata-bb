import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { latestPluginRelease, readPluginConfig } from "./plugin-package.mjs";
import { planUpdate } from "./update-plan.mjs";

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
const plugin = await latestPluginRelease(
  (await readPluginConfig(resolve("vrata"))).package,
);
const update = planUpdate(config, tag, plugin);
if (!update) {
  console.log(`Already tracking ${tag} and plugin ${plugin.version}`);
  process.exit(0);
}
const { version, branch, upstreamChanged, releaseRevision } = update;
if (git("ls-remote", "--heads", "origin", branch)) {
  console.log(
    `${branch} already exists; review its PR before creating another update`,
  );
  process.exit(0);
}
if (upstreamChanged) git("fetch", config.upstream.repository, "tag", tag);
git("switch", "-c", branch);
const previous = { bb: config.upstream.version, plugin: config.plugin.version };
if (upstreamChanged) {
  const commit = git("rev-parse", `${tag}^{commit}`);
  git("merge", "--no-edit", "--no-ff", commit);
  config.upstream = { ...config.upstream, tag, commit, version };
}
assert.equal(
  JSON.parse(await readFile("apps/desktop/package.json", "utf8")).version,
  version,
);
config.releaseRevision = releaseRevision;
config.plugin = plugin;
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
run(
  process.execPath,
  [
    "--test",
    "vrata/overlay.test.mjs",
    "vrata/release.test.mjs",
    "vrata/plugin-package.test.mjs",
    "vrata/update-plan.test.mjs",
  ],
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
git(
  "commit",
  "-m",
  upstreamChanged
    ? `build: update Vrata BB to upstream ${version}`
    : `fix: update Vrata plugin to ${plugin.version}`,
);
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
const title = upstreamChanged
  ? `Update Vrata BB to BB ${version}`
  : `Update Vrata BB plugin to v${plugin.version}`;
const problem = upstreamChanged
  ? `Vrata BB was based on BB ${previous.bb}; BB ${version} is available.`
  : `Vrata BB bundled plugin ${previous.plugin}; plugin ${plugin.version} is available without a new BB release.`;
const change = upstreamChanged
  ? `Merge BB ${version}, apply the existing Vrata distribution, regenerate its dependency lock, use the same ${version} version for Vrata BB.`
  : `Keep BB ${version}, bundle the updated plugin, regenerate its dependency lock, and increment releaseRevision to ${releaseRevision} for a new immutable release.`;
const bodyPath = resolve(
  tmpdir(),
  `vrata-bb-update-${version}-r${releaseRevision}.md`,
);
await writeFile(
  bodyPath,
  `## Human comments\n\n## What was wrong\n\n${problem}\n\n## What changed\n\n${change} Bundle ${config.plugin.package}@${config.plugin.version} selected from npm latest; the tarball integrity is pinned in distribution.json.\n\n## How you verified\n\nOverlay, release validation, plugin package and update planning tests passed. The desktop workflow is dispatched for this branch to verify the plugin, onboarding, and installers. Review its result before merging. No release is published by this update.\n\n> AGENT GENERATED\n`,
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
      title,
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
