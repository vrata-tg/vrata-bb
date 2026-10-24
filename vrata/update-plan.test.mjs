import assert from "node:assert/strict";
import { test } from "node:test";
import { planUpdate } from "./update-plan.mjs";

test("plans plugin-only releases without waiting for a new BB version", () => {
  const config = {
    upstream: { tag: "desktop-v0.46.1", version: "0.46.1" },
    plugin: { version: "0.1.1" },
    releaseRevision: 1,
  };
  assert.equal(planUpdate(config, config.upstream.tag, config.plugin), null);
  assert.deepEqual(
    planUpdate(config, config.upstream.tag, { version: "0.1.7" }),
    {
      upstreamChanged: false,
      version: "0.46.1",
      releaseRevision: 2,
      branch: "automation/plugin-0.1.7-bb-0.46.1-r2",
    },
  );
  assert.deepEqual(planUpdate(config, "desktop-v0.46.2", config.plugin), {
    upstreamChanged: true,
    version: "0.46.2",
    releaseRevision: 0,
    branch: "automation/bb-0.46.2",
  });
  assert.throws(
    () => planUpdate(config, "desktop-v0.46.0", { version: "0.1.7" }),
    /upstream downgrade/,
  );
});
