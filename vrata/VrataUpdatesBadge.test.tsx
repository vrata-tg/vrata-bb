// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";

vi.mock("@/hooks/useUpdateInventory", async () => {
  const { useUpdateInventory } = await vi.importActual<
    typeof import("@/hooks/useUpdateInventory")
  >("@/hooks/useUpdateInventory");
  return { useUpdateInventory: () => useUpdateInventory({ enabled: false }) };
});

vi.mock("@/components/provider-cli/provider-cli-install", () => ({
  useProviderCliInstallRunner: () => ({ runningJobKey: null }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { providers: { list: vi.fn(async () => []) } },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  window.localStorage.clear();
});

it("shows a desktop update received before download without opening settings", async () => {
  const desktopInfo: BbDesktopInfo = {
    lastCheckedAt: "2026-10-26T12:00:00.000Z",
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.47.1-r1",
  };
  const listeners = new Set<(info: BbDesktopInfo) => void>();
  window.bbDesktop = {
    ...createBbDesktopApi(desktopInfo),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarUpdatesBadge />
      </TooltipProvider>
    </MemoryRouter>,
    { wrapper },
  );
  await waitFor(() => expect(listeners.size).toBe(1));
  expect(screen.queryByTestId("sidebar-updates-badge-bb")).toBeNull();

  act(() => {
    for (const listener of listeners)
      listener({
        ...desktopInfo,
        latestVersion: "0.47.1-r2",
        updateAvailable: true,
        updateDownloaded: false,
      });
  });

  expect(
    screen
      .getByRole("link", { name: "bb update available" })
      .getAttribute("href"),
  ).toBe("/settings/updates");
  expect(screen.queryByTestId("sidebar-updates-badge-providers")).toBeNull();
});
