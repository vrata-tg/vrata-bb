import { expect, it } from "vitest";
import {
  createDesktopReleaseInfo,
  createDesktopUpdateFeedUrl,
  DESKTOP_AUTO_UPDATE_FEED_CONFIG,
} from "../src/desktop-update-provider";

it("checks versions and downloads updates only from Vrata on every platform", () => {
  for (const channel of ["latest", "nightly"] as const) {
    expect(createDesktopReleaseInfo(channel).updateReleaseBaseUrl).toBe(
      `https://github.com/vrata-tg/vrata-bb/releases/download/desktop-${channel}/`,
    );
  }
  const base =
    "https://github.com/vrata-tg/vrata-bb/releases/download/desktop-latest/";
  expect(DESKTOP_AUTO_UPDATE_FEED_CONFIG.url).toBe(base);
  expect(createDesktopUpdateFeedUrl("macos")).toBe(
    `${base}desktop-version.json`,
  );
  expect(createDesktopUpdateFeedUrl("linux")).toBe(
    `${base}desktop-version-linux.json`,
  );
  expect(createDesktopUpdateFeedUrl("windows")).toBe(
    `${base}desktop-version-windows.json`,
  );
});
