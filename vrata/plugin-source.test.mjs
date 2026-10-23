import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { copyPluginSources, pluginPin } from "./plugin-source.mjs";

const git = (root, ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "vrata-plugin-source-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init");
  const source = resolve(root, "vrata/plugin");
  await mkdir(source, { recursive: true });
  git(source, "init");
  git(source, "config", "user.name", "Vrata test");
  git(source, "config", "user.email", "test@example.invalid");
  git(source, "config", "commit.gpgsign", "false");
  await writeFile(resolve(source, "host.ts"), "export const version = 1;\n");
  await writeFile(
    resolve(source, "package.json"),
    '{"name":"bb-plugin-vrata"}\n',
  );
  git(source, "add", ".");
  git(source, "commit", "-m", "Initial plugin");
  const commit = git(source, "rev-parse", "HEAD");
  await writeFile(
    resolve(root, ".gitmodules"),
    '[submodule "vrata-plugin"]\n\tpath = vrata/plugin\n\turl = https://github.com/vrata-tg/vrata-bb-plugin.git\n',
  );
  git(root, "update-index", "--add", "--cacheinfo", `160000,${commit},vrata/plugin`);
  return { root, source, commit, target: resolve(root, "export") };
}

test("exports the pinned commit without local edits, credentials or Git metadata", async (t) => {
  const { root, source, commit, target } = await fixture(t);
  await writeFile(resolve(source, "host.ts"), "local modification\n");
  await writeFile(resolve(source, "credentials.json"), "synthetic local secret\n");
  assert.deepEqual(await copyPluginSources(target, root), {
    repository: "vrata-tg/vrata-bb-plugin",
    commit,
  });
  assert.equal(
    await readFile(resolve(target, "host.ts"), "utf8"),
    "export const version = 1;\n",
  );
  assert.deepEqual((await readdir(target)).sort(), ["host.ts", "package.json"]);
});

test("rejects a different checkout until its commit is explicitly pinned", async (t) => {
  const { root, source, target } = await fixture(t);
  await writeFile(resolve(source, "host.ts"), "export const version = 2;\n");
  git(source, "commit", "-am", "Next plugin");
  await assert.rejects(copyPluginSources(target, root), /Plugin revision mismatch/);
  const commit = git(source, "rev-parse", "HEAD");
  git(root, "update-index", "--cacheinfo", `160000,${commit},vrata/plugin`);
  assert.equal(pluginPin(root).commit, commit);
  await copyPluginSources(target, root);
  assert.equal(
    await readFile(resolve(target, "host.ts"), "utf8"),
    "export const version = 2;\n",
  );
});

test("an uninitialized submodule fails with setup instructions", async (t) => {
  const { root, source, target } = await fixture(t);
  await rm(resolve(source, ".git"), { recursive: true });
  await assert.rejects(copyPluginSources(target, root), /git submodule update --init/);
});
