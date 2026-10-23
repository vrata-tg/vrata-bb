import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (root, ...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export function pluginPin(root = repository) {
  const entry = git(root, "ls-files", "--stage", "--", "vrata/plugin");
  const match = /^160000 ([a-f0-9]{40}) 0\tvrata\/plugin$/.exec(entry);
  assert(match, "Expected a pinned vrata/plugin Git submodule");
  const url = git(
    root,
    "config",
    "--file",
    ".gitmodules",
    "--get",
    "submodule.vrata-plugin.url",
  );
  const remote = /^https:\/\/github\.com\/([\w-]+\/[\w.-]+)\.git$/.exec(url);
  assert(remote, "Expected a GitHub HTTPS plugin repository");
  return { repository: remote[1], commit: match[1] };
}

export async function copyPluginSources(target, root = repository) {
  const pin = pluginPin(root);
  const source = resolve(root, "vrata/plugin");
  assert(
    await lstat(resolve(source, ".git")).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    ),
    "Initialize the plugin first: git submodule update --init -- vrata/plugin",
  );
  assert.equal(
    git(source, "rev-parse", "HEAD"),
    pin.commit,
    "Plugin revision mismatch; run git submodule update --init -- vrata/plugin",
  );
  const entries = git(source, "ls-tree", "-r", "-z", pin.commit)
    .split("\0")
    .filter(Boolean);
  for (const entry of entries) {
    const [metadata, path] = entry.split("\t");
    if (
      !(
        /^[^/]+\.(ts|tsx|json)$/.test(path) ||
        /^(pi|packaging|scripts|tests)\//.test(path) ||
        path === "README.md"
      )
    ) continue;
    assert(
      /^100(644|755) blob /.test(metadata),
      `Unexpected plugin source entry: ${path}`,
    );
    const bytes = execFileSync("git", ["show", `${pin.commit}:${path}`], {
      cwd: source,
      maxBuffer: 20 * 1024 * 1024,
    });
    await mkdir(dirname(resolve(target, path)), { recursive: true });
    await writeFile(resolve(target, path), bytes);
  }
  return pin;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, value] of Object.entries(pluginPin()))
    console.log(`${name}=${value}`);
}
