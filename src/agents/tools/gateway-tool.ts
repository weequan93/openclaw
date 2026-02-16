import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveConfigSnapshotHash } from "../../config/io.js";
import { resolveGatewayMultiUserMode } from "../../gateway/multi-user-mode.js";
import { loadSessionEntry } from "../../gateway/session-utils.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;

function resolveBaseHashFromSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  const hashValue = (snapshot as { hash?: unknown }).hash;
  const rawValue = (snapshot as { raw?: unknown }).raw;
  const hash = resolveConfigSnapshotHash({
    hash: typeof hashValue === "string" ? hashValue : undefined,
    raw: typeof rawValue === "string" ? rawValue : undefined,
  });
  return hash ?? undefined;
}

const GATEWAY_ACTIONS = [
  "restart",
  "config.get",
  "config.schema",
  "config.apply",
  "config.patch",
  "update.run",
] as const;

// NOTE: Using a flattened object schema instead of Type.Union([Type.Object(...), ...])
// because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
// The discriminator (action) determines which properties are relevant; runtime validates.
const GatewayToolSchema = Type.Object({
  action: stringEnum(GATEWAY_ACTIONS),
  // restart
  delayMs: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
  // config.get, config.schema, config.apply, update.run
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  // config.apply, config.patch
  raw: Type.Optional(Type.String()),
  baseHash: Type.Optional(Type.String()),
  // config.apply, config.patch, update.run
  sessionKey: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  restartDelayMs: Type.Optional(Type.Number()),
});
// NOTE: We intentionally avoid top-level `allOf`/`anyOf`/`oneOf` conditionals here:
// - OpenAI rejects tool schemas that include these keywords at the *top-level*.
// - Claude/Vertex has other JSON Schema quirks.
// Conditional requirements (like `raw` for config.apply) are enforced at runtime.

