import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import type { DeviceIdentity } from "../infra/device-identity.js";
import { drainSystemEvents, peekSystemEvents } from "../infra/system-events.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { GatewayClient } from "./client.js";

vi.mock("../infra/update-runner.js", () => ({
  runGatewayUpdate: vi.fn(async () => ({
    status: "ok",
    mode: "git",
    root: "/repo",
    steps: [],
    durationMs: 12,
  })),
}));

import { runGatewayUpdate } from "../infra/update-runner.js";
import { sleep } from "../utils.js";
import {
  connectOk,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startServerWithClient,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: WebSocket;
let port: number;

beforeAll(async () => {
  const started = await startServerWithClient();
  server = started.server;
  ws = started.ws;
  port = started.port;
  await connectOk(ws);
});

afterAll(async () => {
  ws.close();
  await server.close();
});

const connectNodeClient = async (params: {
  port: number;
  commands: string[];
  caps?: string[];
  instanceId?: string;
  displayName?: string;
  deviceIdentity?: DeviceIdentity;
  onEvent?: (evt: { event?: string; payload?: unknown }) => void;
}) => {
  const token =
    typeof process.env.OPENCLAW_GATEWAY_TOKEN === "string"
      ? process.env.OPENCLAW_GATEWAY_TOKEN
      : undefined;
  let settled = false;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((err: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const client = new GatewayClient({
    url: `ws://127.0.0.1:${params.port}`,
    role: "node",
    clientName: GATEWAY_CLIENT_NAMES.NODE_HOST,
    clientVersion: "1.0.0",
    clientDisplayName: params.displayName,
    platform: "ios",
    mode: GATEWAY_CLIENT_MODES.NODE,
    token,
    deviceIdentity: params.deviceIdentity,
    instanceId: params.instanceId,
    scopes: [],
    caps: params.caps,
    commands: params.commands,
    onEvent: params.onEvent,
    onHelloOk: () => {
      if (settled) {
        return;
      }
      settled = true;
      resolveReady?.();
    },
    onConnectError: (err) => {
      if (settled) {
        return;
      }
      settled = true;
      rejectReady?.(err);
    },
    onClose: (code, reason) => {
      if (settled) {
        return;
      }
      settled = true;
      rejectReady?.(new Error(`gateway closed (${code}): ${reason}`));
    },
  });
  client.start();
  await Promise.race([
    ready,
    sleep(10_000).then(() => {
      throw new Error("timeout waiting for node to connect");
    }),
  ]);
  return client;
};

async function waitForSignal(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timeout");
}

describe("gateway role enforcement", () => {
  test("enforces operator and node permissions", async () => {
    const nodeWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => nodeWs.once("open", resolve));

    try {
      const eventRes = await rpcReq(ws, "node.event", { event: "test", payload: { ok: true } });
      expect(eventRes.ok).toBe(false);
      expect(eventRes.error?.message ?? "").toContain("unauthorized role");

      const invokeRes = await rpcReq(ws, "node.invoke.result", {
        id: "invoke-1",
        nodeId: "node-1",
        ok: true,
      });
      expect(invokeRes.ok).toBe(false);
      expect(invokeRes.error?.message ?? "").toContain("unauthorized role");

      await connectOk(nodeWs, {
        role: "node",
        client: {
          id: GATEWAY_CLIENT_NAMES.NODE_HOST,
          version: "1.0.0",
          platform: "ios",
          mode: GATEWAY_CLIENT_MODES.NODE,
        },
        commands: [],
      });

      const binsRes = await rpcReq<{ bins?: unknown[] }>(nodeWs, "skills.bins", {});
      if (binsRes.ok) {
        expect(Array.isArray(binsRes.payload?.bins)).toBe(true);
      } else {
        expect(binsRes.error?.message ?? "").toContain("node owner mismatch");
        expect((binsRes.error?.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
          "OWNER_MISMATCH",
        );
      }

      const statusRes = await rpcReq(nodeWs, "status", {});
      expect(statusRes.ok).toBe(false);
      expect(statusRes.error?.message ?? "").toContain("unauthorized role");
    } finally {
      nodeWs.close();
    }
  });
});

describe("gateway node events ownership enforcement", () => {
  test("denies node events for sessions owned by another user", async () => {
    let nodeClient: GatewayClient | undefined;
    let userBws: WebSocket | undefined;
    const sessionKey = `agent:main:discord:dm:node-owner-deny-${Date.now()}`;

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        session: {
          store: "sessions/{ownerUserId}.json",
        },
        gateway: {
          multiUser: {
            mode: "strict",
            identities: {
              "msg:discord:default:user-a": {
                userId: "user-a",
                principalId: "msg:discord:default:user-a",
                alias: "UserA",
                role: "user",
              },
              "msg:discord:default:user-b": {
                userId: "user-b",
                principalId: "msg:discord:default:user-b",
                alias: "UserB",
                role: "user",
              },
            },
          },
        },
      });

      userBws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => userBws?.once("open", resolve));
      await connectOk(userBws, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          alias: "UserB",
        },
      });

      const patch = await rpcReq(userBws, "sessions.patch", {
        key: sessionKey,
        label: `Owner B node-event target ${Date.now()}`,
      });
      expect(patch.ok).toBe(true);

      const beforeList = await rpcReq<{
        sessions?: Array<{ key?: string; updatedAt?: number; ownerUserId?: string | null }>;
      }>(userBws, "sessions.list", { limit: 500 });
      expect(beforeList.ok).toBe(true);
      const beforeEntry =
        beforeList.payload?.sessions?.find((session) => session.key === sessionKey) ?? null;
      expect(beforeEntry).toBeTruthy();
      expect(beforeEntry?.ownerUserId ?? null).toBe("user-b");
      const beforeUpdatedAt = Number(beforeEntry?.updatedAt ?? 0);
      expect(beforeUpdatedAt).toBeGreaterThan(0);

      drainSystemEvents(sessionKey);

      nodeClient = await connectNodeClient({
        port,
        commands: [],
        instanceId: "node-events-owner-deny",
        displayName: "node-events-owner-deny",
      });

      const adminNodeList = await rpcReq<{
        nodes?: Array<{ nodeId: string; connected?: boolean; displayName?: string }>;
      }>(ws, "node.list", {});
      expect(adminNodeList.ok).toBe(true);
      const nodeId =
        adminNodeList.payload?.nodes?.find(
          (node) => node.connected && node.displayName === "node-events-owner-deny",
        )?.nodeId ?? "";
      expect(nodeId).toBeTruthy();

      const pairRequest = await rpcReq<{ request?: { requestId?: string } }>(
        ws,
        "node.pair.request",
        {
          nodeId,
          displayName: "node-events-owner-deny",
          commands: [],
        },
      );
      expect(pairRequest.ok).toBe(true);
      const requestId = pairRequest.payload?.request?.requestId ?? "";
      expect(requestId).toBeTruthy();

      const pairApproved = await rpcReq(ws, "node.pair.approve", {
        requestId,
        ownerUserId: "user-a",
      });
      expect(pairApproved.ok).toBe(true);

      await nodeClient.request("node.event", {
        event: "voice.transcript",
        payloadJSON: JSON.stringify({
          text: "should not run",
          sessionKey,
        }),
      });
      await nodeClient.request("node.event", {
        event: "agent.request",
        payloadJSON: JSON.stringify({
          message: "should not run",
          sessionKey,
        }),
      });
      await nodeClient.request("node.event", {
        event: "exec.started",
        payloadJSON: JSON.stringify({
          sessionKey,
          runId: "run-owner-deny",
          command: "echo blocked",
        }),
      });

      await sleep(200);

      const afterList = await rpcReq<{
        sessions?: Array<{ key?: string; updatedAt?: number; ownerUserId?: string | null }>;
      }>(userBws, "sessions.list", { limit: 500 });
      expect(afterList.ok).toBe(true);
      const afterEntry =
        afterList.payload?.sessions?.find((session) => session.key === sessionKey) ?? null;
      expect(afterEntry).toBeTruthy();
      expect(afterEntry?.ownerUserId ?? null).toBe("user-b");
      const afterUpdatedAt = Number(afterEntry?.updatedAt ?? 0);
      expect(afterUpdatedAt).toBe(beforeUpdatedAt);
      expect(peekSystemEvents(sessionKey)).toEqual([]);
    } finally {
      if (userBws && userBws.readyState !== WebSocket.CLOSED) {
        userBws.close();
      }
      nodeClient?.stop();
      drainSystemEvents(sessionKey);
    }
  });
});

