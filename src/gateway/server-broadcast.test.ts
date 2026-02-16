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

  it("does not treat non-admin principals with operator.admin scope as admin for owner-scoped events", () => {
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const mappedUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "user-owner",
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
      {
        socket: mappedUserSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.admin", "operator.write"],
        } as GatewayWsClient["connect"],
        connId: "mapped-user",
        owner: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.write"],
        },
      },
    ]);

    const { broadcast } = createGatewayBroadcaster({
      clients,
      resolveOwnerUserIdForSessionKey: (sessionKey) =>
        sessionKey === "session-a" ? "user-a" : undefined,
    });

    broadcast("chat", {
      runId: "run-owner",
      sessionKey: "session-a",
      seq: 1,
      state: "delta",
    });

    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
    expect(mappedUserSocket.send).toHaveBeenCalledTimes(0);
  });

  it("requires explicit approval and pairing scopes for non-admin principals in strict and compat modes", () => {
    const mappedUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const approvalsSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const adminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const unresolvedAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: mappedUserSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.admin", "operator.write"],
        } as GatewayWsClient["connect"],
        connId: "mapped-user",
        owner: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.write"],
        },
      },
      {
        socket: approvalsSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.approvals"],
        } as GatewayWsClient["connect"],
        connId: "approvals-user",
        owner: {
          userId: "user-c",
          principalId: "msg:discord:default:user-c",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.approvals"],
        },
      },
      {
        socket: adminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "admin-user",
        owner: {
          userId: "admin-user",
          principalId: "admin:1",
          role: "admin",
          sourceRole: "operator",
          scopes: ["operator.admin"],
        },
      },
      {
        socket: unresolvedAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
    ]);

    for (const mode of ["strict", "compat"] as const) {
      vi.mocked(mappedUserSocket.send).mockClear();
      vi.mocked(approvalsSocket.send).mockClear();
      vi.mocked(adminSocket.send).mockClear();
      vi.mocked(unresolvedAdminSocket.send).mockClear();

      const { broadcast } = createGatewayBroadcaster({
        clients,
        multiUserMode: mode,
      });

      broadcast("exec.approval.requested", { requestId: "approval-1" });
      broadcast("device.pair.requested", { requestId: "pair-1" });

      expect(mappedUserSocket.send).toHaveBeenCalledTimes(0);
      expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
      expect(adminSocket.send).toHaveBeenCalledTimes(2);
      expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(0);
    }
  });

  it("keeps legacy admin-scope fallback when owner context is unavailable", () => {
    const legacyAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: legacyAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "owner-user",
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
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
      runId: "run-legacy-admin",
      sessionKey: "session-a",
      seq: 1,
      state: "delta",
    });

    expect(legacyAdminSocket.send).toHaveBeenCalledTimes(1);
    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
  });

  it("requires resolved admin principal when owner context is unavailable in strict and compat modes", () => {
    const legacyAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const ownerSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: legacyAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "owner-user",
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
    ]);

    for (const mode of ["strict", "compat"] as const) {
      vi.mocked(legacyAdminSocket.send).mockClear();
      vi.mocked(ownerSocket.send).mockClear();

      const { broadcast } = createGatewayBroadcaster({
        clients,
        multiUserMode: mode,
        resolveOwnerUserIdForSessionKey: (sessionKey) =>
          sessionKey === "session-a" ? "user-a" : undefined,
      });

      broadcast("chat", {
        runId: `run-${mode}-owner`,
        sessionKey: "session-a",
        seq: 1,
        state: "delta",
      });

      // No owner context on the legacy admin-scoped client means no admin bypass
      // when owner-role enforcement is active.
      expect(legacyAdminSocket.send).toHaveBeenCalledTimes(0);
      expect(ownerSocket.send).toHaveBeenCalledTimes(1);

      broadcast("exec.approval.requested", { requestId: "approval-1" });
      expect(legacyAdminSocket.send).toHaveBeenCalledTimes(0);
    }
  });

  it("requires resolved admin principal for control-plane runtime events in strict and compat modes", () => {
    const resolvedAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const mappedUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const unresolvedAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: resolvedAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "resolved-admin",
        owner: {
          userId: "admin-user",
          principalId: "admin:1",
          role: "admin",
          sourceRole: "operator",
          scopes: ["operator.admin"],
        },
      },
      {
        socket: mappedUserSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "mapped-user",
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin"],
        },
      },
      {
        socket: unresolvedAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
    ]);

    const events = ["presence", "heartbeat", "cron", "talk.mode", "voicewake.changed"] as const;
    for (const mode of ["strict", "compat"] as const) {
      vi.mocked(resolvedAdminSocket.send).mockClear();
      vi.mocked(mappedUserSocket.send).mockClear();
      vi.mocked(unresolvedAdminSocket.send).mockClear();

      const { broadcast } = createGatewayBroadcaster({
        clients,
        multiUserMode: mode,
      });

      for (const event of events) {
        broadcast(event, { ok: true, event });
      }

      expect(resolvedAdminSocket.send).toHaveBeenCalledTimes(events.length);
      expect(mappedUserSocket.send).toHaveBeenCalledTimes(0);
      expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(0);
    }
  });

  it("keeps control-plane runtime events broadly visible in off mode", () => {
    const adminScopeSocket: TestSocket = {
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
        socket: adminScopeSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
      {
        socket: readSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.read"] } as GatewayWsClient["connect"],
        connId: "reader",
      },
    ]);

    const { broadcast } = createGatewayBroadcaster({
      clients,
      multiUserMode: "off",
    });

    broadcast("presence", { presence: [] });
    broadcast("heartbeat", { status: "ok" });

    expect(adminScopeSocket.send).toHaveBeenCalledTimes(2);
    expect(readSocket.send).toHaveBeenCalledTimes(2);
  });

  it("keeps legacy admin-scope fallback for approval and pairing events in off mode", () => {
    const legacyAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
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

    const clients = new Set<GatewayWsClient>([
      {
        socket: legacyAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
      {
        socket: approvalsSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.approvals"],
        } as GatewayWsClient["connect"],
        connId: "approvals",
      },
      {
        socket: pairingSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.pairing"],
        } as GatewayWsClient["connect"],
        connId: "pairing",
      },
    ]);

    const { broadcast } = createGatewayBroadcaster({
      clients,
      multiUserMode: "off",
    });

    broadcast("exec.approval.requested", { requestId: "approval-legacy-off" });
    broadcast("device.pair.requested", { requestId: "pairing-legacy-off" });

    expect(legacyAdminSocket.send).toHaveBeenCalledTimes(2);
    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);
  });

  it("honors dynamic multi-user mode resolution for approval and pairing events", () => {
    const unresolvedAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const mappedAdminScopeUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
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

    const clients = new Set<GatewayWsClient>([
      {
        socket: unresolvedAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
      {
        socket: mappedAdminScopeUserSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.admin", "operator.write"],
        } as GatewayWsClient["connect"],
        connId: "mapped-admin-scope-user",
        owner: {
          userId: "user-mapped",
          principalId: "msg:test:user-mapped",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.write"],
        },
      },
      {
        socket: approvalsSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.approvals"],
        } as GatewayWsClient["connect"],
        connId: "approvals-user",
        owner: {
          userId: "user-approvals",
          principalId: "msg:test:user-approvals",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.approvals"],
        },
      },
      {
        socket: pairingSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.pairing"],
        } as GatewayWsClient["connect"],
        connId: "pairing-user",
        owner: {
          userId: "user-pairing",
          principalId: "msg:test:user-pairing",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.pairing"],
        },
      },
    ]);

    let mode: "strict" | "off" = "strict";
    const { broadcast } = createGatewayBroadcaster({
      clients,
      multiUserMode: "strict",
      getMultiUserMode: () => mode,
    });

    broadcast("exec.approval.requested", { requestId: "approval-strict" });
    broadcast("device.pair.requested", { requestId: "pairing-strict" });
    expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(0);
    expect(mappedAdminScopeUserSocket.send).toHaveBeenCalledTimes(0);
    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);

    mode = "off";
    broadcast("exec.approval.requested", { requestId: "approval-off" });
    broadcast("device.pair.requested", { requestId: "pairing-off" });
    expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(2);
    expect(mappedAdminScopeUserSocket.send).toHaveBeenCalledTimes(0);
    expect(approvalsSocket.send).toHaveBeenCalledTimes(2);
    expect(pairingSocket.send).toHaveBeenCalledTimes(2);

    mode = "strict";
    broadcast("exec.approval.requested", { requestId: "approval-strict-final" });
    broadcast("device.pair.requested", { requestId: "pairing-strict-final" });
    expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(2);
    expect(mappedAdminScopeUserSocket.send).toHaveBeenCalledTimes(0);
    expect(approvalsSocket.send).toHaveBeenCalledTimes(3);
    expect(pairingSocket.send).toHaveBeenCalledTimes(3);
  });

  it("honors dynamic multi-user mode resolution without restart", () => {
    const resolvedAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const mappedUserSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: resolvedAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "resolved-admin",
        owner: {
          userId: "admin-user",
          principalId: "admin:1",
          role: "admin",
          sourceRole: "operator",
          scopes: ["operator.admin"],
        },
      },
      {
        socket: mappedUserSocket as unknown as GatewayWsClient["socket"],
        connect: {
          role: "operator",
          scopes: ["operator.admin", "operator.write"],
        } as GatewayWsClient["connect"],
        connId: "mapped-user",
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.write"],
        },
      },
    ]);

    let mode: "strict" | "off" = "strict";
    const { broadcast } = createGatewayBroadcaster({
      clients,
      multiUserMode: "strict",
      getMultiUserMode: () => mode,
    });

    broadcast("presence", { phase: "strict" });
    expect(resolvedAdminSocket.send).toHaveBeenCalledTimes(1);
    expect(mappedUserSocket.send).toHaveBeenCalledTimes(0);

    mode = "off";
    broadcast("presence", { phase: "off" });
    expect(resolvedAdminSocket.send).toHaveBeenCalledTimes(2);
    expect(mappedUserSocket.send).toHaveBeenCalledTimes(1);
  });

  it("honors dynamic multi-user mode resolution for owner-scoped chat events", () => {
    const resolvedAdminSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const unresolvedAdminSocket: TestSocket = {
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
        socket: resolvedAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "resolved-admin",
        owner: {
          userId: "admin-user",
          principalId: "admin:1",
          role: "admin",
          sourceRole: "operator",
          scopes: ["operator.admin"],
        },
      },
      {
        socket: unresolvedAdminSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
        connId: "legacy-admin",
      },
      {
        socket: ownerSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "owner-user",
        owner: {
          userId: "user-a",
          principalId: "msg:test:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
      {
        socket: otherUserSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.write"] } as GatewayWsClient["connect"],
        connId: "other-user",
        owner: {
          userId: "user-b",
          principalId: "msg:test:user-b",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.write"],
        },
      },
    ]);

    let mode: "strict" | "off" = "strict";
    const { broadcast } = createGatewayBroadcaster({
      clients,
      multiUserMode: "strict",
      getMultiUserMode: () => mode,
      resolveOwnerUserIdForSessionKey: (sessionKey) =>
        sessionKey === "session-a" ? "user-a" : undefined,
    });

    broadcast("chat", {
      runId: "run-strict",
      sessionKey: "session-a",
      seq: 1,
      state: "delta",
    });
    expect(resolvedAdminSocket.send).toHaveBeenCalledTimes(1);
    expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(0);
    expect(ownerSocket.send).toHaveBeenCalledTimes(1);
    expect(otherUserSocket.send).toHaveBeenCalledTimes(0);

    mode = "off";
    broadcast("chat", {
      runId: "run-off",
      sessionKey: "session-a",
      seq: 2,
      state: "delta",
    });
    expect(resolvedAdminSocket.send).toHaveBeenCalledTimes(2);
    expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(1);
    expect(ownerSocket.send).toHaveBeenCalledTimes(2);
    expect(otherUserSocket.send).toHaveBeenCalledTimes(1);

    mode = "strict";
    broadcast("chat", {
      runId: "run-strict-final",
      sessionKey: "session-a",
      seq: 3,
      state: "delta",
    });
    expect(resolvedAdminSocket.send).toHaveBeenCalledTimes(3);
    expect(unresolvedAdminSocket.send).toHaveBeenCalledTimes(1);
    expect(ownerSocket.send).toHaveBeenCalledTimes(3);
    expect(otherUserSocket.send).toHaveBeenCalledTimes(1);
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
