import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";

type ResFrame<T = unknown> = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: T;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

type AuthzDeniedEvent = {
  method?: string;
  reasonCode?: string;
  userId?: string | null;
  principalId?: string | null;
  actorRole?: string | null;
  clientId?: string | null;
  clientMode?: string | null;
  sourceIp?: string | null;
};

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate ephemeral port"));
        return;
      }
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function onceMessage<T>(
  ws: WebSocket,
  predicate: (frame: unknown) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for websocket frame"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("websocket closed before expected frame"));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const text =
          typeof raw === "string"
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString("utf8")
              : Array.isArray(raw)
                ? Buffer.concat(raw).toString("utf8")
                : Buffer.from(raw).toString("utf8");
        const parsed: unknown = JSON.parse(text);
        if (!predicate(parsed)) {
          return;
        }
        cleanup();
        resolve(parsed as T);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    ws.on("message", onMessage);
    ws.on("close", onClose);
    ws.on("error", onError);
  });
}

async function openWs(port: number, headers?: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, headers ? { headers } : undefined);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}

async function rpcReq<T = unknown>(
  ws: WebSocket,
  method: string,
  params?: Record<string, unknown>,
): Promise<ResFrame<T>> {
  const id = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  ws.send(
    JSON.stringify({
      type: "req",
      id,
      method,
      ...(params ? { params } : {}),
    }),
  );
  return await onceMessage<ResFrame<T>>(ws, (frame) => {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      return false;
    }
    const rec = frame as { type?: unknown; id?: unknown };
    return rec.type === "res" && rec.id === id;
  });
}

