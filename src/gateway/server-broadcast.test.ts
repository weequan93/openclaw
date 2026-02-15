import { describe, expect, it, vi } from "vitest";
import type { GatewayWsClient } from "./server/ws-types.js";
import { createGatewayBroadcaster } from "./server-broadcast.js";

type TestSocket = {
  bufferedAmount: number;
  send: (payload: string) => void;
  close: (code: number, reason: string) => void;
};

describe("gateway broadcaster", () => {
  it("filters approval and pairing events by scope", () => {
    const approvalsSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const pairingSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const readSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: approvalsSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.approvals"] } as GatewayWsClient["connect"],
        connId: "c-approvals",
      },
      {
        socket: pairingSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.pairing"] } as GatewayWsClient["connect"],
        connId: "c-pairing",
      },
      {
        socket: readSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.read"] } as GatewayWsClient["connect"],
        connId: "c-read",
      },
    ]);

    const { broadcast, broadcastToConnIds } = createGatewayBroadcaster({ clients });

    broadcast("exec.approval.requested", { id: "1" });
    broadcast("device.pair.requested", { requestId: "r1" });

    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);
    expect(readSocket.send).toHaveBeenCalledTimes(0);

    broadcastToConnIds("tick", { ts: 1 }, new Set(["c-read"]));
    expect(readSocket.send).toHaveBeenCalledTimes(1);
    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);
  });

  it("broadcasts owner-scoped runtime events only to owner and admin clients", () => {
    const adminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const otherUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: adminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "admin-1",
        owner: {
          userId: "admin-user",
          principalId: "admin:1",
          role: "admin",
          sourceRole: "operator",
          scopes: ["operator.admin"],
        },
      },
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-1",
        owner: {
          userId: "user-a",
          principalId: "user:a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
      {
        socket: otherUserSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-2",
        owner: {
          userId: "user-b",
          principalId: "user:b",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
    ]);

    const { broadcast } = createGatewayBroadcaster({
      clients,
      resolveOwnerUserIdForSessionKey: (sessionKey) =>
        sessionKey === "session-a" ? "user-a" : undefined,
    });

    broadcast("chat", {
      runId: "run-1",
      sessionKey: "session-a",
      seq: 1,
      state: "delta",
    });

    expect(adminSocket.send).toHaveBeenCalledTimes(1);
    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
    expect(otherUserSocket.send).toHaveBeenCalledTimes(0);
  });

  it("broadcasts owner-scoped runtime events to delegated users when callback allows", () => {
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const delegatedSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-1",
        owner: {
          userId: "user-a",
          principalId: "user:a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
      {
        socket: delegatedSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-2",
        owner: {
          userId: "user-b",
          principalId: "user:b",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
    ]);

    const { broadcast } = createGatewayBroadcaster({
      clients,
      resolveOwnerUserIdForSessionKey: (sessionKey) =>
        sessionKey === "session-a" ? "user-a" : undefined,
      canAccessOwnerScopedEvent: ({ viewerUserId, ownerUserId }) =>
        viewerUserId === "user-b" && ownerUserId === "user-a",
    });

    broadcast("chat", {
      runId: "run-1",
      sessionKey: "session-a",
      seq: 1,
      state: "delta",
    });

    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
    expect(delegatedSocket.send).toHaveBeenCalledTimes(1);
  });

  it("drops owner-scoped runtime events when owner cannot be resolved", () => {
    const adminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const userSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: adminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "admin-1",
        owner: {
          userId: "admin-user",
          principalId: "admin:1",
          role: "admin",
          sourceRole: "operator",
          scopes: ["operator.admin"],
        },
      },
      {
        socket: userSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-1",
        owner: {
          userId: "user-a",
          principalId: "user:a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
    ]);

    const { broadcast } = createGatewayBroadcaster({
      clients,
      resolveOwnerUserIdForSessionKey: () => undefined,
    });

    broadcast("chat", {
      runId: "run-1",
      sessionKey: "session-missing-owner",
      seq: 1,
      state: "delta",
    });

    expect(adminSocket.send).toHaveBeenCalledTimes(0);
    expect(userSocket.send).toHaveBeenCalledTimes(0);
  });

  it("does not cache unresolved owner lookups", () => {
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const adminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    let lookupCount = 0;
    const { broadcast } = createGatewayBroadcaster({
      clients: new Set<GatewayWsClient>([
        {
          socket: adminSocket as unknown as GatewayWsClient["socket"],
          connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
          connId: "admin-1",
          owner: {
            userId: "admin-user",
            principalId: "admin:1",
            role: "admin",
            sourceRole: "operator",
            scopes: ["operator.admin"],
          },
        },
        {
          socket: ownerSocket as unknown as GatewayWsClient["socket"],
          connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
          connId: "user-1",
          owner: {
            userId: "user-a",
            principalId: "user:a",
            role: "user",
            sourceRole: "operator",
            scopes: ["operator.write"],
          },
        },
      ]),
      resolveOwnerUserIdForSessionKey: () => {
        lookupCount += 1;
        return lookupCount === 1 ? undefined : "user-a";
      },
    });

    broadcast("chat", { runId: "run-1", sessionKey: "session-a", seq: 1, state: "delta" });
    broadcast("chat", { runId: "run-2", sessionKey: "session-a", seq: 2, state: "final" });

    expect(lookupCount).toBe(2);
    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
    expect(adminSocket.send).toHaveBeenCalledTimes(1);
  });

  it("disables owner-scoped filtering in off mode", () => {
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const otherUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-1",
        owner: {
          userId: "user-a",
          principalId: "user:a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
      {
        socket: otherUserSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-2",
        owner: {
          userId: "user-b",
          principalId: "user:b",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
    ]);

    const { broadcast } = createGatewayBroadcaster({
      clients,
      multiUserMode: "off",
      resolveOwnerUserIdForSessionKey: (sessionKey) =>
        sessionKey === "session-a" ? "user-a" : undefined,
    });

    broadcast("chat", {
      runId: "run-1",
      sessionKey: "session-a",
      seq: 1,
      state: "delta",
    });

    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
    expect(otherUserSocket.send).toHaveBeenCalledTimes(1);
  });

  it("enforces owner checks even for targeted conn-id broadcasts", () => {
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const otherUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-1",
        owner: {
          userId: "user-a",
          principalId: "user:a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
      {
        socket: otherUserSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-2",
        owner: {
          userId: "user-b",
          principalId: "user:b",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
    ]);

    const { broadcastToConnIds } = createGatewayBroadcaster({
      clients,
      resolveOwnerUserIdForSessionKey: (sessionKey) =>
        sessionKey === "session-a" ? "user-a" : undefined,
    });

    broadcastToConnIds(
      "agent",
      {
        runId: "run-1",
        sessionKey: "session-a",
        stream: "assistant",
      },
      new Set(["user-2"]),
    );
    expect(otherUserSocket.send).toHaveBeenCalledTimes(0);

    broadcastToConnIds(
      "agent",
      {
        runId: "run-1",
        sessionKey: "session-a",
        stream: "assistant",
      },
      new Set(["user-1"]),
    );
    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
  });
});
