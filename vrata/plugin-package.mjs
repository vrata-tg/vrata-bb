import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parsePlugin(value) {
  assert.equal(value.package, "@vrata-ai/bb-plugin");
  assert.match(
    value.version,
    versionPattern,
    "Expected a stable plugin version",
  );
  assert.match(value.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  return {
    package: value.package,
    version: value.version,
    integrity: value.integrity,
  };
}

export async function readPluginConfig(distributionRoot) {
  const { plugin } = JSON.parse(
    await readFile(resolve(distributionRoot, "distribution.json"), "utf8"),
  );
  return parsePlugin(plugin);
}

export function parsePluginRelease(metadata, packageName) {
  assert.equal(metadata.name, packageName);
  return parsePlugin({
    package: metadata.name,
    version: metadata.version,
    integrity: metadata.dist.integrity,
  });
}

export async function latestPluginRelease(packageName) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    { signal: AbortSignal.timeout(30_000) },
  );
  assert(response.ok, `npm metadata request failed: ${response.status}`);
  return parsePluginRelease(await response.json(), packageName);
}

export async function unpackPlugin(archive, target, plugin) {
  const bytes = await readFile(archive);
  assert.equal(
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    plugin.integrity,
    "Plugin tarball integrity mismatch",
  );
  const tar = (...args) => execFileSync("tar", args, { encoding: "utf8" });
  const entries = tar("-tzf", archive).trim().split(/\r?\n/);
  assert(
    entries.every(
      (entry) =>
        entry.startsWith("package/") &&
        !entry.includes("\\") &&
        !entry.split("/").some((part) => part === ".." || part === "."),
    ),
    "Unsafe plugin archive path",
  );
  assert(
    tar("-tvzf", archive)
      .trim()
      .split(/\r?\n/)
      .every((entry) => /^[-d]/.test(entry)),
    "Plugin archive must contain only regular files and directories",
  );
  await mkdir(target, { recursive: true });
  tar("-xzf", archive, "--strip-components=1", "-C", target);
  const manifest = JSON.parse(
    await readFile(resolve(target, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, plugin.package);
  assert.equal(
    manifest.version,
    plugin.version,
    "Plugin package version mismatch",
  );
  for (const artifact of ["server", "app", "host"]) {
    const meta = JSON.parse(
      await readFile(resolve(target, "dist", `${artifact}.meta.json`), "utf8"),
    );
    assert.equal(meta.pluginId, "bb-plugin");
    assert.equal(meta.pluginVersion, plugin.version);
    assert.equal(meta.artifactFormatVersion, 1);
    assert.equal(meta.sdkMajor, 0);
    const artifactBytes = await readFile(
      resolve(target, "dist", `${artifact}.js`),
    );
    if (artifact === "host") {
      assert.equal(
        createHash("sha256").update(artifactBytes).digest("hex"),
        meta.artifactDigest,
      );
    }
  }
  return plugin;
}

export async function fetchPluginPackage(target, plugin) {
  const temporary = await mkdtemp(resolve(tmpdir(), "vrata-plugin-fetch-"));
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${plugin.package}/-/bb-plugin-${plugin.version}.tgz`,
      { signal: AbortSignal.timeout(60_000) },
    );
    assert(response.ok, `npm tarball request failed: ${response.status}`);
    const archive = resolve(temporary, "plugin.tgz");
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    return await unpackPlugin(archive, target, plugin);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
