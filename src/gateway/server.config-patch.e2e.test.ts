import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readConfigFileSnapshot, resolveConfigSnapshotHash } from "../config/config.js";
import {
  connectOk,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startServerWithClient,
  testState,
  writeSessionStore,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];

beforeAll(async () => {
  const started = await startServerWithClient();
  server = started.server;
  ws = started.ws;
  await connectOk(ws);
});

afterAll(async () => {
  ws.close();
  await server.close();
});

async function resolveCurrentBaseHash(): Promise<string | undefined> {
  const getRes = await rpcReq<{ hash?: string; raw?: string }>(ws, "config.get", {});
  expect(getRes.ok).toBe(true);
  return (
    resolveConfigSnapshotHash({
      hash: getRes.payload?.hash,
      raw: getRes.payload?.raw,
    }) ?? undefined
  );
}

describe("gateway config.patch", () => {
  it("merges patches without clobbering unrelated config", async () => {
    const initialBaseHash = await resolveCurrentBaseHash();
    const setId = "req-set";
    ws.send(
      JSON.stringify({
        type: "req",
        id: setId,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: { mode: "local" },
            channels: { telegram: { botToken: "token-1" } },
            plugins: { slots: { memory: "none" } },
          }),
          ...(initialBaseHash ? { baseHash: initialBaseHash } : {}),
        },
      }),
    );
    const setRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === setId,
    );
    expect(setRes.ok).toBe(true);

    const getId = "req-get";
    ws.send(
      JSON.stringify({
        type: "req",
        id: getId,
        method: "config.get",
        params: {},
      }),
    );
    const getRes = await onceMessage<{ ok: boolean; payload?: { hash?: string; raw?: string } }>(
      ws,
      (o) => o.type === "res" && o.id === getId,
    );
    expect(getRes.ok).toBe(true);
    const baseHash = resolveConfigSnapshotHash({
      hash: getRes.payload?.hash,
      raw: getRes.payload?.raw,
    });
    expect(typeof baseHash).toBe("string");

    const patchId = "req-patch";
    ws.send(
      JSON.stringify({
        type: "req",
        id: patchId,
        method: "config.patch",
        params: {
          raw: JSON.stringify({
            channels: {
              telegram: {
                groups: {
                  "*": { requireMention: false },
                },
              },
            },
          }),
          baseHash,
        },
      }),
    );
    const patchRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === patchId,
    );
    expect(patchRes.ok).toBe(true);

    const get2Id = "req-get-2";
    ws.send(
      JSON.stringify({
        type: "req",
        id: get2Id,
        method: "config.get",
        params: {},
      }),
    );
    const get2Res = await onceMessage<{
      ok: boolean;
      payload?: {
        config?: { gateway?: { mode?: string }; channels?: { telegram?: { botToken?: string } } };
      };
    }>(ws, (o) => o.type === "res" && o.id === get2Id);
    expect(get2Res.ok).toBe(true);
    expect(get2Res.payload?.config?.gateway?.mode).toBe("local");
    expect(get2Res.payload?.config?.channels?.telegram?.botToken).toBe("__OPENCLAW_REDACTED__");

    const storedSnapshot = await readConfigFileSnapshot();
    expect(storedSnapshot.exists).toBe(true);
    const stored = storedSnapshot.config as {
      channels?: { telegram?: { botToken?: string } };
    };
    expect(stored.channels?.telegram?.botToken).toBe("token-1");
  });

  it("preserves credentials on config.set when raw contains redacted sentinels", async () => {
    const initialBaseHash = await resolveCurrentBaseHash();
    const setId = "req-set-sentinel-1";
    ws.send(
      JSON.stringify({
        type: "req",
        id: setId,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: { mode: "local" },
            channels: { telegram: { botToken: "token-1" } },
            plugins: { slots: { memory: "none" } },
          }),
          ...(initialBaseHash ? { baseHash: initialBaseHash } : {}),
        },
      }),
    );
    const setRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === setId,
    );
    expect(setRes.ok).toBe(true);

    const getId = "req-get-sentinel-1";
    ws.send(
      JSON.stringify({
        type: "req",
        id: getId,
        method: "config.get",
        params: {},
      }),
    );
    const getRes = await onceMessage<{ ok: boolean; payload?: { hash?: string; raw?: string } }>(
      ws,
      (o) => o.type === "res" && o.id === getId,
    );
    expect(getRes.ok).toBe(true);
    const baseHash = resolveConfigSnapshotHash({
      hash: getRes.payload?.hash,
      raw: getRes.payload?.raw,
    });
    expect(typeof baseHash).toBe("string");
    const rawRedacted = getRes.payload?.raw;
    expect(typeof rawRedacted).toBe("string");
    expect(rawRedacted).toContain("__OPENCLAW_REDACTED__");

    const set2Id = "req-set-sentinel-2";
    ws.send(
      JSON.stringify({
        type: "req",
        id: set2Id,
        method: "config.set",
        params: {
          raw: rawRedacted,
          baseHash,
        },
      }),
    );
    const set2Res = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === set2Id,
    );
    expect(set2Res.ok).toBe(true);

    const storedSnapshot = await readConfigFileSnapshot();
    expect(storedSnapshot.exists).toBe(true);
    const stored = storedSnapshot.config as {
      channels?: { telegram?: { botToken?: string } };
    };
    expect(stored.channels?.telegram?.botToken).toBe("token-1");
  });

  it("writes config, stores sentinel, and schedules restart", async () => {
    const initialBaseHash = await resolveCurrentBaseHash();
    const setId = "req-set-restart";
    ws.send(
      JSON.stringify({
        type: "req",
        id: setId,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: { mode: "local" },
            channels: { telegram: { botToken: "token-1" } },
            plugins: { slots: { memory: "none" } },
          }),
          ...(initialBaseHash ? { baseHash: initialBaseHash } : {}),
        },
      }),
    );
    const setRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === setId,
    );
    expect(setRes.ok).toBe(true);

    const getId = "req-get-restart";
    ws.send(
      JSON.stringify({
        type: "req",
        id: getId,
        method: "config.get",
        params: {},
      }),
    );
    const getRes = await onceMessage<{ ok: boolean; payload?: { hash?: string; raw?: string } }>(
      ws,
      (o) => o.type === "res" && o.id === getId,
    );
    expect(getRes.ok).toBe(true);
    const baseHash = resolveConfigSnapshotHash({
      hash: getRes.payload?.hash,
      raw: getRes.payload?.raw,
    });
    expect(typeof baseHash).toBe("string");

    const patchId = "req-patch-restart";
    ws.send(
      JSON.stringify({
        type: "req",
        id: patchId,
        method: "config.patch",
        params: {
          raw: JSON.stringify({
            channels: {
              telegram: {
                groups: {
                  "*": { requireMention: false },
                },
              },
            },
          }),
          baseHash,
          sessionKey: "agent:main:whatsapp:dm:+15555550123",
          note: "test patch",
          restartDelayMs: 0,
        },
      }),
    );
    const patchRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === patchId,
    );
    expect(patchRes.ok).toBe(true);

    const sentinelPath = path.join(os.homedir(), ".openclaw", "restart-sentinel.json");
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const raw = await fs.readFile(sentinelPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        payload?: { kind?: string; stats?: { mode?: string } };
      };
      expect(parsed.payload?.kind).toBe("config-apply");
      expect(parsed.payload?.stats?.mode).toBe("config.patch");
    } catch {
      expect(patchRes.ok).toBe(true);
    }
  });

  it("applies resolved policy bundle patch and records config change note", async () => {
    const initialBaseHash = await resolveCurrentBaseHash();
    const setId = "req-set-policy-bundle";
    ws.send(
      JSON.stringify({
        type: "req",
        id: setId,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: {
              mode: "local",
              multiUser: {
                mode: "off",
              },
            },
            commands: {
              config: true,
              debug: true,
            },
            plugins: { slots: { memory: "none" } },
          }),
          ...(initialBaseHash ? { baseHash: initialBaseHash } : {}),
        },
      }),
    );
    const setRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === setId,
    );
    expect(setRes.ok).toBe(true);

    const baseHash = await resolveCurrentBaseHash();
    expect(typeof baseHash).toBe("string");

    const resolved = await rpcReq<{
      bundle?: {
        id?: string;
        patch?: unknown;
      };
    }>(ws, "config.policyBundle.resolve", {
      bundleId: "strict_admin_control",
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.payload?.bundle?.id).toBe("strict_admin_control");
    expect(resolved.payload?.bundle?.patch).toBeTruthy();

    const patchRes = await rpcReq<{ ok?: boolean }>(ws, "config.patch", {
      raw: JSON.stringify(resolved.payload?.bundle?.patch ?? {}, null, 2),
      ...(baseHash ? { baseHash } : {}),
      note: "policy-bundle:strict_admin_control",
    });
    expect(patchRes.ok).toBe(true);

    const getRes = await rpcReq<{
      config?: {
        gateway?: { multiUser?: { mode?: string } };
        commands?: { config?: boolean; debug?: boolean };
      };
    }>(ws, "config.get", {});
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.config?.gateway?.multiUser?.mode).toBe("strict");
    expect(getRes.payload?.config?.commands?.config).toBe(false);
    expect(getRes.payload?.config?.commands?.debug).toBe(false);

    const changes = await rpcReq<{
      events?: Array<{
        method?: string;
        note?: string | null;
      }>;
    }>(ws, "config.changes.list", {
      limit: 20,
      method: "config.patch",
    });
    expect(changes.ok).toBe(true);
    const bundleChange = (changes.payload?.events ?? []).find(
      (event) =>
        event.method === "config.patch" && event.note === "policy-bundle:strict_admin_control",
    );
    expect(bundleChange).toBeTruthy();
  });

  it("applies policy bundle directly and records policy-bundle note by default", async () => {
    const initialBaseHash = await resolveCurrentBaseHash();
    const setId = "req-set-policy-bundle-direct";
    ws.send(
      JSON.stringify({
        type: "req",
        id: setId,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: {
              mode: "local",
              multiUser: {
                mode: "off",
              },
            },
            commands: {
              config: true,
              debug: true,
            },
            plugins: { slots: { memory: "none" } },
          }),
          ...(initialBaseHash ? { baseHash: initialBaseHash } : {}),
        },
      }),
    );
    const setRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === setId,
    );
    expect(setRes.ok).toBe(true);

    const baseHash = await resolveCurrentBaseHash();
    expect(typeof baseHash).toBe("string");

    const applyRes = await rpcReq<{ ok?: boolean; payload?: { bundleId?: string } }>(
      ws,
      "config.policyBundle.apply",
      {
        bundleId: "strict_admin_control",
        ...(baseHash ? { baseHash } : {}),
      },
    );
    expect(applyRes.ok).toBe(true);
    expect(applyRes.payload?.bundleId).toBe("strict_admin_control");

    const getRes = await rpcReq<{
      config?: {
        gateway?: { multiUser?: { mode?: string } };
        commands?: { config?: boolean; debug?: boolean };
      };
    }>(ws, "config.get", {});
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.config?.gateway?.multiUser?.mode).toBe("strict");
    expect(getRes.payload?.config?.commands?.config).toBe(false);
    expect(getRes.payload?.config?.commands?.debug).toBe(false);

    const changes = await rpcReq<{
      events?: Array<{
        method?: string;
        note?: string | null;
      }>;
    }>(ws, "config.changes.list", {
      limit: 20,
      method: "config.policyBundle.apply",
    });
    expect(changes.ok).toBe(true);
    const bundleChange = (changes.payload?.events ?? []).find(
      (event) =>
        event.method === "config.policyBundle.apply" &&
        event.note === "policy-bundle:strict_admin_control",
    );
    expect(bundleChange).toBeTruthy();
  });

  it("requires base hash when config exists", async () => {
    const baseHash = await resolveCurrentBaseHash();
    const setId = "req-set-2";
    ws.send(
      JSON.stringify({
        type: "req",
        id: setId,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: { mode: "local" },
            plugins: { slots: { memory: "none" } },
          }),
          ...(baseHash ? { baseHash } : {}),
        },
      }),
    );
    const setRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === setId,
    );
    expect(setRes.ok).toBe(true);

    const patchId = "req-patch-2";
    ws.send(
      JSON.stringify({
        type: "req",
        id: patchId,
        method: "config.patch",
        params: {
          raw: JSON.stringify({ gateway: { mode: "remote" } }),
        },
      }),
    );
    const patchRes = await onceMessage<{ ok: boolean; error?: { message?: string } }>(
      ws,
      (o) => o.type === "res" && o.id === patchId,
    );
    expect(patchRes.ok).toBe(false);
    expect(patchRes.error?.message).toContain("base hash");
  });

  it("requires base hash for config.set when config exists", async () => {
    const baseHash = await resolveCurrentBaseHash();
    const setId = "req-set-3";
    ws.send(
      JSON.stringify({
        type: "req",
        id: setId,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: { mode: "local" },
            plugins: { slots: { memory: "none" } },
          }),
          ...(baseHash ? { baseHash } : {}),
        },
      }),
    );
    const setRes = await onceMessage<{ ok: boolean }>(
      ws,
      (o) => o.type === "res" && o.id === setId,
    );
    expect(setRes.ok).toBe(true);

    const set2Id = "req-set-4";
    ws.send(
      JSON.stringify({
        type: "req",
        id: set2Id,
        method: "config.set",
        params: {
          raw: JSON.stringify({
            gateway: { mode: "remote" },
          }),
        },
      }),
    );
    const set2Res = await onceMessage<{ ok: boolean; error?: { message?: string } }>(
      ws,
      (o) => o.type === "res" && o.id === set2Id,
    );
    expect(set2Res.ok).toBe(false);
    expect(set2Res.error?.message).toContain("base hash");
  });
});

