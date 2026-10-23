import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { copyPluginSources } from "./plugin-source.mjs";

const source = process.cwd();
const sdk = JSON.parse(
  await readFile(
    resolve(source, "../../packages/plugin-sdk/package.json"),
    "utf8",
  ),
);
const root = await mkdtemp(resolve(tmpdir(), "vrata-bundled-test-"));
try {
  await copyPluginSources(root);
  await cp(resolve(source, "packaging/pi"), resolve(root, "packaging/pi"), {
    recursive: true,
  });
  await cp(resolve(source, ".bundled-runtime/dist"), resolve(root, "dist"), {
    recursive: true,
  });
  const npm = (...args) =>
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  npm("ci", "--ignore-scripts", "--no-audit", "--no-fund");
  npm(
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    `@get-bb/plugin-sdk@${sdk.version}`,
  );
  const run = (...args) =>
    execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  run(
    resolve(root, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.tests.json",
  );
  run("scripts/bundle-test-runtime.mjs");
  run(
    "--test",
    "--test-concurrency=1",
    ...(await readdir(resolve(root, "tests")))
      .filter((name) => name.endsWith(".test.mjs"))
      .sort()
      .map((name) => `tests/${name}`),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
