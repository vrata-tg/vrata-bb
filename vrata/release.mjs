import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginPin } from "./plugin-source.mjs";

const feeds = [
  ["macos", "desktop-version.json", "latest-mac.yml", [".dmg", ".zip"]],
  ["linux", "desktop-version-linux.json", "latest-linux.yml", [".AppImage"]],
  ["windows", "desktop-version-windows.json", "latest.yml", [".exe"]],
];

export async function prepareRelease(directory, config) {
  assert.match(config.upstream.version, /^\d+\.\d+\.\d+$/);
  assert.match(config.releaseRepository, /^[\w-]+\/[\w.-]+$/);
  const tag = `vrata-v${config.upstream.version}`;
  const base = `https://github.com/${config.releaseRepository}/releases/download/${tag}/`;
  const metadata = [];
  const assets = new Set();
  const outputs = new Map();
  for (const [platform, json, yaml, extensions] of feeds) {
    const feed = JSON.parse(await readFile(resolve(directory, json), "utf8"));
    assert.equal(feed.version, config.upstream.version);
    assert.equal(feed.platform, platform);
    assert.equal(feed.channel, "latest");
    assert.equal(feed.schemaVersion, 1);
    assert(Array.isArray(feed.files) && feed.files.length > 0);
    const names = [];
    for (const file of feed.files) {
      assert.equal(typeof file.url, "string");
      const name = file.url.startsWith(base)
        ? file.url.slice(base.length)
        : file.url;
      assert.match(name, /^[\w.-]+$/);
      assert.equal(basename(name), name);
      assert(name.startsWith(`vrata-bb-${config.upstream.version}-`));
      const bytes = await readFile(resolve(directory, name));
      assert.equal(bytes.length, file.size, `Size mismatch: ${name}`);
      assert.equal(
        createHash("sha512").update(bytes).digest("base64"),
        file.sha512,
        `Checksum mismatch: ${name}`,
      );
      assets.add(name);
      names.push(name);
      file.url = `${base}${name}`;
    }
    for (const extension of extensions)
      assert(
        names.some((name) => name.endsWith(extension)),
        `Missing ${platform} ${extension}`,
      );
    const path = feed.path.startsWith(base)
      ? feed.path.slice(base.length)
      : feed.path;
    const primary = feed.files.find((file) => file.url === `${base}${path}`);
    assert(primary, `Missing primary asset: ${feed.path}`);
    assert.equal(primary.sha512, feed.sha512);
    feed.path = `${base}${path}`;
    outputs.set(json, `${JSON.stringify(feed, null, 2)}\n`);
    const update = {
      version: feed.version,
      files: feed.files,
      path: feed.path,
      sha512: feed.sha512,
      releaseDate: feed.releaseDate,
      releaseName: feed.releaseName,
      ...(feed.minimumSystemVersion
        ? { minimumSystemVersion: feed.minimumSystemVersion }
        : {}),
    };
    outputs.set(yaml, `${JSON.stringify(update, null, 2)}\n`);
    metadata.push(json, yaml);
  }
  for (const name of await readdir(directory)) {
    if (
      name.endsWith(".blockmap") &&
      assets.has(name.slice(0, -".blockmap".length))
    )
      assets.add(name);
  }
  for (const [name, content] of outputs)
    await writeFile(resolve(directory, name), content);
  return { tag, assets: [...assets], metadata };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(
    await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), "distribution.json"),
      "utf8",
    ),
  );
  const directory = resolve(process.argv[2] ?? "apps/desktop/release");
  const result = await prepareRelease(directory, config);
  if (process.argv.includes("--publish")) {
    assert.equal(process.env.GITHUB_REPOSITORY, config.releaseRepository);
    assert.equal(
      process.env.GITHUB_REF,
      "refs/heads/main",
      "Publish only from main",
    );
    assert.match(process.env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
    const gh = (...args) =>
      execFileSync("gh", [...args, "--repo", config.releaseRepository], {
        stdio: "inherit",
      });
    gh(
      "release",
      "create",
      result.tag,
      ...result.assets.map((name) => resolve(directory, name)),
      "--target",
      process.env.GITHUB_SHA,
      "--title",
      `Vrata BB ${config.upstream.version}`,
      "--notes",
      `BB ${config.upstream.version}; Vrata plugin ${pluginPin().commit}.`,
      "--latest=false",
    );
    const releases = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/${config.releaseRepository}/releases?per_page=100`],
        { encoding: "utf8" },
      ),
    );
    if (!releases.some((release) => release.tag_name === "desktop-latest")) {
      gh(
        "release",
        "create",
        "desktop-latest",
        "--target",
        process.env.GITHUB_SHA,
        "--title",
        "Vrata BB updates",
        "--notes",
        "Stable update channel for Vrata BB.",
        "--latest",
      );
    }
    gh(
      "release",
      "upload",
      "desktop-latest",
      ...result.metadata.map((name) => resolve(directory, name)),
      "--clobber",
    );
  }
  console.log(JSON.stringify(result));
}
