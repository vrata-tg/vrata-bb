import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPluginApp,
  buildPluginServer,
  copyPluginRuntime,
  resolvePluginBuildToolchain,
} from "../packages/plugin-build/src/index.ts";
import { PLUGIN_SDK_MAJOR } from "../packages/domain/src/plugin-sdk-version.ts";

const sourceRoot = process.cwd();
const root = resolve(sourceRoot, "../..");
const bb = JSON.parse(
  await readFile(resolve(root, "packages/bb-app/package.json"), "utf8"),
);
const hostMeta = JSON.parse(
  await readFile(resolve(sourceRoot, "published-dist/host.meta.json"), "utf8"),
);
assert.equal(
  hostMeta.sdkMajor,
  PLUGIN_SDK_MAJOR,
  "Published host requires another SDK major",
);
await rm(resolve(sourceRoot, "dist"), { recursive: true, force: true });
await mkdir(resolve(sourceRoot, "dist"));
for (const name of ["host.js", "host.meta.json"]) {
  await cp(
    resolve(sourceRoot, "published-dist", name),
    resolve(sourceRoot, "dist", name),
  );
}
const toolchain = await resolvePluginBuildToolchain(
  resolve(root, "packages/plugin-build/node_modules/.bb-toolchain"),
);
await buildPluginServer(sourceRoot, bb.version, toolchain, {
  hostProvidedZod: true,
});
await buildPluginApp(sourceRoot, bb.version, toolchain);
const targetDir = resolve(sourceRoot, ".bundled-runtime");
await copyPluginRuntime({ sourceRoot, targetDir });
await cp(resolve(sourceRoot, "packaging"), resolve(targetDir, "packaging"), {
  recursive: true,
});
