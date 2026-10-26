import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppImageUpdater } from "electron-updater";
import { GenericProvider } from "electron-updater/out/providers/GenericProvider.js";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseDesktopVersionFeed } from "../src/desktop-update-check.js";
import { createElectronAutoUpdaterAdapter } from "../src/desktop-auto-update.js";

const cases = [
  { current: "0.47.1", latest: "0.47.1-r1", available: true },
  { current: "0.47.1-r1", latest: "0.47.1-r2", available: true },
  { current: "0.47.1-r2", latest: "0.47.1-r10", available: true },
  { current: "0.47.1-r10", latest: "0.47.1-r2", available: false },
  { current: "0.47.1-r2", latest: "0.47.1-r2", available: false },
  { current: "0.47.1-r2", latest: "0.47.1", available: false },
  { current: "0.47.1-r0", latest: "0.47.1", available: false },
  { current: "0.47.1-r10", latest: "0.47.2", available: true },
  { current: "0.47.1-r10", latest: "0.47.2-r1", available: true },
  { current: "0.47.2", latest: "0.47.1-r10", available: false },
  { current: "0.47.1-nightly.2", latest: "0.47.1-nightly.10", available: true },
  { current: "0.47.1", latest: "0.47.1-nightly.10", available: false },
];
const checkedAt = "2026-10-26T00:00:00.000Z";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function feed(version: string) {
  return {
    schemaVersion: 1,
    channel: "latest",
    platform: "macos",
    version,
    files: [{ url: "vrata.zip", sha512: "synthetic", size: 1 }],
    path: "vrata.zip",
    sha512: "synthetic",
    minimumSystemVersion: null,
    releaseDate: checkedAt,
    releaseName: `Vrata BB ${version}`,
    releaseNotes: null,
    stagingPercentage: null,
  };
}

describe("Vrata desktop update checks", () => {
  it.each(cases)(
    "compares $current to $latest",
    ({ current, latest, available }) => {
      const result = parseDesktopVersionFeed({
        channel: "latest",
        checkedAt,
        currentVersion: current,
        payloadText: JSON.stringify(feed(latest)),
        platform: "macos",
      });
      expect(result.kind).toBe("valid");
      if (result.kind !== "valid") throw new Error(result.reason);
      expect(result.info.updateAvailable).toBe(available);
    },
  );
});

describe("Vrata native updater", () => {
  it.each([
    ...cases.map((entry) => ({ ...entry, supported: true, rollout: 100 })),
    {
      current: "0.47.1",
      latest: "0.47.1-r1",
      available: false,
      supported: false,
      rollout: 100,
    },
    {
      current: "0.47.1-r2",
      latest: "0.47.1-r10",
      available: false,
      supported: true,
      rollout: 0,
    },
  ])(
    "checks $current to $latest (OS supported: $supported, rollout: $rollout)",
    async ({ current, latest, available, supported, rollout }) => {
      const userDataPath = await mkdtemp(join(tmpdir(), "vrata-updater-"));
      directories.push(userDataPath);
      class PublishedFeedUpdater extends AppImageUpdater {
        protected override async getUpdateInfoAndProvider() {
          return {
            info: {
              version: latest,
              files: [],
              path: "vrata.AppImage",
              sha512: "synthetic",
              releaseDate: checkedAt,
              minimumSystemVersion: supported ? "0.0.0" : "99999.0.0",
              stagingPercentage: rollout,
            },
            provider: new GenericProvider(
              {
                provider: "generic",
                url: "https://example.test/",
                channel: "latest",
              },
              this,
              {
                isUseMultipleRangeRequest: false,
                platform: "linux",
                executor: new ElectronHttpExecutor(),
              },
            ),
          };
        }
      }
      const updater = new PublishedFeedUpdater(null, {
        version: current,
        name: "Vrata BB",
        isPackaged: true,
        appUpdateConfigPath: "",
        userDataPath,
        baseCachePath: "",
        whenReady: async () => undefined,
        relaunch: () => undefined,
        quit: () => undefined,
        onQuit: () => undefined,
      });
      const adapter = createElectronAutoUpdaterAdapter(
        updater,
        new EventEmitter(),
        null,
      );
      adapter.setLogger({ error() {}, info() {}, warn() {} });
      adapter.setForceDevUpdateConfig(true);
      adapter.setAutoDownload(false);
      expect((await adapter.checkForUpdates())?.isUpdateAvailable).toBe(
        available,
      );
    },
  );
});
