import semver from "semver";
import type { SemVer } from "semver";
import type { AppUpdater } from "electron-updater";

function revision(version: SemVer): bigint | null {
  if (version.prerelease.length === 0) return 0n;
  if (version.prerelease.length !== 1) return null;
  const match = /^r(0|[1-9]\d*)$/.exec(String(version.prerelease[0]));
  return match === null ? null : BigInt(match[1]);
}

export function compareDesktopVersions(left: SemVer, right: SemVer): number {
  if (
    left.major === right.major &&
    left.minor === right.minor &&
    left.patch === right.patch
  ) {
    const leftRevision = revision(left);
    const rightRevision = revision(right);
    if (leftRevision !== null && rightRevision !== null) {
      if (leftRevision === rightRevision) return 0;
      return leftRevision > rightRevision ? 1 : -1;
    }
  }
  return semver.compare(left, right);
}

export function configureDesktopRevisionUpdates(updater: AppUpdater): void {
  const isUpdateSupported = updater.isUpdateSupported;
  updater.isUpdateSupported = async (info) => {
    const version = semver.parse(info.version);
    return (
      version !== null &&
      compareDesktopVersions(version, updater.currentVersion) > 0 &&
      (await isUpdateSupported(info))
    );
  };
  updater.allowDowngrade = true;
}
