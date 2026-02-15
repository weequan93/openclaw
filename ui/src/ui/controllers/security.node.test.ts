import { describe, expect, it, vi } from "vitest";
import type { OwnershipGapsResult } from "../types.ts";
import {
  applySecurityPolicyBundle,
  applySecurityPreset,
  applySecurityTimePreset,
  loadSecurityPolicyBundles,
  loadOlderSecurity,
  loadSecurity,
  resolveSecurityPolicyBundle,
  runOwnershipBackfill,
  type SecurityState,
} from "./security.ts";

function mockOwnershipGapsPayload(): OwnershipGapsResult {
  return {
    ts: 1,
    resources: ["agents", "sessions", "nodes", "browserProfiles", "memory"],
    limit: 50,
    resourcesSummary: {},
    summary: {
      resources: ["agents", "sessions", "nodes", "browserProfiles", "memory"],
      scanned: 0,
      missing: 0,
    },
  };
}

function mockDeniedSummaryPayload() {
  return {
    ts: 3,
    total: 1,
    window: {},
    byReasonCode: [{ key: "OWNER_MISMATCH", count: 1 }],
    byMethod: [{ key: "sessions.list", count: 1 }],
    byActorRole: [{ key: "user", count: 1 }],
    bySourceRole: [{ key: "operator", count: 1 }],
    byErrorCode: [{ key: "INVALID_REQUEST", count: 1 }],
    byPrincipalId: [{ key: "principal:a", count: 1 }],
    highFrequency: {
      threshold: 5,
      principals: [],
    },
  };
}

function mockOwnershipBackfillPayload() {
  return {
    ts: 2,
    dryRun: true,
    ownerUserId: "user-a",
    ownerPrincipalId: "principal:a",
    resources: {
      sessions: {
        scanned: 10,
        updated: 2,
        skipped: 8,
        storesScanned: 2,
        storesUpdated: 1,
        updatedStorePaths: ["/state/agents/main/sessions/sessions.json"],
      },
    },
    summary: {
      resources: ["sessions"],
      scanned: 10,
      updated: 2,
      skipped: 8,
    },
  };
}

function mockConfigChangesPayload() {
  return {
    events: [],
    nextCursor: null,
    hasMore: false,
  };
}