describe("gateway update.run", () => {
  test("writes sentinel and schedules restart", async () => {
    const sigusr1 = vi.fn();
    process.on("SIGUSR1", sigusr1);

    try {
      const id = "req-update";
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "update.run",
          params: {
            sessionKey: "agent:main:whatsapp:dm:+15555550123",
            restartDelayMs: 0,
          },
        }),
      );
      const res = await onceMessage<{ ok: boolean; payload?: unknown }>(
        ws,
        (o) => o.type === "res" && o.id === id,
      );
      expect(res.ok).toBe(true);

      await waitForSignal(() => sigusr1.mock.calls.length > 0);
      expect(sigusr1).toHaveBeenCalled();

      const sentinelPath = path.join(os.homedir(), ".openclaw", "restart-sentinel.json");
      const raw = await fs.readFile(sentinelPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        payload?: { kind?: string; stats?: { mode?: string } };
      };
      expect(parsed.payload?.kind).toBe("update");
      expect(parsed.payload?.stats?.mode).toBe("git");
    } finally {
      process.off("SIGUSR1", sigusr1);
    }
  });

  test("uses configured update channel", async () => {
    const sigusr1 = vi.fn();
    process.on("SIGUSR1", sigusr1);

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({ update: { channel: "beta" } });
      const updateMock = vi.mocked(runGatewayUpdate);
      updateMock.mockClear();

      const id = "req-update-channel";
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "update.run",
          params: {
            restartDelayMs: 0,
          },
        }),
      );
      const res = await onceMessage<{ ok: boolean; payload?: unknown }>(
        ws,
        (o) => o.type === "res" && o.id === id,
      );
      expect(res.ok).toBe(true);
      expect(updateMock.mock.calls[0]?.[0]?.channel).toBe("beta");
    } finally {
      process.off("SIGUSR1", sigusr1);
    }
  });
});

