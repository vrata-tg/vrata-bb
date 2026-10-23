import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function snapshotDigest(root) {
  const hash = createHash("sha256");
  async function visit(directory) {
    for (const entry of (
      await readdir(resolve(root, directory), { withFileTypes: true })
    ).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else {
        assert(entry.isFile(), `Unexpected snapshot entry: ${path}`);
        const bytes = await readFile(resolve(root, path));
        hash.update(JSON.stringify([path, bytes.length])).update(bytes);
      }
    }
  }
  await visit("");
  return hash.digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, revision] = process.argv.slice(2);
  assert(
    source && revision,
    "Usage: node vrata/snapshot.mjs PLUGIN_CHECKOUT COMMIT",
  );
  const root = dirname(fileURLToPath(import.meta.url));
  const commit = execFileSync("git", ["rev-parse", `${revision}^{commit}`], {
    cwd: source,
    encoding: "utf8",
  }).trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", commit], {
    cwd: source,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(
      (path) =>
        /^[^/]+\.(ts|tsx|json)$/.test(path) ||
        /^(pi|packaging|scripts|tests)\//.test(path) ||
        path === "README.md",
    );
  const target = resolve(root, "plugin");
  await rm(target, { recursive: true, force: true });
  for (const file of files) {
    const bytes = execFileSync("git", ["show", `${commit}:${file}`], {
      cwd: source,
      maxBuffer: 20 * 1024 * 1024,
    });
    await mkdir(dirname(resolve(target, file)), { recursive: true });
    await writeFile(resolve(target, file), bytes);
  }
  const configPath = resolve(root, "distribution.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.plugin.commit = commit;
  config.plugin.sha256 = await snapshotDigest(target);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Pinned ${files.length} plugin source files at ${commit}`);
}
