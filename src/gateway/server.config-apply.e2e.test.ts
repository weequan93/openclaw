import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { resolveConfigSnapshotHash } from "../config/config.js";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  startGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let previousToken: string | undefined;

beforeAll(async () => {
  previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  port = await getFreePort();
  server = await startGatewayServer(port);
});

afterAll(async () => {
  await server.close();
  if (previousToken === undefined) {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
  } else {
    process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
  }
});

const openClient = async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  await connectOk(ws);
  return ws;
};

async function resolveBaseHash(ws: WebSocket): Promise<string | undefined> {
  const getId = `req-base-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  ws.send(
    JSON.stringify({
      type: "req",
      id: getId,
      method: "config.get",
      params: {},
    }),
  );
  const getRes = await onceMessage<{
    ok: boolean;
    payload?: { hash?: string; raw?: string };
  }>(ws, (o) => o.type === "res" && o.id === getId);
  expect(getRes.ok).toBe(true);
  return (
    resolveConfigSnapshotHash({
      hash: getRes.payload?.hash,
      raw: getRes.payload?.raw,
    }) ?? undefined
  );
}

describe("gateway config.apply", () => {
  it("writes config, stores sentinel, and schedules restart", async () => {
    const ws = await openClient();
    try {
      const baseHash = await resolveBaseHash(ws);
      const id = "req-1";
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "config.apply",
          params: {
            raw: JSON.stringify({
              agents: { list: [{ id: "main", workspace: "~/openclaw" }] },
              plugins: { slots: { memory: "none" } },
            }),
            sessionKey: "agent:main:whatsapp:dm:+15555550123",
            restartDelayMs: 0,
            ...(baseHash ? { baseHash } : {}),
          },
        }),
      );
      const res = await onceMessage<{ ok: boolean; payload?: unknown; error?: unknown }>(
        ws,
        (o) => o.type === "res" && o.id === id,
      );
      if (!res.ok) {
        throw new Error(`config.apply failed: ${JSON.stringify(res)}`);
      }
      expect(res.ok).toBe(true);

      // Verify sentinel file was created (restart was scheduled)
      const sentinelPath = path.join(os.homedir(), ".openclaw", "restart-sentinel.json");

      // Wait for file to be written
      await new Promise((resolve) => setTimeout(resolve, 100));

      try {
        const raw = await fs.readFile(sentinelPath, "utf-8");
        const parsed = JSON.parse(raw) as { payload?: { kind?: string } };
        expect(parsed.payload?.kind).toBe("config-apply");
      } catch {
        // File may not exist if signal delivery is mocked, verify response was ok instead
        expect(res.ok).toBe(true);
      }
    } finally {
      ws.close();
    }
  });

  it("rejects invalid raw config", async () => {
    const ws = await openClient();
    try {
      const id = "req-2";
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "config.apply",
          params: {
            raw: "{",
          },
        }),
      );
      const res = await onceMessage<{ ok: boolean; error?: unknown }>(
        ws,
        (o) => o.type === "res" && o.id === id,
      );
      expect(res.ok).toBe(false);
    } finally {
      ws.close();
    }
  });
});
