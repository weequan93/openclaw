import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  loadProviderUsageSummary: vi.fn(async () => ({ providers: [] })),
  loadCostUsageSummary: vi.fn(async () => ({
    updatedAt: Date.now(),
    startDate: "2026-02-01",
    endDate: "2026-02-02",
    daily: [],
    totals: {
      totalTokens: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalCost: 0,
    },
  })),
  loadSessionUsageTimeSeries: vi.fn(async () => ({ points: [] })),
  loadSessionLogs: vi.fn(async () => []),
  loadSessionEntry: vi.fn(() => ({
    key: "agent:main:s-1",
    entry: {
      sessionId: "s-1",
      sessionFile: "/tmp/s-1.jsonl",
      ownerUserId: "user-b",
    },
  })),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
  };
});

vi.mock("../../infra/provider-usage.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/provider-usage.js")>(
    "../../infra/provider-usage.js",
  );
  return {
    ...actual,
    loadProviderUsageSummary: mocks.loadProviderUsageSummary,
  };
});

vi.mock("../../infra/session-cost-usage.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/session-cost-usage.js")>(
    "../../infra/session-cost-usage.js",
  );
  return {
    ...actual,
    loadCostUsageSummary: mocks.loadCostUsageSummary,
    loadSessionUsageTimeSeries: mocks.loadSessionUsageTimeSeries,
    loadSessionLogs: mocks.loadSessionLogs,
  };
});

vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../session-utils.js")>("../session-utils.js");
  return {
    ...actual,
    loadSessionEntry: mocks.loadSessionEntry,
  };
});

import { usageHandlers } from "./usage.js";

const adminOwner = {
  userId: "admin-1",
  principalId: "principal:admin-1",
  role: "admin" as const,
  sourceRole: "operator" as const,
  scopes: ["operator.admin"],
};

const userOwner = {
  userId: "user-a",
  principalId: "principal:user-a",
  role: "user" as const,
  sourceRole: "operator" as const,
  scopes: ["operator.read"],
};

describe("usage handler owner access policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies usage.status for non-admin callers", async () => {
    const respond = vi.fn();
    await usageHandlers["usage.status"]({
      respond,
      owner: userOwner,
    } as unknown as Parameters<(typeof usageHandlers)["usage.status"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "usage.status is admin-only in gateway user mode",
      }),
    );
    expect(mocks.loadProviderUsageSummary).not.toHaveBeenCalled();
  });

  it("allows usage.status for admin callers", async () => {
    const respond = vi.fn();
    await usageHandlers["usage.status"]({
      respond,
      owner: adminOwner,
    } as unknown as Parameters<(typeof usageHandlers)["usage.status"]>[0]);

    expect(mocks.loadProviderUsageSummary).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, { providers: [] }, undefined);
  });

  it("denies usage.cost for non-admin callers", async () => {
    const respond = vi.fn();
    await usageHandlers["usage.cost"]({
      respond,
      params: { startDate: "2026-02-01", endDate: "2026-02-02" },
      owner: userOwner,
    } as unknown as Parameters<(typeof usageHandlers)["usage.cost"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "usage.cost is admin-only in gateway user mode",
      }),
    );
    expect(mocks.loadCostUsageSummary).not.toHaveBeenCalled();
  });

  it("denies sessions.usage.timeseries owner mismatch", async () => {
    const respond = vi.fn();
    await usageHandlers["sessions.usage.timeseries"]({
      respond,
      params: { key: "agent:main:s-1" },
      owner: userOwner,
    } as unknown as Parameters<(typeof usageHandlers)["sessions.usage.timeseries"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "session owner mismatch for key: agent:main:s-1",
      }),
    );
    expect(mocks.loadSessionUsageTimeSeries).not.toHaveBeenCalled();
  });

  it("denies sessions.usage.logs owner mismatch", async () => {
    const respond = vi.fn();
    await usageHandlers["sessions.usage.logs"]({
      respond,
      params: { key: "agent:main:s-1" },
      owner: userOwner,
    } as unknown as Parameters<(typeof usageHandlers)["sessions.usage.logs"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "session owner mismatch for key: agent:main:s-1",
      }),
    );
    expect(mocks.loadSessionLogs).not.toHaveBeenCalled();
  });

  it("allows sessions.usage.timeseries owner mismatch when session delegation rule matches", async () => {
    mocks.loadConfig.mockReturnValueOnce({
      gateway: {
        multiUser: {
          mode: "strict",
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-a",
                toUserId: "user-b",
                resources: ["sessions"],
              },
            ],
          },
        },
      },
    });
    const respond = vi.fn();
    await usageHandlers["sessions.usage.timeseries"]({
      respond,
      params: { key: "agent:main:s-1" },
      owner: userOwner,
    } as unknown as Parameters<(typeof usageHandlers)["sessions.usage.timeseries"]>[0]);

    expect(mocks.loadSessionUsageTimeSeries).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, { points: [] }, undefined);
  });

  it("allows sessions.usage.logs owner mismatch when session delegation rule matches", async () => {
    mocks.loadConfig.mockReturnValueOnce({
      gateway: {
        multiUser: {
          mode: "strict",
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-a",
                toUserId: "user-b",
                resources: ["sessions"],
              },
            ],
          },
        },
      },
    });
    const respond = vi.fn();
    await usageHandlers["sessions.usage.logs"]({
      respond,
      params: { key: "agent:main:s-1" },
      owner: userOwner,
    } as unknown as Parameters<(typeof usageHandlers)["sessions.usage.logs"]>[0]);

    expect(mocks.loadSessionLogs).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, { logs: [] }, undefined);
  });

  it("allows sessions.usage.timeseries when owner metadata is missing in compat mode", async () => {
    mocks.loadConfig.mockReturnValueOnce({
      gateway: { multiUser: { mode: "compat" } },
    });
    mocks.loadSessionEntry.mockReturnValueOnce({
      key: "agent:main:s-1",
      entry: {
        sessionId: "s-1",
        sessionFile: "/tmp/s-1.jsonl",
      },
    });
    const respond = vi.fn();
    await usageHandlers["sessions.usage.timeseries"]({
      respond,
      params: { key: "agent:main:s-1" },
      owner: userOwner,
    } as unknown as Parameters<(typeof usageHandlers)["sessions.usage.timeseries"]>[0]);

    expect(mocks.loadSessionUsageTimeSeries).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, { points: [] }, undefined);
  });
});