describe("gateway node command allowlist", () => {
  test("enforces command allowlists across node clients", async () => {
    const waitForConnectedCount = async (count: number) => {
      await expect
        .poll(
          async () => {
            const listRes = await rpcReq<{
              nodes?: Array<{ nodeId: string; connected?: boolean }>;
            }>(ws, "node.list", {});
            const nodes = listRes.payload?.nodes ?? [];
            return nodes.filter((node) => node.connected).length;
          },
          { timeout: 2_000 },
        )
        .toBe(count);
    };

    const getConnectedNodeId = async () => {
      const listRes = await rpcReq<{ nodes?: Array<{ nodeId: string; connected?: boolean }> }>(
        ws,
        "node.list",
        {},
      );
      const nodeId = listRes.payload?.nodes?.find((node) => node.connected)?.nodeId ?? "";
      expect(nodeId).toBeTruthy();
      return nodeId;
    };

    let systemClient: GatewayClient | undefined;
    let emptyClient: GatewayClient | undefined;
    let allowedClient: GatewayClient | undefined;

    try {
      systemClient = await connectNodeClient({
        port,
        commands: ["system.run"],
        instanceId: "node-system-run",
        displayName: "node-system-run",
      });
      const systemNodeId = await getConnectedNodeId();
      const disallowedRes = await rpcReq(ws, "node.invoke", {
        nodeId: systemNodeId,
        command: "system.run",
        params: { command: "echo hi" },
        idempotencyKey: "allowlist-1",
      });
      expect(disallowedRes.ok).toBe(false);
      expect(disallowedRes.error?.message).toContain("node command not allowed");
      systemClient.stop();
      await waitForConnectedCount(0);

      emptyClient = await connectNodeClient({
        port,
        commands: [],
        instanceId: "node-empty",
        displayName: "node-empty",
      });
      const emptyNodeId = await getConnectedNodeId();
      const missingRes = await rpcReq(ws, "node.invoke", {
        nodeId: emptyNodeId,
        command: "canvas.snapshot",
        params: {},
        idempotencyKey: "allowlist-2",
      });
      expect(missingRes.ok).toBe(false);
      expect(missingRes.error?.message).toContain("node command not allowed");
      emptyClient.stop();
      await waitForConnectedCount(0);

      let resolveInvoke: ((payload: { id?: string; nodeId?: string }) => void) | null = null;
      const waitForInvoke = () =>
        new Promise<{ id?: string; nodeId?: string }>((resolve) => {
          resolveInvoke = resolve;
        });
      allowedClient = await connectNodeClient({
        port,
        commands: ["canvas.snapshot"],
        instanceId: "node-allowed",
        displayName: "node-allowed",
        onEvent: (evt) => {
          if (evt.event === "node.invoke.request") {
            const payload = evt.payload as { id?: string; nodeId?: string };
            resolveInvoke?.(payload);
          }
        },
      });
      const allowedNodeId = await getConnectedNodeId();

      const invokeResP = rpcReq(ws, "node.invoke", {
        nodeId: allowedNodeId,
        command: "canvas.snapshot",
        params: { format: "png" },
        idempotencyKey: "allowlist-3",
      });
      const payload = await waitForInvoke();
      const requestId = payload?.id ?? "";
      const nodeIdFromReq = payload?.nodeId ?? "node-allowed";
      await allowedClient.request("node.invoke.result", {
        id: requestId,
        nodeId: nodeIdFromReq,
        ok: true,
        payloadJSON: JSON.stringify({ ok: true }),
      });
      const invokeRes = await invokeResP;
      expect(invokeRes.ok).toBe(true);

      const invokeNullResP = rpcReq(ws, "node.invoke", {
        nodeId: allowedNodeId,
        command: "canvas.snapshot",
        params: { format: "png" },
        idempotencyKey: "allowlist-null-payloadjson",
      });
      const payloadNull = await waitForInvoke();
      const requestIdNull = payloadNull?.id ?? "";
      const nodeIdNull = payloadNull?.nodeId ?? "node-allowed";
      await allowedClient.request("node.invoke.result", {
        id: requestIdNull,
        nodeId: nodeIdNull,
        ok: true,
        payloadJSON: null,
      });
      const invokeNullRes = await invokeNullResP;
      expect(invokeNullRes.ok).toBe(true);
    } finally {
      systemClient?.stop();
      emptyClient?.stop();
      allowedClient?.stop();
    }
  });
});

