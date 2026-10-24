import assert from "node:assert/strict";

export function planUpdate(config, tag, plugin) {
  assert.match(tag, /^desktop-v\d+\.\d+\.\d+$/);
  const upstreamChanged = tag !== config.upstream.tag;
  if (!upstreamChanged && plugin.version === config.plugin.version) return null;
  const version = tag.slice("desktop-v".length);
  if (upstreamChanged) {
    const parts = (value) => value.split(".").map(Number);
    const current = parts(config.upstream.version);
    assert(
      parts(version).some(
        (value, index, next) =>
          value > current[index] &&
          next.slice(0, index).every((part, i) => part === current[i]),
      ),
      "Refusing an upstream downgrade",
    );
  }
  const releaseRevision = upstreamChanged ? 0 : config.releaseRevision + 1;
  assert(Number.isSafeInteger(releaseRevision) && releaseRevision >= 0);
  return {
    upstreamChanged,
    version,
    releaseRevision,
    branch: upstreamChanged
      ? `automation/bb-${version}`
      : `automation/plugin-${plugin.version}-bb-${version}-r${releaseRevision}`,
  };
}
