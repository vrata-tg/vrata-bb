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

async function fixture(t) {
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
      const name = `vrata-bb-0.46.1-${extension}`;
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
        version: "0.46.1",
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        minimumSystemVersion: null,
        releaseDate: "2026-10-23T00:00:00Z",
        releaseName: "Vrata BB 0.46.1",
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

test("publishing freezes installers and all update feeds in one release", async (t) => {
  const root = await fixture(t);
  const revised = { ...config, releaseRevision: 1 };
  const result = await prepareRelease(root, revised);
  assert.equal(result.tag, "vrata-v0.46.1-r1");
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
  assert.equal(feed.version, config.upstream.version);
  assert(feed.path.includes(`/releases/download/${result.tag}/`));
});

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
