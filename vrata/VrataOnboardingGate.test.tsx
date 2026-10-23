// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingGate } from "./VrataOnboardingGate";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
  config: vi.fn(),
  host: vi.fn(),
}));
vi.mock("@/lib/plugin-sdk-hooks", () => ({ callPluginRpc: mocks.rpc }));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.config,
}));
vi.mock("@/hooks/queries/host-queries", () => ({ usePrimaryHost: mocks.host }));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutateAsync: mocks.update }),
}));

function settings(completed: string | null = null) {
  mocks.config.mockReturnValue({
    data: {
      generalSettings: {
        onboardingCompletedAt: completed,
        providerOrder: ["provider-codex", "vrata"],
      },
    },
    isError: false,
  });
}
const configured = (value: boolean, hostId = "local") => ({
  hostId,
  configured: value,
  baseUrl: "https://example.invalid/v1",
});
const content = (
  <OnboardingGate>
    <div>Workspace</div>
  </OnboardingGate>
);

beforeEach(() => {
  vi.resetAllMocks();
  settings();
  mocks.host.mockReturnValue({ id: "local", status: "connected" });
  mocks.rpc.mockResolvedValue(configured(false));
  mocks.update.mockResolvedValue(undefined);
});
afterEach(cleanup);

async function submitKey() {
  fireEvent.change(await screen.findByLabelText("Ключ API Врата AI"), {
    target: { value: "  synthetic-test-key  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Начать работу" }));
}

it("validates and saves on the local host before selecting Vrata and completing onboarding", async () => {
  mocks.rpc
    .mockResolvedValueOnce(configured(false))
    .mockResolvedValueOnce(configured(true));
  render(content);
  await submitKey();
  await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    fetch,
    "vrata",
    "saveCredentials",
    {
      target: { kind: "host", hostId: "local" },
      apiKey: "synthetic-test-key",
      baseUrl: "https://example.invalid/v1",
    },
  );
  expect(mocks.update).toHaveBeenCalledWith({
    defaultProviderId: "vrata",
    providerOrder: ["vrata", "provider-codex"],
    onboardingCompletedAt: expect.any(String),
  });
  expect(screen.queryByDisplayValue("synthetic-test-key")).toBeNull();
});

it("keeps rejected credentials out of the error and does not complete onboarding", async () => {
  mocks.rpc
    .mockResolvedValueOnce(configured(false))
    .mockRejectedValueOnce(new Error("synthetic-test-key rejected"));
  render(content);
  await submitKey();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("synthetic-test-key");
  expect(
    screen.getByLabelText<HTMLInputElement>("Ключ API Врата AI").value,
  ).toBe("");
});

it("retries settings persistence without asking for the already saved key", async () => {
  mocks.rpc
    .mockResolvedValueOnce(configured(false))
    .mockResolvedValueOnce(configured(true));
  mocks.update
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  render(content);
  await submitKey();
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Ключ API Врата AI")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Начать работу" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

it("does not reveal the app while an optimistic completion is still being saved", async () => {
  let resolveSave: () => void = () => {};
  mocks.rpc.mockResolvedValue(configured(true));
  mocks.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const view = render(content);
  fireEvent.click(await screen.findByRole("button", { name: "Начать работу" }));
  settings("2026-10-23T00:00:00Z");
  view.rerender(content);
  expect(screen.queryByText("Workspace")).toBeNull();
  await act(async () => resolveSave());
  expect(await screen.findByText("Workspace")).toBeTruthy();
});

it("does not complete for a stale save after switching hosts", async () => {
  let resolveSave: (value: ReturnType<typeof configured>) => void = () => {};
  mocks.rpc.mockResolvedValueOnce(configured(false)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  const view = render(content);
  await submitKey();
  mocks.host.mockReturnValue({ id: "other", status: "connected" });
  mocks.rpc.mockResolvedValue(configured(false, "other"));
  view.rerender(
    <OnboardingGate>
      <div>Workspace</div>
    </OnboardingGate>,
  );
  await act(async () => resolveSave(configured(true)));
  expect(mocks.update).not.toHaveBeenCalled();
});

it("rejects a configuration response for a different host", async () => {
  mocks.rpc.mockResolvedValue(configured(true, "wrong-host"));
  render(content);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Начать работу" })).toBeNull();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("waits for the plugin to start without requiring a manual retry", async () => {
  mocks.rpc
    .mockRejectedValueOnce(new Error("starting"))
    .mockResolvedValueOnce(configured(false));
  render(content);
  expect(
    await screen.findByLabelText("Ключ API Врата AI", {}, { timeout: 3000 }),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("opens a completed installation without reading credentials", () => {
  settings("2026-10-23T00:00:00Z");
  render(content);
  expect(screen.getByText("Workspace")).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
