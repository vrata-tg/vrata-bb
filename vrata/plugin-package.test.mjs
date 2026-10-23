import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { parsePluginRelease, unpackPlugin } from "./plugin-package.mjs";

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "vrata-plugin-package-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "package/dist"), { recursive: true });
  await writeFile(
    resolve(root, "package/package.json"),
    JSON.stringify({
      name: "@vrata-ai/bb-plugin",
      version: "0.1.1",
    }),
  );
  for (const artifact of ["server", "app", "host"]) {
    const bytes = "export default {};\n";
    await writeFile(resolve(root, "package/dist", `${artifact}.js`), bytes);
    await writeFile(
      resolve(root, "package/dist", `${artifact}.meta.json`),
      JSON.stringify({
        pluginId: "bb-plugin",
        pluginVersion: "0.1.1",
        artifactFormatVersion: 1,
        sdkMajor: 0,
        artifactDigest: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
  }
  const archive = resolve(root, "plugin.tgz");
  execFileSync("tar", ["-czf", archive, "-C", root, "package"]);
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(archive))
    .digest("base64")}`;
  return {
    archive,
    target: resolve(root, "output"),
    plugin: {
      package: "@vrata-ai/bb-plugin",
      version: "0.1.1",
      integrity,
    },
  };
}

test("extracts a versioned npm package and verifies its host bundle", async (t) => {
  const { archive, target, plugin } = await fixture(t);
  assert.deepEqual(await unpackPlugin(archive, target, plugin), plugin);
  assert.equal(
    JSON.parse(await readFile(resolve(target, "package.json"), "utf8")).name,
    plugin.package,
  );
});

test("rejects a changed tarball before extracting and refuses a mismatched version", async (t) => {
  const { archive, target, plugin } = await fixture(t);
  await assert.rejects(
    unpackPlugin(archive, target, {
      ...plugin,
      integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    }),
    /integrity mismatch/,
  );
  await assert.rejects(readdir(target), { code: "ENOENT" });
  await assert.rejects(
    unpackPlugin(archive, target, { ...plugin, version: "0.1.2" }),
    /version mismatch/,
  );
});

test("npm latest must identify our package, a stable version and SHA-512 integrity", () => {
  const metadata = {
    name: "@vrata-ai/bb-plugin",
    version: "0.1.1",
    dist: { integrity: `sha512-${Buffer.alloc(64).toString("base64")}` },
  };
  assert.equal(parsePluginRelease(metadata, metadata.name).version, "0.1.1");
  assert.throws(() =>
    parsePluginRelease({ ...metadata, version: "0.2.0-beta.1" }, metadata.name),
  );
  assert.throws(() =>
    parsePluginRelease({ ...metadata, name: "another-plugin" }, metadata.name),
  );
  assert.throws(() =>
    parsePluginRelease(
      { ...metadata, dist: { integrity: "sha1-abc" } },
      metadata.name,
    ),
  );
});
