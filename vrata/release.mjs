import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { distributionVersion } from "./version.mjs";

const feeds = [
  ["macos", "desktop-version.json", "latest-mac.yml", [".dmg", ".zip"]],
  ["linux", "desktop-version-linux.json", "latest-linux.yml", [".AppImage"]],
  ["windows", "desktop-version-windows.json", "latest.yml", [".exe"]],
];

export async function prepareRelease(directory, config) {
  const version = distributionVersion(config);
  assert.match(config.releaseRepository, /^[\w-]+\/[\w.-]+$/);
  const tag = `vrata-v${version}`;
  const base = `https://github.com/${config.releaseRepository}/releases/download/${tag}/`;
  const metadata = [];
  const assets = new Set();
  const outputs = new Map();
  const downloads = [];
  for (const [platform, json, yaml, extensions] of feeds) {
    const feed = JSON.parse(await readFile(resolve(directory, json), "utf8"));
    assert.equal(feed.version, version);
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
      const artifact = /^vrata-bb-(\d+\.\d+\.\d+(?:-r\d+)?)-[\w.-]+$/.exec(
        name,
      );
      assert.equal(
        artifact?.[1],
        version,
        `Unexpected installer version: ${name}`,
      );
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
    const extension = extensions[0];
    const system = { macos: "macOS", linux: "Linux", windows: "Windows" }[
      platform
    ];
    for (const name of names.filter((name) => name.endsWith(extension))) {
      const arch = name.slice(`vrata-bb-${version}-`.length, -extension.length);
      const architecture =
        platform === "macos" && arch === "arm64"
          ? "arm64 (Apple Silicon)"
          : arch;
      const format =
        extension === ".AppImage"
          ? "AppImage"
          : extension.slice(1).toUpperCase();
      downloads.push(
        `| ${system} | ${architecture} | [Скачать ${format}](${base}${name}) |`,
      );
    }
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
  const notes = [
    `BB ${config.upstream.version}; плагин Vrata v${config.plugin.version}.`,
    "",
    "## Скачать приложение",
    "",
    "| Операционная система | Архитектура | Установщик |",
    "| --- | --- | --- |",
    ...downloads,
    "",
    "## Установка на macOS",
    "",
    "1. Откройте DMG и перетащите **Vrata BB.app** в папку **Программы (Applications)**.",
    "2. После установки выполните в Терминале команду:",
    "",
    "   ```sh",
    '   xattr -d com.apple.quarantine "/Applications/Vrata BB.app"',
    "   ```",
    "",
    "3. Запустите **Vrata BB** из папки **Программы**.",
    "",
  ].join("\n");
  return { tag, assets: [...assets], metadata, notes };
}

export function publishRelease(directory, config, result, environment, gh) {
  assert.equal(environment.GITHUB_REPOSITORY, config.releaseRepository);
  assert.equal(
    environment.GITHUB_REF,
    "refs/heads/main",
    "Publish only from main",
  );
  assert.match(environment.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  gh(
    "release",
    "create",
    result.tag,
    ...[...result.assets, ...result.metadata].map((name) =>
      resolve(directory, name),
    ),
    "--target",
    environment.GITHUB_SHA,
    "--title",
    `Vrata BB ${distributionVersion(config)}`,
    "--notes",
    result.notes,
    "--draft",
  );
  gh("release", "edit", result.tag, "--draft=false", "--latest");
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
    const gh = (...args) =>
      execFileSync("gh", [...args, "--repo", config.releaseRepository], {
        stdio: "inherit",
      });
    publishRelease(directory, config, result, process.env, gh);
  }
  console.log(JSON.stringify(result));
}
