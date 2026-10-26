import assert from "node:assert/strict";

export function distributionVersion(config) {
  assert.match(config.upstream.version, /^\d+\.\d+\.\d+$/);
  assert(
    Number.isSafeInteger(config.releaseRevision) && config.releaseRevision >= 0,
    "releaseRevision must be a nonnegative safe integer",
  );
  return config.releaseRevision === 0
    ? config.upstream.version
    : `${config.upstream.version}-r${config.releaseRevision}`;
}
