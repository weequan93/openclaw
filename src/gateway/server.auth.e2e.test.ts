import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { emitHeartbeatEvent } from "../infra/heartbeat-events.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { __test as authzAllowEventsTest } from "./authz-allow-events.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "./authz-denied-events.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
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

const openWsWithHeaders = async (port: number, headers: Record<string, string>) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
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

function rawDataToString(raw: WebSocket.RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return Buffer.from(raw).toString("utf8");
}

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

      const blockedEscalationMethods: Array<{ method: string; params: Record<string, unknown> }> = [
        { method: "status", params: {} },
        { method: "system-presence", params: {} },
        { method: "last-heartbeat", params: {} },
        { method: "cron.list", params: {} },
        { method: "cron.status", params: {} },
        { method: "cron.runs", params: {} },
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
        "status",
        "system-presence",
        "last-heartbeat",
        "cron.list",
        "cron.status",
        "cron.runs",
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

    test("admin can query allow access events and summary via authz.allow methods", async () => {
      authzAllowEventsTest.clear();

      const wsUser = await openWs(port);
      const userRes = await connectReq(wsUser, {
        scopes: ["operator.read"],
        identity: {
          userId: "user-allow-summary",
          principalId: "msg:discord:default:user-allow-summary",
          alias: "AllowSummaryUser",
        },
      });
      expect(userRes.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-allow-health-1",
          method: "health",
          params: {},
        }),
      );
      const allowOne = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "user-allow-health-1",
      );
      expect(allowOne.ok).toBe(true);

      wsUser.send(
        JSON.stringify({
          type: "req",
          id: "user-allow-health-2",
          method: "health",
          params: {},
        }),
      );
      const allowTwo = await onceMessage<{ ok: boolean }>(
        wsUser,
        (o) => o.type === "res" && o.id === "user-allow-health-2",
      );
      expect(allowTwo.ok).toBe(true);
      wsUser.close();

      const wsAdmin = await openWs(port);
      const adminRes = await connectReq(wsAdmin);
      expect(adminRes.ok).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-allow-list",
          method: "authz.allow.list",
          params: {
            method: "health",
            userId: "user-allow-summary",
            limit: 10,
            order: "desc",
          },
        }),
      );
      const allowList = await onceMessage<{
        ok: boolean;
        payload?: {
          events?: Array<{ method?: string; userId?: string; principalId?: string }>;
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-allow-list");
      expect(allowList.ok).toBe(true);
      expect(allowList.payload?.events?.some((event) => event.method === "health")).toBe(true);
      expect(
        allowList.payload?.events?.some(
          (event) =>
            event.userId === "user-allow-summary" &&
            event.principalId === "msg:discord:default:user-allow-summary",
        ),
      ).toBe(true);

      wsAdmin.send(
        JSON.stringify({
          type: "req",
          id: "admin-authz-allow-summary",
          method: "authz.allow.summary",
          params: {
            method: "health",
            userId: "user-allow-summary",
            topN: 5,
            alertThreshold: 2,
          },
        }),
      );
      const allowSummary = await onceMessage<{
        ok: boolean;
        payload?: {
          total?: number;
          byMethod?: Array<{ key?: string; count?: number }>;
          highFrequency?: {
            threshold?: number;
            principals?: Array<{ key?: string; count?: number }>;
          };
        };
      }>(wsAdmin, (o) => o.type === "res" && o.id === "admin-authz-allow-summary");
      expect(allowSummary.ok).toBe(true);
      expect(allowSummary.payload?.total).toBeGreaterThanOrEqual(2);
      expect(allowSummary.payload?.byMethod?.some((entry) => entry.key === "health")).toBe(true);
      expect(allowSummary.payload?.highFrequency?.threshold).toBe(2);
      expect(
        allowSummary.payload?.highFrequency?.principals?.some(
          (entry) => entry.key === "msg:discord:default:user-allow-summary" && entry.count === 2,
        ),
      ).toBe(true);
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

    test("pairing methods require operator.pairing for mapped non-admin principals in strict and compat modes", async () => {
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");

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

      for (const mode of ["strict", "compat"] as const) {
        authzDeniedEventsTest.clear();
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode,
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
      }
    });

    test("approval methods require operator.approvals for mapped non-admin principals in strict and compat modes", async () => {
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");

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

      for (const mode of ["strict", "compat"] as const) {
        authzDeniedEventsTest.clear();
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode,
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

        const wsMissing = await openWs(port);
        const deniedMissing = await request(wsMissing, "mapped-approval-missing-scope", [
          "operator.write",
        ]);
        expect(deniedMissing.ok).toBe(false);
        expect(deniedMissing.error?.message ?? "").toContain("missing scope: operator.approvals");
        expect(deniedMissing.error?.details?.reasonCode).toBe("SCOPE_MISSING");
        wsMissing.close();

        const wsAdminOnly = await openWs(port);
        const deniedAdminOnly = await request(
          wsAdminOnly,
          "mapped-approval-admin-without-approvals",
          ["operator.admin", "operator.write"],
        );
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
      }
    });

    test("device pairing and token methods require operator.pairing for mapped non-admin principals in strict and compat modes", async () => {
      const identity = loadOrCreateDeviceIdentity();
      const { writeConfigFile } = await import("../config/config.js");

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

      for (const mode of ["strict", "compat"] as const) {
        authzDeniedEventsTest.clear();
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode,
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
      }
    });

    test("approval and pairing runtime events require explicit scopes for mapped non-admin principals in strict and compat modes", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      for (const mode of ["strict", "compat"] as const) {
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode,
              identities: {
                "msg:test:mapped-admin-scope-user": {
                  userId: "mapped-admin-scope-user",
                  principalId: "msg:test:mapped-admin-scope-user",
                  alias: "MappedAdminScopeUser",
                  role: "user",
                },
                "msg:test:mapped-no-role-user": {
                  userId: "mapped-no-role-user",
                  principalId: "msg:test:mapped-no-role-user",
                  alias: "MappedNoRoleUser",
                },
                "msg:test:approvals-user": {
                  userId: "approvals-user",
                  principalId: "msg:test:approvals-user",
                  alias: "ApprovalsUser",
                  role: "user",
                },
                "msg:test:pairing-user": {
                  userId: "pairing-user",
                  principalId: "msg:test:pairing-user",
                  alias: "PairingUser",
                  role: "user",
                },
                "msg:test:admin-user": {
                  userId: "admin-user",
                  principalId: "msg:test:admin-user",
                  alias: "AdminUser",
                  role: "admin",
                },
              },
            },
          },
        });

        const modeMarker = `${mode}-${Date.now()}`;
        const mappedUserWs = await openWs(port);
        const mappedNoRoleWs = await openWs(port);
        const approvalsWs = await openWs(port);
        const pairingWs = await openWs(port);
        const adminWs = await openWs(port);
        try {
          const [
            mappedConnect,
            mappedNoRoleConnect,
            approvalsConnect,
            pairingConnect,
            adminConnect,
          ] = await Promise.all([
            connectReq(mappedUserWs, {
              scopes: ["operator.admin", "operator.write"],
              identity: {
                userId: "mapped-admin-scope-user",
                principalId: "msg:test:mapped-admin-scope-user",
                alias: "MappedAdminScopeUser",
              },
            }),
            connectReq(mappedNoRoleWs, {
              scopes: ["operator.admin", "operator.write"],
              identity: {
                userId: "mapped-no-role-user",
                principalId: "msg:test:mapped-no-role-user",
                alias: "MappedNoRoleUser",
              },
            }),
            connectReq(approvalsWs, {
              scopes: ["operator.approvals"],
              identity: {
                userId: "approvals-user",
                principalId: "msg:test:approvals-user",
                alias: "ApprovalsUser",
              },
            }),
            connectReq(pairingWs, {
              scopes: ["operator.pairing"],
              identity: {
                userId: "pairing-user",
                principalId: "msg:test:pairing-user",
                alias: "PairingUser",
              },
            }),
            connectReq(adminWs, {
              scopes: ["operator.admin"],
              identity: {
                userId: "admin-user",
                principalId: "msg:test:admin-user",
                alias: "AdminUser",
              },
            }),
          ]);
          expect(mappedConnect.ok).toBe(true);
          expect(mappedNoRoleConnect.ok).toBe(true);
          expect(approvalsConnect.ok).toBe(true);
          expect(pairingConnect.ok).toBe(true);
          expect(adminConnect.ok).toBe(true);
          expect(
            (mappedConnect.payload as { auth?: { principalRole?: unknown } } | undefined)?.auth
              ?.principalRole,
          ).toBe("user");
          const mappedNoRolePrincipalRole = (
            mappedNoRoleConnect.payload as { auth?: { principalRole?: unknown } } | undefined
          )?.auth?.principalRole;
          expect(
            mappedNoRolePrincipalRole === undefined || mappedNoRolePrincipalRole === "user",
          ).toBe(true);

          const approvalRequestId = `approval-scope-event-${modeMarker}`;
          const approvalEventApprovalsP = onceMessage(
            approvalsWs,
            (o) =>
              o.type === "event" &&
              o.event === "exec.approval.requested" &&
              o.payload?.id === approvalRequestId,
            6000,
          );
          const approvalEventAdminP = onceMessage(
            adminWs,
            (o) =>
              o.type === "event" &&
              o.event === "exec.approval.requested" &&
              o.payload?.id === approvalRequestId,
            6000,
          );
          let mappedSawApprovalEvent = false;
          let mappedNoRoleSawApprovalEvent = false;
          let pairingSawApprovalEvent = false;
          const mappedApprovalListener = (raw: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(rawDataToString(raw)) as {
                type?: string;
                event?: string;
                payload?: { id?: string };
              };
              if (
                parsed.type === "event" &&
                parsed.event === "exec.approval.requested" &&
                parsed.payload?.id === approvalRequestId
              ) {
                mappedSawApprovalEvent = true;
              }
            } catch {
              /* ignore malformed test frames */
            }
          };
          const mappedNoRoleApprovalListener = (raw: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(rawDataToString(raw)) as {
                type?: string;
                event?: string;
                payload?: { id?: string };
              };
              if (
                parsed.type === "event" &&
                parsed.event === "exec.approval.requested" &&
                parsed.payload?.id === approvalRequestId
              ) {
                mappedNoRoleSawApprovalEvent = true;
              }
            } catch {
              /* ignore malformed test frames */
            }
          };
          const pairingApprovalListener = (raw: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(rawDataToString(raw)) as {
                type?: string;
                event?: string;
                payload?: { id?: string };
              };
              if (
                parsed.type === "event" &&
                parsed.event === "exec.approval.requested" &&
                parsed.payload?.id === approvalRequestId
              ) {
                pairingSawApprovalEvent = true;
              }
            } catch {
              /* ignore malformed test frames */
            }
          };
          mappedUserWs.on("message", mappedApprovalListener);
          mappedNoRoleWs.on("message", mappedNoRoleApprovalListener);
          pairingWs.on("message", pairingApprovalListener);

          const approvalRequestRpcId = `approval-scope-request-${mode}`;
          approvalsWs.send(
            JSON.stringify({
              type: "req",
              id: approvalRequestRpcId,
              method: "exec.approval.request",
              params: {
                id: approvalRequestId,
                command: "echo scope-test",
                timeoutMs: 80,
              },
            }),
          );
          const approvalRequestRes = await onceMessage<{
            ok: boolean;
            payload?: { id?: string };
          }>(approvalsWs, (o) => o.type === "res" && o.id === approvalRequestRpcId, 6000);
          expect(approvalRequestRes.ok).toBe(true);
          expect(approvalRequestRes.payload?.id).toBe(approvalRequestId);
          const approvalEventApprovals = await approvalEventApprovalsP;
          expect(approvalEventApprovals.type).toBe("event");
          const approvalEventAdmin = await approvalEventAdminP;
          expect(approvalEventAdmin.type).toBe("event");
          await new Promise((resolve) => setTimeout(resolve, 250));
          mappedUserWs.off("message", mappedApprovalListener);
          mappedNoRoleWs.off("message", mappedNoRoleApprovalListener);
          pairingWs.off("message", pairingApprovalListener);
          expect(mappedSawApprovalEvent).toBe(false);
          expect(mappedNoRoleSawApprovalEvent).toBe(false);
          expect(pairingSawApprovalEvent).toBe(false);

          const pairNodeId = `node-scope-event-${modeMarker}`;
          const pairingEventPairingP = onceMessage(
            pairingWs,
            (o) =>
              o.type === "event" &&
              o.event === "node.pair.requested" &&
              o.payload?.nodeId === pairNodeId,
            6000,
          );
          const pairingEventAdminP = onceMessage(
            adminWs,
            (o) =>
              o.type === "event" &&
              o.event === "node.pair.requested" &&
              o.payload?.nodeId === pairNodeId,
            6000,
          );
          let mappedSawPairingEvent = false;
          let mappedNoRoleSawPairingEvent = false;
          let approvalsSawPairingEvent = false;
          const mappedPairingListener = (raw: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(rawDataToString(raw)) as {
                type?: string;
                event?: string;
                payload?: { nodeId?: string };
              };
              if (
                parsed.type === "event" &&
                parsed.event === "node.pair.requested" &&
                parsed.payload?.nodeId === pairNodeId
              ) {
                mappedSawPairingEvent = true;
              }
            } catch {
              /* ignore malformed test frames */
            }
          };
          const mappedNoRolePairingListener = (raw: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(rawDataToString(raw)) as {
                type?: string;
                event?: string;
                payload?: { nodeId?: string };
              };
              if (
                parsed.type === "event" &&
                parsed.event === "node.pair.requested" &&
                parsed.payload?.nodeId === pairNodeId
              ) {
                mappedNoRoleSawPairingEvent = true;
              }
            } catch {
              /* ignore malformed test frames */
            }
          };
          const approvalsPairingListener = (raw: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(rawDataToString(raw)) as {
                type?: string;
                event?: string;
                payload?: { nodeId?: string };
              };
              if (
                parsed.type === "event" &&
                parsed.event === "node.pair.requested" &&
                parsed.payload?.nodeId === pairNodeId
              ) {
                approvalsSawPairingEvent = true;
              }
            } catch {
              /* ignore malformed test frames */
            }
          };
          mappedUserWs.on("message", mappedPairingListener);
          mappedNoRoleWs.on("message", mappedNoRolePairingListener);
          approvalsWs.on("message", approvalsPairingListener);

          const pairingRequestRpcId = `pairing-scope-request-${mode}`;
          pairingWs.send(
            JSON.stringify({
              type: "req",
              id: pairingRequestRpcId,
              method: "node.pair.request",
              params: {
                nodeId: pairNodeId,
                displayName: "Scope Test Node",
                platform: "test",
                version: "1.0.0",
              },
            }),
          );
          const pairingRequestRes = await onceMessage<{
            ok: boolean;
            payload?: { status?: string; request?: { nodeId?: string } };
          }>(pairingWs, (o) => o.type === "res" && o.id === pairingRequestRpcId, 6000);
          expect(pairingRequestRes.ok).toBe(true);
          expect(pairingRequestRes.payload?.status).toBe("pending");
          expect(pairingRequestRes.payload?.request?.nodeId).toBe(pairNodeId);
          const pairingEventPairing = await pairingEventPairingP;
          expect(pairingEventPairing.type).toBe("event");
          const pairingEventAdmin = await pairingEventAdminP;
          expect(pairingEventAdmin.type).toBe("event");
          await new Promise((resolve) => setTimeout(resolve, 250));
          mappedUserWs.off("message", mappedPairingListener);
          mappedNoRoleWs.off("message", mappedNoRolePairingListener);
          approvalsWs.off("message", approvalsPairingListener);
          expect(mappedSawPairingEvent).toBe(false);
          expect(mappedNoRoleSawPairingEvent).toBe(false);
          expect(approvalsSawPairingEvent).toBe(false);
        } finally {
          mappedUserWs.close();
          mappedNoRoleWs.close();
          approvalsWs.close();
          pairingWs.close();
          adminWs.close();
        }
      }
    });

    test("approval and pairing runtime events keep legacy admin-scope fallback in off mode", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "off",
            identities: {},
          },
        },
      });

      const modeMarker = `off-${Date.now()}`;
      const approvalRequestId = `approval-off-mode-${modeMarker}`;
      const pairNodeId = `pair-off-mode-${modeMarker}`;
      const legacyAdminWs = await openWs(port);
      const approvalsWs = await openWs(port);
      const pairingWs = await openWs(port);
      try {
        const [legacyConnect, approvalsConnect, pairingConnect] = await Promise.all([
          connectReq(legacyAdminWs, {
            scopes: ["operator.admin"],
            identity: undefined,
          }),
          connectReq(approvalsWs, {
            scopes: ["operator.approvals"],
            identity: {
              userId: "off-approvals-user",
              principalId: "msg:test:off-approvals-user",
              alias: "OffApprovalsUser",
            },
          }),
          connectReq(pairingWs, {
            scopes: ["operator.pairing"],
            identity: {
              userId: "off-pairing-user",
              principalId: "msg:test:off-pairing-user",
              alias: "OffPairingUser",
            },
          }),
        ]);
        expect(legacyConnect.ok).toBe(true);
        expect(approvalsConnect.ok).toBe(true);
        expect(pairingConnect.ok).toBe(true);

        let pairingSawApprovalEvent = false;
        const pairingApprovalListener = (raw: WebSocket.RawData) => {
          try {
            const parsed = JSON.parse(rawDataToString(raw)) as {
              type?: string;
              event?: string;
              payload?: { id?: string };
            };
            if (
              parsed.type === "event" &&
              parsed.event === "exec.approval.requested" &&
              parsed.payload?.id === approvalRequestId
            ) {
              pairingSawApprovalEvent = true;
            }
          } catch {
            /* ignore malformed test frames */
          }
        };
        pairingWs.on("message", pairingApprovalListener);

        const approvalEventApprovalsP = onceMessage(
          approvalsWs,
          (o) =>
            o.type === "event" &&
            o.event === "exec.approval.requested" &&
            o.payload?.id === approvalRequestId,
          6000,
        );
        const approvalEventLegacyAdminP = onceMessage(
          legacyAdminWs,
          (o) =>
            o.type === "event" &&
            o.event === "exec.approval.requested" &&
            o.payload?.id === approvalRequestId,
          6000,
        );
        approvalsWs.send(
          JSON.stringify({
            type: "req",
            id: `approval-off-mode-request-${modeMarker}`,
            method: "exec.approval.request",
            params: {
              id: approvalRequestId,
              command: "echo off-mode",
              timeoutMs: 80,
            },
          }),
        );
        const approvalRequestRes = await onceMessage<{ ok: boolean; payload?: { id?: string } }>(
          approvalsWs,
          (o) => o.type === "res" && o.id === `approval-off-mode-request-${modeMarker}`,
          6000,
        );
        expect(approvalRequestRes.ok).toBe(true);
        expect(approvalRequestRes.payload?.id).toBe(approvalRequestId);
        const approvalEventApprovals = await approvalEventApprovalsP;
        expect(approvalEventApprovals.type).toBe("event");
        const approvalEventLegacyAdmin = await approvalEventLegacyAdminP;
        expect(approvalEventLegacyAdmin.type).toBe("event");
        await new Promise((resolve) => setTimeout(resolve, 250));
        pairingWs.off("message", pairingApprovalListener);
        expect(pairingSawApprovalEvent).toBe(false);

        let approvalsSawPairingEvent = false;
        const approvalsPairingListener = (raw: WebSocket.RawData) => {
          try {
            const parsed = JSON.parse(rawDataToString(raw)) as {
              type?: string;
              event?: string;
              payload?: { nodeId?: string };
            };
            if (
              parsed.type === "event" &&
              parsed.event === "node.pair.requested" &&
              parsed.payload?.nodeId === pairNodeId
            ) {
              approvalsSawPairingEvent = true;
            }
          } catch {
            /* ignore malformed test frames */
          }
        };
        approvalsWs.on("message", approvalsPairingListener);

        const pairingEventPairingP = onceMessage(
          pairingWs,
          (o) =>
            o.type === "event" &&
            o.event === "node.pair.requested" &&
            o.payload?.nodeId === pairNodeId,
          6000,
        );
        const pairingEventLegacyAdminP = onceMessage(
          legacyAdminWs,
          (o) =>
            o.type === "event" &&
            o.event === "node.pair.requested" &&
            o.payload?.nodeId === pairNodeId,
          6000,
        );
        pairingWs.send(
          JSON.stringify({
            type: "req",
            id: `pairing-off-mode-request-${modeMarker}`,
            method: "node.pair.request",
            params: {
              nodeId: pairNodeId,
              displayName: "Off Mode Scope Test Node",
              platform: "test",
              version: "1.0.0",
            },
          }),
        );
        const pairingRequestRes = await onceMessage<{
          ok: boolean;
          payload?: { status?: string; request?: { nodeId?: string } };
        }>(
          pairingWs,
          (o) => o.type === "res" && o.id === `pairing-off-mode-request-${modeMarker}`,
          6000,
        );
        expect(pairingRequestRes.ok).toBe(true);
        expect(pairingRequestRes.payload?.status).toBe("pending");
        expect(pairingRequestRes.payload?.request?.nodeId).toBe(pairNodeId);
        const pairingEventPairing = await pairingEventPairingP;
        expect(pairingEventPairing.type).toBe("event");
        const pairingEventLegacyAdmin = await pairingEventLegacyAdminP;
        expect(pairingEventLegacyAdmin.type).toBe("event");
        await new Promise((resolve) => setTimeout(resolve, 250));
        approvalsWs.off("message", approvalsPairingListener);
        expect(approvalsSawPairingEvent).toBe(false);
      } finally {
        legacyAdminWs.close();
        approvalsWs.close();
        pairingWs.close();
      }
    });

    test("approval and pairing runtime fanout keeps mapped non-admin admin-scope observers blocked across strict/off mode changes", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      const identities = {
        "msg:test:mode-switch-observer-user": {
          userId: "mode-switch-observer-user",
          principalId: "msg:test:mode-switch-observer-user",
          alias: "ModeSwitchObserverUser",
          role: "user",
        },
        "msg:test:mode-switch-approvals-user": {
          userId: "mode-switch-approvals-user",
          principalId: "msg:test:mode-switch-approvals-user",
          alias: "ModeSwitchApprovalsUser",
          role: "user",
        },
        "msg:test:mode-switch-pairing-user": {
          userId: "mode-switch-pairing-user",
          principalId: "msg:test:mode-switch-pairing-user",
          alias: "ModeSwitchPairingUser",
          role: "user",
        },
      } as const;
      const writeMode = async (mode: "strict" | "off"): Promise<void> => {
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode,
              identities,
            },
          },
        });
      };
      await writeMode("strict");

      const marker = `approval-pairing-mode-switch-${Date.now()}`;
      const observerWs = await openWs(port);
      const approvalsWs = await openWs(port);
      const pairingWs = await openWs(port);
      const observedApprovalIds = new Set<string>();
      const observedPairNodeIds = new Set<string>();
      const waitForNoObservedApproval = async (approvalId: string, waitMs = 300): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        expect(observedApprovalIds.has(approvalId)).toBe(false);
      };
      const waitForNoObservedPairing = async (nodeId: string, waitMs = 300): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        expect(observedPairNodeIds.has(nodeId)).toBe(false);
      };
      const observerListener = (raw: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(rawDataToString(raw)) as {
            type?: string;
            event?: string;
            payload?: { id?: string; nodeId?: string };
          };
          if (parsed.type !== "event") {
            return;
          }
          if (
            parsed.event === "exec.approval.requested" &&
            typeof parsed.payload?.id === "string"
          ) {
            observedApprovalIds.add(parsed.payload.id);
            return;
          }
          if (
            parsed.event === "node.pair.requested" &&
            typeof parsed.payload?.nodeId === "string"
          ) {
            observedPairNodeIds.add(parsed.payload.nodeId);
          }
        } catch {
          /* ignore malformed test frames */
        }
      };
      observerWs.on("message", observerListener);
      const requestApproval = async (approvalId: string): Promise<void> => {
        const reqId = `${approvalId}-request`;
        const approvalEventP = onceMessage(
          approvalsWs,
          (o) =>
            o.type === "event" &&
            o.event === "exec.approval.requested" &&
            o.payload?.id === approvalId,
          6000,
        );
        approvalsWs.send(
          JSON.stringify({
            type: "req",
            id: reqId,
            method: "exec.approval.request",
            params: {
              id: approvalId,
              command: "echo mode-switch",
              timeoutMs: 80,
            },
          }),
        );
        const approvalRes = await onceMessage<{ ok: boolean; payload?: { id?: string } }>(
          approvalsWs,
          (o) => o.type === "res" && o.id === reqId,
          6000,
        );
        expect(approvalRes.ok).toBe(true);
        expect(approvalRes.payload?.id).toBe(approvalId);
        const approvalEvent = await approvalEventP;
        expect(approvalEvent.type).toBe("event");
      };
      const requestPairing = async (nodeId: string): Promise<void> => {
        const reqId = `${nodeId}-request`;
        const pairingEventP = onceMessage(
          pairingWs,
          (o) =>
            o.type === "event" && o.event === "node.pair.requested" && o.payload?.nodeId === nodeId,
          6000,
        );
        pairingWs.send(
          JSON.stringify({
            type: "req",
            id: reqId,
            method: "node.pair.request",
            params: {
              nodeId,
              displayName: "Mode Switch Scope Test Node",
              platform: "test",
              version: "1.0.0",
            },
          }),
        );
        const pairingRes = await onceMessage<{
          ok: boolean;
          payload?: { status?: string; request?: { nodeId?: string } };
        }>(pairingWs, (o) => o.type === "res" && o.id === reqId, 6000);
        expect(pairingRes.ok).toBe(true);
        expect(pairingRes.payload?.status).toBe("pending");
        expect(pairingRes.payload?.request?.nodeId).toBe(nodeId);
        const pairingEvent = await pairingEventP;
        expect(pairingEvent.type).toBe("event");
      };

      try {
        const [observerConnect, approvalsConnect, pairingConnect] = await Promise.all([
          connectReq(observerWs, {
            scopes: ["operator.admin", "operator.write"],
            identity: {
              userId: "mode-switch-observer-user",
              principalId: "msg:test:mode-switch-observer-user",
              alias: "ModeSwitchObserverUser",
            },
          }),
          connectReq(approvalsWs, {
            scopes: ["operator.approvals"],
            identity: {
              userId: "mode-switch-approvals-user",
              principalId: "msg:test:mode-switch-approvals-user",
              alias: "ModeSwitchApprovalsUser",
            },
          }),
          connectReq(pairingWs, {
            scopes: ["operator.pairing"],
            identity: {
              userId: "mode-switch-pairing-user",
              principalId: "msg:test:mode-switch-pairing-user",
              alias: "ModeSwitchPairingUser",
            },
          }),
        ]);
        expect(observerConnect.ok).toBe(true);
        expect(approvalsConnect.ok).toBe(true);
        expect(pairingConnect.ok).toBe(true);
        expect(
          (observerConnect.payload as { auth?: { principalRole?: unknown } } | undefined)?.auth
            ?.principalRole,
        ).toBe("user");

        const strictInitialApprovalId = `${marker}-strict-initial-approval`;
        await requestApproval(strictInitialApprovalId);
        await waitForNoObservedApproval(strictInitialApprovalId);
        const strictInitialPairNodeId = `${marker}-strict-initial-pair`;
        await requestPairing(strictInitialPairNodeId);
        await waitForNoObservedPairing(strictInitialPairNodeId);

        await writeMode("off");

        const offApprovalId = `${marker}-off-approval`;
        await requestApproval(offApprovalId);
        await waitForNoObservedApproval(offApprovalId);
        const offPairNodeId = `${marker}-off-pair`;
        await requestPairing(offPairNodeId);
        await waitForNoObservedPairing(offPairNodeId);

        await writeMode("strict");

        const strictFinalApprovalId = `${marker}-strict-final-approval`;
        await requestApproval(strictFinalApprovalId);
        await waitForNoObservedApproval(strictFinalApprovalId);
        const strictFinalPairNodeId = `${marker}-strict-final-pair`;
        await requestPairing(strictFinalPairNodeId);
        await waitForNoObservedPairing(strictFinalPairNodeId);
      } finally {
        observerWs.off("message", observerListener);
        observerWs.close();
        approvalsWs.close();
        pairingWs.close();
      }
    });

    test("control-plane runtime events remain broadly visible in off mode", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "off",
            identities: {
              "msg:test:off-mapped-user": {
                userId: "off-mapped-user",
                principalId: "msg:test:off-mapped-user",
                alias: "OffMappedUser",
                role: "user",
              },
              "msg:test:off-admin-user": {
                userId: "off-admin-user",
                principalId: "msg:test:off-admin-user",
                alias: "OffAdminUser",
                role: "admin",
              },
            },
          },
        },
      });

      const modeMarker = `off-control-plane-${Date.now()}`;
      const talkPhase = `talk-${modeMarker}`;
      const voicewakeTrigger = `voicewake-${modeMarker}`;
      const heartbeatReason = `heartbeat-${modeMarker}`;
      const presenceReason = `presence-${modeMarker}`;
      const presenceDeviceId = `device-${modeMarker}`;

      const mappedUserWs = await openWs(port);
      const adminWs = await openWs(port);
      const observed = new Set<string>();
      const observedCronAddedJobIds = new Set<string>();
      const waitForObserved = async (
        label: string,
        predicate: () => boolean,
        timeoutMs = 6000,
      ): Promise<void> => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          if (predicate()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(
          `timeout waiting for ${label}; observed=${JSON.stringify([...observed])} cronAdded=${JSON.stringify([...observedCronAddedJobIds])}`,
        );
      };
      const mappedListener = (raw: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(rawDataToString(raw)) as {
            type?: string;
            event?: string;
            payload?: {
              phase?: string;
              reason?: string;
              triggers?: string[];
              action?: string;
              jobId?: string;
              presence?: Array<{ reason?: string; deviceId?: string }>;
            };
          };
          if (parsed.type !== "event" || typeof parsed.event !== "string") {
            return;
          }
          if (parsed.event === "talk.mode" && parsed.payload?.phase === talkPhase) {
            observed.add("talk.mode");
            return;
          }
          if (
            parsed.event === "voicewake.changed" &&
            Array.isArray(parsed.payload?.triggers) &&
            parsed.payload.triggers.includes(voicewakeTrigger)
          ) {
            observed.add("voicewake.changed");
            return;
          }
          if (parsed.event === "heartbeat" && parsed.payload?.reason === heartbeatReason) {
            observed.add("heartbeat");
            return;
          }
          if (
            parsed.event === "presence" &&
            Array.isArray(parsed.payload?.presence) &&
            parsed.payload.presence.some(
              (entry) => entry?.reason === presenceReason && entry?.deviceId === presenceDeviceId,
            )
          ) {
            observed.add("presence");
            return;
          }
          if (
            parsed.event === "cron" &&
            parsed.payload?.action === "added" &&
            typeof parsed.payload?.jobId === "string"
          ) {
            observedCronAddedJobIds.add(parsed.payload.jobId);
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      mappedUserWs.on("message", mappedListener);
      try {
        const [mappedConnect, adminConnect] = await Promise.all([
          connectReq(mappedUserWs, {
            scopes: ["operator.write"],
            identity: {
              userId: "off-mapped-user",
              principalId: "msg:test:off-mapped-user",
              alias: "OffMappedUser",
            },
          }),
          connectReq(adminWs, {
            scopes: ["operator.admin"],
            identity: {
              userId: "off-admin-user",
              principalId: "msg:test:off-admin-user",
              alias: "OffAdminUser",
            },
          }),
        ]);
        expect(mappedConnect.ok).toBe(true);
        expect(adminConnect.ok).toBe(true);

        adminWs.send(
          JSON.stringify({
            type: "req",
            id: `off-mode-talk-mode-${modeMarker}`,
            method: "talk.mode",
            params: { enabled: true, phase: talkPhase },
          }),
        );
        const talkRes = await onceMessage<{ ok: boolean }>(
          adminWs,
          (o) => o.type === "res" && o.id === `off-mode-talk-mode-${modeMarker}`,
          6000,
        );
        expect(talkRes.ok).toBe(true);
        await waitForObserved("talk.mode", () => observed.has("talk.mode"));

        adminWs.send(
          JSON.stringify({
            type: "req",
            id: `off-mode-voicewake-set-${modeMarker}`,
            method: "voicewake.set",
            params: { triggers: ["openclaw", voicewakeTrigger] },
          }),
        );
        const voicewakeRes = await onceMessage<{ ok: boolean }>(
          adminWs,
          (o) => o.type === "res" && o.id === `off-mode-voicewake-set-${modeMarker}`,
          6000,
        );
        expect(voicewakeRes.ok).toBe(true);
        await waitForObserved("voicewake.changed", () => observed.has("voicewake.changed"));

        emitHeartbeatEvent({
          status: "sent",
          reason: heartbeatReason,
        });
        await waitForObserved("heartbeat", () => observed.has("heartbeat"));

        adminWs.send(
          JSON.stringify({
            type: "req",
            id: `off-mode-system-event-${modeMarker}`,
            method: "system-event",
            params: {
              text: "off mode control-plane presence test",
              reason: presenceReason,
              deviceId: presenceDeviceId,
              mode: "off-test",
            },
          }),
        );
        const presenceRes = await onceMessage<{ ok: boolean }>(
          adminWs,
          (o) => o.type === "res" && o.id === `off-mode-system-event-${modeMarker}`,
          6000,
        );
        expect(presenceRes.ok).toBe(true);
        await waitForObserved("presence", () => observed.has("presence"));

        adminWs.send(
          JSON.stringify({
            type: "req",
            id: `off-mode-cron-add-${modeMarker}`,
            method: "cron.add",
            params: {
              name: `off-mode-cron-${modeMarker}`,
              enabled: true,
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "main",
              wakeMode: "next-heartbeat",
              payload: {
                kind: "systemEvent",
                text: "off mode control-plane cron event test",
              },
            },
          }),
        );
        const cronAddRes = await onceMessage<{ ok: boolean; payload?: { id?: string } }>(
          adminWs,
          (o) => o.type === "res" && o.id === `off-mode-cron-add-${modeMarker}`,
          6000,
        );
        expect(cronAddRes.ok).toBe(true);
        const cronAddedJobId =
          typeof cronAddRes.payload?.id === "string" ? cronAddRes.payload.id : "";
        expect(cronAddedJobId.length).toBeGreaterThan(0);
        await waitForObserved("cron.added", () => observedCronAddedJobIds.has(cronAddedJobId));

        adminWs.send(
          JSON.stringify({
            type: "req",
            id: `off-mode-cron-remove-${modeMarker}`,
            method: "cron.remove",
            params: { id: cronAddedJobId },
          }),
        );
        const cronRemoveRes = await onceMessage<{
          ok: boolean;
          payload?: { removed?: boolean };
        }>(adminWs, (o) => o.type === "res" && o.id === `off-mode-cron-remove-${modeMarker}`, 6000);
        expect(cronRemoveRes.ok).toBe(true);
        expect(cronRemoveRes.payload?.removed).toBe(true);
      } finally {
        mappedUserWs.off("message", mappedListener);
        mappedUserWs.close();
        adminWs.close();
      }
    });

    test("control-plane runtime fanout follows strict/off mode changes without reconnect", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      const identities = {
        "msg:test:mode-switch-mapped-user": {
          userId: "mode-switch-mapped-user",
          principalId: "msg:test:mode-switch-mapped-user",
          alias: "ModeSwitchMappedUser",
          role: "user",
        },
        "msg:test:mode-switch-admin-user": {
          userId: "mode-switch-admin-user",
          principalId: "msg:test:mode-switch-admin-user",
          alias: "ModeSwitchAdminUser",
          role: "admin",
        },
      } as const;
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities,
          },
        },
      });

      const marker = `mode-switch-${Date.now()}`;
      const mappedUserWs = await openWs(port);
      const adminWs = await openWs(port);
      const observedTalkPhases = new Set<string>();
      const waitForObservedPhase = async (phase: string, timeoutMs = 6000): Promise<void> => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          if (observedTalkPhases.has(phase)) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(
          `timeout waiting for talk.mode phase ${phase}; observed=${JSON.stringify([...observedTalkPhases])}`,
        );
      };
      const waitForNoObservedPhase = async (phase: string, waitMs = 300): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        expect(observedTalkPhases.has(phase)).toBe(false);
      };
      const sendTalkMode = async (id: string, phase: string): Promise<void> => {
        const eventP = onceMessage(
          adminWs,
          (o) => o.type === "event" && o.event === "talk.mode" && o.payload?.phase === phase,
          6000,
        );
        adminWs.send(
          JSON.stringify({
            type: "req",
            id,
            method: "talk.mode",
            params: { enabled: true, phase },
          }),
        );
        const res = await onceMessage<{ ok: boolean }>(
          adminWs,
          (o) => o.type === "res" && o.id === id,
          6000,
        );
        expect(res.ok).toBe(true);
        await eventP;
      };
      const mappedListener = (raw: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(rawDataToString(raw)) as {
            type?: string;
            event?: string;
            payload?: { phase?: string };
          };
          if (
            parsed.type === "event" &&
            parsed.event === "talk.mode" &&
            typeof parsed.payload?.phase === "string"
          ) {
            observedTalkPhases.add(parsed.payload.phase);
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      mappedUserWs.on("message", mappedListener);
      try {
        const [mappedConnect, adminConnect] = await Promise.all([
          connectReq(mappedUserWs, {
            scopes: ["operator.write"],
            identity: {
              userId: "mode-switch-mapped-user",
              principalId: "msg:test:mode-switch-mapped-user",
              alias: "ModeSwitchMappedUser",
            },
          }),
          connectReq(adminWs, {
            scopes: ["operator.admin"],
            identity: {
              userId: "mode-switch-admin-user",
              principalId: "msg:test:mode-switch-admin-user",
              alias: "ModeSwitchAdminUser",
            },
          }),
        ]);
        expect(mappedConnect.ok).toBe(true);
        expect(adminConnect.ok).toBe(true);

        const strictInitialPhase = `${marker}-strict-initial`;
        await sendTalkMode(`${marker}-strict-initial-req`, strictInitialPhase);
        await waitForNoObservedPhase(strictInitialPhase);

        await writeConfigFile({
          gateway: {
            multiUser: {
              mode: "off",
              identities,
            },
          },
        });

        const offPhase = `${marker}-off`;
        await sendTalkMode(`${marker}-off-req`, offPhase);
        await waitForObservedPhase(offPhase);

        await writeConfigFile({
          gateway: {
            multiUser: {
              mode: "strict",
              identities,
            },
          },
        });

        const strictFinalPhase = `${marker}-strict-final`;
        await sendTalkMode(`${marker}-strict-final-req`, strictFinalPhase);
        await waitForNoObservedPhase(strictFinalPhase);
      } finally {
        mappedUserWs.off("message", mappedListener);
        mappedUserWs.close();
        adminWs.close();
      }
    });

    test("admin-only method auth remains role-gated across strict/off mode changes without reconnect", async () => {
      authzDeniedEventsTest.clear();
      const { writeConfigFile } = await import("../config/config.js");
      const identities = {
        "msg:test:method-mode-switch-mapped-user": {
          userId: "method-mode-switch-mapped-user",
          principalId: "msg:test:method-mode-switch-mapped-user",
          alias: "MethodModeSwitchMappedUser",
          role: "user",
        },
        "msg:test:method-mode-switch-admin-user": {
          userId: "method-mode-switch-admin-user",
          principalId: "msg:test:method-mode-switch-admin-user",
          alias: "MethodModeSwitchAdminUser",
          role: "admin",
        },
      } as const;
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities,
          },
        },
      });

      const marker = `method-mode-switch-${Date.now()}`;
      const mappedUserWs = await openWs(port);
      const adminWs = await openWs(port);
      const request = async (
        ws: WebSocket,
        id: string,
        method: string,
        params: Record<string, unknown>,
      ) => {
        ws.send(JSON.stringify({ type: "req", id, method, params }));
        return await onceMessage<{
          ok: boolean;
          payload?: Record<string, unknown>;
          error?: { message?: string; details?: { reasonCode?: string } };
        }>(ws, (o) => o.type === "res" && o.id === id, 6000);
      };
      const writeMode = async (mode: "strict" | "off"): Promise<void> => {
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode,
              identities,
            },
          },
        });
      };
      try {
        const [mappedConnect, adminConnect] = await Promise.all([
          connectReq(mappedUserWs, {
            scopes: ["operator.admin", "operator.write"],
            identity: {
              userId: "method-mode-switch-mapped-user",
              principalId: "msg:test:method-mode-switch-mapped-user",
              alias: "MethodModeSwitchMappedUser",
            },
          }),
          connectReq(adminWs, {
            scopes: ["operator.admin"],
            identity: {
              userId: "method-mode-switch-admin-user",
              principalId: "msg:test:method-mode-switch-admin-user",
              alias: "MethodModeSwitchAdminUser",
            },
          }),
        ]);
        expect(mappedConnect.ok).toBe(true);
        expect(adminConnect.ok).toBe(true);
        expect(
          (mappedConnect.payload as { auth?: { principalRole?: unknown } } | undefined)?.auth
            ?.principalRole,
        ).toBe("user");
        expect(
          (adminConnect.payload as { auth?: { principalRole?: unknown } } | undefined)?.auth
            ?.principalRole,
        ).toBe("admin");

        const strictInitialMappedId = `${marker}-strict-initial-mapped`;
        const strictInitialMapped = await request(
          mappedUserWs,
          strictInitialMappedId,
          "status",
          {},
        );
        expect(strictInitialMapped.ok).toBe(false);
        expect(strictInitialMapped.error?.message ?? "").toContain(
          "admin scope requires admin principal role",
        );
        expect(strictInitialMapped.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

        const strictInitialAdmin = await request(
          adminWs,
          `${marker}-strict-initial-admin`,
          "status",
          {},
        );
        expect(strictInitialAdmin.ok).toBe(true);

        await writeMode("off");

        const offMappedId = `${marker}-off-mapped`;
        const offMapped = await request(mappedUserWs, offMappedId, "status", {});
        expect(offMapped.ok).toBe(false);
        expect(offMapped.error?.message ?? "").toContain(
          "admin scope requires admin principal role",
        );
        expect(offMapped.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

        const offAdmin = await request(adminWs, `${marker}-off-admin`, "status", {});
        expect(offAdmin.ok).toBe(true);

        await writeMode("strict");

        const strictFinalMappedId = `${marker}-strict-final-mapped`;
        const strictFinalMapped = await request(mappedUserWs, strictFinalMappedId, "status", {});
        expect(strictFinalMapped.ok).toBe(false);
        expect(strictFinalMapped.error?.message ?? "").toContain(
          "admin scope requires admin principal role",
        );
        expect(strictFinalMapped.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

        const strictFinalAdmin = await request(
          adminWs,
          `${marker}-strict-final-admin`,
          "status",
          {},
        );
        expect(strictFinalAdmin.ok).toBe(true);

        const deniedStatus = listGatewayAuthzDenyEvents({
          method: "status",
          reasonCode: "ROLE_FORBIDDEN",
          userId: "method-mode-switch-mapped-user",
          limit: 20,
        });
        expect(deniedStatus.some((event) => event.requestId === strictInitialMappedId)).toBe(true);
        expect(deniedStatus.some((event) => event.requestId === offMappedId)).toBe(true);
        expect(deniedStatus.some((event) => event.requestId === strictFinalMappedId)).toBe(true);
      } finally {
        mappedUserWs.close();
        adminWs.close();
      }
    });

    test("control-plane runtime events require resolved admin principal for mapped non-admin sessions in strict and compat modes", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      for (const mode of ["strict", "compat"] as const) {
        await writeConfigFile({
          gateway: {
            multiUser: {
              mode,
              identities: {
                "msg:test:mapped-admin-scope-user": {
                  userId: "mapped-admin-scope-user",
                  principalId: "msg:test:mapped-admin-scope-user",
                  alias: "MappedAdminScopeUser",
                  role: "user",
                },
                "msg:test:mapped-no-role-user": {
                  userId: "mapped-no-role-user",
                  principalId: "msg:test:mapped-no-role-user",
                  alias: "MappedNoRoleUser",
                },
                "msg:test:admin-user": {
                  userId: "admin-user",
                  principalId: "msg:test:admin-user",
                  alias: "AdminUser",
                  role: "admin",
                },
              },
            },
          },
        });

        const mappedUserWs = await openWs(port);
        const mappedNoRoleWs = await openWs(port);
        const adminWs = await openWs(port);
        try {
          const [mappedConnect, mappedNoRoleConnect, adminConnect] = await Promise.all([
            connectReq(mappedUserWs, {
              scopes: ["operator.admin", "operator.write"],
              identity: {
                userId: "mapped-admin-scope-user",
                principalId: "msg:test:mapped-admin-scope-user",
                alias: "MappedAdminScopeUser",
              },
            }),
            connectReq(mappedNoRoleWs, {
              scopes: ["operator.admin", "operator.write"],
              identity: {
                userId: "mapped-no-role-user",
                principalId: "msg:test:mapped-no-role-user",
                alias: "MappedNoRoleUser",
              },
            }),
            connectReq(adminWs, {
              scopes: ["operator.admin"],
              identity: {
                userId: "admin-user",
                principalId: "msg:test:admin-user",
                alias: "AdminUser",
              },
            }),
          ]);
          expect(mappedConnect.ok).toBe(true);
          expect(mappedNoRoleConnect.ok).toBe(true);
          expect(adminConnect.ok).toBe(true);
          expect(
            (mappedConnect.payload as { auth?: { principalRole?: unknown } } | undefined)?.auth
              ?.principalRole,
          ).toBe("user");
          const mappedNoRolePrincipalRole = (
            mappedNoRoleConnect.payload as { auth?: { principalRole?: unknown } } | undefined
          )?.auth?.principalRole;
          expect(
            mappedNoRolePrincipalRole === undefined || mappedNoRolePrincipalRole === "user",
          ).toBe(true);
          expect(
            (adminConnect.payload as { auth?: { principalRole?: unknown } } | undefined)?.auth
              ?.principalRole,
          ).toBe("admin");

          const requestStatus = async (ws: WebSocket, id: string) => {
            ws.send(
              JSON.stringify({
                type: "req",
                id,
                method: "status",
                params: {},
              }),
            );
            return await onceMessage<{
              ok: boolean;
              error?: { message?: string; details?: { reasonCode?: string } };
            }>(ws, (o) => o.type === "res" && o.id === id, 6000);
          };

          const mappedStatus = await requestStatus(mappedUserWs, `mapped-non-admin-status-${mode}`);
          expect(mappedStatus.ok).toBe(false);
          expect(mappedStatus.error?.message ?? "").toContain(
            "admin scope requires admin principal role",
          );
          expect(mappedStatus.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

          const mappedNoRoleStatus = await requestStatus(
            mappedNoRoleWs,
            `mapped-no-role-status-${mode}`,
          );
          expect(mappedNoRoleStatus.ok).toBe(false);
          expect(mappedNoRoleStatus.error?.message ?? "").toContain(
            "admin scope requires admin principal role",
          );
          expect(mappedNoRoleStatus.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");

          const adminStatus = await requestStatus(adminWs, `admin-status-${mode}`);
          expect(adminStatus.ok).toBe(true);

          const marker = `${mode}-${Date.now()}`;
          const talkPhase = `talk-${marker}`;
          const voicewakeTrigger = `voicewake-${marker}`;
          const heartbeatReason = `heartbeat-${marker}`;
          const presenceReason = `presence-${marker}`;
          const presenceDeviceId = `device-${marker}`;
          const registerBlockedObserver = (ws: WebSocket) => {
            const blockedEvents = new Set<string>();
            const cronAddedJobIds = new Set<string>();
            const listener = (raw: WebSocket.RawData) => {
              try {
                const parsed = JSON.parse(rawDataToString(raw)) as {
                  type?: string;
                  event?: string;
                  payload?: {
                    reason?: string;
                    action?: string;
                    jobId?: string;
                    presence?: Array<{ reason?: string; deviceId?: string }>;
                  };
                };
                if (parsed.type !== "event" || typeof parsed.event !== "string") {
                  return;
                }
                if (
                  parsed.event === "talk.mode" ||
                  parsed.event === "voicewake.changed" ||
                  (parsed.event === "heartbeat" && parsed.payload?.reason === heartbeatReason)
                ) {
                  blockedEvents.add(parsed.event);
                }
                if (
                  parsed.event === "presence" &&
                  Array.isArray(parsed.payload?.presence) &&
                  parsed.payload.presence.some(
                    (entry) =>
                      entry?.reason === presenceReason && entry?.deviceId === presenceDeviceId,
                  )
                ) {
                  blockedEvents.add("presence");
                }
                if (
                  parsed.event === "cron" &&
                  parsed.payload?.action === "added" &&
                  typeof parsed.payload?.jobId === "string"
                ) {
                  cronAddedJobIds.add(parsed.payload.jobId);
                }
              } catch {
                /* ignore malformed frames */
              }
            };
            ws.on("message", listener);
            return { blockedEvents, cronAddedJobIds, listener };
          };

          const mappedObserver = registerBlockedObserver(mappedUserWs);
          const mappedNoRoleObserver = registerBlockedObserver(mappedNoRoleWs);

          const talkEventP = onceMessage(
            adminWs,
            (o) => o.type === "event" && o.event === "talk.mode" && o.payload?.phase === talkPhase,
            6000,
          );
          adminWs.send(
            JSON.stringify({
              type: "req",
              id: `mapped-non-admin-talk-mode-${mode}`,
              method: "talk.mode",
              params: { enabled: true, phase: talkPhase },
            }),
          );
          const talkRes = await onceMessage<{ ok: boolean }>(
            adminWs,
            (o) => o.type === "res" && o.id === `mapped-non-admin-talk-mode-${mode}`,
            6000,
          );
          expect(talkRes.ok).toBe(true);
          await talkEventP;

          const voicewakeEventP = onceMessage(
            adminWs,
            (o) =>
              o.type === "event" &&
              o.event === "voicewake.changed" &&
              Array.isArray(o.payload?.triggers) &&
              o.payload?.triggers?.includes(voicewakeTrigger),
            6000,
          );
          adminWs.send(
            JSON.stringify({
              type: "req",
              id: `mapped-non-admin-voicewake-set-${mode}`,
              method: "voicewake.set",
              params: { triggers: ["openclaw", voicewakeTrigger] },
            }),
          );
          const voicewakeRes = await onceMessage<{ ok: boolean }>(
            adminWs,
            (o) => o.type === "res" && o.id === `mapped-non-admin-voicewake-set-${mode}`,
            6000,
          );
          expect(voicewakeRes.ok).toBe(true);
          await voicewakeEventP;

          const heartbeatEventP = onceMessage(
            adminWs,
            (o) =>
              o.type === "event" &&
              o.event === "heartbeat" &&
              o.payload?.reason === heartbeatReason,
            6000,
          );
          emitHeartbeatEvent({
            status: "sent",
            reason: heartbeatReason,
          });
          await heartbeatEventP;

          const presenceEventP = onceMessage(
            adminWs,
            (o) =>
              o.type === "event" &&
              o.event === "presence" &&
              Array.isArray(o.payload?.presence) &&
              o.payload?.presence?.some(
                (entry) => entry?.reason === presenceReason && entry?.deviceId === presenceDeviceId,
              ),
            6000,
          );
          adminWs.send(
            JSON.stringify({
              type: "req",
              id: `mapped-non-admin-system-event-${mode}`,
              method: "system-event",
              params: {
                text: `mapped non-admin control-plane presence test (${mode})`,
                reason: presenceReason,
                deviceId: presenceDeviceId,
                mode: `${mode}-test`,
              },
            }),
          );
          const presenceRes = await onceMessage<{ ok: boolean }>(
            adminWs,
            (o) => o.type === "res" && o.id === `mapped-non-admin-system-event-${mode}`,
            6000,
          );
          expect(presenceRes.ok).toBe(true);
          await presenceEventP;

          const cronAddedEventP = onceMessage<{
            type?: string;
            payload?: { action?: string; jobId?: string };
          }>(
            adminWs,
            (o) =>
              o.type === "event" &&
              o.event === "cron" &&
              o.payload?.action === "added" &&
              typeof o.payload?.jobId === "string",
            6000,
          );
          adminWs.send(
            JSON.stringify({
              type: "req",
              id: `mapped-non-admin-cron-add-${mode}`,
              method: "cron.add",
              params: {
                name: `mapped-non-admin-cron-${marker}`,
                enabled: true,
                schedule: { kind: "every", everyMs: 60_000 },
                sessionTarget: "main",
                wakeMode: "next-heartbeat",
                payload: {
                  kind: "systemEvent",
                  text: `mapped non-admin control-plane cron event test (${mode})`,
                },
              },
            }),
          );
          const cronAddRes = await onceMessage<{ ok: boolean; payload?: { id?: string } }>(
            adminWs,
            (o) => o.type === "res" && o.id === `mapped-non-admin-cron-add-${mode}`,
            6000,
          );
          expect(cronAddRes.ok).toBe(true);
          const cronAddedEvent = await cronAddedEventP;
          expect(cronAddedEvent.type).toBe("event");
          const cronAddedJobId =
            typeof cronAddedEvent.payload?.jobId === "string" ? cronAddedEvent.payload.jobId : "";
          expect(cronAddedJobId.length).toBeGreaterThan(0);
          expect(cronAddRes.payload?.id).toBe(cronAddedJobId);

          adminWs.send(
            JSON.stringify({
              type: "req",
              id: `mapped-non-admin-cron-remove-${mode}`,
              method: "cron.remove",
              params: { id: cronAddedJobId },
            }),
          );
          const cronRemoveRes = await onceMessage<{
            ok: boolean;
            payload?: { removed?: boolean };
          }>(
            adminWs,
            (o) => o.type === "res" && o.id === `mapped-non-admin-cron-remove-${mode}`,
            6000,
          );
          expect(cronRemoveRes.ok).toBe(true);
          expect(cronRemoveRes.payload?.removed).toBe(true);

          await new Promise((resolve) => setTimeout(resolve, 250));
          mappedUserWs.off("message", mappedObserver.listener);
          mappedNoRoleWs.off("message", mappedNoRoleObserver.listener);
          expect(mappedObserver.blockedEvents.has("talk.mode")).toBe(false);
          expect(mappedObserver.blockedEvents.has("voicewake.changed")).toBe(false);
          expect(mappedObserver.blockedEvents.has("heartbeat")).toBe(false);
          expect(mappedObserver.blockedEvents.has("presence")).toBe(false);
          expect(mappedObserver.cronAddedJobIds.has(cronAddedJobId)).toBe(false);
          expect(mappedNoRoleObserver.blockedEvents.has("talk.mode")).toBe(false);
          expect(mappedNoRoleObserver.blockedEvents.has("voicewake.changed")).toBe(false);
          expect(mappedNoRoleObserver.blockedEvents.has("heartbeat")).toBe(false);
          expect(mappedNoRoleObserver.blockedEvents.has("presence")).toBe(false);
          expect(mappedNoRoleObserver.cronAddedJobIds.has(cronAddedJobId)).toBe(false);
        } finally {
          mappedUserWs.close();
          mappedNoRoleWs.close();
          adminWs.close();
        }
      }
    });

    test("status, presence telemetry, cron, skills, and agent control-plane methods remain admin-only", async () => {
      authzDeniedEventsTest.clear();
      const methods: Array<{ method: string; params: Record<string, unknown> }> = [
        { method: "status", params: {} },
        { method: "system-presence", params: {} },
        { method: "last-heartbeat", params: {} },
        { method: "cron.list", params: {} },
        { method: "cron.status", params: {} },
        { method: "cron.runs", params: {} },
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

    test("rejects non-local shared-auth principal-id spoofing against mapped identities in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              "msg:test:victim-user": {
                userId: "victim-user",
                principalId: "msg:test:victim-user",
                alias: "VictimUser",
                role: "user",
              },
            },
          },
        },
      });

      try {
        const ws = await openWsWithHeaders(port, {
          "x-forwarded-for": "203.0.113.29",
          "x-forwarded-host": "gateway.example.com",
        });
        const res = await connectReq(ws, {
          device: null,
          token: "test-gateway-token-1234567890",
          scopes: ["operator.write"],
          identity: {
            userId: "spoofed-user",
            principalId: "msg:test:victim-user",
            alias: "SpoofedUser",
          },
        });
        expect(res.ok).toBe(false);
        expect(res.error?.message ?? "").toContain("unknown sender identity");
        await new Promise<void>((resolve) => ws.once("close", () => resolve()));

        const connectDenyEvents = listGatewayAuthzDenyEvents({
          method: "connect",
          reasonCode: "UNKNOWN_SENDER",
          limit: 50,
        });
        expect(connectDenyEvents.length).toBeGreaterThan(0);
        const latest = connectDenyEvents[0];
        expect(latest?.userId).toBeNull();
        expect(latest?.principalId).toBeNull();
        expect(latest?.clientMode).toBe("test");
        expect(typeof latest?.sourceIp).toBe("string");
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

    test("allows local shared-auth admin connections without sender identity in strict mode", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        device: null,
        identity: undefined,
        scopes: ["operator.admin"],
      });
      expect(res.ok).toBe(true);
      ws.close();
    });

    test("ignores self-asserted identity on local shared-auth admin bypass in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        device: null,
        scopes: ["operator.admin"],
        identity: {
          userId: "spoof-user",
          principalId: "msg:discord:default:spoof-user",
          alias: "SpoofUser",
        },
      });
      expect(res.ok).toBe(true);

      ws.send(
        JSON.stringify({
          type: "req",
          id: "local-shared-auth-admin-identity-spoof-check",
          method: "node.event",
          params: {},
        }),
      );
      const denied = await onceMessage<{
        ok: boolean;
        error?: { details?: { reasonCode?: string } };
      }>(ws, (o) => o.type === "res" && o.id === "local-shared-auth-admin-identity-spoof-check");
      expect(denied.ok).toBe(false);
      expect(denied.error?.details?.reasonCode).toBe("ROLE_FORBIDDEN");
      ws.close();

      const event = listGatewayAuthzDenyEvents({
        method: "node.event",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 50,
      }).find((entry) => entry.requestId === "local-shared-auth-admin-identity-spoof-check");
      expect(event).toBeDefined();
      expect(event?.userId?.startsWith("legacy:operator:test:")).toBe(true);
      expect(event?.principalId).toBe("client:test:default");
      expect(event?.userId).not.toBe("spoof-user");
      expect(event?.principalId).not.toBe("msg:discord:default:spoof-user");
    });

    test("rejects non-local shared-auth admin connections without sender identity in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const ws = await openWsWithHeaders(port, {
        "x-forwarded-for": "203.0.113.20",
        "x-forwarded-host": "gateway.example.com",
      });
      const res = await connectReq(ws, {
        device: null,
        identity: undefined,
        scopes: ["operator.admin"],
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unknown sender identity");
      await new Promise<void>((resolve) => ws.once("close", () => resolve()));

      const connectDenyEvents = listGatewayAuthzDenyEvents({
        method: "connect",
        reasonCode: "UNKNOWN_SENDER",
        limit: 50,
      }).filter((entry) => entry.sourceRole === "operator");
      expect(connectDenyEvents.length).toBeGreaterThan(0);
      const latest = connectDenyEvents[0];
      expect(latest?.clientMode).toBe("test");
      expect(typeof latest?.sourceIp).toBe("string");
    });

    test("rejects local shared-auth node-role admin scope connections without sender identity in strict mode", async () => {
      authzDeniedEventsTest.clear();
      const ws = await openWs(port);
      const res = await connectReq(ws, {
        role: "node",
        device: null,
        identity: undefined,
        scopes: ["operator.admin"],
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unknown sender identity");
      await new Promise<void>((resolve) => ws.once("close", () => resolve()));

      const connectDenyEvents = listGatewayAuthzDenyEvents({
        method: "connect",
        reasonCode: "UNKNOWN_SENDER",
        limit: 50,
      }).filter((entry) => entry.sourceRole === "node");
      expect(connectDenyEvents.length).toBeGreaterThan(0);
      const latest = connectDenyEvents[0];
      expect(latest?.clientMode).toBe("test");
      expect(typeof latest?.sourceIp).toBe("string");
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

    test("rejects shared token device-skip without mapped sender when tailscale auth is enabled in strict mode", async () => {
      const ws = await openTailscaleWs(port);
      const res = await connectReq(ws, { token: "secret", device: null });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unknown sender identity");
      ws.close();
    });

    test("allows shared token device-skip when sender client is mapped in strict mode", async () => {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              "client:test:default": {
                userId: "tailscale-user",
                principalId: "msg:discord:default:tailscale-user",
                alias: "TailMapped",
                role: "user",
              },
            },
          },
        },
      });

      const ws = await openTailscaleWs(port);
      const res = await connectReq(ws, {
        token: "secret",
        device: null,
        scopes: ["operator.write"],
        identity: {
          userId: "spoofed-user",
          principalId: "msg:discord:default:spoofed-user",
          alias: "Spoofed",
        },
      });
      expect(res.ok).toBe(true);
      ws.close();
    });

    test("ignores self-asserted identity for non-local shared-auth callers", async () => {
      authzDeniedEventsTest.clear();
      const identity = loadOrCreateDeviceIdentity();
      const { publicKeyRawBase64UrlFromPem, signDevicePayload } =
        await import("../infra/device-identity.js");
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
        const { approveDevicePairing, listDevicePairing } =
          await import("../infra/device-pairing.js");
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
