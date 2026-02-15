import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "./authz-denied-events.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { getHandshakeTimeoutMs } from "./server-constants.js";
import {
  connectReq,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  startGatewayServer,
  startServerWithClient,
  testTailscaleWhois,
  testState,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

async function waitForWsClose(ws: WebSocket, timeoutMs: number): Promise<boolean> {
  if (ws.readyState === WebSocket.CLOSED) {
    return true;
  }
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(ws.readyState === WebSocket.CLOSED), timeoutMs);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const openWs = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  return ws;
};

const openTailscaleWs = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: {
      "x-forwarded-for": "100.64.0.1",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "gateway.tailnet.ts.net",
      "tailscale-user-login": "peter",
      "tailscale-user-name": "Peter",
    },
  });
  await new Promise<void>((resolve) => ws.once("open", resolve));
  return ws;
};

describe("gateway server auth/connect", () => {
  describe("default auth (token)", () => {
    let server: Awaited<ReturnType<typeof startGatewayServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getFreePort();
      server = await startGatewayServer(port);
    });

    afterAll(async () => {
      await server.close();
    });

    test("closes silent handshakes after timeout", { timeout: 60_000 }, async () => {
      vi.useRealTimers();
      const prevHandshakeTimeout = process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS;
      process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS = "50";
      try {
        const ws = await openWs(port);
        const handshakeTimeoutMs = getHandshakeTimeoutMs();
        const closed = await waitForWsClose(ws, handshakeTimeoutMs + 250);
        expect(closed).toBe(true);
      } finally {
        if (prevHandshakeTimeout === undefined) {
          delete process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS;
        } else {
          process.env.OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS = prevHandshakeTimeout;
        }
      }
    });

    test("connect (req) handshake returns hello-ok payload", async () => {
      const { CONFIG_PATH, STATE_DIR } = await import("../config/config.js");
      const ws = await openWs(port);

      const res = await connectReq(ws);
      expect(res.ok).toBe(true);
      const payload = res.payload as
        | {
            type?: unknown;
            snapshot?: { configPath?: string; stateDir?: string };
          }
        | undefined;
      expect(payload?.type).toBe("hello-ok");
      expect(payload?.snapshot?.configPath).toBe(CONFIG_PATH);
      expect(payload?.snapshot?.stateDir).toBe(STATE_DIR);

      ws.close();
    });

    test("operator without scopes is connected but denied method access", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { scopes: [] });
      expect(res.ok).toBe(true);

      ws.send(JSON.stringify({ type: "req", id: "no-scopes-health", method: "health" }));
      const denied = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(ws, (o) => o.type === "res" && o.id === "no-scopes-health");
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("missing scope: operator.read");
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      ws.close();
    });

    test("admin can query denied access events via authz.denied.list", async () => {
      authzDeniedEventsTest.clear();

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-denied-authz-list",
          method: "authz.denied.list",
          params: {},
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-denied-authz-list");
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsUser.close();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin, {
        device: null,
        scopes: ["operator.admin"],
        identity: {
          userId: "admin-panel-user",
          principalId: "admin:panel",
          alias: "PanelAdmin",
        },
      });
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-list",
          method: "authz.denied.list",
          params: {
            method: "authz.denied.list",
            reasonCode: "SCOPE_MISSING",
            userId: "user-a",
            limit: 10,
          },
        }),
      );
      const listed = await onceMessage<{
        ok: boolean;
        payload?: {
          events?: Array<{ method?: string; reasonCode?: string; userId?: string | null }>;
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-list");
      expect(listed.ok).toBe(true);
      expect(listed.payload?.events?.length ?? 0).toBeGreaterThan(0);
      expect(
        listed.payload?.events?.some(
          (event) =>
            event.method === "authz.denied.list" &&
            event.reasonCode === "SCOPE_MISSING" &&
            event.userId === "user-a",
        ),
      ).toBe(true);
      wsAdmin.close();
    });

    test("applies admin-managed identity mappings to owner context and deny audit entries", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              [`device:${identity.deviceId}`]: {
                userId: "user-mapped-a",
                principalId: "msg:discord:default:user-mapped-a",
                alias: "AliceMapped",
                groupIds: ["ops"],
              },
            },
          },
        },
      });

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.write"],
        identity: undefined,
      });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-user-denied-authz-list",
          method: "authz.denied.list",
          params: {},
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "mapped-user-denied-authz-list");
      expect(denied.ok).toBe(false);
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsUser.close();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin, {
        device: null,
        scopes: ["operator.admin"],
        identity: {
          userId: "admin-panel-user",
          principalId: "admin:panel",
          alias: "PanelAdmin",
        },
      });
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-list-mapped-user",
          method: "authz.denied.list",
          params: {
            method: "authz.denied.list",
            reasonCode: "SCOPE_MISSING",
            userId: "user-mapped-a",
            limit: 10,
          },
        }),
      );
      const listed = await onceMessage<{
        ok: boolean;
        payload?: {
          events?: Array<{
            userId?: string | null;
            userAlias?: string | null;
            principalId?: string | null;
          }>;
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-list-mapped-user");
      expect(listed.ok).toBe(true);
      expect(
        listed.payload?.events?.some(
          (event) =>
            event.userId === "user-mapped-a" &&
            event.userAlias === "AliceMapped" &&
            event.principalId === "msg:discord:default:user-mapped-a",
        ),
      ).toBe(true);
      wsAdmin.close();
    });

    test("prevents mapped user principals from elevating with operator.admin scope", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              [`device:${identity.deviceId}`]: {
                userId: "user-mapped-role-user",
                principalId: "msg:discord:default:user-mapped-role-user",
                alias: "MappedRoleUser",
                role: "user",
              },
            },
          },
        },
      });

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.admin", "operator.write"],
        identity: undefined,
      });
      expect(userRes.ok).toBe(true);
      const userHello = userRes.payload as { auth?: { principalRole?: string } } | undefined;
      expect(userHello?.auth?.principalRole).toBe("user");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-role-user-config-get",
          method: "config.get",
          params: {},
        }),
      );
      const deniedAdminMethod = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "mapped-role-user-config-get");
      expect(deniedAdminMethod.ok).toBe(false);
      expect(deniedAdminMethod.error?.message ?? "").toContain(
        "admin scope requires admin principal role",
      );
      expect(deniedAdminMethod.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-role-user-set-heartbeats",
          method: "set-heartbeats",
          params: { enabled: true },
        }),
      );
      const deniedSetHeartbeats = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "mapped-role-user-set-heartbeats");
      expect(deniedSetHeartbeats.ok).toBe(false);
      expect(deniedSetHeartbeats.error?.message ?? "").toContain(
        "admin scope requires admin principal role",
      );
      expect(deniedSetHeartbeats.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-role-user-system-event",
          method: "system-event",
          params: { text: "blocked user system event" },
        }),
      );
      const deniedSystemEvent = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "mapped-role-user-system-event");
      expect(deniedSystemEvent.ok).toBe(false);
      expect(deniedSystemEvent.error?.message ?? "").toContain(
        "admin scope requires admin principal role",
      );
      expect(deniedSystemEvent.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-role-user-channels-logout",
          method: "channels.logout",
          params: { channel: "telegram" },
        }),
      );
      const deniedChannelsLogout = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "mapped-role-user-channels-logout");
      expect(deniedChannelsLogout.ok).toBe(false);
      expect(deniedChannelsLogout.error?.message ?? "").toContain(
        "admin scope requires admin principal role",
      );
      expect(deniedChannelsLogout.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

      const blockedEscalationMethods: Array<{ method: string; params: Record<string, unknown> }> =
        [
          { method: "cron.add", params: {} },
          { method: "cron.update", params: {} },
          { method: "cron.remove", params: {} },
          { method: "cron.run", params: {} },
          { method: "skills.install", params: {} },
          { method: "skills.update", params: {} },
          { method: "agents.create", params: {} },
          { method: "agents.update", params: {} },
          { method: "agents.delete", params: {} },
          { method: "agents.files.list", params: {} },
          { method: "agents.files.get", params: {} },
          { method: "agents.files.set", params: {} },
        ];
      for (const [index, entry] of blockedEscalationMethods.entries()) {
        const id = `mapped-role-user-admin-escalation-${index}`;
        wsUser.send(
          JSON.stringify({
            type: "req",
            id,
            method: entry.method,
            params: entry.params,
          }),
        );
        const denied = await onceMessage<{
          ok: boolean;
          error?: { message?: string; details?: { reasonCode?: string } };
        }>(wsUser, (o) => o.type === "res" && o.id === id);
        expect(denied.ok).toBe(false);
        expect(denied.error?.message ?? "").toContain("admin scope requires admin principal role");
        expect(denied.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");
      }

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-role-user-health",
          method: "health",
          params: {},
        }),
      );
      const allowedWriteMethod = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "mapped-role-user-health",
      );
      expect(allowedWriteMethod.ok).toBe(true);
      wsUser.close();
      const listedConfig = listGatewayAuthzDenyEvents({
        method: "config.get",
        reasonCode: "ROLE_FORBIDDEN",
        userId: "user-mapped-role-user",
        limit: 10,
      });
      expect(
        listedConfig.some(
          (event) =>
            event.method === "config.get" &&
            event.reasonCode === "ROLE_FORBIDDEN" &&
            event.userId === "user-mapped-role-user" &&
            event.userAlias === "MappedRoleUser",
        ),
      ).toBe(true);
      const listed = listGatewayAuthzDenyEvents({
        reasonCode: "ROLE_FORBIDDEN",
        userId: "user-mapped-role-user",
        limit: 50,
      });
      expect(
        listed.some(
          (event) =>
            event.method === "set-heartbeats" &&
            event.reasonCode === "ROLE_FORBIDDEN" &&
            event.userId === "user-mapped-role-user",
        ),
      ).toBe(true);
      expect(
        listed.some(
          (event) =>
            event.method === "system-event" &&
            event.reasonCode === "ROLE_FORBIDDEN" &&
            event.userId === "user-mapped-role-user",
        ),
      ).toBe(true);
      expect(
        listed.some(
          (event) =>
            event.method === "channels.logout" &&
            event.reasonCode === "ROLE_FORBIDDEN" &&
            event.userId === "user-mapped-role-user",
        ),
      ).toBe(true);
      for (const method of [
        "cron.add",
        "cron.update",
        "cron.remove",
        "cron.run",
        "skills.install",
        "skills.update",
        "agents.create",
        "agents.update",
        "agents.delete",
        "agents.files.list",
        "agents.files.get",
        "agents.files.set",
      ]) {
        expect(
          listed.some(
            (event) =>
              event.method === method &&
              event.reasonCode === "ROLE_FORBIDDEN" &&
              event.userId === "user-mapped-role-user",
          ),
        ).toBe(true);
      }
    });

    test("treats mapped principals without explicit role as non-admin for admin scope checks", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              [`device:${identity.deviceId}`]: {
                userId: "user-mapped-no-role",
                principalId: "msg:discord:default:user-mapped-no-role",
                alias: "MappedNoRole",
              },
            },
          },
        },
      });

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.admin", "operator.write"],
        identity: undefined,
      });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-no-role-config-get",
          method: "config.get",
          params: {},
        }),
      );
      const deniedAdminMethod = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "mapped-no-role-config-get");
      expect(deniedAdminMethod.ok).toBe(false);
      expect(deniedAdminMethod.error?.message ?? "").toContain(
        "admin scope requires admin principal role",
      );
      expect(deniedAdminMethod.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "mapped-no-role-health",
          method: "health",
          params: {},
        }),
      );
      const allowedWriteMethod = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "mapped-no-role-health",
      );
      expect(allowedWriteMethod.ok).toBe(true);
      wsUser.close();

      const listed = listGatewayAuthzDenyEvents({
        method: "config.get",
        reasonCode: "ROLE_FORBIDDEN",
        userId: "user-mapped-no-role",
        limit: 10,
      });
      expect(
        listed.some(
          (event) =>
            event.requestId === "mapped-no-role-config-get" &&
            event.userAlias === "MappedNoRole" &&
            event.actorRole === "user",
        ),
      ).toBe(true);
    });

    test("authz.denied.list supports cursor pagination for admin users", async () => {
      authzDeniedEventsTest.clear();

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-pagination",
          principalId: "msg:discord:default:user-pagination",
          alias: "Pager",
        },
      });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "deny-pagination-1",
          method: "authz.denied.list",
          params: {},
        }),
      );
      const denied1 = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "deny-pagination-1",
      );
      expect(denied1.ok).toBe(false);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "deny-pagination-2",
          method: "authz.denied.list",
          params: {},
        }),
      );
      const denied2 = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "deny-pagination-2",
      );
      expect(denied2.ok).toBe(false);
      wsUser.close();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-page-1",
          method: "authz.denied.list",
          params: {
            method: "authz.denied.list",
            reasonCode: "SCOPE_MISSING",
            userId: "user-pagination",
            limit: 1,
            order: "desc",
          },
        }),
      );
      const page1 = await onceMessage<{
        ok: boolean;
        payload?: {
          events?: Array<{ requestId?: string }>;
          nextCursor?: string | null;
          hasMore?: boolean;
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-page-1");
      expect(page1.ok).toBe(true);
      expect(page1.payload?.events?.length).toBe(1);
      expect(page1.payload?.hasMore).toBe(true);
      expect(typeof page1.payload?.nextCursor).toBe("string");

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-page-2",
          method: "authz.denied.list",
          params: {
            method: "authz.denied.list",
            reasonCode: "SCOPE_MISSING",
            userId: "user-pagination",
            limit: 1,
            order: "desc",
            cursor: page1.payload?.nextCursor,
          },
        }),
      );
      const page2 = await onceMessage<{
        ok: boolean;
        payload?: { events?: Array<{ requestId?: string }> };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-page-2");
      expect(page2.ok).toBe(true);
      expect(page2.payload?.events?.length).toBe(1);
      expect(page2.payload?.events?.[0]?.requestId).not.toBe(page1.payload?.events?.[0]?.requestId);
      wsAdmin.close();
    });

    test("admin can query denied access summary via authz.denied.summary", async () => {
      authzDeniedEventsTest.clear();

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-summary",
          principalId: "msg:discord:default:user-summary",
          alias: "SummaryUser",
        },
      });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-denied-summary-1",
          method: "authz.denied.list",
          params: {},
        }),
      );
      const deniedOne = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "user-denied-summary-1",
      );
      expect(deniedOne.ok).toBe(false);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-denied-summary-2",
          method: "authz.denied.list",
          params: {},
        }),
      );
      const deniedTwo = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "user-denied-summary-2",
      );
      expect(deniedTwo.ok).toBe(false);
      wsUser.close();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-summary",
          method: "authz.denied.summary",
          params: {
            reasonCode: "SCOPE_MISSING",
            userId: "user-summary",
            topN: 5,
          },
        }),
      );
      const summary = await onceMessage<{
        ok: boolean;
        payload?: {
          total?: number;
          byReasonCode?: Array<{ key?: string; count?: number }>;
          byMethod?: Array<{ key?: string; count?: number }>;
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-summary");
      expect(summary.ok).toBe(true);
      expect(summary.payload?.total).toBeGreaterThanOrEqual(2);
      expect(summary.payload?.byReasonCode?.[0]?.key).toBe("SCOPE_MISSING");
      expect(summary.payload?.byMethod?.some((entry) => entry.key === "authz.denied.list")).toBe(
        true,
      );
      wsAdmin.close();
    });

    test("config.changes.list remains admin-only", async () => {
      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, { scopes: ["operator.write"] });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-config-changes",
          method: "config.changes.list",
          params: {},
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-config-changes");
      expect(denied.ok).toBe(false);
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsUser.close();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-config-changes",
          method: "config.changes.list",
          params: { limit: 5 },
        }),
      );
      const listed = await onceMessage<{
        ok: boolean;
        payload?: { events?: unknown[]; hasMore?: boolean };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-config-changes");
      expect(listed.ok).toBe(true);
      expect(Array.isArray(listed.payload?.events)).toBe(true);
      expect(typeof listed.payload?.hasMore).toBe("boolean");
      wsAdmin.close();
    });

    test("talk.mode remains admin-only", async () => {
      authzDeniedEventsTest.clear();
      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, { scopes: ["operator.write"] });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-talk-mode",
          method: "talk.mode",
          params: { enabled: true },
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-talk-mode");
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsUser.close();

      const talkModeDeny = listGatewayAuthzDenyEvents({
        method: "talk.mode",
        reasonCode: "SCOPE_MISSING",
        limit: 10,
      }).find((entry) => entry.requestId === "user-talk-mode");
      expect(talkModeDeny).toBeDefined();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-talk-mode",
          method: "talk.mode",
          params: { enabled: true },
        }),
      );
      const allowed = await onceMessage<{
        ok: boolean;
        payload?: { enabled?: boolean; phase?: string | null };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-talk-mode");
      expect(allowed.ok).toBe(true);
      expect(allowed.payload?.enabled).toBe(true);
      expect(allowed.payload?.phase ?? null).toBeNull();
      wsAdmin.close();
    });

    test("wake remains admin-only", async () => {
      authzDeniedEventsTest.clear();
      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, { scopes: ["operator.write"] });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-wake",
          method: "wake",
          params: { mode: "now", text: "hello wake" },
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-wake");
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsUser.close();

      const wakeDeny = listGatewayAuthzDenyEvents({
        method: "wake",
        reasonCode: "SCOPE_MISSING",
        limit: 10,
      }).find((entry) => entry.requestId === "user-wake");
      expect(wakeDeny).toBeDefined();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-wake",
          method: "wake",
          params: { mode: "next-heartbeat", text: "hello wake" },
        }),
      );
      const allowed = await onceMessage<{
        ok: boolean;
        payload?: { ok?: boolean };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-wake");
      expect(allowed.ok).toBe(true);
      expect(allowed.payload?.ok).toBe(true);
      wsAdmin.close();
    });

    test("set-heartbeats, system-event, and channels.logout remain admin-only", async () => {
      authzDeniedEventsTest.clear();
      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, { scopes: ["operator.write"] });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-set-heartbeats",
          method: "set-heartbeats",
          params: { enabled: true },
        }),
      );
      const deniedSetHeartbeats = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-set-heartbeats");
      expect(deniedSetHeartbeats.ok).toBe(false);
      expect(deniedSetHeartbeats.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(deniedSetHeartbeats.error?.details?.reasonCode).toBe("SCOPE_MISSING");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-system-event",
          method: "system-event",
          params: { text: "user event" },
        }),
      );
      const deniedSystemEvent = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-system-event");
      expect(deniedSystemEvent.ok).toBe(false);
      expect(deniedSystemEvent.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(deniedSystemEvent.error?.details?.reasonCode).toBe("SCOPE_MISSING");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-channels-logout",
          method: "channels.logout",
          params: { channel: "telegram" },
        }),
      );
      const deniedChannelLogout = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-channels-logout");
      expect(deniedChannelLogout.ok).toBe(false);
      expect(deniedChannelLogout.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(deniedChannelLogout.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsUser.close();

      const deniedSetHeartbeatsEvent = listGatewayAuthzDenyEvents({
        method: "set-heartbeats",
        reasonCode: "SCOPE_MISSING",
        limit: 10,
      }).find((entry) => entry.requestId === "user-set-heartbeats");
      expect(deniedSetHeartbeatsEvent).toBeDefined();
      const deniedSystemEventRecord = listGatewayAuthzDenyEvents({
        method: "system-event",
        reasonCode: "SCOPE_MISSING",
        limit: 10,
      }).find((entry) => entry.requestId === "user-system-event");
      expect(deniedSystemEventRecord).toBeDefined();
      const deniedChannelLogoutRecord = listGatewayAuthzDenyEvents({
        method: "channels.logout",
        reasonCode: "SCOPE_MISSING",
        limit: 10,
      }).find((entry) => entry.requestId === "user-channels-logout");
      expect(deniedChannelLogoutRecord).toBeDefined();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-set-heartbeats",
          method: "set-heartbeats",
          params: { enabled: true },
        }),
      );
      const allowedSetHeartbeats = await onceMessage<{
        ok: boolean;
        payload?: { ok?: boolean; enabled?: boolean };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-set-heartbeats");
      expect(allowedSetHeartbeats.ok).toBe(true);
      expect(allowedSetHeartbeats.payload?.ok).toBe(true);
      expect(allowedSetHeartbeats.payload?.enabled).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-system-event",
          method: "system-event",
          params: { text: "admin event" },
        }),
      );
      const allowedSystemEvent = await onceMessage<{
        ok: boolean;
        payload?: { ok?: boolean };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-system-event");
      expect(allowedSystemEvent.ok).toBe(true);
      expect(allowedSystemEvent.payload?.ok).toBe(true);
      wsAdmin.close();
    });

    test("config policy bundle methods remain admin-only", async () => {
      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-policy-bundles",
          principalId: "msg:discord:default:user-policy-bundles",
          alias: "PolicyUser",
        },
      });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-policy-bundles-list",
          method: "config.policyBundles.list",
          params: {},
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-policy-bundles-list");
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-policy-bundle-resolve",
          method: "config.policyBundle.resolve",
          params: { bundleId: "strict_admin_control" },
        }),
      );
      const deniedResolve = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-policy-bundle-resolve");
      expect(deniedResolve.ok).toBe(false);
      expect(deniedResolve.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(deniedResolve.error?.details?.reasonCode).toBe("SCOPE_MISSING");

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-policy-bundle-apply",
          method: "config.policyBundle.apply",
          params: { bundleId: "strict_admin_control" },
        }),
      );
      const deniedApply = await onceMessage<{
        ok: boolean;
        error?: { message?: string; details?: { reasonCode?: string } };
      }>(wsUser, (o) => o.type === "res" && o.id === "user-policy-bundle-apply");
      expect(deniedApply.ok).toBe(false);
      expect(deniedApply.error?.message ?? "").toContain("missing scope: operator.admin");
      expect(deniedApply.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsUser.close();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-policy-bundles-list",
          method: "config.policyBundles.list",
          params: {},
        }),
      );
      const listed = await onceMessage<{
        ok: boolean;
        payload?: { bundles?: Array<{ id?: string }> };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-policy-bundles-list");
      expect(listed.ok).toBe(true);
      expect(listed.payload?.bundles?.some((bundle) => bundle.id === "strict_admin_control")).toBe(
        true,
      );

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-policy-bundle-resolve",
          method: "config.policyBundle.resolve",
          params: { bundleId: "strict_admin_control" },
        }),
      );
      const resolved = await onceMessage<{
        ok: boolean;
        payload?: {
          bundle?: { id?: string; patch?: { commands?: { config?: boolean; debug?: boolean } } };
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-policy-bundle-resolve");
      expect(resolved.ok).toBe(true);
      expect(resolved.payload?.bundle?.id).toBe("strict_admin_control");
      expect(resolved.payload?.bundle?.patch?.commands?.config).toBe(false);
      expect(resolved.payload?.bundle?.patch?.commands?.debug).toBe(false);
      wsAdmin.close();
    });

    test("pairing methods require operator.pairing for mapped non-admin principals in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              [`device:${identity.deviceId}`]: {
                userId: "user-mapped-pairing",
                principalId: "msg:discord:default:user-mapped-pairing",
                alias: "MappedPairingUser",
                role: "user",
              },
            },
          },
        },
      });

      const request = async (ws: WebSocket, id: string, scopes: string[]) => {
        const res = await connectReq(ws, { scopes, identity: undefined });
        expect(res.ok).toBe(true);
        ws.send(JSON.stringify({ type: "req", id, method: "node.pair.list", params: {} }));
        return await onceMessage<{
          ok: boolean;
          error?: { message?: string; details?: { reasonCode?: string } };
          payload?: { pending?: unknown[]; paired?: unknown[] };
        }>(ws, (o) => o.type === "res" && o.id === id);
      };

      const wsMissing = await openWs(port);
      const deniedMissing = await request(wsMissing, "mapped-pairing-missing-scope", [
        "operator.write",
      ]);
      expect(deniedMissing.ok).toBe(false);
      expect(deniedMissing.error?.message ?? "").toContain("missing scope: operator.pairing");
      expect(deniedMissing.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsMissing.close();

      const wsAdminOnly = await openWs(port);
      const deniedAdminOnly = await request(wsAdminOnly, "mapped-pairing-admin-without-pairing", [
        "operator.admin",
        "operator.write",
      ]);
      expect(deniedAdminOnly.ok).toBe(false);
      expect(deniedAdminOnly.error?.message ?? "").toContain("missing scope: operator.pairing");
      expect(deniedAdminOnly.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsAdminOnly.close();

      const wsAllowed = await openWs(port);
      const allowed = await request(wsAllowed, "mapped-pairing-allowed", ["operator.pairing"]);
      expect(allowed.ok).toBe(true);
      expect(Array.isArray(allowed.payload?.pending)).toBe(true);
      expect(Array.isArray(allowed.payload?.paired)).toBe(true);
      wsAllowed.close();

      const deniedEvents = listGatewayAuthzDenyEvents({
        method: "node.pair.list",
        reasonCode: "SCOPE_MISSING",
        userId: "user-mapped-pairing",
        limit: 20,
      });
      expect(
        deniedEvents.some((event) => event.requestId === "mapped-pairing-missing-scope"),
      ).toBe(true);
      expect(
        deniedEvents.some((event) => event.requestId === "mapped-pairing-admin-without-pairing"),
      ).toBe(true);
    });

    test("approval methods require operator.approvals for mapped non-admin principals in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              [`device:${identity.deviceId}`]: {
                userId: "user-mapped-approvals",
                principalId: "msg:discord:default:user-mapped-approvals",
                alias: "MappedApprovalsUser",
                role: "user",
              },
            },
          },
        },
      });

      const request = async (ws: WebSocket, id: string, scopes: string[]) => {
        const res = await connectReq(ws, { scopes, identity: undefined });
        expect(res.ok).toBe(true);
        ws.send(
          JSON.stringify({
            type: "req",
            id,
            method: "exec.approval.resolve",
            params: { id: "missing-approval-id", decision: "deny" },
          }),
        );
        return await onceMessage<{
          ok: boolean;
          error?: { message?: string; details?: { reasonCode?: string } };
        }>(ws, (o) => o.type === "res" && o.id === id);
      };

      const wsMissing = await openWs(port);
      const deniedMissing = await request(wsMissing, "mapped-approval-missing-scope", [
        "operator.write",
      ]);
      expect(deniedMissing.ok).toBe(false);
      expect(deniedMissing.error?.message ?? "").toContain("missing scope: operator.approvals");
      expect(deniedMissing.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsMissing.close();

      const wsAdminOnly = await openWs(port);
      const deniedAdminOnly = await request(wsAdminOnly, "mapped-approval-admin-without-approvals", [
        "operator.admin",
        "operator.write",
      ]);
      expect(deniedAdminOnly.ok).toBe(false);
      expect(deniedAdminOnly.error?.message ?? "").toContain("missing scope: operator.approvals");
      expect(deniedAdminOnly.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      wsAdminOnly.close();

      const wsAllowed = await openWs(port);
      const allowed = await request(wsAllowed, "mapped-approval-allowed", ["operator.approvals"]);
      expect(allowed.ok).toBe(false);
      expect(allowed.error?.message ?? "").not.toContain("missing scope: operator.approvals");
      wsAllowed.close();

      const deniedEvents = listGatewayAuthzDenyEvents({
        method: "exec.approval.resolve",
        reasonCode: "SCOPE_MISSING",
        userId: "user-mapped-approvals",
        limit: 20,
      });
      expect(
        deniedEvents.some((event) => event.requestId === "mapped-approval-missing-scope"),
      ).toBe(true);
      expect(
        deniedEvents.some(
          (event) => event.requestId === "mapped-approval-admin-without-approvals",
        ),
      ).toBe(true);
    });

    test("device pairing and token methods require operator.pairing for mapped non-admin principals in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              [`device:${identity.deviceId}`]: {
                userId: "user-mapped-device-pairing",
                principalId: "msg:discord:default:user-mapped-device-pairing",
                alias: "MappedDevicePairingUser",
                role: "user",
              },
            },
          },
        },
      });

      const methods: Array<{ method: string; params: Record<string, unknown> }> = [
        { method: "device.pair.list", params: {} },
        { method: "device.pair.approve", params: { requestId: "missing-request-id" } },
        { method: "device.pair.reject", params: { requestId: "missing-request-id" } },
        {
          method: "device.token.rotate",
          params: { deviceId: "missing-device-id", role: "operator.write" },
        },
        {
          method: "device.token.revoke",
          params: { deviceId: "missing-device-id", role: "operator.write" },
        },
      ];

      const callMethod = async (
        ws: WebSocket,
        id: string,
        method: string,
        params: Record<string, unknown>,
      ) => {
        ws.send(JSON.stringify({ type: "req", id, method, params }));
        return await onceMessage<{
          ok: boolean;
          error?: { message?: string; details?: { reasonCode?: string } };
        }>(ws, (o) => o.type === "res" && o.id === id);
      };

      const assertMissingPairingScope = async (scopes: string[], idPrefix: string) => {
        const ws = await openWs(port);
        const res = await connectReq(ws, { scopes, identity: undefined });
        expect(res.ok).toBe(true);
        for (const [index, entry] of methods.entries()) {
          const id = `${idPrefix}-${index}`;
          const denied = await callMethod(ws, id, entry.method, entry.params);
          expect(denied.ok).toBe(false);
          expect(denied.error?.message ?? "").toContain("missing scope: operator.pairing");
          expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
        }
        ws.close();
      };

      await assertMissingPairingScope(["operator.write"], "mapped-device-pairing-missing-scope");
      await assertMissingPairingScope(
        ["operator.admin", "operator.write"],
        "mapped-device-pairing-admin-without-pairing",
      );

      const wsAllowed = await openWs(port);
      const allowedRes = await connectReq(wsAllowed, {
        scopes: ["operator.pairing"],
        identity: undefined,
      });
      expect(allowedRes.ok).toBe(true);
      for (const [index, entry] of methods.entries()) {
        const id = `mapped-device-pairing-allowed-${index}`;
        const result = await callMethod(wsAllowed, id, entry.method, entry.params);
        if (entry.method === "device.pair.list") {
          expect(result.ok).toBe(true);
          continue;
        }
        expect(result.ok).toBe(false);
        expect(result.error?.message ?? "").not.toContain("missing scope: operator.pairing");
      }
      wsAllowed.close();

      const deniedEvents = listGatewayAuthzDenyEvents({
        reasonCode: "SCOPE_MISSING",
        userId: "user-mapped-device-pairing",
        limit: 200,
      });
      for (const [index, entry] of methods.entries()) {
        expect(
          deniedEvents.some(
            (event) =>
              event.method === entry.method &&
              event.requestId === `mapped-device-pairing-missing-scope-${index}`,
          ),
        ).toBe(true);
        expect(
          deniedEvents.some(
            (event) =>
              event.method === entry.method &&
              event.requestId === `mapped-device-pairing-admin-without-pairing-${index}`,
          ),
        ).toBe(true);
      }
    });

    test("cron, skills, and agent mutation methods remain admin-only", async () => {
      authzDeniedEventsTest.clear();
      const methods: Array<{ method: string; params: Record<string, unknown> }> = [
        { method: "cron.add", params: {} },
        { method: "cron.update", params: {} },
        { method: "cron.remove", params: {} },
        { method: "cron.run", params: {} },
        { method: "skills.install", params: {} },
        { method: "skills.update", params: {} },
        { method: "agents.create", params: {} },
        { method: "agents.update", params: {} },
        { method: "agents.delete", params: {} },
        { method: "agents.files.list", params: {} },
        { method: "agents.files.get", params: {} },
        { method: "agents.files.set", params: {} },
      ];
      const request = async (
        ws: WebSocket,
        id: string,
        method: string,
        params: Record<string, unknown>,
      ) => {
        ws.send(JSON.stringify({ type: "req", id, method, params }));
        return await onceMessage<{
          ok: boolean;
          error?: { message?: string; details?: { reasonCode?: string } };
        }>(ws, (o) => o.type === "res" && o.id === id);
      };

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, { scopes: ["operator.write"] });
      expect(userRes.ok).toBe(true);

      const deniedIds: Array<{ id: string; method: string }> = [];
      for (const [index, entry] of methods.entries()) {
        const id = `user-admin-method-${index}`;
        deniedIds.push({ id, method: entry.method });
        const denied = await request(wsUser, id, entry.method, entry.params);
        expect(denied.ok).toBe(false);
        expect(denied.error?.message ?? "").toContain("missing scope: operator.admin");
        expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      }
      wsUser.close();

      for (const denied of deniedIds) {
        const event = listGatewayAuthzDenyEvents({
          method: denied.method,
          reasonCode: "SCOPE_MISSING",
          limit: 20,
        }).find((entry) => entry.requestId === denied.id);
        expect(event).toBeDefined();
      }

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);
      for (const [index, entry] of methods.entries()) {
        const id = `admin-admin-method-${index}`;
        const allowed = await request(wsAdmin, id, entry.method, entry.params);
        if (!allowed.ok) {
          expect(allowed.error?.message ?? "").not.toContain("missing scope: operator.admin");
        }
      }
      wsAdmin.close();
    });

    test("operator.write can access session lifecycle methods", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { scopes: ["operator.write"] });
      expect(res.ok).toBe(true);

      const request = async (id: string, method: string, params: Record<string, unknown> = {}) => {
        ws.send(JSON.stringify({ type: "req", id, method, params }));
        return await onceMessage<{
          ok: boolean;
          error?: { message?: string; details?: { reasonCode?: string } };
        }>(ws, (o) => o.type === "res" && o.id === id);
      };

      const patchRes = await request("write-sessions-patch", "sessions.patch", {});
      expect(patchRes.ok).toBe(false);
      expect(patchRes.error?.message ?? "").not.toContain("missing scope");

      const resetRes = await request("write-sessions-reset", "sessions.reset", {});
      expect(resetRes.ok).toBe(false);
      expect(resetRes.error?.message ?? "").not.toContain("missing scope");

      const deleteRes = await request("write-sessions-delete", "sessions.delete", {});
      expect(deleteRes.ok).toBe(false);
      expect(deleteRes.error?.message ?? "").not.toContain("missing scope");

      const compactRes = await request("write-sessions-compact", "sessions.compact", {});
      expect(compactRes.ok).toBe(false);
      expect(compactRes.error?.message ?? "").not.toContain("missing scope");

      ws.close();
    });

    test("rejects unauthenticated sender without identity", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        skipDefaultAuth: true,
        device: null,
        identity: undefined,
      });
      expect(res.ok).toBe(false);
      const errorMessage = res.error?.message ?? "";
      const expected = ["unknown sender identity", "device identity required"];
      expect(expected.some((candidate) => errorMessage.includes(candidate))).toBe(true);
      await new Promise<void>((resolve) => ws.once("close", () => resolve()));
    });

    test("rejects shared-auth non-admin connections without sender identity in strict mode", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        device: null,
        identity: undefined,
        scopes: ["operator.write"],
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unknown sender identity");
      await new Promise<void>((resolve) => ws.once("close", () => resolve()));
    });

    test("rejects shared-auth non-admin connections with only self-asserted identity in strict mode", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        device: null,
        scopes: ["operator.write"],
        identity: {
          userId: "spoof-user",
          principalId: "msg:discord:default:spoof-user",
          alias: "SpoofUser",
        },
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unknown sender identity");
      await new Promise<void>((resolve) => ws.once("close", () => resolve()));
    });

    test("accepts local shared-auth device callers with explicit identity in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        scopes: ["operator.write"],
        identity: {
          userId: "trusted-local-user",
          principalId: "msg:discord:default:trusted-local-user",
          alias: "TrustedLocalUser",
        },
      });
      expect(res.ok).toBe(true);
      ws.send(
        JSON.stringify({
          type: "req",
          id: "local-shared-auth-identity-check",
          method: "config.get",
          params: {},
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { details?: { reasonCode?: string } };
      }>(ws, (o) => o.type === "res" && o.id === "local-shared-auth-identity-check");
      expect(denied.ok).toBe(false);
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      ws.close();

      const event = listGatewayAuthzDenyEvents({
        method: "config.get",
        reasonCode: "SCOPE_MISSING",
        limit: 50,
      }).find((entry) => entry.requestId === "local-shared-auth-identity-check");
      expect(event).toBeDefined();
      expect(event?.userId).toBe("trusted-local-user");
      expect(event?.principalId).toBe("msg:discord:default:trusted-local-user");
    });

    test("allows shared-auth non-admin connections when sender is mapped in strict mode", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              "client:test:default": {
                userId: "user-shared-auth-mapped",
                principalId: "msg:webchat:default:user-shared-auth-mapped",
                alias: "SharedAuthMapped",
                role: "user",
              },
            },
          },
        },
      });
      try {
        const ws = await openWs(port);
        const connect = await connectReq(ws, {
          device: null,
          identity: undefined,
          scopes: ["operator.write"],
        });
        expect(connect.ok).toBe(true);
        ws.send(
          JSON.stringify({
            type: "req",
            id: "shared-auth-mapped-health",
            method: "health",
            params: {},
          }),
        );
        const health = await onceMessage<{ ok: boolean }>(
          ws,
          (o) => o.type === "res" && o.id === "shared-auth-mapped-health",
        );
        expect(health.ok).toBe(true);
        ws.close();
      } finally {
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode: "strict",
              identities: {},
            },
          },
        });
      }
    });

    test("records unknown sender connect denies in authz.denied.list", async () => {
      authzDeniedEventsTest.clear();

      const wsUnknown = await openWs(port);
      const denied = await connectReq(wsUnknown, {
        skipDefaultAuth: true,
        device: null,
        identity: undefined,
      });
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("unknown sender identity");
      await new Promise<void>((resolve) => wsUnknown.once("close", () => resolve()));

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-list-unknown-sender",
          method: "authz.denied.list",
          params: {
            method: "connect",
            reasonCode: "UNKNOWN_SENDER",
            limit: 10,
          },
        }),
      );
      const listed = await onceMessage<{
        ok: boolean;
        payload?: {
          events?: Array<{ method?: string; reasonCode?: string; userId?: string | null }>;
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-list-unknown-sender");
      expect(listed.ok).toBe(true);
      expect(
        listed.payload?.events?.some(
          (event) =>
            event.method === "connect" &&
            event.reasonCode === "UNKNOWN_SENDER" &&
            event.userId === null,
        ),
      ).toBe(true);
      wsAdmin.close();
    });

    test("records unauthorized connect auth failures in authz.denied.list", async () => {
      authzDeniedEventsTest.clear();

      const wsUnauthorized = await openWs(port);
      const denied = await connectReq(wsUnauthorized, {
        token: "wrong-token",
      });
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("gateway token mismatch");
      await new Promise<void>((resolve) => wsUnauthorized.once("close", () => resolve()));

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-list-auth-unauthorized",
          method: "authz.denied.list",
          params: {
            method: "connect",
            reasonCode: "AUTH_UNAUTHORIZED",
            limit: 10,
          },
        }),
      );
      const listed = await onceMessage<{
        ok: boolean;
        payload?: {
          events?: Array<{ method?: string; reasonCode?: string; userId?: string | null }>;
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-list-auth-unauthorized");
      expect(listed.ok).toBe(true);
      expect(
        listed.payload?.events?.some(
          (event) =>
            event.method === "connect" &&
            event.reasonCode === "AUTH_UNAUTHORIZED" &&
            event.userId === null,
        ),
      ).toBe(true);
      wsAdmin.close();
    });

    test("sends connect challenge on open", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const evtPromise = onceMessage<{ payload?: unknown }>(
        ws,
        (o) => o.type === "event" && o.event === "connect.challenge",
      );
      await new Promise<void>((resolve) => ws.once("open", resolve));
      const evt = await evtPromise;
      const nonce = (evt.payload as { nonce?: unknown } | undefined)?.nonce;
      expect(typeof nonce).toBe("string");
      ws.close();
    });

    test("rejects protocol mismatch", async () => {
      const ws = await openWs(port);
      try {
        const res = await connectReq(ws, {
          minProtocol: PROTOCOL_VERSION + 1,
          maxProtocol: PROTOCOL_VERSION + 2,
        });
        expect(res.ok).toBe(false);
      } catch {
        // If the server closed before we saw the frame, that's acceptable.
      }
      ws.close();
    });

    test("rejects non-connect first request", async () => {
      const ws = await openWs(port);
      ws.send(JSON.stringify({ type: "req", id: "h1", method: "health" }));
      const res = await onceMessage<{ ok: boolean; error?: unknown }>(
        ws,
        (o) => o.type === "res" && o.id === "h1",
      );
      expect(res.ok).toBe(false);
      await new Promise<void>((resolve) => ws.once("close", () => resolve()));
    });

    test("requires nonce when host is non-local", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { host: "example.com" },
      });
      await new Promise<void>((resolve) => ws.once("open", resolve));

      const res = await connectReq(ws);
      expect(res.ok).toBe(false);
      expect(res.error?.message).toBe("device nonce required");
      await new Promise<void>((resolve) => ws.once("close", () => resolve()));
    });

    test(
      "invalid connect params surface in response and close reason",
      { timeout: 60_000 },
      async () => {
        const ws = await openWs(port);
        const closeInfoPromise = new Promise<{ code: number; reason: string }>((resolve) => {
          ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
        });

        ws.send(
          JSON.stringify({
            type: "req",
            id: "h-bad",
            method: "connect",
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: "bad-client",
                version: "dev",
                platform: "web",
                mode: "webchat",
              },
              device: {
                id: 123,
                publicKey: "bad",
                signature: "bad",
                signedAt: "bad",
              },
            },
          }),
        );

        const res = await onceMessage<{
          ok: boolean;
          error?: { message?: string };
        }>(
          ws,
          (o) => (o as { type?: string }).type === "res" && (o as { id?: string }).id === "h-bad",
        );
        expect(res.ok).toBe(false);
        expect(String(res.error?.message ?? "")).toContain("invalid connect params");

        const closeInfo = await closeInfoPromise;
        expect(closeInfo.code).toBe(1008);
        expect(closeInfo.reason).toContain("invalid connect params");
      },
    );
  });

  describe("password auth", () => {
    let server: Awaited<ReturnType<typeof startGatewayServer>>;
    let port: number;

    beforeAll(async () => {
      testState.gatewayAuth = { mode: "password", password: "secret" };
      port = await getFreePort();
      server = await startGatewayServer(port);
    });

    afterAll(async () => {
      await server.close();
    });

    test("accepts password auth when configured", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { password: "secret" });
      expect(res.ok).toBe(true);
      ws.close();
    });

    test("rejects invalid password", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { password: "wrong" });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unauthorized");
      ws.close();
    });
  });

  describe("token auth", () => {
    let server: Awaited<ReturnType<typeof startGatewayServer>>;
    let port: number;
    let prevToken: string | undefined;

    beforeAll(async () => {
      prevToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      process.env.OPENCLAW_GATEWAY_TOKEN = "secret";
      port = await getFreePort();
      server = await startGatewayServer(port);
    });

    afterAll(async () => {
      await server.close();
      if (prevToken === undefined) {
        delete process.env.OPENCLAW_GATEWAY_TOKEN;
      } else {
        process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
      }
    });

    test("rejects invalid token", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { token: "wrong" });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unauthorized");
      ws.close();
    });

    test("returns control ui hint when token is missing", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        skipDefaultAuth: true,
        client: {
          id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          version: "1.0.0",
          platform: "web",
          mode: GATEWAY_CLIENT_MODES.WEBCHAT,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("Control UI settings");
      ws.close();
    });

    test("rejects control ui without device identity by default", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        token: "secret",
        device: null,
        client: {
          id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          version: "1.0.0",
          platform: "web",
          mode: GATEWAY_CLIENT_MODES.WEBCHAT,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("secure context");
      ws.close();
    });
  });

  describe("tailscale auth", () => {
    let server: Awaited<ReturnType<typeof startGatewayServer>>;
    let port: number;

    beforeAll(async () => {
      testState.gatewayAuth = { mode: "token", token: "secret", allowTailscale: true };
      port = await getFreePort();
      server = await startGatewayServer(port);
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(() => {
      testTailscaleWhois.value = { login: "peter", name: "Peter" };
    });

    afterEach(() => {
      testTailscaleWhois.value = null;
    });

    test("requires device identity when only tailscale auth is available", async () => {
      const ws = await openTailscaleWs(port);
      const res = await connectReq(ws, { token: "dummy", device: null });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("device identity required");
      ws.close();
    });

    test("allows shared token to skip device when tailscale auth is enabled", async () => {
      const ws = await openTailscaleWs(port);
      const res = await connectReq(ws, { token: "secret", device: null });
      expect(res.ok).toBe(true);
      ws.close();
    });

    test("ignores self-asserted identity for non-local shared-auth callers", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { publicKeyRawBase64UrlFromPem, signDevicePayload } = await import(
        "../infra/device-identity.js"
      );
      const connectWithNonceDevice = async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
          headers: {
            "x-forwarded-for": "100.64.0.1",
            "x-forwarded-proto": "https",
            "x-forwarded-host": "gateway.tailnet.ts.net",
            "tailscale-user-login": "peter",
            "tailscale-user-name": "Peter",
          },
        });
        const challengePromise = onceMessage<{ payload?: { nonce?: unknown } }>(
          ws,
          (o) => o.type === "event" && o.event === "connect.challenge",
        );
        await new Promise<void>((resolve) => ws.once("open", resolve));
        const challenge = await challengePromise;
        const nonce = challenge.payload?.nonce;
        expect(typeof nonce).toBe("string");
        const signedAtMs = Date.now();
        const devicePayload = buildDeviceAuthPayload({
          deviceId: identity.deviceId,
          clientId: GATEWAY_CLIENT_NAMES.TEST,
          clientMode: GATEWAY_CLIENT_MODES.TEST,
          role: "operator",
          scopes: ["operator.write"],
          signedAtMs,
          token: "secret",
          nonce: String(nonce),
        });
        const res = await connectReq(ws, {
          token: "secret",
          scopes: ["operator.write"],
          identity: {
            userId: "spoof-user",
            principalId: "msg:discord:default:spoof-user",
            alias: "SpoofUser",
          },
          device: {
            id: identity.deviceId,
            publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
            signature: signDevicePayload(identity.privateKeyPem, devicePayload),
            signedAt: signedAtMs,
            nonce: String(nonce),
          },
        });
        return { ws, res };
      };

      let { ws, res } = await connectWithNonceDevice();
      if (!res.ok) {
        expect(res.error?.message ?? "").toContain("pairing required");
        ws.close();
        const { approveDevicePairing, listDevicePairing } = await import("../infra/device-pairing.js");
        const list = await listDevicePairing();
        const pending = list.pending.at(0);
        expect(pending?.requestId).toBeDefined();
        if (pending?.requestId) {
          await approveDevicePairing(pending.requestId);
        }
        ({ ws, res } = await connectWithNonceDevice());
      }
      expect(res.ok).toBe(true);

      ws.send(
        JSON.stringify({
          type: "req",
          id: "tailscale-shared-auth-identity-spoof-check",
          method: "config.get",
          params: {},
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { details?: { reasonCode?: string } };
      }>(ws, (o) => o.type === "res" && o.id === "tailscale-shared-auth-identity-spoof-check");
      expect(denied.ok).toBe(false);
      expect(denied.error?.details?.reasonCode).toBe("SCOPE_MISSING");
      ws.close();

      const event = listGatewayAuthzDenyEvents({
        method: "config.get",
        reasonCode: "SCOPE_MISSING",
        limit: 50,
      }).find((entry) => entry.requestId === "tailscale-shared-auth-identity-spoof-check");
      expect(event).toBeDefined();
      expect(event?.userId).toBe(identity.deviceId);
      expect(event?.principalId).toBe(`device:${identity.deviceId}`);
      expect(event?.userId).not.toBe("spoof-user");
      expect(event?.principalId).not.toBe("msg:discord:default:spoof-user");
    });
  });

  test("allows control ui without device identity when insecure auth is enabled", async () => {
    testState.gatewayControlUi = { allowInsecureAuth: true };
    const { server, ws, prevToken } = await startServerWithClient("secret");
    const res = await connectReq(ws, {
      token: "secret",
      device: null,
      client: {
        id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
        version: "1.0.0",
        platform: "web",
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      },
    });
    expect(res.ok).toBe(true);
    ws.close();
    await server.close();
    if (prevToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
    }
  });

  test("allows control ui with device identity when insecure auth is enabled", async () => {
    testState.gatewayControlUi = { allowInsecureAuth: true };
    testState.gatewayAuth = { mode: "token", token: "secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);
    const prevToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    process.env.OPENCLAW_GATEWAY_TOKEN = "secret";
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    const challengePromise = onceMessage<{ payload?: unknown }>(
      ws,
      (o) => o.type === "event" && o.event === "connect.challenge",
    );
    await new Promise<void>((resolve) => ws.once("open", resolve));
    const challenge = await challengePromise;
    const nonce = (challenge.payload as { nonce?: unknown } | undefined)?.nonce;
    expect(typeof nonce).toBe("string");
    const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem, signDevicePayload } =
      await import("../infra/device-identity.js");
    const identity = loadOrCreateDeviceIdentity();
    const signedAtMs = Date.now();
    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: GATEWAY_CLIENT_NAMES.CONTROL_UI,
      clientMode: GATEWAY_CLIENT_MODES.WEBCHAT,
      role: "operator",
      scopes: [],
      signedAtMs,
      token: "secret",
      nonce: String(nonce),
    });
    const device = {
      id: identity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      signature: signDevicePayload(identity.privateKeyPem, payload),
      signedAt: signedAtMs,
      nonce: String(nonce),
    };
    const res = await connectReq(ws, {
      token: "secret",
      scopes: [],
      device,
      client: {
        id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
        version: "1.0.0",
        platform: "web",
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      },
    });
    expect(res.ok).toBe(true);
    ws.close();
    await server.close();
    if (prevToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
    }
  });

  test("allows control ui with stale device identity when device auth is disabled", async () => {
    testState.gatewayControlUi = { dangerouslyDisableDeviceAuth: true };
    testState.gatewayAuth = { mode: "token", token: "secret" };
    const prevToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    process.env.OPENCLAW_GATEWAY_TOKEN = "secret";
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    const ws = await openWs(port);
    const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem, signDevicePayload } =
      await import("../infra/device-identity.js");
    const identity = loadOrCreateDeviceIdentity();
    const signedAtMs = Date.now() - 60 * 60 * 1000;
    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: GATEWAY_CLIENT_NAMES.CONTROL_UI,
      clientMode: GATEWAY_CLIENT_MODES.WEBCHAT,
      role: "operator",
      scopes: [],
      signedAtMs,
      token: "secret",
    });
    const device = {
      id: identity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      signature: signDevicePayload(identity.privateKeyPem, payload),
      signedAt: signedAtMs,
    };
    const res = await connectReq(ws, {
      token: "secret",
      device,
      client: {
        id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
        version: "1.0.0",
        platform: "web",
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      },
    });
    expect(res.ok).toBe(true);
    expect((res.payload as { auth?: unknown } | undefined)?.auth).toBeUndefined();
    ws.close();
    await server.close();
    if (prevToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
    }
  });

  test("accepts device token auth for paired device", async () => {
    const { loadOrCreateDeviceIdentity } = await import("../infra/device-identity.js");
    const { approveDevicePairing, getPairedDevice, listDevicePairing } =
      await import("../infra/device-pairing.js");
    const { server, ws, port, prevToken } = await startServerWithClient("secret");
    const res = await connectReq(ws, { token: "secret" });
    if (!res.ok) {
      const list = await listDevicePairing();
      const pending = list.pending.at(0);
      expect(pending?.requestId).toBeDefined();
      if (pending?.requestId) {
        await approveDevicePairing(pending.requestId);
      }
    }

    const identity = loadOrCreateDeviceIdentity();
    const paired = await getPairedDevice(identity.deviceId);
    const deviceToken = paired?.tokens?.operator?.token;
    expect(deviceToken).toBeDefined();

    ws.close();

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws2.once("open", resolve));
    const res2 = await connectReq(ws2, { token: deviceToken });
    expect(res2.ok).toBe(true);

    ws2.close();
    await server.close();
    if (prevToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
    }
  });

  test("requires pairing for scope upgrades", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { buildDeviceAuthPayload } = await import("./device-auth.js");
    const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem, signDevicePayload } =
      await import("../infra/device-identity.js");
    const { approveDevicePairing, getPairedDevice, listDevicePairing } =
      await import("../infra/device-pairing.js");
    const { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } =
      await import("../utils/message-channel.js");
    const { server, ws, port, prevToken } = await startServerWithClient("secret");
    const identityDir = await mkdtemp(join(tmpdir(), "openclaw-device-scope-"));
    const identity = loadOrCreateDeviceIdentity(join(identityDir, "device.json"));
    const client = {
      id: GATEWAY_CLIENT_NAMES.TEST,
      version: "1.0.0",
      platform: "test",
      mode: GATEWAY_CLIENT_MODES.TEST,
    };
    const buildDevice = (scopes: string[]) => {
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId: client.id,
        clientMode: client.mode,
        role: "operator",
        scopes,
        signedAtMs,
        token: "secret",
      });
      return {
        id: identity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
        signature: signDevicePayload(identity.privateKeyPem, payload),
        signedAt: signedAtMs,
      };
    };
    const initial = await connectReq(ws, {
      token: "secret",
      scopes: ["operator.read"],
      client,
      device: buildDevice(["operator.read"]),
    });
    if (!initial.ok) {
      const list = await listDevicePairing();
      const pending = list.pending.at(0);
      expect(pending?.requestId).toBeDefined();
      if (pending?.requestId) {
        await approveDevicePairing(pending.requestId);
      }
    }

    let paired = await getPairedDevice(identity.deviceId);
    expect(paired?.scopes).toContain("operator.read");

    ws.close();

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws2.once("open", resolve));
    const res = await connectReq(ws2, {
      token: "secret",
      scopes: ["operator.admin"],
      client,
      device: buildDevice(["operator.admin"]),
    });
    expect(res.ok).toBe(true);
    paired = await getPairedDevice(identity.deviceId);
    expect(paired?.scopes).toContain("operator.admin");

    ws2.close();
    await server.close();
    if (prevToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
    }
  });

  test("rejects revoked device token", async () => {
    const { loadOrCreateDeviceIdentity } = await import("../infra/device-identity.js");
    const { approveDevicePairing, getPairedDevice, listDevicePairing, revokeDeviceToken } =
      await import("../infra/device-pairing.js");
    const { server, ws, port, prevToken } = await startServerWithClient("secret");
    const res = await connectReq(ws, { token: "secret" });
    if (!res.ok) {
      const list = await listDevicePairing();
      const pending = list.pending.at(0);
      expect(pending?.requestId).toBeDefined();
      if (pending?.requestId) {
        await approveDevicePairing(pending.requestId);
      }
    }

    const identity = loadOrCreateDeviceIdentity();
    const paired = await getPairedDevice(identity.deviceId);
    const deviceToken = paired?.tokens?.operator?.token;
    expect(deviceToken).toBeDefined();

    await revokeDeviceToken({ deviceId: identity.deviceId, role: "operator" });

    ws.close();

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws2.once("open", resolve));
    const res2 = await connectReq(ws2, { token: deviceToken });
    expect(res2.ok).toBe(false);

    ws2.close();
    await server.close();
    if (prevToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
    }
  });

  // Remaining tests require isolated gateway state.
});
