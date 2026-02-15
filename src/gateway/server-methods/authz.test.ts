import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __test as authzDeniedEventsTest,
  recordGatewayAuthzDenyEvent,
} from "../authz-denied-events.js";
import { authzHandlers } from "./authz.js";

describe("authz.denied.list", () => {
  beforeEach(() => {
    authzDeniedEventsTest.clear();
  });

  it("returns latest deny events first", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "health",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "config.get",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond,
      params: { limit: 1 },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        events: [expect.objectContaining({ requestId: "req-2" })],
        hasMore: true,
        nextCursor: expect.any(String),
      }),
      undefined,
    );
  });

  it("filters deny events by reason and user", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "health",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-b",
      principalId: "principal:b",
      actorRole: "user",
      sourceRole: "operator",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond,
      params: { reasonCode: "OWNER_MISMATCH", userId: "user-b" },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        events: [expect.objectContaining({ requestId: "req-2" })],
      }),
      undefined,
    );
  });

  it("filters deny events by actor role, source role, and error code", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "health",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "node.invoke",
      reasonCode: "ROLE_FORBIDDEN",
      errorCode: "UNAUTHORIZED",
      errorMessage: "role forbidden",
      userId: null,
      principalId: "device:node-1",
      actorRole: "node",
      sourceRole: "node",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond,
      params: { actorRole: "node", sourceRole: "node", errorCode: "UNAUTHORIZED" },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        events: [expect.objectContaining({ requestId: "req-2" })],
      }),
      undefined,
    );
  });

  it("filters deny events by client and source ip", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "health",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
      clientId: "control-ui",
      clientMode: "webchat",
      sourceIp: "203.0.113.1",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "health",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
      clientId: "gateway-client",
      clientMode: "backend",
      sourceIp: "203.0.113.2",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond,
      params: { clientId: "control-ui", sourceIp: "203.0.113.1" },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        events: [expect.objectContaining({ requestId: "req-1" })],
      }),
      undefined,
    );
  });

  it("rejects invalid params", () => {
    const respond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond,
      params: { cursor: "abc" },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid authz.denied.list params"),
      }),
    );
  });

  it("supports pagination cursor for older events", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "health",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "config.get",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 300,
      requestId: "req-3",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });

    const firstRespond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond: firstRespond,
      params: { limit: 2 },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    const firstResult = firstRespond.mock.calls[0]?.[1] as
      | { nextCursor?: string | null; events?: Array<{ requestId?: string }>; hasMore?: boolean }
      | undefined;
    expect(firstResult?.events?.map((event) => event.requestId)).toEqual(["req-3", "req-2"]);
    expect(firstResult?.hasMore).toBe(true);
    expect(typeof firstResult?.nextCursor).toBe("string");

    const secondRespond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond: secondRespond,
      params: { limit: 2, cursor: firstResult?.nextCursor },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    const secondResult = secondRespond.mock.calls[0]?.[1] as
      | { nextCursor?: string | null; events?: Array<{ requestId?: string }>; hasMore?: boolean }
      | undefined;
    expect(secondResult?.events?.map((event) => event.requestId)).toEqual(["req-1"]);
    expect(secondResult?.hasMore).toBe(false);
    expect(secondResult?.nextCursor).toBeNull();
  });

  it("supports ascending order for visible page", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "health",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "config.get",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 300,
      requestId: "req-3",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.list"]({
      respond,
      params: { limit: 2, order: "asc" },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.list"]>[0]);

    const result = respond.mock.calls[0]?.[1] as
      | { events?: Array<{ requestId?: string }>; hasMore?: boolean; nextCursor?: string | null }
      | undefined;
    expect(result?.events?.map((entry) => entry.requestId)).toEqual(["req-2", "req-3"]);
    expect(result?.hasMore).toBe(true);
    expect(typeof result?.nextCursor).toBe("string");
  });
});

describe("authz.denied.summary", () => {
  beforeEach(() => {
    authzDeniedEventsTest.clear();
  });

  it("returns aggregate buckets for denied events", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 300,
      requestId: "req-3",
      method: "authz.denied.list",
      reasonCode: "SCOPE_MISSING",
      errorCode: "INVALID_REQUEST",
      errorMessage: "missing scope",
      userId: "user-b",
      principalId: "principal:b",
      actorRole: "user",
      sourceRole: "operator",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.summary"]({
      respond,
      params: { topN: 3 },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.summary"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        total: 3,
        earliestTs: 100,
        latestTs: 300,
        byReasonCode: [
          { key: "OWNER_MISMATCH", count: 2 },
          { key: "SCOPE_MISSING", count: 1 },
        ],
        byMethod: [
          { key: "sessions.list", count: 2 },
          { key: "authz.denied.list", count: 1 },
        ],
        byPrincipalId: [
          { key: "principal:a", count: 2 },
          { key: "principal:b", count: 1 },
        ],
        highFrequency: {
          threshold: 5,
          principals: [],
        },
      }),
      undefined,
    );
  });

  it("supports summary filters by source role and error code", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "node.invoke",
      reasonCode: "ROLE_FORBIDDEN",
      errorCode: "UNAUTHORIZED",
      errorMessage: "unauthorized role",
      userId: null,
      principalId: "device:node-1",
      actorRole: "node",
      sourceRole: "node",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "node.invoke",
      reasonCode: "ROLE_FORBIDDEN",
      errorCode: "INVALID_REQUEST",
      errorMessage: "bad payload",
      userId: null,
      principalId: "device:node-2",
      actorRole: "node",
      sourceRole: "node",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.summary"]({
      respond,
      params: { sourceRole: "node", errorCode: "UNAUTHORIZED" },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.summary"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        total: 1,
        byErrorCode: [{ key: "UNAUTHORIZED", count: 1 }],
        byPrincipalId: [{ key: "device:node-1", count: 1 }],
        highFrequency: {
          threshold: 5,
          principals: [],
        },
      }),
      undefined,
    );
  });

  it("supports high-frequency alert threshold for principal aggregation", () => {
    recordGatewayAuthzDenyEvent({
      ts: 100,
      requestId: "req-1",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 200,
      requestId: "req-2",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "user",
      sourceRole: "operator",
    });
    recordGatewayAuthzDenyEvent({
      ts: 300,
      requestId: "req-3",
      method: "sessions.list",
      reasonCode: "OWNER_MISMATCH",
      errorCode: "INVALID_REQUEST",
      errorMessage: "owner mismatch",
      userId: "user-b",
      principalId: "principal:b",
      actorRole: "user",
      sourceRole: "operator",
    });

    const respond = vi.fn();
    authzHandlers["authz.denied.summary"]({
      respond,
      params: { topN: 5, alertThreshold: 2 },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.summary"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        byPrincipalId: [
          { key: "principal:a", count: 2 },
          { key: "principal:b", count: 1 },
        ],
        highFrequency: {
          threshold: 2,
          principals: [{ key: "principal:a", count: 2 }],
        },
      }),
      undefined,
    );
  });

  it("rejects invalid summary params", () => {
    const respond = vi.fn();
    authzHandlers["authz.denied.summary"]({
      respond,
      params: { topN: 9999 },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.summary"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid authz.denied.summary params"),
      }),
    );
  });

  it("rejects invalid alertThreshold in summary params", () => {
    const respond = vi.fn();
    authzHandlers["authz.denied.summary"]({
      respond,
      params: { alertThreshold: 9999 },
    } as unknown as Parameters<(typeof authzHandlers)["authz.denied.summary"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid authz.denied.summary params"),
      }),
    );
  });
});
