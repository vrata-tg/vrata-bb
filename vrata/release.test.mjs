import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { prepareRelease, publishRelease } from "./release.mjs";

const config = {
  upstream: { version: "0.46.1" },
  releaseRepository: "vrata-tg/vrata-bb",
  releaseRevision: 0,
  plugin: { version: "0.1.1" },
};

async function fixture(t, version = "0.46.1") {
  const root = await mkdtemp(resolve(tmpdir(), "vrata-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [platform, suffix, extensions] of [
    ["macos", "", ["arm64.dmg", "arm64.zip"]],
    ["linux", "-linux", ["x64.AppImage"]],
    ["windows", "-windows", ["x64.exe"]],
  ]) {
    const files = [];
    for (const extension of extensions) {
      const bytes = Buffer.from(`synthetic-${extension}`);
      const name = `vrata-bb-${version}-${extension}`;
      await writeFile(resolve(root, name), bytes);
      files.push({
        url: name,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      });
    }
    await writeFile(
      resolve(root, `desktop-version${suffix}.json`),
      JSON.stringify({
        schemaVersion: 1,
        platform,
        channel: "latest",
        version,
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        minimumSystemVersion: null,
        releaseDate: "2026-10-23T00:00:00Z",
        releaseName: `Vrata BB ${version}`,
      }),
    );
  }
  return root;
}

test("feeds resolve to immutable Vrata artifacts and can be validated twice", async (t) => {
  const root = await fixture(t);
  const result = await prepareRelease(root, config);
  assert.equal(result.assets.length, 4);
  assert.equal(result.metadata.length, 6);
  for (const name of result.metadata) {
    const feed = JSON.parse(await readFile(resolve(root, name), "utf8"));
    for (const file of feed.files)
      assert(
        file.url.startsWith(
          "https://github.com/vrata-tg/vrata-bb/releases/download/vrata-v0.46.1/",
        ),
      );
  }
  assert.deepEqual(await prepareRelease(root, config), result);
});

test("a corrupted installer prevents any feed rewrite", async (t) => {
  const root = await fixture(t);
  const before = await readFile(resolve(root, "desktop-version.json"), "utf8");
  await writeFile(resolve(root, "vrata-bb-0.46.1-x64.exe"), "wrong");
  await assert.rejects(prepareRelease(root, config), /Size mismatch/);
  assert.equal(
    await readFile(resolve(root, "desktop-version.json"), "utf8"),
    before,
  );
});