async function connectReq(params: {
  ws: WebSocket;
  token: string;
  scopes: string[];
  identity: { userId: string; principalId: string; alias?: string };
  clientInstanceId?: string;
}): Promise<ResFrame<{ type?: string }>> {
  const id = `connect-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  params.ws.send(
    JSON.stringify({
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
          version: "test",
          platform: "node",
          mode: GATEWAY_CLIENT_MODES.BACKEND,
          ...(params.clientInstanceId ? { instanceId: params.clientInstanceId } : {}),
        },
        role: "operator",
        scopes: params.scopes,
        identity: params.identity,
        auth: { token: params.token },
      },
    }),
  );
  return await onceMessage<ResFrame<{ type?: string }>>(params.ws, (frame) => {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      return false;
    }
    const rec = frame as { type?: unknown; id?: unknown };
    return rec.type === "res" && rec.id === id;
  });
}

function setEnv(key: string, value: string, restore: Map<string, string | undefined>) {
  if (!restore.has(key)) {
    restore.set(key, process.env[key]);
  }
  process.env[key] = value;
}

function restoreEnv(restore: Map<string, string | undefined>) {
  for (const [key, value] of restore.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("gateway chat command authz (real reply path)", () => {
  const tempDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  test("records ROLE_FORBIDDEN deny events for admin-only chat commands from mapped non-admin principals", async () => {
    const restore = new Map<string, string | undefined>();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-chat-cmd-authz-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "openclaw.json");
    const stateDir = path.join(tempRoot, "state");
    const token = "test-gateway-token-chat-command-authz";
    const userPrincipalId = "msg:test:user-a";
    const userClientInstanceId = "mapped-user-a";
    const proxiedSourceIp = "203.0.113.42";

    let server:
      | {
          close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
        }
      | undefined;
    let wsUser: WebSocket | undefined;
    let wsAdmin: WebSocket | undefined;

    try {
      setEnv("OPENCLAW_CONFIG_PATH", configPath, restore);
      setEnv("OPENCLAW_STATE_DIR", stateDir, restore);
      setEnv("OPENCLAW_SKIP_CHANNELS", "1", restore);
      setEnv("OPENCLAW_SKIP_CRON", "1", restore);
      setEnv("OPENCLAW_SKIP_BROWSER_CONTROL_SERVER", "1", restore);
      setEnv("OPENCLAW_SKIP_GMAIL_WATCHER", "1", restore);
      setEnv("OPENCLAW_SKIP_CANVAS_HOST", "1", restore);
      setEnv(
        "OPENCLAW_BUNDLED_PLUGINS_DIR",
        path.join(tempRoot, "openclaw-test-no-bundled-extensions"),
        restore,
      );

      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            commands: {
              text: true,
              config: true,
              debug: true,
            },
            plugins: {
              slots: {
                memory: "none",
              },
            },
            gateway: {
              auth: { mode: "token", token },
              trustedProxies: ["127.0.0.1"],
              multiUser: {
                mode: "strict",
                identities: {
                  [`client:${GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT}:${userClientInstanceId}`]: {
                    userId: "user-a",
                    principalId: userPrincipalId,
                    alias: "UserA",
                    role: "user",
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const port = await getFreePort();
      vi.resetModules();
      const { startGatewayServer } = await import("./server.js");
      server = await startGatewayServer(port, {
        controlUiEnabled: false,
        openAiChatCompletionsEnabled: false,
        openResponsesEnabled: false,
      });

      wsUser = await openWs(port, {
        "x-forwarded-for": proxiedSourceIp,
      });
      const userConnect = await connectReq({
        ws: wsUser,
        token,
        scopes: ["operator.admin", "operator.write"],
        clientInstanceId: userClientInstanceId,
        identity: {
          userId: "user-a",
          principalId: userPrincipalId,
          alias: "UserA",
        },
      });
      expect(userConnect.ok).toBe(true);
      expect(userConnect.payload?.type).toBe("hello-ok");

      wsAdmin = await openWs(port);
      const adminConnect = await connectReq({
        ws: wsAdmin,
        token,
        scopes: ["operator.admin"],
        identity: {
          userId: "admin-a",
          principalId: "admin:test:panel",
          alias: "AdminA",
        },
      });
      expect(adminConnect.ok).toBe(true);
      const commandCases: Array<{ message: string; idempotencyKey: string; method: string }> = [
        {
          message: "/config show",
          idempotencyKey: "idem-chat-command-config-deny",
          method: "command.config",
        },
        {
          message: "/debug show",
          idempotencyKey: "idem-chat-command-debug-deny",
          method: "command.debug",
        },
        {
          message: "/allowlist list dm",
          idempotencyKey: "idem-chat-command-allowlist-deny",
          method: "command.allowlist",
        },
        {
          message: "/tts on",
          idempotencyKey: "idem-chat-command-tts-deny",
          method: "command.tts",
        },
        {
          message: "/approve abc allow-once",
          idempotencyKey: "idem-chat-command-approve-deny",
          method: "command.approve",
        },
      ];

      for (const commandCase of commandCases) {
        const chatSend = await rpcReq<{ status?: string }>(wsUser, "chat.send", {
          sessionKey: "main",
          message: commandCase.message,
          idempotencyKey: commandCase.idempotencyKey,
        });
        expect(chatSend.ok).toBe(true);
        expect(chatSend.payload?.status).toBe("started");

        const deadline = Date.now() + 4_000;
        let found = false;
        while (Date.now() < deadline) {
          const denied = await rpcReq<{ events?: AuthzDeniedEvent[] }>(
            wsAdmin,
            "authz.denied.list",
            {
              method: commandCase.method,
              reasonCode: "ROLE_FORBIDDEN",
              userId: "user-a",
              limit: 20,
            },
          );
          expect(denied.ok).toBe(true);

          found = (denied.payload?.events ?? []).some(
            (event) =>
              event.method === commandCase.method &&
              event.reasonCode === "ROLE_FORBIDDEN" &&
              event.userId === "user-a" &&
              event.principalId === userPrincipalId &&
              event.actorRole === "user" &&
              event.clientId === GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT &&
              event.clientMode === GATEWAY_CLIENT_MODES.BACKEND &&
              event.sourceIp === proxiedSourceIp,
          );
          if (found) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        expect(found).toBe(true);
      }
    } finally {
      if (wsUser && wsUser.readyState !== WebSocket.CLOSED) {
        wsUser.terminate();
      }
      if (wsAdmin && wsAdmin.readyState !== WebSocket.CLOSED) {
        wsAdmin.terminate();
      }
      if (server) {
        await server.close();
      }
      restoreEnv(restore);
    }
  });

  test("records ROLE_FORBIDDEN when mapped principal role is missing on admin-only chat commands", async () => {
    const restore = new Map<string, string | undefined>();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-chat-cmd-authz-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "openclaw.json");
    const stateDir = path.join(tempRoot, "state");
    const token = "test-gateway-token-chat-command-authz-no-role";
    const userPrincipalId = "msg:test:user-b";
    const userClientInstanceId = "mapped-user-b";

    let server:
      | {
          close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
        }
      | undefined;
    let wsUser: WebSocket | undefined;
    let wsAdmin: WebSocket | undefined;

    try {
      setEnv("OPENCLAW_CONFIG_PATH", configPath, restore);
      setEnv("OPENCLAW_STATE_DIR", stateDir, restore);
      setEnv("OPENCLAW_SKIP_CHANNELS", "1", restore);
      setEnv("OPENCLAW_SKIP_CRON", "1", restore);
      setEnv("OPENCLAW_SKIP_BROWSER_CONTROL_SERVER", "1", restore);
      setEnv("OPENCLAW_SKIP_GMAIL_WATCHER", "1", restore);
      setEnv("OPENCLAW_SKIP_CANVAS_HOST", "1", restore);
      setEnv(
        "OPENCLAW_BUNDLED_PLUGINS_DIR",
        path.join(tempRoot, "openclaw-test-no-bundled-extensions"),
        restore,
      );

      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            commands: {
              text: true,
              config: true,
            },
            plugins: {
              slots: {
                memory: "none",
              },
            },
            gateway: {
              auth: { mode: "token", token },
              multiUser: {
                mode: "strict",
                identities: {
                  [`client:${GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT}:${userClientInstanceId}`]: {
                    userId: "user-b",
                    principalId: userPrincipalId,
                    alias: "UserB",
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const port = await getFreePort();
      vi.resetModules();
      const { startGatewayServer } = await import("./server.js");
      server = await startGatewayServer(port, {
        controlUiEnabled: false,
        openAiChatCompletionsEnabled: false,
        openResponsesEnabled: false,
      });

      wsUser = await openWs(port);
      const userConnect = await connectReq({
        ws: wsUser,
        token,
        scopes: ["operator.admin", "operator.write"],
        clientInstanceId: userClientInstanceId,
        identity: {
          userId: "user-b",
          principalId: userPrincipalId,
          alias: "UserB",
        },
      });
      expect(userConnect.ok).toBe(true);
      expect(userConnect.payload?.type).toBe("hello-ok");

      wsAdmin = await openWs(port);
      const adminConnect = await connectReq({
        ws: wsAdmin,
        token,
        scopes: ["operator.admin"],
        identity: {
          userId: "admin-b",
          principalId: "admin:test:panel-b",
          alias: "AdminB",
        },
      });
      expect(adminConnect.ok).toBe(true);

      const chatSend = await rpcReq<{ status?: string }>(wsUser, "chat.send", {
        sessionKey: "main",
        message: "/config show",
        idempotencyKey: "idem-chat-command-config-deny-no-role",
      });
      expect(chatSend.ok).toBe(true);
      expect(chatSend.payload?.status).toBe("started");

      const deadline = Date.now() + 4_000;
      let found = false;
      while (Date.now() < deadline) {
        const denied = await rpcReq<{ events?: AuthzDeniedEvent[] }>(wsAdmin, "authz.denied.list", {
          method: "command.config",
          reasonCode: "ROLE_FORBIDDEN",
          userId: "user-b",
          limit: 20,
        });
        expect(denied.ok).toBe(true);
        found = (denied.payload?.events ?? []).some(
          (event) =>
            event.method === "command.config" &&
            event.reasonCode === "ROLE_FORBIDDEN" &&
            event.userId === "user-b" &&
            event.principalId === userPrincipalId &&
            event.actorRole === "user" &&
            event.sourceIp === "127.0.0.1",
        );
        if (found) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      expect(found).toBe(true);
    } finally {
      if (wsUser && wsUser.readyState !== WebSocket.CLOSED) {
        wsUser.terminate();
      }
      if (wsAdmin && wsAdmin.readyState !== WebSocket.CLOSED) {
        wsAdmin.terminate();
      }
      if (server) {
        await server.close();
      }
      restoreEnv(restore);
    }
  });
});
