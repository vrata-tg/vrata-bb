import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDistribution } from "./apply.mjs";
import { copyPluginSources } from "./plugin-source.mjs";

const distributionRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? ".",
);
const config = JSON.parse(
  await readFile(resolve(distributionRoot, "distribution.json"), "utf8"),
);
const current = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
execFileSync(
  "git",
  ["merge-base", "--is-ancestor", config.upstream.commit, current],
  { cwd: root },
);
const target = resolve(root, "plugins/vrata");
assert.equal(
  execFileSync("git", ["ls-files", "plugins/vrata"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  "",
  "Refusing to replace tracked plugin sources",
);
assert.equal(
  await lstat(target).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  ),
  false,
  "plugins/vrata already exists; use a clean checkout",
);
const patch = resolve(distributionRoot, "pnpm-lock.patch");
if (!process.argv.includes("--refresh-lock"))
  execFileSync("git", ["apply", "--check", patch], { cwd: root });
const staging = await mkdtemp(resolve(tmpdir(), "vrata-plugin-"));
try {
  await copyPluginSources(staging);
  execFileSync(process.execPath, ["scripts/vendor-pi-runtime.mjs"], {
    cwd: staging,
    stdio: "inherit",
  });
  const manifest = JSON.parse(
    await readFile(resolve(staging, "package.json"), "utf8"),
  );
  manifest.dependencies["@get-bb/plugin-sdk"] = "workspace:*";
  manifest.devDependencies["@bb/plugin-build"] = "workspace:*";
  delete manifest.scripts.build;
  delete manifest.scripts.prepack;
  manifest.scripts["prepare:bundled"] = "bb-plugin-build prepare-bundled";
  manifest.scripts.test = "node ../../vrata/test-plugin.mjs";
  await writeFile(
    resolve(staging, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rm(resolve(staging, "package-lock.json"));
  const result = await applyDistribution(root, distributionRoot);
  await cp(staging, target, { recursive: true });
  if (process.argv.includes("--refresh-lock")) {
    execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      [
        "install",
        "--lockfile-only",
        "--ignore-scripts",
        "--no-frozen-lockfile",
      ],
      { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
    );
    await writeFile(
      patch,
      execFileSync("git", ["diff", "--", "pnpm-lock.yaml"], {
        cwd: root,
        maxBuffer: 20 * 1024 * 1024,
      }),
    );
  } else {
    execFileSync("git", ["apply", patch], { cwd: root });
  }
  console.log(JSON.stringify(result));
} finally {
  await rm(staging, { recursive: true, force: true });
}