for (const [releaseRevision, version] of [
  [0, "0.46.1"],
  [1, "0.46.1-r1"],
  [12, "0.46.1-r12"],
]) {
  test(`publishing revision ${releaseRevision} freezes matching installers, feeds, tag and title`, async (t) => {
    const root = await fixture(t, version);
    const revised = { ...config, releaseRevision };
    const result = await prepareRelease(root, revised);
    assert.equal(result.tag, `vrata-v${version}`);
    assert(
      result.assets.every((name) => name.startsWith(`vrata-bb-${version}-`)),
    );
    let draft = null;
    let published = false;
    publishRelease(
      root,
      revised,
      result,
      {
        GITHUB_REPOSITORY: config.releaseRepository,
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: "a".repeat(40),
      },
      (...args) => {
        assert.equal(
          published,
          false,
          "An immutable release rejects later mutations",
        );
        if (args[1] === "create") {
          assert.equal(args[2], `vrata-v${version}`);
          assert.equal(
            args[args.indexOf("--title") + 1],
            `Vrata BB ${version}`,
          );
          const notes = args[args.indexOf("--notes") + 1];
          const base = `https://github.com/vrata-tg/vrata-bb/releases/download/vrata-v${version}/vrata-bb-${version}-`;
          assert.deepEqual(
            notes.split("\n").filter((line) => line.startsWith("|")),
            [
              "| Операционная система | Архитектура | Установщик |",
              "| --- | --- | --- |",
              `| macOS | arm64 (Apple Silicon) | [Скачать DMG](${base}arm64.dmg) |`,
              `| Linux | x64 | [Скачать AppImage](${base}x64.AppImage) |`,
              `| Windows | x64 | [Скачать EXE](${base}x64.exe) |`,
            ],
          );
          assert(
            notes.includes(
              `BB ${config.upstream.version}; плагин Vrata v${config.plugin.version}.`,
            ),
          );
          assert(
            notes.includes(
              'xattr -d com.apple.quarantine "/Applications/Vrata BB.app"',
            ),
          );
          for (const text of [
            "## Скачать приложение",
            "## Установка на macOS",
            "1. Откройте DMG и перетащите **Vrata BB.app** в папку **Программы (Applications)**.",
            "2. После установки выполните в Терминале команду для снятия атрибута карантина с неподписанного приложения:",
            "3. Запустите **Vrata BB** из папки **Программы**.",
          ])
            assert(notes.includes(text));
          assert(args.includes("--draft"));
          draft = args.filter((arg) => arg.startsWith(root));
          return;
        }
        assert.deepEqual(args, [
          "release",
          "edit",
          result.tag,
          "--draft=false",
          "--latest",
        ]);
        assert.deepEqual(
          new Set(draft),
          new Set(
            [...result.assets, ...result.metadata].map((name) =>
              resolve(root, name),
            ),
          ),
        );
        published = true;
      },
    );
    assert.equal(published, true);
    const feed = JSON.parse(
      await readFile(resolve(root, "desktop-version.json"), "utf8"),
    );
    assert.equal(feed.version, version);
    assert(feed.path.includes(`/releases/download/${result.tag}/`));
    for (const name of result.metadata) {
      const metadata = JSON.parse(await readFile(resolve(root, name), "utf8"));
      assert.equal(metadata.version, version);
      assert.equal(metadata.releaseName, `Vrata BB ${version}`);
      assert(
        metadata.files.every((file) =>
          file.url.startsWith(
            `https://github.com/vrata-tg/vrata-bb/releases/download/vrata-v${version}/vrata-bb-${version}-`,
          ),
        ),
      );
    }
    assert.deepEqual(await prepareRelease(root, revised), result);
  });
}

test("missing platform artifacts prevent publication", async (t) => {
  const root = await fixture(t);
  await rm(resolve(root, "vrata-bb-0.46.1-arm64.zip"));
  await assert.rejects(prepareRelease(root, config), /ENOENT/);
});

test("installers with a different BB version cannot enter the update channel", async (t) => {
  const root = await fixture(t);
  const path = resolve(root, "desktop-version-windows.json");
  const feed = JSON.parse(await readFile(path, "utf8"));
  feed.version = "0.46.0";
  await writeFile(path, JSON.stringify(feed));
  const before = await readFile(resolve(root, "desktop-version.json"), "utf8");
  await assert.rejects(prepareRelease(root, config), { code: "ERR_ASSERTION" });
  assert.equal(
    await readFile(resolve(root, "desktop-version.json"), "utf8"),
    before,
  );
});

test("a revision cannot publish feeds from an earlier build", async (t) => {
  const root = await fixture(t);
  const before = await readFile(resolve(root, "desktop-version.json"), "utf8");
  await assert.rejects(
    prepareRelease(root, { ...config, releaseRevision: 1 }),
    { code: "ERR_ASSERTION" },
  );
  assert.equal(
    await readFile(resolve(root, "desktop-version.json"), "utf8"),
    before,
  );
});

test("matching feed versions cannot admit installers from another revision", async (t) => {
  const root = await fixture(t, "0.46.1-r10");
  for (const name of [
    "desktop-version.json",
    "desktop-version-linux.json",
    "desktop-version-windows.json",
  ]) {
    const path = resolve(root, name);
    const feed = JSON.parse(await readFile(path, "utf8"));
    feed.version = "0.46.1-r1";
    await writeFile(path, JSON.stringify(feed));
  }
  const path = resolve(root, "desktop-version.json");
  const before = await readFile(path, "utf8");
  await assert.rejects(
    prepareRelease(root, { ...config, releaseRevision: 1 }),
    { code: "ERR_ASSERTION" },
  );
  assert.equal(await readFile(path, "utf8"), before);
});
