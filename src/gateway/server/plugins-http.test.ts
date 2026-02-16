import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "../authz-denied-events.js";
import { createTestRegistry } from "./__tests__/test-utils.js";
import { createGatewayPluginRequestHandler } from "./plugins-http.js";

const gatewayAuth: Parameters<typeof createGatewayPluginRequestHandler>[0]["auth"] = {
  mode: "token",
  token: "secret",
  allowTailscale: false,
};

const makeResponse = (): {
  res: ServerResponse;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} => {
  const setHeader = vi.fn();
  const end = vi.fn();
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader,
    end,
  } as unknown as ServerResponse;
  return { res, setHeader, end };
};

describe("createGatewayPluginRequestHandler", () => {
  it("returns false when no handlers are registered", async () => {
    const log = { warn: vi.fn() } as unknown as Parameters<
      typeof createGatewayPluginRequestHandler
    >[0]["log"];
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry(),
      auth: gatewayAuth,
      log,
    });
    const { res } = makeResponse();
    const handled = await handler({} as IncomingMessage, res);
    expect(handled).toBe(false);
  });

  it("denies non-local /api/channels root even when no plugin handlers are registered", async () => {
    authzDeniedEventsTest.clear();
    const log = { warn: vi.fn() } as unknown as Parameters<
      typeof createGatewayPluginRequestHandler
    >[0]["log"];
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry(),
      auth: gatewayAuth,
      log,
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });
    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.95",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.11" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.11");
  });

  it("denies local /api/channels root without token even when no plugin handlers are registered", async () => {
    authzDeniedEventsTest.clear();
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry(),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "off" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });
    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels",
        headers: {
          host: "localhost",
        },
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse((end.mock.calls[0] ?? [])[0] as string)).toEqual({
      error: { message: "Unauthorized", type: "unauthorized" },
    });

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "UNKNOWN_SENDER",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("continues until a handler reports it handled the request", async () => {
    const first = vi.fn(async () => false);
    const second = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [
          { pluginId: "first", handler: first, source: "first" },
          { pluginId: "second", handler: second, source: "second" },
        ],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
    });

    const { res } = makeResponse();
    const handled = await handler({} as IncomingMessage, res);
    expect(handled).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("handles registered http routes before generic handlers", async () => {
    const routeHandler = vi.fn(async (_req, res: ServerResponse) => {
      res.statusCode = 200;
    });
    const fallback = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpRoutes: [
          {
            pluginId: "route",
            path: "/demo",
            handler: routeHandler,
            source: "route",
          },
        ],
        httpHandlers: [{ pluginId: "fallback", handler: fallback, source: "fallback" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
    });

    const { res } = makeResponse();
    const handled = await handler({ url: "/demo" } as IncomingMessage, res);
    expect(handled).toBe(true);
    expect(routeHandler).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("logs and responds with 500 when a handler throws", async () => {
    const log = { warn: vi.fn() } as unknown as Parameters<
      typeof createGatewayPluginRequestHandler
    >[0]["log"];
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [
          {
            pluginId: "boom",
            handler: async () => {
              throw new Error("boom");
            },
            source: "boom",
          },
        ],
      }),
      auth: gatewayAuth,
      log,
    });

    const { res, setHeader, end } = makeResponse();
    const handled = await handler({} as IncomingMessage, res);
    expect(handled).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(res.statusCode).toBe(500);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
    expect(end).toHaveBeenCalledWith("Internal Server Error");
  });

  it("denies non-local plugin admin routes in strict mode and records deny events", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels/nostr/default/profile",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.77",
        },
        socket: { remoteAddress: "203.0.113.7" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.7");
  });

  it("treats /api/channels root as plugin admin path for local-admin deny checks", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.91",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.9" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.9");
  });

  it("treats /api/channels/ trailing slash as plugin admin path for local-admin deny checks", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels/",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.92",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.10" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.10");
  });

  it("treats encoded /api/channels%2F... path as plugin admin path for local-admin deny checks", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels%2Fnostr%2Fdefault%2Fprofile",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.93",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.12" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.12");
  });

  it("treats encoded /api/channels%5C... path as plugin admin path for local-admin deny checks", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels%5Cnostr%5Cdefault%5Cprofile",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.94",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.13" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.13");
  });

  it("treats double-encoded /api/channels%252F... path as plugin admin path for local-admin deny checks", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels%252Fnostr%252Fdefault%252Fprofile",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.95",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.14" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.14");
  });

  it("treats triple-encoded /api%25252Fchannels... path as plugin admin path for local-admin deny checks", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api%25252Fchannels%25252Fnostr%25252Fdefault%25252Fprofile",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.97",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.16" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.16");
  });

  it("treats double-encoded /api/channels%255C... path as plugin admin path for local-admin deny checks", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "strict" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels%255Cnostr%255Cdefault%255Cprofile",
        headers: {
          host: "gateway.example.com",
          "x-forwarded-for": "203.0.113.96",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "203.0.113.15" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    const body = JSON.parse((end.mock.calls[0] ?? [])[0] as string) as {
      ok?: boolean;
      error?: { type?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("forbidden");

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "ROLE_FORBIDDEN",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.sourceIp).toBe("203.0.113.15");
  });

  it("denies plugin admin routes without gateway auth and records UNKNOWN_SENDER", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "off" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels/nostr/default/profile",
        headers: {
          host: "localhost",
        },
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(JSON.parse((end.mock.calls[0] ?? [])[0] as string)).toEqual({
      error: { message: "Unauthorized", type: "unauthorized" },
    });

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "UNKNOWN_SENDER",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
    expect(events[0]?.errorMessage).toContain("token missing or invalid");
  });

  it("treats /api/channels root as plugin admin path for gateway auth", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "off" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res, end } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels",
        headers: {
          host: "localhost",
        },
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(JSON.parse((end.mock.calls[0] ?? [])[0] as string)).toEqual({
      error: { message: "Unauthorized", type: "unauthorized" },
    });

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "UNKNOWN_SENDER",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records unauthorized plugin admin route responses as UNKNOWN_SENDER", async () => {
    authzDeniedEventsTest.clear();
    const pluginHandler = vi.fn(async (_req, res: ServerResponse) => {
      res.statusCode = 401;
      res.end("unauthorized");
      return true;
    });
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpHandlers: [{ pluginId: "nostr", handler: pluginHandler, source: "nostr" }],
      }),
      auth: gatewayAuth,
      log: { warn: vi.fn() } as unknown as Parameters<
        typeof createGatewayPluginRequestHandler
      >[0]["log"],
      getConfig: () =>
        ({
          gateway: {
            multiUser: { mode: "off" },
          },
        }) as ReturnType<typeof import("../../config/config.js").loadConfig>,
    });

    const { res } = makeResponse();
    const handled = await handler(
      {
        url: "/api/channels/nostr/default/profile",
        headers: {
          host: "localhost",
          "x-openclaw-token": "secret",
        },
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage,
      res,
    );
    expect(handled).toBe(true);
    expect(pluginHandler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(401);

    const events = listGatewayAuthzDenyEvents({
      method: "http.plugin",
      reasonCode: "UNKNOWN_SENDER",
      limit: 10,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.method).toBe("http.plugin");
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });
});
