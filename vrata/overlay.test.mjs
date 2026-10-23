import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { applyDistribution } from "./apply.mjs";
import { snapshotDigest } from "./snapshot.mjs";

const distributionRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(distributionRoot, "..");
const config = JSON.parse(
  await readFile(resolve(distributionRoot, "distribution.json"), "utf8"),
);
const paths = [
  "apps/desktop/package.json",
  "apps/desktop/scripts/desktop-release-channel.mjs",
  "apps/desktop/src/desktop-update-provider.ts",
  "apps/desktop/scripts/desktop-release-channel.d.mts",
  "apps/desktop/electron-builder.config.json",
  "packages/config/src/runtime.ts",
  "apps/desktop/src/types.ts",
  "apps/desktop/src/main.ts",
  "packages/domain/src/app-settings.ts",
  "apps/app/src/App.tsx",
  "apps/server/src/services/plugins/builtin-registry.ts",
  "packages/bundled-plugins/package.json",
  "plugins/bb-official.json",
  "turbo.json",
];

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "vrata-overlay-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of paths) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    const source = execFileSync(
      "git",
      ["show", `${config.upstream.commit}:${path}`],
      { cwd: repository },
    );
    await writeFile(resolve(root, path), source);
  }
  await mkdir(resolve(root, "apps/app/src/components/onboarding"), {
    recursive: true,
  });
  await mkdir(resolve(root, "apps/desktop/test"), { recursive: true });
  return root;
}

test("the pinned plugin snapshot is complete and unmodified", async () => {
  assert.equal(
    await snapshotDigest(resolve(distributionRoot, "plugin")),
    config.plugin.sha256,
  );
});

test("both update channels and all packagers target our release repository", async (t) => {
  const root = await fixture(t);
  await applyDistribution(root, distributionRoot);
  const channel = await import(
    pathToFileURL(
      resolve(root, "apps/desktop/scripts/desktop-release-channel.mjs"),
    )
  );
  for (const name of ["latest", "nightly"]) {
    const release = channel.createDesktopReleaseConfig(name);
    assert.match(release.appId, /^tg\.vrata\.bb/);
    assert.match(release.applicationName, /^Vrata BB/);
    assert.equal(
      channel.createDesktopUpdateReleaseBaseUrl(release.releaseTag),
      `https://github.com/${config.releaseRepository}/releases/download/desktop-${name}/`,
    );
  }
  const provider = await readFile(
    resolve(root, "apps/desktop/src/desktop-update-provider.ts"),
    "utf8",
  );
  assert(!provider.includes("github.com/get-bb/bb/releases"));
  assert(
    provider.includes(
      `github.com/${config.releaseRepository}/releases/download/`,
    ),
  );
  const desktop = JSON.parse(
    await readFile(resolve(root, "apps/desktop/package.json"), "utf8"),
  );
  assert.equal(desktop.version, config.version);
  assert(desktop.scripts["desktop:build"].includes("--publish never"));
  const runtime = await readFile(
    resolve(root, "packages/config/src/runtime.ts"),
    "utf8",
  );
  assert(runtime.includes(`BB_PROD_DATA_DIR_NAME = "${config.dataDirectory}"`));
  assert(runtime.includes(`BB_PROD_SERVER_PORT = ${config.serverPort}`));
  assert(
    runtime.includes(`BB_PROD_HOST_DAEMON_PORT = ${config.hostDaemonPort}`),
  );
});

test("upstream drift fails before modifying any source file", async (t) => {
  const root = await fixture(t);
  const drifted = resolve(root, "turbo.json");
  await writeFile(
    drifted,
    (await readFile(drifted, "utf8")).replace(
      '"prepare:bundled":',
      '"prepare:new":',
    ),
  );
  const before = await Promise.all(
    paths.map((path) => readFile(resolve(root, path), "utf8")),
  );
  await assert.rejects(
    applyDistribution(root, distributionRoot),
    /Upstream changed/,
  );
  assert.deepEqual(
    await Promise.all(
      paths.map((path) => readFile(resolve(root, path), "utf8")),
    ),
    before,
  );
});