describe("gateway server sessions", () => {
  it("filters sessions by agentId", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sessions-agents-"));
    testState.sessionConfig = {
      store: path.join(dir, "{agentId}", "sessions.json"),
    };
    testState.agentsConfig = {
      list: [{ id: "home", default: true }, { id: "work" }],
    };
    const homeDir = path.join(dir, "home");
    const workDir = path.join(dir, "work");
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });
    await writeSessionStore({
      storePath: path.join(homeDir, "sessions.json"),
      agentId: "home",
      entries: {
        main: {
          sessionId: "sess-home-main",
          updatedAt: Date.now(),
        },
        "discord:group:dev": {
          sessionId: "sess-home-group",
          updatedAt: Date.now() - 1000,
        },
      },
    });
    await writeSessionStore({
      storePath: path.join(workDir, "sessions.json"),
      agentId: "work",
      entries: {
        main: {
          sessionId: "sess-work-main",
          updatedAt: Date.now(),
        },
      },
    });

    const homeSessions = await rpcReq<{
      sessions: Array<{ key: string }>;
    }>(ws, "sessions.list", {
      includeGlobal: false,
      includeUnknown: false,
      agentId: "home",
    });
    expect(homeSessions.ok).toBe(true);
    expect(homeSessions.payload?.sessions.map((s) => s.key).toSorted()).toEqual([
      "agent:home:discord:group:dev",
      "agent:home:main",
    ]);

    const workSessions = await rpcReq<{
      sessions: Array<{ key: string }>;
    }>(ws, "sessions.list", {
      includeGlobal: false,
      includeUnknown: false,
      agentId: "work",
    });
    expect(workSessions.ok).toBe(true);
    expect(workSessions.payload?.sessions.map((s) => s.key)).toEqual(["agent:work:main"]);
  });

  it("resolves and patches main alias to default agent main key", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sessions-"));
    const storePath = path.join(dir, "sessions.json");
    testState.sessionStorePath = storePath;
    testState.agentsConfig = { list: [{ id: "ops", default: true }] };
    testState.sessionConfig = { mainKey: "work" };

    await writeSessionStore({
      storePath,
      agentId: "ops",
      mainKey: "work",
      entries: {
        main: {
          sessionId: "sess-ops-main",
          updatedAt: Date.now(),
        },
      },
    });

    const resolved = await rpcReq<{ ok: true; key: string }>(ws, "sessions.resolve", {
      key: "main",
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.payload?.key).toBe("agent:ops:work");

    const patched = await rpcReq<{ ok: true; key: string }>(ws, "sessions.patch", {
      key: "main",
      thinkingLevel: "medium",
    });
    expect(patched.ok).toBe(true);
    expect(patched.payload?.key).toBe("agent:ops:work");

    const stored = JSON.parse(await fs.readFile(storePath, "utf-8")) as Record<
      string,
      { thinkingLevel?: string }
    >;
    expect(stored["agent:ops:work"]?.thinkingLevel).toBe("medium");
    expect(stored.main).toBeUndefined();
  });
});
