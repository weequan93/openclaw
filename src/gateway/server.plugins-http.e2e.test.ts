import { describe, expect, test, vi } from "vitest";
import {
  __test as authzAllowEventsTest,
  listGatewayAuthzAllowEvents,
} from "./authz-allow-events.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "./authz-denied-events.js";
import { callGateway } from "./call.js";
import { createTestRegistry } from "./server/__tests__/test-utils.js";
import {
  getFreePort,
  installGatewayTestHooks,
  resetTestPluginRegistry,
  setTestPluginRegistry,
  startGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

describe("gateway plugin http routing (e2e)", () => {
  test("denies non-local plugin admin routes in strict mode and records deny events", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels/demo/config",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.42",
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");
      expect(routeHandler).not.toHaveBeenCalled();

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe("203.0.113.42");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("denies non-local encoded plugin admin paths in strict mode", async () => {
    authzDeniedEventsTest.clear();
    const handler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
        return true;
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpHandlers: [
          {
            pluginId: "demo",
            handler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const sourceIp = "203.0.113.50";
      const res = await fetch(`http://127.0.0.1:${port}/api/channels%2Fdemo%2Fconfig`, {
        method: "GET",
        headers: {
          "x-forwarded-for": sourceIp,
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");
      expect(handler).not.toHaveBeenCalled();

      const resBackslash = await fetch(`http://127.0.0.1:${port}/api/channels%5Cdemo%5Cconfig`, {
        method: "GET",
        headers: {
          "x-forwarded-for": sourceIp,
          Authorization: "Bearer secret",
        },
      });
      expect(resBackslash.status).toBe(403);
      const bodyBackslash = (await resBackslash.json()) as { error?: { type?: string } };
      expect(bodyBackslash.error?.type).toBe("forbidden");
      expect(handler).not.toHaveBeenCalled();

      const resDoubleEncoded = await fetch(
        `http://127.0.0.1:${port}/api/channels%252Fdemo%252Fconfig`,
        {
          method: "GET",
          headers: {
            "x-forwarded-for": sourceIp,
            Authorization: "Bearer secret",
          },
        },
      );
      expect(resDoubleEncoded.status).toBe(403);
      const bodyDoubleEncoded = (await resDoubleEncoded.json()) as { error?: { type?: string } };
      expect(bodyDoubleEncoded.error?.type).toBe("forbidden");
      expect(handler).not.toHaveBeenCalled();

      const resDoubleEncodedBackslash = await fetch(
        `http://127.0.0.1:${port}/api/channels%255Cdemo%255Cconfig`,
        {
          method: "GET",
          headers: {
            "x-forwarded-for": sourceIp,
            Authorization: "Bearer secret",
          },
        },
      );
      expect(resDoubleEncodedBackslash.status).toBe(403);
      const bodyDoubleEncodedBackslash = (await resDoubleEncodedBackslash.json()) as {
        error?: { type?: string };
      };
      expect(bodyDoubleEncodedBackslash.error?.type).toBe("forbidden");
      expect(handler).not.toHaveBeenCalled();

      const resTripleEncoded = await fetch(
        `http://127.0.0.1:${port}/api%25252Fchannels%25252Fdemo%25252Fconfig`,
        {
          method: "GET",
          headers: {
            "x-forwarded-for": sourceIp,
            Authorization: "Bearer secret",
          },
        },
      );
      expect(resTripleEncoded.status).toBe(403);
      const bodyTripleEncoded = (await resTripleEncoded.json()) as { error?: { type?: string } };
      expect(bodyTripleEncoded.error?.type).toBe("forbidden");
      expect(handler).not.toHaveBeenCalled();

      const resTripleEncodedBackslash = await fetch(
        `http://127.0.0.1:${port}/api/channels%25255Cdemo%25255Cconfig`,
        {
          method: "GET",
          headers: {
            "x-forwarded-for": sourceIp,
            Authorization: "Bearer secret",
          },
        },
      );
      expect(resTripleEncodedBackslash.status).toBe(403);
      const bodyTripleEncodedBackslash = (await resTripleEncodedBackslash.json()) as {
        error?: { type?: string };
      };
      expect(bodyTripleEncodedBackslash.error?.type).toBe("forbidden");
      expect(handler).not.toHaveBeenCalled();

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe(sourceIp);
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("treats /api/channels root as plugin admin path in strict mode", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.49",
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");
      expect(routeHandler).not.toHaveBeenCalled();

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe("203.0.113.49");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("enforces /api/channels root boundary in strict mode even with empty plugin registry", async () => {
    authzDeniedEventsTest.clear();
    setTestPluginRegistry(createTestRegistry());

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.57",
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe("203.0.113.57");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("enforces /api/channels/ trailing-slash boundary in strict mode even with empty plugin registry", async () => {
    authzDeniedEventsTest.clear();
    setTestPluginRegistry(createTestRegistry());

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels/`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.58",
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe("203.0.113.58");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("denies non-local /api/channels root in compat mode", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "compat" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.46",
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");
      expect(routeHandler).not.toHaveBeenCalled();

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe("203.0.113.46");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("denies non-local /api/channels/ trailing slash in compat mode", async () => {
    authzDeniedEventsTest.clear();
    setTestPluginRegistry(createTestRegistry());

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "compat" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels/`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.47",
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe("203.0.113.47");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("denies non-local plugin admin routes in compat mode and records deny events", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels/demo/config",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "compat" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.44",
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");
      expect(routeHandler).not.toHaveBeenCalled();

      const events = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(events[0]?.sourceIp).toBe("203.0.113.44");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("applies strict/off/strict mode changes without restart for non-local plugin admin routes", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels/demo/config",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    const headers = {
      "x-forwarded-for": "203.0.113.43",
      Authorization: "Bearer secret",
    };
    try {
      const deniedStrict = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
        method: "GET",
        headers,
      });
      expect(deniedStrict.status).toBe(403);
      const deniedStrictBody = (await deniedStrict.json()) as { error?: { type?: string } };
      expect(deniedStrictBody.error?.type).toBe("forbidden");
      expect(routeHandler).not.toHaveBeenCalled();

      await writeConfigFile({
        gateway: {
          multiUser: { mode: "off" },
          trustedProxies: ["127.0.0.1"],
        },
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any);

      const allowedOff = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
        method: "GET",
        headers,
      });
      expect(allowedOff.status).toBe(200);
      const allowedOffBody = (await allowedOff.json()) as { ok?: boolean };
      expect(allowedOffBody.ok).toBe(true);
      expect(routeHandler).toHaveBeenCalledTimes(1);

      await writeConfigFile({
        gateway: {
          multiUser: { mode: "strict" },
          trustedProxies: ["127.0.0.1"],
        },
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any);

      const deniedStrictAgain = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
        method: "GET",
        headers,
      });
      expect(deniedStrictAgain.status).toBe(403);
      const deniedStrictAgainBody = (await deniedStrictAgain.json()) as {
        error?: { type?: string };
      };
      expect(deniedStrictAgainBody.error?.type).toBe("forbidden");
      expect(routeHandler).toHaveBeenCalledTimes(1);

      const denyEvents = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 20,
      });
      expect(denyEvents.length).toBeGreaterThanOrEqual(2);
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("allows local plugin admin routes in strict mode", async () => {
    authzAllowEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels/demo/config",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
        method: "GET",
        headers: {
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);
      expect(routeHandler).toHaveBeenCalledTimes(1);

      const events = listGatewayAuthzAllowEvents({
        method: "http.plugin",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.clientMode).toBe("http");
      expect(typeof events[0]?.sourceIp).toBe("string");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("allows local /api/channels root in strict mode and records allow events", async () => {
    authzAllowEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels`, {
        method: "GET",
        headers: {
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);
      expect(routeHandler).toHaveBeenCalledTimes(1);

      const events = listGatewayAuthzAllowEvents({
        method: "http.plugin",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.clientMode).toBe("http");
      expect(typeof events[0]?.sourceIp).toBe("string");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("allows local /api/channels/ trailing-slash route in strict mode and records allow events", async () => {
    authzAllowEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels/",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels/`, {
        method: "GET",
        headers: {
          Authorization: "Bearer secret",
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);
      expect(routeHandler).toHaveBeenCalledTimes(1);

      const events = listGatewayAuthzAllowEvents({
        method: "http.plugin",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.plugin");
      expect(events[0]?.clientMode).toBe("http");
      expect(typeof events[0]?.sourceIp).toBe("string");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("denies local plugin admin routes without gateway auth and records UNKNOWN_SENDER", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels/demo/config",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
        method: "GET",
      });
      expect(denied.status).toBe(401);
      const deniedBody = (await denied.json()) as { error?: { message?: string; type?: string } };
      expect(deniedBody.error?.type).toBe("unauthorized");
      expect(routeHandler).not.toHaveBeenCalled();

      const denyEvents = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "UNKNOWN_SENDER",
        limit: 10,
      });
      expect(denyEvents.length).toBeGreaterThan(0);
      expect(denyEvents[0]?.method).toBe("http.plugin");
      expect(denyEvents[0]?.reasonCode).toBe("UNKNOWN_SENDER");
      expect(denyEvents[0]?.errorMessage).toContain("token missing or invalid");
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("denies local /api/channels root and trailing slash without gateway auth", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels",
            handler: routeHandler,
            source: "demo",
          },
          {
            pluginId: "demo",
            path: "/api/channels/",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const deniedRoot = await fetch(`http://127.0.0.1:${port}/api/channels`, {
        method: "GET",
      });
      expect(deniedRoot.status).toBe(401);
      const deniedRootBody = (await deniedRoot.json()) as {
        error?: { message?: string; type?: string };
      };
      expect(deniedRootBody.error?.type).toBe("unauthorized");

      const deniedTrailing = await fetch(`http://127.0.0.1:${port}/api/channels/`, {
        method: "GET",
      });
      expect(deniedTrailing.status).toBe(401);
      const deniedTrailingBody = (await deniedTrailing.json()) as {
        error?: { message?: string; type?: string };
      };
      expect(deniedTrailingBody.error?.type).toBe("unauthorized");
      expect(routeHandler).not.toHaveBeenCalled();

      const denyEvents = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "UNKNOWN_SENDER",
        limit: 20,
      });
      expect(denyEvents.length).toBeGreaterThan(0);
      expect(
        denyEvents.some((event) => String(event.errorMessage ?? "").includes("token missing")),
      ).toBe(true);
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("allows non-local plugin webhook routes outside /api/channels in strict mode", async () => {
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/webhooks/demo",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/webhooks/demo`, {
        method: "GET",
        headers: {
          "x-forwarded-for": "198.51.100.25",
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);
      expect(routeHandler).toHaveBeenCalledTimes(1);
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("authz.denied.summary includes source-IP buckets for plugin deny events", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/api/channels/demo/config",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
        trustedProxies: ["127.0.0.1"],
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const sourceIp = "203.0.113.88";
      for (let i = 0; i < 2; i += 1) {
        const denied = await fetch(`http://127.0.0.1:${port}/api/channels/demo/config`, {
          method: "GET",
          headers: {
            "x-forwarded-for": sourceIp,
            Authorization: "Bearer secret",
          },
        });
        expect(denied.status).toBe(403);
      }

      const summary = await callGateway<{
        total?: number;
        bySourceIp?: Array<{ key?: string; count?: number }>;
        highFrequency?: {
          threshold?: number;
          sourceIps?: Array<{ key?: string; count?: number }>;
        };
      }>({
        url: `ws://127.0.0.1:${port}`,
        token: "secret",
        method: "authz.denied.summary",
        params: {
          method: "http.plugin",
          reasonCode: "ROLE_FORBIDDEN",
          topN: 5,
          alertThreshold: 2,
        },
      });

      expect(summary.total).toBeGreaterThanOrEqual(2);
      expect(summary.bySourceIp?.some((entry) => entry.key === sourceIp && entry.count === 2)).toBe(
        true,
      );
      expect(summary.highFrequency?.threshold).toBe(2);
      expect(
        summary.highFrequency?.sourceIps?.some(
          (entry) => entry.key === sourceIp && entry.count === 2,
        ),
      ).toBe(true);
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });

  test("records UNKNOWN_SENDER when plugin admin route handler returns 401 after gateway auth", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
        const auth = String(req.headers.authorization ?? "");
        if (auth !== "Bearer profile-secret") {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "nostr",
            path: "/api/channels/nostr/default/profile",
            handler: routeHandler,
            source: "nostr",
          },
        ],
      }),
    );

    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: { mode: "strict" },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      host: "127.0.0.1",
      auth: { mode: "token", token: "secret" },
      controlUiEnabled: false,
    });
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/api/channels/nostr/default/profile`, {
        method: "GET",
        headers: {
          "x-openclaw-token": "secret",
        },
      });
      expect(denied.status).toBe(401);
      const deniedBody = (await denied.json()) as { error?: string };
      expect(deniedBody.error).toContain("Unauthorized");

      const denyEvents = listGatewayAuthzDenyEvents({
        method: "http.plugin",
        reasonCode: "UNKNOWN_SENDER",
        limit: 10,
      });
      expect(denyEvents.length).toBeGreaterThan(0);
      expect(denyEvents[0]?.method).toBe("http.plugin");
      expect(denyEvents[0]?.reasonCode).toBe("UNKNOWN_SENDER");

      const allowed = await fetch(`http://127.0.0.1:${port}/api/channels/nostr/default/profile`, {
        method: "GET",
        headers: {
          "x-openclaw-token": "secret",
          Authorization: "Bearer profile-secret",
        },
      });
      expect(allowed.status).toBe(200);
      const allowedBody = (await allowed.json()) as { ok?: boolean };
      expect(allowedBody.ok).toBe(true);
      expect(routeHandler).toHaveBeenCalledTimes(2);
    } finally {
      await server.close({ reason: "test done" });
      resetTestPluginRegistry();
    }
  });
});
