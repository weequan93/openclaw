import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { A2UI_PATH, CANVAS_HOST_PATH, CANVAS_WS_PATH } from "../canvas-host/a2ui.js";
import {
  __test as authzAllowEventsTest,
  listGatewayAuthzAllowEvents,
} from "./authz-allow-events.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "./authz-denied-events.js";
import { attachGatewayUpgradeHandler, createGatewayHttpServer } from "./server-http.js";

async function withTempConfig(params: { cfg: unknown; run: () => Promise<void> }): Promise<void> {
  const prevConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  const prevDisableCache = process.env.OPENCLAW_DISABLE_CONFIG_CACHE;

  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-canvas-auth-test-"));
  const configPath = path.join(dir, "openclaw.json");

  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";

  try {
    await writeFile(configPath, JSON.stringify(params.cfg, null, 2), "utf-8");
    await params.run();
  } finally {
    if (prevConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = prevConfigPath;
    }
    if (prevDisableCache === undefined) {
      delete process.env.OPENCLAW_DISABLE_CONFIG_CACHE;
    } else {
      process.env.OPENCLAW_DISABLE_CONFIG_CACHE = prevDisableCache;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function listen(server: ReturnType<typeof createGatewayHttpServer>): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

async function expectWsRejected(url: string, headers: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error("expected ws to reject"));
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      expect(res.statusCode).toBe(401);
      resolve();
    });
    ws.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function expectWsAccepted(url: string, headers: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      ws.terminate();
      resolve();
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`unexpected response ${res.statusCode}`));
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function expectWsRejectedStatus(
  url: string,
  headers: Record<string, string>,
  statusCode: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error("expected ws to reject"));
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      expect(res.statusCode).toBe(statusCode);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("gateway canvas host auth", () => {
  test("authorizes canvas/a2ui HTTP and canvas WS by matching an authenticated gateway ws client ip", async () => {
    authzDeniedEventsTest.clear();
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "off",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const ipA = "203.0.113.10";
          const ipB = "203.0.113.11";

          const unauthCanvas = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`,
            {
              headers: { "x-forwarded-for": ipA },
            },
          );
          expect(unauthCanvas.status).toBe(401);

          const unauthA2ui = await fetch(`http://127.0.0.1:${listener.port}${A2UI_PATH}/`, {
            headers: { "x-forwarded-for": ipA },
          });
          expect(unauthA2ui.status).toBe(401);

          await expectWsRejected(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, {
            "x-forwarded-for": ipA,
          });

          clients.add({
            socket: {} as unknown as WebSocket,
            connect: {} as never,
            connId: "c1",
            clientIp: ipA,
          });

          const authCanvas = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`, {
            headers: { "x-forwarded-for": ipA },
          });
          expect(authCanvas.status).toBe(200);
          expect(await authCanvas.text()).toBe("ok");

          const otherIpStillBlocked = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`,
            {
              headers: { "x-forwarded-for": ipB },
            },
          );
          expect(otherIpStillBlocked.status).toBe(401);

          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, {
              headers: { "x-forwarded-for": ipA },
            });
            const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
            ws.once("open", () => {
              clearTimeout(timer);
              ws.terminate();
              resolve();
            });
            ws.once("unexpected-response", (_req, res) => {
              clearTimeout(timer);
              reject(new Error(`unexpected response ${res.statusCode}`));
            });
            ws.once("error", reject);
          });

          const httpUnknownSenderDenies = listGatewayAuthzDenyEvents({
            method: "http.canvas",
            reasonCode: "UNKNOWN_SENDER",
            limit: 20,
          });
          expect(httpUnknownSenderDenies.length).toBeGreaterThan(0);

          const wsUnknownSenderDenies = listGatewayAuthzDenyEvents({
            method: "ws.canvas",
            reasonCode: "UNKNOWN_SENDER",
            limit: 20,
          });
          expect(wsUnknownSenderDenies.length).toBeGreaterThan(0);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("records allow events for local canvas HTTP/WS in strict multi-user mode", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();
    authzAllowEventsTest.clear();

    await withTempConfig({
      cfg: {
        gateway: {
          multiUser: {
            mode: "strict",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const canvasRes = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`);
          expect(canvasRes.status).toBe(200);
          expect(await canvasRes.text()).toBe("ok");

          await expectWsAccepted(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, {});

          const httpAllows = listGatewayAuthzAllowEvents({
            method: "http.canvas",
            limit: 10,
          });
          expect(httpAllows.length).toBeGreaterThan(0);
          expect(httpAllows[0]?.method).toBe("http.canvas");
          expect(typeof httpAllows[0]?.sourceIp).toBe("string");

          const wsAllows = listGatewayAuthzAllowEvents({
            method: "ws.canvas",
            limit: 10,
          });
          expect(wsAllows.length).toBeGreaterThan(0);
          expect(wsAllows[0]?.method).toBe("ws.canvas");
          expect(typeof wsAllows[0]?.sourceIp).toBe("string");
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("denies non-local canvas HTTP/WS in strict multi-user mode and records deny events", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "strict",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const remoteIp = "203.0.113.77";
          clients.add({
            socket: {} as unknown as WebSocket,
            connect: {} as never,
            connId: "c1",
            clientIp: remoteIp,
          });

          const canvasRes = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`, {
            headers: {
              authorization: "Bearer test-token",
              "x-forwarded-for": remoteIp,
            },
          });
          expect(canvasRes.status).toBe(401);

          await expectWsRejected(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, {
            authorization: "Bearer test-token",
            "x-forwarded-for": remoteIp,
          });

          const httpDenies = listGatewayAuthzDenyEvents({
            method: "http.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            sourceIp: remoteIp,
            limit: 10,
          });
          expect(httpDenies.length).toBeGreaterThan(0);

          const wsDenies = listGatewayAuthzDenyEvents({
            method: "ws.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            sourceIp: remoteIp,
            limit: 10,
          });
          expect(wsDenies.length).toBeGreaterThan(0);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("routes canvas host paths before plugin HTTP handler in strict mode", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ source: "plugin" }));
        return true;
      },
    );

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "strict",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();
        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("canvas-ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          handlePluginRequest: pluginHandler,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const sourceIp = "203.0.113.178";
          const denied = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`, {
            headers: {
              authorization: "Bearer test-token",
              "x-forwarded-for": sourceIp,
            },
          });
          expect(denied.status).toBe(401);
          expect(pluginHandler).not.toHaveBeenCalled();

          const denies = listGatewayAuthzDenyEvents({
            method: "http.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            sourceIp,
            limit: 10,
          });
          expect(denies.length).toBeGreaterThan(0);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("denies non-local encoded canvas host paths in strict multi-user mode", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "strict",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const sourceIp = "203.0.113.80";
          const canvasRes = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}%2F`, {
            headers: {
              authorization: "Bearer test-token",
              "x-forwarded-for": sourceIp,
            },
          });
          expect(canvasRes.status).toBe(401);

          const canvasResBackslash = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}%5C`,
            {
              headers: {
                authorization: "Bearer test-token",
                "x-forwarded-for": sourceIp,
              },
            },
          );
          expect(canvasResBackslash.status).toBe(401);

          const canvasResDoubleEncoded = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}%252F`,
            {
              headers: {
                authorization: "Bearer test-token",
                "x-forwarded-for": sourceIp,
              },
            },
          );
          expect(canvasResDoubleEncoded.status).toBe(401);

          const canvasResDoubleEncodedBackslash = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}%255C`,
            {
              headers: {
                authorization: "Bearer test-token",
                "x-forwarded-for": sourceIp,
              },
            },
          );
          expect(canvasResDoubleEncodedBackslash.status).toBe(401);

          const canvasResTripleEncoded = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}%25252F`,
            {
              headers: {
                authorization: "Bearer test-token",
                "x-forwarded-for": sourceIp,
              },
            },
          );
          expect(canvasResTripleEncoded.status).toBe(401);

          const canvasResTripleEncodedBackslash = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}%25255C`,
            {
              headers: {
                authorization: "Bearer test-token",
                "x-forwarded-for": sourceIp,
              },
            },
          );
          expect(canvasResTripleEncodedBackslash.status).toBe(401);

          const httpDenies = listGatewayAuthzDenyEvents({
            method: "http.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            sourceIp,
            limit: 10,
          });
          expect(httpDenies.length).toBeGreaterThan(0);
          expect(httpDenies[0]?.method).toBe("http.canvas");
          expect(httpDenies[0]?.sourceIp).toBe(sourceIp);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("denies non-local canvas WS trailing-slash path in strict mode", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "strict",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const wsPathMatch =
              url.pathname === CANVAS_WS_PATH || url.pathname.startsWith(`${CANVAS_WS_PATH}/`);
            if (!wsPathMatch) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async () => false,
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const remoteIp = "203.0.113.78";
          await expectWsRejected(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}/`, {
            authorization: "Bearer test-token",
            "x-forwarded-for": remoteIp,
          });

          const wsDenies = listGatewayAuthzDenyEvents({
            method: "ws.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            sourceIp: remoteIp,
            limit: 10,
          });
          expect(wsDenies.length).toBeGreaterThan(0);
          expect(wsDenies[0]?.method).toBe("ws.canvas");
          expect(wsDenies[0]?.sourceIp).toBe(remoteIp);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("fails closed for encoded canvas WS path variants instead of falling through to gateway WS", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };

    await withTempConfig({
      cfg: {
        gateway: {
          multiUser: {
            mode: "off",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();
        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async () => false,
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        let gatewayWsConnections = 0;
        wss.on("connection", () => {
          gatewayWsConnections += 1;
        });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const encodedVariants = [
            "%2Fws",
            "%5Cws",
            "%252Fws",
            "%255Cws",
            "%25252Fws",
            "%25255Cws",
          ];
          for (const encodedWsSuffix of encodedVariants) {
            await expectWsRejectedStatus(
              `ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH.replace("/ws", encodedWsSuffix)}`,
              {},
              404,
            );
          }
          expect(gatewayWsConnections).toBe(0);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("fails closed for encoded canvas HTTP paths instead of falling through to plugin handlers", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    const pluginHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ source: "plugin" }));
        return true;
      },
    );

    await withTempConfig({
      cfg: {
        gateway: {
          multiUser: {
            mode: "off",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();
        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("canvas-ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          handlePluginRequest: pluginHandler,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const encodedVariants = [
            "%2Fcanvas",
            "%5Ccanvas",
            "%252Fcanvas",
            "%255Ccanvas",
            "%25252Fcanvas",
            "%25255Ccanvas",
          ];
          for (const encodedCanvasSegment of encodedVariants) {
            const res = await fetch(
              `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH.replace(
                "/canvas",
                encodedCanvasSegment,
              )}`,
              {
                headers: {
                  authorization: "Bearer test-token",
                },
              },
            );
            expect(res.status).toBe(404);
          }
          expect(pluginHandler).not.toHaveBeenCalled();
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("denies non-local canvas HTTP ws-path trailing-slash variant in strict mode", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "strict",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const wsPathMatch =
              url.pathname === CANVAS_WS_PATH || url.pathname.startsWith(`${CANVAS_WS_PATH}/`);
            if (!wsPathMatch) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ws-http-ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const remoteIp = "203.0.113.79";
          const res = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_WS_PATH}/`, {
            headers: {
              authorization: "Bearer test-token",
              "x-forwarded-for": remoteIp,
            },
          });
          expect(res.status).toBe(401);

          const httpDenies = listGatewayAuthzDenyEvents({
            method: "http.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            sourceIp: remoteIp,
            limit: 10,
          });
          expect(httpDenies.length).toBeGreaterThan(0);
          expect(httpDenies[0]?.method).toBe("http.canvas");
          expect(httpDenies[0]?.sourceIp).toBe(remoteIp);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("denies non-local canvas HTTP/WS in compat multi-user mode and records deny events", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "compat",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        try {
          const remoteIp = "203.0.113.10";
          const canvasRes = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`, {
            headers: {
              Authorization: "Bearer test-token",
              "x-forwarded-for": remoteIp,
            },
          });
          expect(canvasRes.status).toBe(401);
          await expectWsRejected(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, {
            authorization: "Bearer test-token",
            "x-forwarded-for": remoteIp,
          });

          const deniedHttp = listGatewayAuthzDenyEvents({
            method: "http.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            limit: 5,
          });
          expect(deniedHttp.some((event) => event.sourceIp === remoteIp)).toBe(true);

          const deniedWs = listGatewayAuthzDenyEvents({
            method: "ws.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            limit: 5,
          });
          expect(deniedWs.some((event) => event.sourceIp === remoteIp)).toBe(true);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);

  test("applies strict/off/strict mode changes without restart for non-local canvas HTTP/WS", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    authzDeniedEventsTest.clear();

    await withTempConfig({
      cfg: {
        gateway: {
          trustedProxies: ["127.0.0.1"],
          multiUser: {
            mode: "strict",
          },
        },
      },
      run: async () => {
        const clients = new Set<GatewayWsClient>();

        const canvasWss = new WebSocketServer({ noServer: true });
        const canvasHost: CanvasHostHandler = {
          rootDir: "test",
          close: async () => {},
          handleUpgrade: (req, socket, head) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname !== CANVAS_WS_PATH) {
              return false;
            }
            canvasWss.handleUpgrade(req, socket, head, (ws) => {
              ws.close();
            });
            return true;
          },
          handleHttpRequest: async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (
              url.pathname !== CANVAS_HOST_PATH &&
              !url.pathname.startsWith(`${CANVAS_HOST_PATH}/`)
            ) {
              return false;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
            return true;
          },
        };

        const httpServer = createGatewayHttpServer({
          canvasHost,
          clients,
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const wss = new WebSocketServer({ noServer: true });
        attachGatewayUpgradeHandler({
          httpServer,
          wss,
          canvasHost,
          clients,
          resolvedAuth,
        });

        const listener = await listen(httpServer);
        const sourceIp = "203.0.113.12";
        const httpHeaders = {
          "x-forwarded-for": sourceIp,
          Authorization: "Bearer test-token",
        };
        const wsHeaders = {
          "x-forwarded-for": sourceIp,
          authorization: "Bearer test-token",
        };
        try {
          const deniedStrict = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`,
            {
              headers: httpHeaders,
            },
          );
          expect(deniedStrict.status).toBe(401);
          await expectWsRejected(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, wsHeaders);

          const { writeConfigFile } = await import("../config/config.js");
          await writeConfigFile({
            gateway: {
              trustedProxies: ["127.0.0.1"],
              multiUser: {
                mode: "off",
              },
            },
            // oxlint-disable-next-line typescript/no-explicit-any
          } as any);

          const allowedOff = await fetch(`http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`, {
            headers: httpHeaders,
          });
          expect(allowedOff.status).toBe(200);
          expect(await allowedOff.text()).toBe("ok");
          await expectWsAccepted(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, wsHeaders);

          await writeConfigFile({
            gateway: {
              trustedProxies: ["127.0.0.1"],
              multiUser: {
                mode: "strict",
              },
            },
            // oxlint-disable-next-line typescript/no-explicit-any
          } as any);

          const deniedStrictAgain = await fetch(
            `http://127.0.0.1:${listener.port}${CANVAS_HOST_PATH}/`,
            {
              headers: httpHeaders,
            },
          );
          expect(deniedStrictAgain.status).toBe(401);
          await expectWsRejected(`ws://127.0.0.1:${listener.port}${CANVAS_WS_PATH}`, wsHeaders);

          const deniedHttpEvents = listGatewayAuthzDenyEvents({
            method: "http.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            limit: 20,
          });
          expect(deniedHttpEvents.length).toBeGreaterThanOrEqual(2);

          const deniedWsEvents = listGatewayAuthzDenyEvents({
            method: "ws.canvas",
            reasonCode: "ROLE_FORBIDDEN",
            limit: 20,
          });
          expect(deniedWsEvents.length).toBeGreaterThanOrEqual(2);
        } finally {
          await listener.close();
          canvasWss.close();
          wss.close();
        }
      },
    });
  }, 60_000);
});