export function createGatewayTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
  ownerUserId?: string;
  ownerPrincipalId?: string;
  ownerAlias?: string;
  ownerRole?: string;
}): AnyAgentTool {
  const ownerUserId =
    typeof opts?.ownerUserId === "string" && opts.ownerUserId.trim()
      ? opts.ownerUserId.trim()
      : undefined;
  const ownerRole =
    typeof opts?.ownerRole === "string" && opts.ownerRole.trim()
      ? opts.ownerRole.trim().toLowerCase()
      : undefined;
  const ownerPrincipalId =
    typeof opts?.ownerPrincipalId === "string" && opts.ownerPrincipalId.trim()
      ? opts.ownerPrincipalId.trim()
      : undefined;
  const ownerAlias =
    typeof opts?.ownerAlias === "string" && opts.ownerAlias.trim()
      ? opts.ownerAlias.trim()
      : undefined;
  const multiUserMode = resolveGatewayMultiUserMode(opts?.config);
  const ownerBoundRun = Boolean(ownerUserId);
  const enforceAdminControlPlane = multiUserMode !== "off" && ownerBoundRun;

  return {
    label: "Gateway",
    name: "gateway",
    description:
      "Restart, apply config, or update the gateway in-place (SIGUSR1). Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing.",
    parameters: GatewayToolSchema,
    execute: async (_toolCallId, args) => {
      if (enforceAdminControlPlane && ownerRole !== "admin") {
        throw new Error("Gateway tool is admin-only in multi-user mode for owner-bound sessions.");
      }
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "restart") {
        if (opts?.config?.commands?.restart !== true) {
          throw new Error("Gateway restart is disabled. Set commands.restart=true to enable.");
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const delayMs =
          typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
            ? Math.floor(params.delayMs)
            : undefined;
        const reason =
          typeof params.reason === "string" && params.reason.trim()
            ? params.reason.trim().slice(0, 200)
            : undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        // Extract channel + threadId for routing after restart
        let deliveryContext: { channel?: string; to?: string; accountId?: string } | undefined;
        let threadId: string | undefined;
        if (sessionKey) {
          const threadMarker = ":thread:";
          const threadIndex = sessionKey.lastIndexOf(threadMarker);
          const baseSessionKey = threadIndex === -1 ? sessionKey : sessionKey.slice(0, threadIndex);
          const threadIdRaw =
            threadIndex === -1 ? undefined : sessionKey.slice(threadIndex + threadMarker.length);
          threadId = threadIdRaw?.trim() || undefined;
          try {
            let entry = loadSessionEntry(sessionKey, { ownerUserId }).entry;
            if (!entry?.deliveryContext && threadIndex !== -1 && baseSessionKey) {
              entry = loadSessionEntry(baseSessionKey, { ownerUserId }).entry;
            }
            if (entry?.deliveryContext) {
              deliveryContext = {
                channel: entry.deliveryContext.channel,
                to: entry.deliveryContext.to,
                accountId: entry.deliveryContext.accountId,
              };
            }
          } catch {
            // ignore: best-effort
          }
        }
        const payload: RestartSentinelPayload = {
          kind: "restart",
          status: "ok",
          ts: Date.now(),
          sessionKey,
          ownerUserId,
          deliveryContext,
          threadId,
          message: note ?? reason ?? null,
          doctorHint: formatDoctorNonInteractiveHint(),
          stats: {
            mode: "gateway.restart",
            reason,
          },
        };
        try {
          await writeRestartSentinel(payload);
        } catch {
          // ignore: sentinel is best-effort
        }
        console.info(
          `gateway tool: restart requested (delayMs=${delayMs ?? "default"}, reason=${reason ?? "none"})`,
        );
        const scheduled = scheduleGatewaySigusr1Restart({
          delayMs,
          reason,
        });
        return jsonResult(scheduled);
      }

      const gatewayUrl =
        typeof params.gatewayUrl === "string" && params.gatewayUrl.trim()
          ? params.gatewayUrl.trim()
          : undefined;
      const gatewayToken =
        typeof params.gatewayToken === "string" && params.gatewayToken.trim()
          ? params.gatewayToken.trim()
          : undefined;
      const timeoutMs =
        typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
          ? Math.max(1, Math.floor(params.timeoutMs))
          : undefined;
      const gatewayOpts = { gatewayUrl, gatewayToken, timeoutMs };
      const gatewayOwnerOpts = {
        ownerUserId,
        ownerPrincipalId,
        ownerAlias,
      };
      const gatewayAdminExtra = { allowAdmin: true as const };

      if (action === "config.get") {
        const result = await callGatewayTool(
          "config.get",
          { ...gatewayOpts, ...gatewayOwnerOpts },
          {},
          gatewayAdminExtra,
        );
        return jsonResult({ ok: true, result });
      }
      if (action === "config.schema") {
        const result = await callGatewayTool(
          "config.schema",
          { ...gatewayOpts, ...gatewayOwnerOpts },
          {},
          gatewayAdminExtra,
        );
        return jsonResult({ ok: true, result });
      }
      if (action === "config.apply") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (!baseHash) {
          const snapshot = await callGatewayTool(
            "config.get",
            { ...gatewayOpts, ...gatewayOwnerOpts },
            {},
            gatewayAdminExtra,
          );
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const result = await callGatewayTool(
          "config.apply",
          { ...gatewayOpts, ...gatewayOwnerOpts },
          {
            raw,
            baseHash,
            sessionKey,
            note,
            restartDelayMs,
          },
          gatewayAdminExtra,
        );
        return jsonResult({ ok: true, result });
      }
      if (action === "config.patch") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (!baseHash) {
          const snapshot = await callGatewayTool(
            "config.get",
            { ...gatewayOpts, ...gatewayOwnerOpts },
            {},
            gatewayAdminExtra,
          );
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const result = await callGatewayTool(
          "config.patch",
          { ...gatewayOpts, ...gatewayOwnerOpts },
          {
            raw,
            baseHash,
            sessionKey,
            note,
            restartDelayMs,
          },
          gatewayAdminExtra,
        );
        return jsonResult({ ok: true, result });
      }
      if (action === "update.run") {
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const updateGatewayOpts = {
          ...gatewayOpts,
          ...gatewayOwnerOpts,
          timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
        };
        const result = await callGatewayTool(
          "update.run",
          updateGatewayOpts,
          {
            sessionKey,
            note,
            restartDelayMs,
            timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
          },
          gatewayAdminExtra,
        );
        return jsonResult({ ok: true, result });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
