import { describe, expect, it, vi } from "vitest";
import { loadDebug, type DebugState } from "./debug.ts";

describe("debug controller", () => {
  it("loads status snapshots", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "status") {
        return { ok: true };
      }
      if (method === "health") {
        return { healthy: true };
      }
      if (method === "models.list") {
        return { models: [{ id: "gpt-5" }] };
      }
      if (method === "last-heartbeat") {
        return { ts: 1 };
      }
      return {};
    });

    const state: DebugState = {
      client: {
        request,
      } as unknown as DebugState["client"],
      connected: true,
      debugLoading: false,
      debugStatus: null,
      debugHealth: null,
      debugModels: [],
      debugHeartbeat: null,
      debugCallMethod: "",
      debugCallParams: "{}",
      debugCallResult: null,
      debugCallError: null,
    };

    await loadDebug(state);

    expect(state.debugModels).toEqual([{ id: "gpt-5" }]);
    expect(request).toHaveBeenCalledWith("status", {});
    expect(request).toHaveBeenCalledWith("health", {});
    expect(request).toHaveBeenCalledWith("models.list", {});
    expect(request).toHaveBeenCalledWith("last-heartbeat", {});
  });

  it("stores debug error when load fails", async () => {
    const state: DebugState = {
      client: {
        request: vi.fn(async () => {
          throw new Error("forbidden");
        }),
      } as unknown as DebugState["client"],
      connected: true,
      debugLoading: false,
      debugStatus: null,
      debugHealth: null,
      debugModels: [],
      debugHeartbeat: null,
      debugCallMethod: "",
      debugCallParams: "{}",
      debugCallResult: null,
      debugCallError: null,
    };

    await loadDebug(state);

    expect(state.debugCallError).toContain("forbidden");
  });
});
