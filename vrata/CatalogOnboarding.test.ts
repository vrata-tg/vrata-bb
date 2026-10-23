import { getAppSettings } from "@bb/db";
import { expect, it, vi } from "vitest";
import { resolveSystemExecutionOptions } from "../../src/services/system/execution-options.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  catalogAnswer,
  healthAnswer,
  installCatalogStore,
  modelList,
} from "../helpers/provider-model-catalogs.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

it("refreshes a catalog cached before credentials when onboarding completes", async () => {
  await withTestHarness(async (harness) => {
    installCatalogStore(harness, { clock: { now: 1_800_000_000_000 } });
    const { host, session } = seedHostSession(harness.deps);
    let configured = false;
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: ({ command }) => {
        if (command.type === "provider.health") return healthAnswer("ready");
        if (command.type === "provider.list_models")
          return catalogAnswer(
            modelList(configured ? "authenticated-model" : "setup-model"),
          );
        throw new Error(`Unexpected RPC ${command.type}`);
      },
    });
    const readModels = async () =>
      (
        await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "codex",
        })
      ).models.map((model) => model.model);
    expect(await readModels()).toEqual(["setup-model"]);
    configured = true;
    async function saveSettings(onboardingCompletedAt: string | null) {
      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...getAppSettings(harness.db),
          onboardingCompletedAt,
        }),
      });
      expect(response.status).toBe(200);
    }
    await saveSettings(null);
    expect(await readModels()).toEqual(["setup-model"]);
    await saveSettings("2026-10-23T00:00:00.000Z");
    await vi.waitFor(async () => {
      expect(await readModels()).toEqual(["authenticated-model"]);
    });
  });
});