describe("gateway node and browser ownership", () => {
  test("denies encoded browser profile mutation routes for non-admin users", async () => {
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));
    const sinceTs = Date.now();

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
          },
        },
        browser: {
          defaultProfile: "alice",
          profiles: {
            alice: {
              cdpPort: 18810,
              color: "#00AA00",
              ownerUserId: "user-a",
            },
          },
        },
      });

      await connectOk(userWs, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });

      const denied = await rpcReq(userWs, "browser.request", {
        method: "POST",
        path: "/profiles%252Fcreate",
        body: { name: "should-not-create" },
      });
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("admin-only");
      expect((denied.error?.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "ROLE_FORBIDDEN",
      );

      const deniedFeed = await rpcReq<{
        events?: Array<{
          method?: string;
          reasonCode?: string;
          userId?: string | null;
          userAlias?: string | null;
        }>;
      }>(ws, "authz.denied.list", {
        method: "browser.request",
        reasonCode: "ROLE_FORBIDDEN",
        userId: "user-a",
        sinceTs,
        limit: 20,
      });
      expect(deniedFeed.ok).toBe(true);
      expect(
        (deniedFeed.payload?.events ?? []).some(
          (event) =>
            event.method === "browser.request" &&
            event.reasonCode === "ROLE_FORBIDDEN" &&
            event.userAlias === "Alice",
        ),
      ).toBe(true);
    } finally {
      userWs.close();
    }
  });

  test("filters node.list and denies node.invoke/browser.request for owner mismatch", async () => {
    let browserNodeClient: GatewayClient | undefined;
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));
    const sinceTs = Date.now();

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          nodes: {
            allowCommands: ["browser.proxy"],
            browser: {
              mode: "auto",
            },
          },
        },
        browser: {
          defaultProfile: "alice",
          profiles: {
            alice: {
              cdpPort: 18810,
              color: "#00AA00",
              ownerUserId: "user-b",
            },
          },
        },
      });

      browserNodeClient = await connectNodeClient({
        port,
        caps: ["browser"],
        commands: ["browser.proxy", "canvas.snapshot"],
        instanceId: "node-owner-mismatch",
        displayName: "node-owner-mismatch",
      });

      const adminNodeList = await rpcReq<{
        nodes?: Array<{ nodeId: string; connected?: boolean; ownerUserId?: string }>;
      }>(ws, "node.list", {});
      expect(adminNodeList.ok).toBe(true);
      const nodeId =
        adminNodeList.payload?.nodes?.find((node) => node.connected && node.nodeId)?.nodeId ?? "";
      expect(nodeId).toBeTruthy();

      const pairRequest = await rpcReq<{
        request?: { requestId?: string };
      }>(ws, "node.pair.request", {
        nodeId,
        displayName: "node-owner-mismatch",
        commands: ["browser.proxy", "canvas.snapshot"],
      });
      expect(pairRequest.ok).toBe(true);
      const requestId = pairRequest.payload?.request?.requestId ?? "";
      expect(requestId).toBeTruthy();

      const pairApproved = await rpcReq(ws, "node.pair.approve", {
        requestId,
        ownerUserId: "user-b",
      });
      expect(pairApproved.ok).toBe(true);
      await writeConfigFile({
        gateway: {
          nodes: {
            allowCommands: ["browser.proxy"],
            browser: {
              mode: "auto",
              node: nodeId,
            },
          },
        },
        browser: {
          defaultProfile: "alice",
          profiles: {
            alice: {
              cdpPort: 18810,
              color: "#00AA00",
              ownerUserId: "user-b",
            },
          },
        },
      });
      const adminNodeListAfterPair = await rpcReq<{
        nodes?: Array<{ nodeId: string; ownerUserId?: string }>;
      }>(ws, "node.list", {});
      expect(adminNodeListAfterPair.ok).toBe(true);
      expect(
        adminNodeListAfterPair.payload?.nodes?.find((node) => node.nodeId === nodeId)?.ownerUserId,
      ).toBe("user-b");

      await connectOk(userWs, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });

      const userNodeList = await rpcReq<{ nodes?: Array<{ nodeId: string }> }>(
        userWs,
        "node.list",
        {},
      );
      expect(userNodeList.ok).toBe(true);
      expect(userNodeList.payload?.nodes?.some((node) => node.nodeId === nodeId)).toBe(false);

      const invokeDenied = await rpcReq(userWs, "node.invoke", {
        nodeId,
        command: "canvas.snapshot",
        params: { format: "png" },
        idempotencyKey: "owner-mismatch-invoke",
      });
      expect(invokeDenied.ok).toBe(false);
      expect(invokeDenied.error?.message ?? "").toContain("node owner mismatch");
      expect(
        (
          invokeDenied.error as
            | {
                details?: { reasonCode?: string };
              }
            | undefined
        )?.details?.reasonCode,
      ).toBe("OWNER_MISMATCH");

      const describeDenied = await rpcReq(userWs, "node.describe", { nodeId });
      expect(describeDenied.ok).toBe(false);
      expect(describeDenied.error?.message ?? "").toContain("node owner mismatch");
      expect(
        (
          describeDenied.error as
            | {
                details?: { reasonCode?: string };
              }
            | undefined
        )?.details?.reasonCode,
      ).toBe("OWNER_MISMATCH");

      const browserDenied = await rpcReq(userWs, "browser.request", {
        method: "GET",
        path: "/tabs/list",
      });
      expect(browserDenied.ok).toBe(false);
      expect(
        (
          browserDenied.error as
            | {
                details?: { reasonCode?: string };
              }
            | undefined
        )?.details?.reasonCode,
      ).toBe("OWNER_MISMATCH");
      expect(browserDenied.error?.message ?? "").toMatch(/browser|owner mismatch|not found/i);

      const deniedFeed = await rpcReq<{
        events?: Array<{
          method?: string;
          reasonCode?: string;
          userId?: string | null;
          userAlias?: string | null;
          sourceIp?: string | null;
        }>;
      }>(ws, "authz.denied.list", {
        reasonCode: "OWNER_MISMATCH",
        userId: "user-a",
        sinceTs,
        limit: 50,
      });
      expect(deniedFeed.ok).toBe(true);
      const deniedMethods = (deniedFeed.payload?.events ?? []).map((event) => event.method);
      expect(deniedMethods).toContain("node.invoke");
      expect(deniedMethods).toContain("node.describe");
      expect(deniedMethods).toContain("browser.request");
      expect((deniedFeed.payload?.events ?? []).some((event) => event.userAlias === "Alice")).toBe(
        true,
      );
      const browserDeniedEvent = (deniedFeed.payload?.events ?? []).find(
        (event) => event.method === "browser.request",
      );
      expect(typeof browserDeniedEvent?.sourceIp).toBe("string");
    } finally {
      userWs.close();
      browserNodeClient?.stop();
    }
  });

  test("denies send when provided session key is owned by another user", async () => {
    const userAws = new WebSocket(`ws://127.0.0.1:${port}`);
    const userBws = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise<void>((resolve) => userAws.once("open", resolve)),
      new Promise<void>((resolve) => userBws.once("open", resolve)),
    ]);
    const sinceTs = Date.now();
    const sessionKey = `agent:main:slack:channel:owner-b-send-${Date.now()}`;

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
          },
        },
      });

      await connectOk(userAws, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });
      await connectOk(userBws, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          alias: "Bob",
        },
      });

      const patch = await rpcReq(userBws, "sessions.patch", {
        key: sessionKey,
        label: "Owner B send session",
      });
      expect(patch.ok).toBe(true);

      const denied = await rpcReq(userAws, "send", {
        to: "C123",
        message: "hello",
        channel: "slack",
        idempotencyKey: `idem-send-owner-deny-${Date.now()}`,
        sessionKey,
      });
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("owner mismatch");
      expect((denied.error?.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "OWNER_MISMATCH",
      );

      const deniedFeed = await rpcReq<{
        events?: Array<{ method?: string; userAlias?: string | null }>;
      }>(ws, "authz.denied.list", {
        method: "send",
        reasonCode: "OWNER_MISMATCH",
        userId: "user-a",
        sinceTs,
        limit: 20,
      });
      expect(deniedFeed.ok).toBe(true);
      expect((deniedFeed.payload?.events ?? []).some((event) => event.method === "send")).toBe(
        true,
      );
      expect((deniedFeed.payload?.events ?? []).some((event) => event.userAlias === "Alice")).toBe(
        true,
      );
    } finally {
      userAws.close();
      userBws.close();
    }
  });

  test("denies send when derived target session key is owned by another user", async () => {
    const userAws = new WebSocket(`ws://127.0.0.1:${port}`);
    const userBws = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise<void>((resolve) => userAws.once("open", resolve)),
      new Promise<void>((resolve) => userBws.once("open", resolve)),
    ]);
    const sinceTs = Date.now();

    try {
      const { writeConfigFile, loadConfig } = await import("../config/config.js");
      const { resolveOutboundSessionRoute } = await import("../infra/outbound/outbound-session.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
          },
        },
      });

      await connectOk(userAws, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });
      await connectOk(userBws, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          alias: "Bob",
        },
      });

      const route = await resolveOutboundSessionRoute({
        cfg: loadConfig(),
        channel: "slack",
        agentId: "main",
        target: "C456",
      });
      expect(route?.sessionKey).toBeTruthy();
      const sessionKey = route?.sessionKey ?? "";

      const patch = await rpcReq(userBws, "sessions.patch", {
        key: sessionKey,
        label: "Owner B derived send session",
      });
      expect(patch.ok).toBe(true);

      const denied = await rpcReq(userAws, "send", {
        to: "C456",
        message: "hello",
        channel: "slack",
        idempotencyKey: `idem-send-derived-owner-deny-${Date.now()}`,
      });
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("owner mismatch");
      expect((denied.error?.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "OWNER_MISMATCH",
      );

      const deniedFeed = await rpcReq<{
        events?: Array<{ method?: string; userAlias?: string | null }>;
      }>(ws, "authz.denied.list", {
        method: "send",
        reasonCode: "OWNER_MISMATCH",
        userId: "user-a",
        sinceTs,
        limit: 20,
      });
      expect(deniedFeed.ok).toBe(true);
      expect((deniedFeed.payload?.events ?? []).some((event) => event.method === "send")).toBe(
        true,
      );
      expect((deniedFeed.payload?.events ?? []).some((event) => event.userAlias === "Alice")).toBe(
        true,
      );
    } finally {
      userAws.close();
      userBws.close();
    }
  });

  test("allows delegated send access without changing session owner", async () => {
    const userAws = new WebSocket(`ws://127.0.0.1:${port}`);
    const userBws = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise<void>((resolve) => userAws.once("open", resolve)),
      new Promise<void>((resolve) => userBws.once("open", resolve)),
    ]);
    const sessionKey = `agent:main:slack:channel:delegated-send-${Date.now()}`;

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
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

      await connectOk(userAws, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });
      await connectOk(userBws, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          alias: "Bob",
        },
      });

      const patch = await rpcReq(userBws, "sessions.patch", {
        key: sessionKey,
        label: "Delegated send owner test",
      });
      expect(patch.ok).toBe(true);

      const beforeList = await rpcReq<{ sessions?: Array<{ key?: string; ownerUserId?: string }> }>(
        ws,
        "sessions.list",
        { limit: 500 },
      );
      expect(beforeList.ok).toBe(true);
      const beforeOwner =
        beforeList.payload?.sessions?.find((session) => session.key === sessionKey)?.ownerUserId ??
        null;
      expect(beforeOwner).toBe("user-b");

      const sendRes = await rpcReq(userAws, "send", {
        to: "C123",
        message: "delegated hello",
        channel: "slack",
        idempotencyKey: `idem-send-delegated-owner-${Date.now()}`,
        sessionKey,
      });
      if (!sendRes.ok) {
        expect(
          (sendRes.error?.details as { reasonCode?: string } | undefined)?.reasonCode,
        ).not.toBe("OWNER_MISMATCH");
      }

      const afterList = await rpcReq<{ sessions?: Array<{ key?: string; ownerUserId?: string }> }>(
        ws,
        "sessions.list",
        { limit: 500 },
      );
      expect(afterList.ok).toBe(true);
      const afterOwner =
        afterList.payload?.sessions?.find((session) => session.key === sessionKey)?.ownerUserId ??
        null;
      expect(afterOwner).toBe("user-b");
    } finally {
      userAws.close();
      userBws.close();
    }
  });

  test("allows browser.request via delegated browser access with aligned profile and node owner", async () => {
    let browserNodeClient: GatewayClient | undefined;
    let resolveInvoke: ((payload: { id?: string; nodeId?: string }) => void) | null = null;
    const waitForInvoke = () =>
      new Promise<{ id?: string; nodeId?: string }>((resolve) => {
        resolveInvoke = resolve;
      });
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: "user-a",
                  toUserId: "user-b",
                  resources: ["browser"],
                },
              ],
            },
          },
          nodes: {
            allowCommands: ["browser.proxy"],
            browser: {
              mode: "auto",
            },
          },
        },
        browser: {
          defaultProfile: "alice",
          profiles: {
            alice: {
              cdpPort: 18810,
              color: "#00AA00",
              ownerUserId: "user-b",
            },
          },
        },
      });

      browserNodeClient = await connectNodeClient({
        port,
        caps: ["browser"],
        commands: ["browser.proxy"],
        instanceId: "node-browser-delegated",
        displayName: "node-browser-delegated",
        onEvent: (evt) => {
          if (evt.event === "node.invoke.request") {
            resolveInvoke?.(evt.payload as { id?: string; nodeId?: string });
          }
        },
      });

      const adminNodeList = await rpcReq<{
        nodes?: Array<{ nodeId: string; connected?: boolean; displayName?: string }>;
      }>(ws, "node.list", {});
      expect(adminNodeList.ok).toBe(true);
      const nodeId =
        adminNodeList.payload?.nodes?.find(
          (node) => node.connected && node.displayName === "node-browser-delegated",
        )?.nodeId ?? "";
      expect(nodeId).toBeTruthy();

      const pairRequest = await rpcReq<{
        request?: { requestId?: string };
      }>(ws, "node.pair.request", {
        nodeId,
        displayName: "node-browser-delegated",
        commands: ["browser.proxy"],
      });
      expect(pairRequest.ok).toBe(true);
      const requestId = pairRequest.payload?.request?.requestId ?? "";
      expect(requestId).toBeTruthy();

      const pairApproved = await rpcReq(ws, "node.pair.approve", {
        requestId,
        ownerUserId: "user-b",
      });
      expect(pairApproved.ok).toBe(true);

      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: "user-a",
                  toUserId: "user-b",
                  resources: ["browser"],
                },
              ],
            },
          },
          nodes: {
            allowCommands: ["browser.proxy"],
            browser: {
              mode: "auto",
              node: nodeId,
            },
          },
        },
        browser: {
          defaultProfile: "alice",
          profiles: {
            alice: {
              cdpPort: 18810,
              color: "#00AA00",
              ownerUserId: "user-b",
            },
          },
        },
      });

      await connectOk(userWs, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });

      const browserResultP = rpcReq<{ source?: string }>(userWs, "browser.request", {
        method: "GET",
        path: "/tabs/list",
      });
      const firstCompletion = await Promise.race([
        waitForInvoke().then(
          (payload) =>
            ({
              kind: "invoke" as const,
              payload,
            }) as const,
        ),
        browserResultP.then(
          (result) =>
            ({
              kind: "result" as const,
              result,
            }) as const,
        ),
        sleep(10_000).then(
          () =>
            ({
              kind: "timeout" as const,
            }) as const,
        ),
      ]);
      if (firstCompletion.kind === "timeout") {
        throw new Error("timed out waiting for browser.proxy invoke or browser.request response");
      }
      if (firstCompletion.kind === "result") {
        if (!firstCompletion.result.ok) {
          throw new Error(
            `delegated browser.request failed before node invoke: ${JSON.stringify(firstCompletion.result.error)}`,
          );
        }
        expect(firstCompletion.result.payload?.source).toBe("delegated-browser");
        return;
      }
      const invokePayload = firstCompletion.payload;
      const invokeRequestId = invokePayload.id ?? "";
      const invokeNodeId = invokePayload.nodeId ?? nodeId;
      await browserNodeClient.request("node.invoke.result", {
        id: invokeRequestId,
        nodeId: invokeNodeId,
        ok: true,
        payloadJSON: JSON.stringify({ result: { source: "delegated-browser" } }),
      });

      const browserResult = await browserResultP;
      expect(browserResult.ok).toBe(true);
      expect(browserResult.payload?.source).toBe("delegated-browser");
    } finally {
      userWs.close();
      browserNodeClient?.stop();
    }
  });

  test("denies delegated browser.request when profile owner and node owner differ", async () => {
    let browserNodeClient: GatewayClient | undefined;
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));

    try {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: "user-a",
                  toUserId: "user-b",
                  resources: ["browser"],
                },
              ],
            },
          },
          nodes: {
            allowCommands: ["browser.proxy"],
            browser: {
              mode: "auto",
            },
          },
        },
        browser: {
          defaultProfile: "alice",
          profiles: {
            alice: {
              cdpPort: 18810,
              color: "#00AA00",
              ownerUserId: "user-a",
            },
          },
        },
      });

      browserNodeClient = await connectNodeClient({
        port,
        caps: ["browser"],
        commands: ["browser.proxy"],
        instanceId: "node-browser-profile-mismatch",
        displayName: "node-browser-profile-mismatch",
      });

      const adminNodeList = await rpcReq<{
        nodes?: Array<{ nodeId: string; connected?: boolean; displayName?: string }>;
      }>(ws, "node.list", {});
      expect(adminNodeList.ok).toBe(true);
      const nodeId =
        adminNodeList.payload?.nodes?.find(
          (node) => node.connected && node.displayName === "node-browser-profile-mismatch",
        )?.nodeId ?? "";
      expect(nodeId).toBeTruthy();

      const pairRequest = await rpcReq<{
        request?: { requestId?: string };
      }>(ws, "node.pair.request", {
        nodeId,
        displayName: "node-browser-profile-mismatch",
        commands: ["browser.proxy"],
      });
      expect(pairRequest.ok).toBe(true);
      const requestId = pairRequest.payload?.request?.requestId ?? "";
      expect(requestId).toBeTruthy();

      const pairApproved = await rpcReq(ws, "node.pair.approve", {
        requestId,
        ownerUserId: "user-b",
      });
      expect(pairApproved.ok).toBe(true);

      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: "user-a",
                  toUserId: "user-b",
                  resources: ["browser"],
                },
              ],
            },
          },
          nodes: {
            allowCommands: ["browser.proxy"],
            browser: {
              mode: "auto",
              node: nodeId,
            },
          },
        },
        browser: {
          defaultProfile: "alice",
          profiles: {
            alice: {
              cdpPort: 18810,
              color: "#00AA00",
              ownerUserId: "user-a",
            },
          },
        },
      });

      await connectOk(userWs, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });

      const denied = await rpcReq(userWs, "browser.request", {
        method: "GET",
        path: "/tabs/list",
      });
      expect(denied.ok).toBe(false);
      expect(denied.error?.message ?? "").toContain("profile/node owner mismatch");
      expect((denied.error?.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "OWNER_MISMATCH",
      );
    } finally {
      userWs.close();
      browserNodeClient?.stop();
    }
  });

  test("strict mode denies missing node owner while compat mode allows describe/list", async () => {
    let nodeClient: GatewayClient | undefined;
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));
    const identityDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-node-owner-missing-"));

    try {
      const { loadOrCreateDeviceIdentity } = await import("../infra/device-identity.js");
      const deviceIdentity = loadOrCreateDeviceIdentity(path.join(identityDir, "device.json"));
      nodeClient = await connectNodeClient({
        port,
        commands: ["canvas.snapshot"],
        instanceId: "node-owner-missing",
        displayName: "node-owner-missing",
        deviceIdentity,
      });

      const adminNodeList = await rpcReq<{
        nodes?: Array<{ nodeId: string; connected?: boolean }>;
      }>(ws, "node.list", {});
      expect(adminNodeList.ok).toBe(true);
      const nodeId =
        adminNodeList.payload?.nodes?.find((node) => node.connected && node.nodeId)?.nodeId ?? "";
      expect(nodeId).toBeTruthy();

      const pairRequest = await rpcReq<{
        request?: { requestId?: string };
      }>(ws, "node.pair.request", {
        nodeId,
        displayName: "node-owner-missing",
        commands: ["canvas.snapshot"],
      });
      expect(pairRequest.ok).toBe(true);
      const requestId = pairRequest.payload?.request?.requestId ?? "";
      expect(requestId).toBeTruthy();

      const pairApproved = await rpcReq(ws, "node.pair.approve", { requestId });
      expect(pairApproved.ok).toBe(true);

      await connectOk(userWs, {
        scopes: ["operator.read", "operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });

      const strictDescribe = await rpcReq(userWs, "node.describe", { nodeId });
      expect(strictDescribe.ok).toBe(false);
      expect(strictDescribe.error?.message ?? "").toContain("node owner mismatch");
      expect(
        (
          strictDescribe.error as
            | {
                details?: { reasonCode?: string };
              }
            | undefined
        )?.details?.reasonCode,
      ).toBe("OWNER_MISMATCH");

      const strictList = await rpcReq<{ nodes?: Array<{ nodeId: string }> }>(
        userWs,
        "node.list",
        {},
      );
      expect(strictList.ok).toBe(true);
      expect(strictList.payload?.nodes?.some((node) => node.nodeId === nodeId)).toBe(false);

      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "compat",
          },
        },
      });

      const compatDescribe = await rpcReq(userWs, "node.describe", { nodeId });
      expect(compatDescribe.ok).toBe(true);
      expect((compatDescribe.payload as { nodeId?: string } | undefined)?.nodeId).toBe(nodeId);

      const compatList = await rpcReq<{ nodes?: Array<{ nodeId: string }> }>(
        userWs,
        "node.list",
        {},
      );
      expect(compatList.ok).toBe(true);
      expect(compatList.payload?.nodes?.some((node) => node.nodeId === nodeId)).toBe(true);
    } finally {
      userWs.close();
      nodeClient?.stop();
      await fs.rm(identityDir, { recursive: true, force: true });
    }
  });
});
