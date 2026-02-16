import { describe, expect, test, vi } from "vitest";
import { resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { drainSystemEvents, peekSystemEvents } from "../infra/system-events.js";
import {
  __test as authzAllowEventsTest,
  listGatewayAuthzAllowEvents,
} from "./authz-allow-events.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "./authz-denied-events.js";
import { createTestRegistry } from "./server/__tests__/test-utils.js";
import {
  cronIsolatedRun,
  getFreePort,
  installGatewayTestHooks,
  resetTestPluginRegistry,
  setTestPluginRegistry,
  startGatewayServer,
  testState,
  waitForSystemEvent,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const resolveMainKey = () => resolveMainSessionKeyFromConfig();

describe("gateway server hooks", () => {
  test("routes /hooks before plugin HTTP handlers", async () => {
    authzDeniedEventsTest.clear();
    const routeHandler = vi.fn(
      async (
        _req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ source: "plugin-route" }));
      },
    );
    setTestPluginRegistry(
      createTestRegistry({
        httpRoutes: [
          {
            pluginId: "demo",
            path: "/hooks/wake",
            handler: routeHandler,
            source: "demo",
          },
        ],
      }),
    );
    testState.hooksConfig = { enabled: true, token: "hook-secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        trustedProxies: ["127.0.0.1"],
        multiUser: {
          mode: "strict",
        },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": "203.0.113.198",
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");
      expect(routeHandler).not.toHaveBeenCalled();
    } finally {
      await server.close();
      resetTestPluginRegistry();
    }
  });

  test("denies non-local requests in multi-user mode and records deny events", async () => {
    authzDeniedEventsTest.clear();
    testState.hooksConfig = { enabled: true, token: "hook-secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        trustedProxies: ["127.0.0.1"],
        multiUser: {
          mode: "strict",
        },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": "203.0.113.99",
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");

      const events = listGatewayAuthzDenyEvents({
        method: "http.hooks",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.hooks");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(typeof events[0]?.sourceIp).toBe("string");
    } finally {
      await server.close();
    }
  });

  test("denies non-local encoded hook paths in strict mode and records deny events", async () => {
    authzDeniedEventsTest.clear();
    testState.hooksConfig = { enabled: true, token: "hook-secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: {
          mode: "strict",
        },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const sourceIp = "203.0.113.102";
      const res = await fetch(`http://127.0.0.1:${port}/hooks%2Fwake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": sourceIp,
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");

      const resBackslash = await fetch(`http://127.0.0.1:${port}/hooks%5Cwake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": sourceIp,
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(resBackslash.status).toBe(403);
      const bodyBackslash = (await resBackslash.json()) as { error?: { type?: string } };
      expect(bodyBackslash.error?.type).toBe("forbidden");

      const resDoubleEncoded = await fetch(`http://127.0.0.1:${port}/hooks%252Fwake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": sourceIp,
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(resDoubleEncoded.status).toBe(403);
      const bodyDoubleEncoded = (await resDoubleEncoded.json()) as { error?: { type?: string } };
      expect(bodyDoubleEncoded.error?.type).toBe("forbidden");

      const resDoubleEncodedBackslash = await fetch(`http://127.0.0.1:${port}/hooks%255Cwake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": sourceIp,
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(resDoubleEncodedBackslash.status).toBe(403);
      const bodyDoubleEncodedBackslash = (await resDoubleEncodedBackslash.json()) as {
        error?: { type?: string };
      };
      expect(bodyDoubleEncodedBackslash.error?.type).toBe("forbidden");

      const resTripleEncoded = await fetch(`http://127.0.0.1:${port}/hooks%25252Fwake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": sourceIp,
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(resTripleEncoded.status).toBe(403);
      const bodyTripleEncoded = (await resTripleEncoded.json()) as { error?: { type?: string } };
      expect(bodyTripleEncoded.error?.type).toBe("forbidden");

      const resTripleEncodedBackslash = await fetch(`http://127.0.0.1:${port}/hooks%25255Cwake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": sourceIp,
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(resTripleEncodedBackslash.status).toBe(403);
      const bodyTripleEncodedBackslash = (await resTripleEncodedBackslash.json()) as {
        error?: { type?: string };
      };
      expect(bodyTripleEncodedBackslash.error?.type).toBe("forbidden");

      const events = listGatewayAuthzDenyEvents({
        method: "http.hooks",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.hooks");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(typeof events[0]?.sourceIp).toBe("string");
    } finally {
      await server.close();
    }
  });

  test("denies non-local requests in compat mode and records deny events", async () => {
    authzDeniedEventsTest.clear();
    testState.hooksConfig = { enabled: true, token: "hook-secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: {
          mode: "compat",
        },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
          "x-forwarded-for": "203.0.113.101",
        },
        body: JSON.stringify({ text: "nope" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("forbidden");

      const events = listGatewayAuthzDenyEvents({
        method: "http.hooks",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.hooks");
      expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(typeof events[0]?.sourceIp).toBe("string");
    } finally {
      await server.close();
    }
  });

  test("applies strict/off/strict mode changes without restart for non-local hook requests", async () => {
    authzDeniedEventsTest.clear();
    testState.hooksConfig = { enabled: true, token: "hook-secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: {
          mode: "strict",
        },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port);
    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer hook-secret",
      "x-forwarded-for": "203.0.113.100",
    };
    try {
      const deniedStrict = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "blocked" }),
      });
      expect(deniedStrict.status).toBe(403);
      const deniedStrictBody = (await deniedStrict.json()) as { error?: { type?: string } };
      expect(deniedStrictBody.error?.type).toBe("forbidden");

      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "off",
          },
        },
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any);

      const allowedOff = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "allowed" }),
      });
      expect(allowedOff.status).toBe(200);
      const allowedOffBody = (await allowedOff.json()) as { ok?: boolean };
      expect(allowedOffBody.ok).toBe(true);

      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
          },
        },
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any);

      const deniedStrictAgain = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "blocked-again" }),
      });
      expect(deniedStrictAgain.status).toBe(403);
      const deniedStrictAgainBody = (await deniedStrictAgain.json()) as {
        error?: { type?: string };
      };
      expect(deniedStrictAgainBody.error?.type).toBe("forbidden");

      const denyEvents = listGatewayAuthzDenyEvents({
        method: "http.hooks",
        reasonCode: "ROLE_FORBIDDEN",
        limit: 20,
      });
      expect(denyEvents.length).toBeGreaterThanOrEqual(2);
    } finally {
      await server.close();
    }
  });

  test("records allow events for local hook requests in strict mode", async () => {
    authzDeniedEventsTest.clear();
    authzAllowEventsTest.clear();
    testState.hooksConfig = { enabled: true, token: "hook-secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: {
          mode: "strict",
        },
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ text: "allow-local" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);

      const events = listGatewayAuthzAllowEvents({
        method: "http.hooks",
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.method).toBe("http.hooks");
      expect(events[0]?.clientMode).toBe("http");
      expect(typeof events[0]?.sourceIp).toBe("string");
    } finally {
      await server.close();
    }
  });

  test("handles auth, wake, and agent flows", async () => {
    authzDeniedEventsTest.clear();
    testState.hooksConfig = { enabled: true, token: "hook-secret" };
    testState.agentsConfig = {
      list: [{ id: "main", default: true }, { id: "hooks" }],
    };
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const resNoAuth = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Ping" }),
      });
      expect(resNoAuth.status).toBe(401);
      const deniedNoAuthEvents = listGatewayAuthzDenyEvents({
        method: "http.hooks",
        reasonCode: "UNKNOWN_SENDER",
        limit: 10,
      });
      expect(deniedNoAuthEvents.length).toBeGreaterThan(0);

      const resWake = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ text: "Ping", mode: "next-heartbeat" }),
      });
      expect(resWake.status).toBe(200);
      const wakeEvents = await waitForSystemEvent();
      expect(wakeEvents.some((e) => e.includes("Ping"))).toBe(true);
      drainSystemEvents(resolveMainKey());

      cronIsolatedRun.mockReset();
      cronIsolatedRun.mockResolvedValueOnce({
        status: "ok",
        summary: "done",
      });
      const resAgent = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "Do it", name: "Email" }),
      });
      expect(resAgent.status).toBe(202);
      const agentEvents = await waitForSystemEvent();
      expect(agentEvents.some((e) => e.includes("Hook Email: done"))).toBe(true);
      drainSystemEvents(resolveMainKey());

      cronIsolatedRun.mockReset();
      cronIsolatedRun.mockResolvedValueOnce({
        status: "ok",
        summary: "done",
      });
      const resAgentModel = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({
          message: "Do it",
          name: "Email",
          model: "openai/gpt-4.1-mini",
        }),
      });
      expect(resAgentModel.status).toBe(202);
      await waitForSystemEvent();
      const call = cronIsolatedRun.mock.calls[0]?.[0] as {
        job?: { payload?: { model?: string } };
      };
      expect(call?.job?.payload?.model).toBe("openai/gpt-4.1-mini");
      drainSystemEvents(resolveMainKey());

      cronIsolatedRun.mockReset();
      cronIsolatedRun.mockResolvedValueOnce({
        status: "ok",
        summary: "done",
      });
      const resAgentWithId = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "Do it", name: "Email", agentId: "hooks" }),
      });
      expect(resAgentWithId.status).toBe(202);
      await waitForSystemEvent();
      const routedCall = cronIsolatedRun.mock.calls[0]?.[0] as {
        job?: { agentId?: string };
      };
      expect(routedCall?.job?.agentId).toBe("hooks");
      drainSystemEvents(resolveMainKey());

      cronIsolatedRun.mockReset();
      cronIsolatedRun.mockResolvedValueOnce({
        status: "ok",
        summary: "done",
      });
      const resAgentUnknown = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "Do it", name: "Email", agentId: "missing-agent" }),
      });
      expect(resAgentUnknown.status).toBe(202);
      await waitForSystemEvent();
      const fallbackCall = cronIsolatedRun.mock.calls[0]?.[0] as {
        job?: { agentId?: string };
      };
      expect(fallbackCall?.job?.agentId).toBe("main");
      drainSystemEvents(resolveMainKey());

      const resQuery = await fetch(`http://127.0.0.1:${port}/hooks/wake?token=hook-secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Query auth" }),
      });
      expect(resQuery.status).toBe(400);
      const queryTokenDenies = listGatewayAuthzDenyEvents({
        method: "http.hooks",
        reasonCode: "UNKNOWN_SENDER",
        limit: 20,
      });
      expect(
        queryTokenDenies.some((event) =>
          String(event.errorMessage ?? "").includes("query token is not allowed"),
        ),
      ).toBe(true);

      const resBadChannel = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "Nope", channel: "sms" }),
      });
      expect(resBadChannel.status).toBe(400);
      expect(peekSystemEvents(resolveMainKey()).length).toBe(0);

      const resHeader = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openclaw-token": "hook-secret",
        },
        body: JSON.stringify({ text: "Header auth" }),
      });
      expect(resHeader.status).toBe(200);
      const headerEvents = await waitForSystemEvent();
      expect(headerEvents.some((e) => e.includes("Header auth"))).toBe(true);
      drainSystemEvents(resolveMainKey());

      const resGet = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "GET",
        headers: { Authorization: "Bearer hook-secret" },
      });
      expect(resGet.status).toBe(405);

      const resBlankText = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ text: " " }),
      });
      expect(resBlankText.status).toBe(400);

      const resBlankMessage = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: " " }),
      });
      expect(resBlankMessage.status).toBe(400);

      const resBadJson = await fetch(`http://127.0.0.1:${port}/hooks/wake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: "{",
      });
      expect(resBadJson.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  test("enforces hooks.allowedAgentIds for explicit agent routing", async () => {
    testState.hooksConfig = {
      enabled: true,
      token: "hook-secret",
      allowedAgentIds: ["hooks"],
      mappings: [
        {
          match: { path: "mapped" },
          action: "agent",
          agentId: "main",
          messageTemplate: "Mapped: {{payload.subject}}",
        },
      ],
    };
    testState.agentsConfig = {
      list: [{ id: "main", default: true }, { id: "hooks" }],
    };
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      cronIsolatedRun.mockReset();
      cronIsolatedRun.mockResolvedValueOnce({
        status: "ok",
        summary: "done",
      });
      const resNoAgent = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "No explicit agent" }),
      });
      expect(resNoAgent.status).toBe(202);
      await waitForSystemEvent();
      const noAgentCall = cronIsolatedRun.mock.calls[0]?.[0] as {
        job?: { agentId?: string };
      };
      expect(noAgentCall?.job?.agentId).toBeUndefined();
      drainSystemEvents(resolveMainKey());

      cronIsolatedRun.mockReset();
      cronIsolatedRun.mockResolvedValueOnce({
        status: "ok",
        summary: "done",
      });
      const resAllowed = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "Allowed", agentId: "hooks" }),
      });
      expect(resAllowed.status).toBe(202);
      await waitForSystemEvent();
      const allowedCall = cronIsolatedRun.mock.calls[0]?.[0] as {
        job?: { agentId?: string };
      };
      expect(allowedCall?.job?.agentId).toBe("hooks");
      drainSystemEvents(resolveMainKey());

      const resDenied = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "Denied", agentId: "main" }),
      });
      expect(resDenied.status).toBe(400);
      const deniedBody = (await resDenied.json()) as { error?: string };
      expect(deniedBody.error).toContain("hooks.allowedAgentIds");

      const resMappedDenied = await fetch(`http://127.0.0.1:${port}/hooks/mapped`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ subject: "hello" }),
      });
      expect(resMappedDenied.status).toBe(400);
      const mappedDeniedBody = (await resMappedDenied.json()) as { error?: string };
      expect(mappedDeniedBody.error).toContain("hooks.allowedAgentIds");
      expect(peekSystemEvents(resolveMainKey()).length).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("denies explicit agentId when hooks.allowedAgentIds is empty", async () => {
    testState.hooksConfig = {
      enabled: true,
      token: "hook-secret",
      allowedAgentIds: [],
    };
    testState.agentsConfig = {
      list: [{ id: "main", default: true }, { id: "hooks" }],
    };
    const port = await getFreePort();
    const server = await startGatewayServer(port);
    try {
      const resDenied = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hook-secret",
        },
        body: JSON.stringify({ message: "Denied", agentId: "hooks" }),
      });
      expect(resDenied.status).toBe(400);
      const deniedBody = (await resDenied.json()) as { error?: string };
      expect(deniedBody.error).toContain("hooks.allowedAgentIds");
      expect(peekSystemEvents(resolveMainKey()).length).toBe(0);
    } finally {
      await server.close();
    }
  });
});