describe("security controller", () => {
  it("loads denied access events", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "authz.denied.list") {
        return {
          events: [
            {
              ts: 10,
              requestId: "req-1",
              method: "sessions.list",
              reasonCode: "OWNER_MISMATCH",
              errorCode: "INVALID_REQUEST",
              errorMessage: "owner mismatch",
              userId: "user-a",
              principalId: "principal:a",
              actorRole: "user",
              sourceRole: "operator",
            },
          ],
        };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });

    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await loadSecurity(state);

    expect(request).toHaveBeenCalledWith("authz.denied.list", { limit: 200 });
    expect(request).toHaveBeenCalledWith("authz.denied.summary", {
      topN: 5,
      alertThreshold: 5,
    });
    expect(request).toHaveBeenCalledWith("config.changes.list", {
      limit: 50,
    });
    expect(request).toHaveBeenCalledWith("ownership.gaps", { limit: 50 });
    expect(state.securityDeniedEvents).toHaveLength(1);
    expect(state.securityDeniedEvents[0]?.reasonCode).toBe("OWNER_MISMATCH");
    expect(state.securityOwnershipGaps?.limit).toBe(50);
    expect(state.securityOwnershipGapsError).toBeNull();
    expect(state.securityHasMore).toBe(false);
    expect(state.securityNextCursor).toBeNull();
    expect(state.securityPinnedHistory).toBe(false);
  });

  it("loads config validation warnings when warning surface is enabled", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "authz.denied.list") {
        return { events: [] };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      if (method === "config.get") {
        return {
          warnings: [
            {
              path: "gateway.multiUser.identities.msg:telegram:default:123.role",
              message: "Identity mapping should set explicit role.",
            },
            {
              path: "",
              message: "ignored",
            },
            {
              path: "gateway.multiUser.identities.msg:telegram:default:456.role",
              message: 123,
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
      securityConfigWarnings: [],
      securityConfigWarningsError: "old",
      securityIdentityRoleWarnings: [],
    };

    await loadSecurity(state);

    expect(request).toHaveBeenNthCalledWith(5, "config.get", {});
    expect(state.securityConfigWarnings).toEqual([
      {
        path: "gateway.multiUser.identities.msg:telegram:default:123.role",
        message: "Identity mapping should set explicit role.",
      },
    ]);
    expect(state.securityConfigWarningsError).toBeNull();
    expect(state.securityIdentityRoleWarnings).toEqual([
      {
        principalId: "msg:telegram:default:123",
        path: "gateway.multiUser.identities.msg:telegram:default:123.role",
        message: "Identity mapping should set explicit role.",
      },
    ]);
  });

  it("captures config warning load errors when warning surface is enabled", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "authz.denied.list") {
        return { events: [] };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      if (method === "config.get") {
        throw new Error("config not allowed");
      }
      throw new Error(`unexpected method ${method}`);
    });

    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
      securityConfigWarnings: [
        {
          path: "old",
          message: "old",
        },
      ],
      securityConfigWarningsError: null,
      securityIdentityRoleWarnings: [
        {
          principalId: "old",
          path: "gateway.multiUser.identities.old.role",
          message: "old",
        },
      ],
    };

    await loadSecurity(state);

    expect(request).toHaveBeenNthCalledWith(5, "config.get", {});
    expect(state.securityConfigWarnings).toEqual([]);
    expect(state.securityConfigWarningsError).toContain("config not allowed");
    expect(state.securityIdentityRoleWarnings).toEqual([]);
  });

  it("stores deny errors when load fails", async () => {
    const state: SecurityState = {
      client: {
        request: vi.fn(async () => {
          throw new Error("forbidden");
        }),
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await loadSecurity(state);

    expect(state.securityDeniedError).toContain("forbidden");
    expect(state.securityOwnershipGapsError).toContain("forbidden");
  });

  it("applies filter values from state", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "authz.denied.list") {
        return { events: [] };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
      securityOrder: "asc",
      securityLimit: "25",
      securityAlertThreshold: "12",
      securityFilterMethod: "sessions.list",
      securityFilterReasonCode: "OWNER_MISMATCH",
      securityFilterErrorCode: "INVALID_REQUEST",
      securityFilterUserId: "user-1",
      securityFilterPrincipalId: "principal:1",
      securityFilterActorRole: "user",
      securityFilterSourceRole: "operator",
      securityFilterClientId: "control-ui",
      securityFilterClientMode: "webchat",
      securityFilterSourceIp: "203.0.113.7",
      securityFilterSinceTs: "100",
      securityFilterUntilTs: "300",
    };

    await loadSecurity(state);

    expect(request).toHaveBeenCalledWith("authz.denied.list", {
      limit: 25,
      order: "asc",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      userId: "user-1",
      principalId: "principal:1",
      actorRole: "user",
      sourceRole: "operator",
      clientId: "control-ui",
      clientMode: "webchat",
      sourceIp: "203.0.113.7",
      sinceTs: 100,
      untilTs: 300,
    });
    expect(request).toHaveBeenCalledWith("authz.denied.summary", {
      topN: 5,
      alertThreshold: 12,
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      userId: "user-1",
      principalId: "principal:1",
      actorRole: "user",
      sourceRole: "operator",
      clientId: "control-ui",
      clientMode: "webchat",
      sourceIp: "203.0.113.7",
      sinceTs: 100,
      untilTs: 300,
    });
    expect(request).toHaveBeenCalledWith("config.changes.list", {
      limit: 25,
      order: "asc",
      userId: "user-1",
      principalId: "principal:1",
      actorRole: "user",
      sourceRole: "operator",
      clientId: "control-ui",
      clientMode: "webchat",
      sourceIp: "203.0.113.7",
      sinceTs: 100,
      untilTs: 300,
    });
    expect(request).toHaveBeenCalledWith("ownership.gaps", { limit: 25 });
  });

  it("appends older pages when cursor is provided", async () => {
    const request = vi.fn(async (method: string, params?: { cursor?: string }) => {
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "authz.denied.list" && params?.cursor === "123") {
        return {
          events: [
            {
              requestId: "req-1",
              ts: 1,
              method: "m",
              reasonCode: "R",
              errorCode: "E",
              errorMessage: "x",
              userId: null,
              principalId: null,
              actorRole: null,
              sourceRole: null,
            },
          ],
          nextCursor: null,
          hasMore: false,
        };
      }
      if (method === "authz.denied.list") {
        return {
          events: [
            {
              requestId: "req-2",
              ts: 2,
              method: "m",
              reasonCode: "R",
              errorCode: "E",
              errorMessage: "x",
              userId: null,
              principalId: null,
              actorRole: null,
              sourceRole: null,
            },
          ],
          nextCursor: "123",
          hasMore: true,
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
      securityLimit: "1",
    };

    await loadSecurity(state);
    await loadOlderSecurity(state);

    expect(request).toHaveBeenNthCalledWith(1, "authz.denied.list", { limit: 1 });
    expect(request).toHaveBeenNthCalledWith(2, "authz.denied.summary", {
      topN: 5,
      alertThreshold: 5,
    });
    expect(request).toHaveBeenNthCalledWith(3, "config.changes.list", { limit: 1 });
    expect(request).toHaveBeenNthCalledWith(4, "ownership.gaps", { limit: 1 });
    expect(request).toHaveBeenNthCalledWith(5, "authz.denied.list", { limit: 1, cursor: "123" });
    expect(request).toHaveBeenNthCalledWith(6, "authz.denied.summary", {
      topN: 5,
      alertThreshold: 5,
    });
    expect(request).toHaveBeenNthCalledWith(7, "config.changes.list", { limit: 1 });
    expect(request).toHaveBeenNthCalledWith(8, "ownership.gaps", { limit: 1 });
    expect(state.securityDeniedEvents.map((entry) => entry.requestId)).toEqual(["req-2", "req-1"]);
    expect(state.securityHasMore).toBe(false);
    expect(state.securityNextCursor).toBeNull();
    expect(state.securityPinnedHistory).toBe(true);
  });

  it("applies preset filters and loads data", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });
    const now = 1_000_000;
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: "9",
      securityHasMore: true,
      securityPinnedHistory: true,
      securityOrder: "asc",
      securityLimit: "10",
      securityFilterMethod: "sessions.list",
      securityFilterReasonCode: "",
      securityFilterUserId: "user-1",
      securityFilterPrincipalId: "principal:1",
      securityFilterSinceTs: "",
      securityFilterUntilTs: "",
    };

    await applySecurityPreset(state, "scope-missing-24h", now);

    expect(state.securityFilterReasonCode).toBe("SCOPE_MISSING");
    expect(state.securityFilterMethod).toBe("");
    expect(state.securityFilterUserId).toBe("");
    expect(state.securityFilterPrincipalId).toBe("");
    expect(state.securityFilterSinceTs).toBe("0");
    expect(state.securityFilterUntilTs).toBe(String(now));
    expect(state.securityLimit).toBe("200");
    expect(state.securityOrder).toBe("desc");
    expect(state.securityHasMore).toBe(false);
    expect(state.securityNextCursor).toBeNull();
    expect(state.securityPinnedHistory).toBe(false);
    expect(request).toHaveBeenNthCalledWith(1, "authz.denied.list", {
      limit: 200,
      reasonCode: "SCOPE_MISSING",
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(2, "authz.denied.summary", {
      topN: 5,
      alertThreshold: 5,
      reasonCode: "SCOPE_MISSING",
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(3, "config.changes.list", {
      limit: 50,
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(4, "ownership.gaps", { limit: 50 });
  });

  it("applies role-forbidden preset filters and loads data", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });
    const now = 1_000_000;
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: "9",
      securityHasMore: true,
      securityPinnedHistory: true,
      securityOrder: "asc",
      securityLimit: "10",
      securityFilterMethod: "sessions.list",
      securityFilterReasonCode: "",
      securityFilterUserId: "user-1",
      securityFilterPrincipalId: "principal:1",
      securityFilterSinceTs: "",
      securityFilterUntilTs: "",
    };

    await applySecurityPreset(state, "role-forbidden-24h", now);

    expect(state.securityFilterReasonCode).toBe("ROLE_FORBIDDEN");
    expect(state.securityFilterMethod).toBe("");
    expect(state.securityFilterUserId).toBe("");
    expect(state.securityFilterPrincipalId).toBe("");
    expect(state.securityFilterSinceTs).toBe("0");
    expect(state.securityFilterUntilTs).toBe(String(now));
    expect(state.securityLimit).toBe("200");
    expect(state.securityOrder).toBe("desc");
    expect(state.securityHasMore).toBe(false);
    expect(state.securityNextCursor).toBeNull();
    expect(state.securityPinnedHistory).toBe(false);
    expect(request).toHaveBeenNthCalledWith(1, "authz.denied.list", {
      limit: 200,
      reasonCode: "ROLE_FORBIDDEN",
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(2, "authz.denied.summary", {
      topN: 5,
      alertThreshold: 5,
      reasonCode: "ROLE_FORBIDDEN",
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(3, "config.changes.list", {
      limit: 50,
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(4, "ownership.gaps", { limit: 50 });
  });

  it("applies time presets without changing reason filter", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });
    const now = 10_000_000;
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityNextCursor: "11",
      securityHasMore: true,
      securityPinnedHistory: true,
      securityOrder: "asc",
      securityLimit: "40",
      securityFilterMethod: "sessions.list",
      securityFilterReasonCode: "OWNER_MISMATCH",
      securityFilterUserId: "",
      securityFilterPrincipalId: "",
      securityFilterSinceTs: "",
      securityFilterUntilTs: "",
    };

    await applySecurityTimePreset(state, "last-7d", now);

    expect(state.securityFilterReasonCode).toBe("OWNER_MISMATCH");
    expect(state.securityFilterSinceTs).toBe("0");
    expect(state.securityFilterUntilTs).toBe(String(now));
    expect(state.securityHasMore).toBe(false);
    expect(state.securityNextCursor).toBeNull();
    expect(state.securityPinnedHistory).toBe(false);
    expect(request).toHaveBeenNthCalledWith(1, "authz.denied.list", {
      limit: 40,
      order: "asc",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(2, "authz.denied.summary", {
      topN: 5,
      alertThreshold: 5,
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(3, "config.changes.list", {
      limit: 40,
      order: "asc",
      sinceTs: 0,
      untilTs: now,
    });
    expect(request).toHaveBeenNthCalledWith(4, "ownership.gaps", { limit: 40 });
  });

  it("runs ownership backfill dry-run and refreshes security views", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "ownership.backfill") {
        return mockOwnershipBackfillPayload();
      }
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityBackfillBusy: false,
      securityBackfillOwnerUserId: "user-a",
      securityBackfillOwnerPrincipalId: "principal:a",
      securityBackfillResources: "sessions,nodes",
      securityBackfillResult: null,
      securityBackfillError: null,
      securityLimit: "200",
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await runOwnershipBackfill(state, { dryRun: true });

    expect(request).toHaveBeenNthCalledWith(1, "ownership.backfill", {
      ownerUserId: "user-a",
      ownerPrincipalId: "principal:a",
      resources: ["sessions", "nodes"],
      dryRun: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "authz.denied.list", { limit: 200 });
    expect(request).toHaveBeenNthCalledWith(3, "authz.denied.summary", {
      topN: 5,
      alertThreshold: 5,
    });
    expect(request).toHaveBeenNthCalledWith(4, "config.changes.list", { limit: 50 });
    expect(request).toHaveBeenNthCalledWith(5, "ownership.gaps", { limit: 50 });
    expect(state.securityBackfillResult?.summary.updated).toBe(2);
    expect(state.securityBackfillError).toBeNull();
    expect(state.securityBackfillBusy).toBe(false);
  });

  it("supports one-click resources override for ownership backfill", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "ownership.backfill") {
        return mockOwnershipBackfillPayload();
      }
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityBackfillBusy: false,
      securityBackfillOwnerUserId: "user-a",
      securityBackfillOwnerPrincipalId: "principal:a",
      securityBackfillResources: "",
      securityBackfillResult: null,
      securityBackfillError: null,
      securityLimit: "200",
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await runOwnershipBackfill(state, { dryRun: true, resources: "sessions" });

    expect(request).toHaveBeenNthCalledWith(1, "ownership.backfill", {
      ownerUserId: "user-a",
      ownerPrincipalId: "principal:a",
      resources: ["sessions"],
      dryRun: true,
    });
    expect(state.securityBackfillResources).toBe("sessions");
  });

  it("accepts memory resource override for ownership backfill", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "ownership.backfill") {
        return mockOwnershipBackfillPayload();
      }
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityBackfillBusy: false,
      securityBackfillOwnerUserId: "user-a",
      securityBackfillOwnerPrincipalId: "principal:a",
      securityBackfillResources: "",
      securityBackfillResult: null,
      securityBackfillError: null,
      securityLimit: "200",
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await runOwnershipBackfill(state, { dryRun: true, resources: "memory" });

    expect(request).toHaveBeenNthCalledWith(1, "ownership.backfill", {
      ownerUserId: "user-a",
      ownerPrincipalId: "principal:a",
      resources: ["memory"],
      dryRun: true,
    });
    expect(state.securityBackfillResources).toBe("memory");
  });

  it("rejects ownership backfill when owner user id is missing", async () => {
    const request = vi.fn(async () => ({}));
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityBackfillBusy: false,
      securityBackfillOwnerUserId: "   ",
      securityBackfillResult: null,
      securityBackfillError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await runOwnershipBackfill(state, { dryRun: false });

    expect(request).not.toHaveBeenCalled();
    expect(state.securityBackfillError).toContain("owner user id is required");
  });

  it("skips admin security queries for non-admin auth context", async () => {
    const request = vi.fn(async () => ({}));
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      hello: {
        type: "hello-ok",
        protocol: 3,
        auth: {
          role: "operator",
          scopes: ["operator.read"],
        },
      },
      securityLoading: false,
      securityDeniedEvents: [
        {
          ts: 1,
          requestId: "req-1",
          method: "m",
          reasonCode: "R",
          errorCode: "E",
          errorMessage: "x",
          userId: null,
          principalId: null,
          actorRole: null,
          sourceRole: null,
        },
      ],
      securityDeniedError: "old",
      securityConfigChanges: [{ ts: 1 } as never],
      securityConfigChangesError: "old",
      securityConfigWarnings: [{ path: "old.path", message: "old" }],
      securityConfigWarningsError: "old",
      securityIdentityRoleWarnings: [
        {
          principalId: "old",
          path: "gateway.multiUser.identities.old.role",
          message: "old",
        },
      ],
      securityOwnershipGaps: mockOwnershipGapsPayload(),
      securityOwnershipGapsError: "old",
      securityNextCursor: "1",
      securityHasMore: true,
      securityPinnedHistory: true,
    };

    await loadSecurity(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.securityDeniedEvents).toEqual([]);
    expect(state.securityDeniedError).toBeNull();
    expect(state.securityConfigChanges).toEqual([]);
    expect(state.securityConfigChangesError).toBeNull();
    expect(state.securityConfigWarnings).toEqual([]);
    expect(state.securityConfigWarningsError).toBeNull();
    expect(state.securityIdentityRoleWarnings).toEqual([]);
    expect(state.securityOwnershipGaps).toBeNull();
    expect(state.securityOwnershipGapsError).toBeNull();
    expect(state.securityNextCursor).toBeNull();
    expect(state.securityHasMore).toBe(false);
    expect(state.securityPinnedHistory).toBe(false);
  });

  it("treats principalRole=user as non-admin even when operator.admin scope is present", async () => {
    const request = vi.fn(async () => ({}));
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      hello: {
        type: "hello-ok",
        protocol: 3,
        auth: {
          role: "operator",
          principalRole: "user",
          scopes: ["operator.admin"],
        },
      },
      securityLoading: false,
      securityDeniedEvents: [
        {
          ts: 1,
          requestId: "req-1",
          method: "m",
          reasonCode: "R",
          errorCode: "E",
          errorMessage: "x",
          userId: null,
          principalId: null,
          actorRole: null,
          sourceRole: null,
        },
      ],
      securityDeniedError: "old",
      securityConfigChanges: [{ ts: 1 } as never],
      securityConfigChangesError: "old",
      securityConfigWarnings: [{ path: "old.path", message: "old" }],
      securityConfigWarningsError: "old",
      securityIdentityRoleWarnings: [
        {
          principalId: "old",
          path: "gateway.multiUser.identities.old.role",
          message: "old",
        },
      ],
      securityOwnershipGaps: mockOwnershipGapsPayload(),
      securityOwnershipGapsError: "old",
      securityNextCursor: "1",
      securityHasMore: true,
      securityPinnedHistory: true,
    };

    await loadSecurity(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.securityDeniedEvents).toEqual([]);
    expect(state.securityDeniedError).toBeNull();
    expect(state.securityConfigChanges).toEqual([]);
    expect(state.securityConfigChangesError).toBeNull();
    expect(state.securityConfigWarnings).toEqual([]);
    expect(state.securityConfigWarningsError).toBeNull();
    expect(state.securityIdentityRoleWarnings).toEqual([]);
    expect(state.securityOwnershipGaps).toBeNull();
    expect(state.securityOwnershipGapsError).toBeNull();
    expect(state.securityNextCursor).toBeNull();
    expect(state.securityHasMore).toBe(false);
    expect(state.securityPinnedHistory).toBe(false);
  });

  it("rejects backfill for non-admin auth context", async () => {
    const request = vi.fn(async () => ({}));
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      hello: {
        type: "hello-ok",
        protocol: 3,
        auth: {
          role: "operator",
          scopes: ["operator.read"],
        },
      },
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityBackfillBusy: false,
      securityBackfillOwnerUserId: "user-a",
      securityBackfillResult: null,
      securityBackfillError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await runOwnershipBackfill(state, { dryRun: false });

    expect(request).not.toHaveBeenCalled();
    expect(state.securityBackfillError).toContain("requires admin principal role");
  });

  it("loads and resolves policy bundles", async () => {
    const request = vi.fn(async (method: string, params?: { bundleId?: string }) => {
      if (method === "config.policyBundles.list") {
        return {
          bundles: [
            {
              id: "single_user",
              title: "Single User",
              description: "Disable multi-user ownership enforcement.",
              patch: {
                gateway: {
                  multiUser: {
                    mode: "off",
                  },
                },
              },
            },
            {
              id: "strict_admin_control",
              title: "Strict Admin Control",
              description: "Enable strict mode.",
              patch: {
                gateway: {
                  multiUser: {
                    mode: "strict",
                  },
                },
              },
            },
          ],
        };
      }
      if (method === "config.policyBundle.resolve" && params?.bundleId === "single_user") {
        return {
          bundle: {
            id: "single_user",
            title: "Single User",
            description: "Disable multi-user ownership enforcement.",
            patch: {
              gateway: {
                multiUser: {
                  mode: "off",
                },
              },
            },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityPolicyBundles: [],
      securityPolicyBundlesLoading: false,
      securityPolicyBundlesError: null,
      securityPolicyBundleSelectedId: "",
      securityPolicyBundleResolved: null,
      securityPolicyBundleResolveLoading: false,
      securityPolicyBundleResolveError: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await loadSecurityPolicyBundles(state);

    expect(request).toHaveBeenNthCalledWith(1, "config.policyBundles.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "config.policyBundle.resolve", {
      bundleId: "single_user",
    });
    expect((state.securityPolicyBundles ?? []).map((bundle) => bundle.id)).toEqual([
      "single_user",
      "strict_admin_control",
    ]);
    expect(state.securityPolicyBundleSelectedId).toBe("single_user");
    expect(state.securityPolicyBundleResolved?.id).toBe("single_user");
    expect(state.securityPolicyBundlesError).toBeNull();
  });

  it("applies policy bundle via config.policyBundle.apply", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "config.policyBundle.resolve") {
        return {
          bundle: {
            id: "strict_admin_control",
            title: "Strict Admin Control",
            description: "Enable strict mode.",
            patch: {
              gateway: {
                multiUser: {
                  mode: "strict",
                },
              },
            },
          },
        };
      }
      if (method === "config.get") {
        return {
          hash: "hash-1",
        };
      }
      if (method === "config.policyBundle.apply") {
        expect(params).toEqual({
          bundleId: "strict_admin_control",
          baseHash: "hash-1",
          sessionKey: "main",
          note: "policy-bundle:strict_admin_control",
        });
        return { ok: true };
      }
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });

    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      applySessionKey: "main",
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityPolicyBundles: [],
      securityPolicyBundlesLoading: false,
      securityPolicyBundlesError: null,
      securityPolicyBundleSelectedId: "strict_admin_control",
      securityPolicyBundleResolved: null,
      securityPolicyBundleResolveLoading: false,
      securityPolicyBundleResolveError: null,
      securityPolicyBundleApplyBusy: false,
      securityPolicyBundleApplyError: null,
      securityPolicyBundleApplyMessage: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await applySecurityPolicyBundle(state, "strict_admin_control");

    expect(request).toHaveBeenNthCalledWith(1, "config.policyBundle.resolve", {
      bundleId: "strict_admin_control",
    });
    expect(request).toHaveBeenNthCalledWith(2, "config.get", {});
    expect(request).toHaveBeenNthCalledWith(
      3,
      "config.policyBundle.apply",
      expect.objectContaining({
        baseHash: "hash-1",
      }),
    );
    expect(state.securityPolicyBundleApplyError).toBeNull();
    expect(state.securityPolicyBundleApplyMessage).toContain("Strict Admin Control");
  });

  it("falls back to config.patch when policy bundle apply method is unavailable", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "config.policyBundle.resolve") {
        return {
          bundle: {
            id: "strict_admin_control",
            title: "Strict Admin Control",
            description: "Enable strict mode.",
            patch: {
              gateway: {
                multiUser: {
                  mode: "strict",
                },
              },
            },
          },
        };
      }
      if (method === "config.get") {
        return {
          hash: "hash-1",
        };
      }
      if (method === "config.policyBundle.apply") {
        throw new Error("unknown method: config.policyBundle.apply");
      }
      if (method === "config.patch") {
        expect(params).toEqual({
          raw: JSON.stringify(
            {
              gateway: {
                multiUser: {
                  mode: "strict",
                },
              },
            },
            null,
            2,
          ),
          baseHash: "hash-1",
          sessionKey: "main",
          note: "policy-bundle:strict_admin_control",
        });
        return { ok: true };
      }
      if (method === "authz.denied.list") {
        return { events: [], nextCursor: null, hasMore: false };
      }
      if (method === "authz.denied.summary") {
        return mockDeniedSummaryPayload();
      }
      if (method === "config.changes.list") {
        return mockConfigChangesPayload();
      }
      if (method === "ownership.gaps") {
        return mockOwnershipGapsPayload();
      }
      throw new Error(`unexpected method ${method}`);
    });

    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      applySessionKey: "main",
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityPolicyBundles: [],
      securityPolicyBundlesLoading: false,
      securityPolicyBundlesError: null,
      securityPolicyBundleSelectedId: "strict_admin_control",
      securityPolicyBundleResolved: null,
      securityPolicyBundleResolveLoading: false,
      securityPolicyBundleResolveError: null,
      securityPolicyBundleApplyBusy: false,
      securityPolicyBundleApplyError: null,
      securityPolicyBundleApplyMessage: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await applySecurityPolicyBundle(state, "strict_admin_control");

    expect(request).toHaveBeenNthCalledWith(1, "config.policyBundle.resolve", {
      bundleId: "strict_admin_control",
    });
    expect(request).toHaveBeenNthCalledWith(2, "config.get", {});
    expect(request).toHaveBeenNthCalledWith(
      3,
      "config.policyBundle.apply",
      expect.objectContaining({
        baseHash: "hash-1",
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      "config.patch",
      expect.objectContaining({
        baseHash: "hash-1",
      }),
    );
    expect(state.securityPolicyBundleApplyError).toBeNull();
    expect(state.securityPolicyBundleApplyMessage).toContain("Strict Admin Control");
  });

  it("rejects policy bundle access for non-admin auth context", async () => {
    const request = vi.fn(async () => ({}));
    const state: SecurityState = {
      client: {
        request,
      } as unknown as SecurityState["client"],
      connected: true,
      hello: {
        type: "hello-ok",
        protocol: 3,
        auth: {
          role: "operator",
          scopes: ["operator.read"],
        },
      },
      securityLoading: false,
      securityDeniedEvents: [],
      securityDeniedError: null,
      securityOwnershipGaps: null,
      securityOwnershipGapsError: null,
      securityPolicyBundles: [],
      securityPolicyBundlesLoading: false,
      securityPolicyBundlesError: null,
      securityPolicyBundleSelectedId: "",
      securityPolicyBundleResolved: null,
      securityPolicyBundleResolveLoading: false,
      securityPolicyBundleResolveError: null,
      securityPolicyBundleApplyBusy: false,
      securityPolicyBundleApplyError: null,
      securityPolicyBundleApplyMessage: null,
      securityNextCursor: null,
      securityHasMore: false,
      securityPinnedHistory: false,
    };

    await loadSecurityPolicyBundles(state);
    await resolveSecurityPolicyBundle(state, "single_user");
    await applySecurityPolicyBundle(state, "single_user");

    expect(request).not.toHaveBeenCalled();
    expect(state.securityPolicyBundles).toEqual([]);
    expect(state.securityPolicyBundleResolveError).toContain("requires admin principal role");
    expect(state.securityPolicyBundleApplyError).toContain("requires admin principal role");
  });
});
