import { randomUUID } from "node:crypto";
import type { NodeEvent, NodeEventContext } from "./server-node-events-types.js";
import { normalizeChannelId } from "../channels/plugins/index.js";
import { agentCommand } from "../commands/agent.js";
import { loadConfig } from "../config/config.js";
import { updateSessionStore } from "../config/sessions.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { getPairedNode } from "../infra/node-pairing.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { normalizeMainKey } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { hasGatewayDelegatedAccess } from "./delegation-policy.js";
import { resolveGatewayMultiUserMode } from "./multi-user-mode.js";
import { resolveSessionOwnerUserIdForGateway } from "./session-owner-resolver.js";
import { assertSessionAccess } from "./session-owner.js";
import { loadSessionEntry } from "./session-utils.js";
import { formatForLog } from "./ws-log.js";

function normalizeOwnerUserId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function createNodeOwnerContext(params: { nodeId: string; ownerUserId: string }) {
  return {
    userId: params.ownerUserId,
    principalId: `node:${params.nodeId}`,
    role: "node" as const,
    sourceRole: "node" as const,
    scopes: [],
  };
}

async function resolveNodeOwnerUserId(nodeId: string): Promise<string | undefined> {
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId) {
    return undefined;
  }
  try {
    const paired = await getPairedNode(normalizedNodeId);
    return normalizeOwnerUserId(paired?.ownerUserId);
  } catch {
    return undefined;
  }
}

function canNodeAccessSession(params: {
  cfg: ReturnType<typeof loadConfig>;
  sessionKey: string;
  nodeOwnerUserId?: string;
  allowMissingSessionOwner?: boolean;
}): boolean {
  if (resolveGatewayMultiUserMode(params.cfg) === "off") {
    return true;
  }
  if (!params.nodeOwnerUserId) {
    return false;
  }
  const sessionOwnerUserId = resolveSessionOwnerUserIdForGateway({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    preferredOwnerUserId: params.nodeOwnerUserId,
  });
  if (!sessionOwnerUserId) {
    return Boolean(params.allowMissingSessionOwner);
  }
  return hasGatewayDelegatedAccess({
    cfg: params.cfg,
    fromUserId: params.nodeOwnerUserId,
    ownerUserId: sessionOwnerUserId,
    resource: "sessions",
  });
}

export const handleNodeEvent = async (ctx: NodeEventContext, nodeId: string, evt: NodeEvent) => {
  switch (evt.event) {
    case "voice.transcript": {
      if (!evt.payloadJSON) {
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(evt.payloadJSON) as unknown;
      } catch {
        return;
      }
      const obj =
        typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text) {
        return;
      }
      if (text.length > 20_000) {
        return;
      }
      const sessionKeyRaw = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
      const cfg = loadConfig();
      const rawMainKey = normalizeMainKey(cfg.session?.mainKey);
      const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : rawMainKey;
      const ownerUserId = await resolveNodeOwnerUserId(nodeId);
      if (
        !canNodeAccessSession({
          cfg,
          sessionKey,
          nodeOwnerUserId: ownerUserId,
          allowMissingSessionOwner: true,
        })
      ) {
        ctx.logGateway.warn(`node voice.transcript denied node=${nodeId} session=${sessionKey}`);
        return;
      }
      const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey, { ownerUserId });
      if (ownerUserId && resolveGatewayMultiUserMode(cfg) !== "off") {
        const ownerAccess = assertSessionAccess({
          owner: createNodeOwnerContext({ nodeId, ownerUserId }),
          entry,
          sessionKey: canonicalKey,
          cfg,
        });
        if (!ownerAccess.ok) {
          ctx.logGateway.warn(
            `node voice.transcript denied node=${nodeId} session=${canonicalKey}`,
          );
          return;
        }
      }
      const now = Date.now();
      const sessionId = entry?.sessionId ?? randomUUID();
      const effectiveOwnerUserId = normalizeOwnerUserId(entry?.ownerUserId) ?? ownerUserId;
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[canonicalKey] = {
            ...entry,
            ...(effectiveOwnerUserId ? { ownerUserId: effectiveOwnerUserId } : {}),
            sessionId,
            updatedAt: now,
            thinkingLevel: entry?.thinkingLevel,
            verboseLevel: entry?.verboseLevel,
            reasoningLevel: entry?.reasoningLevel,
            systemSent: entry?.systemSent,
            sendPolicy: entry?.sendPolicy,
            lastChannel: entry?.lastChannel,
            lastTo: entry?.lastTo,
          };
        });
      }

      // Ensure chat UI clients refresh when this run completes (even though it wasn't started via chat.send).
      // This maps agent bus events (keyed by sessionId) to chat events (keyed by clientRunId).
      ctx.addChatRun(sessionId, {
        sessionKey,
        clientRunId: `voice-${randomUUID()}`,
      });

      void agentCommand(
        {
          message: text,
          sessionId,
          sessionKey,
          thinking: "low",
          deliver: false,
          messageChannel: "node",
        },
        defaultRuntime,
        ctx.deps,
      ).catch((err) => {
        ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
      });
      return;
    }
    case "agent.request": {
      if (!evt.payloadJSON) {
        return;
      }
      type AgentDeepLink = {
        message?: string;
        sessionKey?: string | null;
        thinking?: string | null;
        deliver?: boolean;
        to?: string | null;
        channel?: string | null;
        timeoutSeconds?: number | null;
        key?: string | null;
      };
      let link: AgentDeepLink | null = null;
      try {
        link = JSON.parse(evt.payloadJSON) as AgentDeepLink;
      } catch {
        return;
      }
      const message = (link?.message ?? "").trim();
      if (!message) {
        return;
      }
      if (message.length > 20_000) {
        return;
      }

      const channelRaw = typeof link?.channel === "string" ? link.channel.trim() : "";
      const channel = normalizeChannelId(channelRaw) ?? undefined;
      const to = typeof link?.to === "string" && link.to.trim() ? link.to.trim() : undefined;
      const deliver = Boolean(link?.deliver) && Boolean(channel);

      const sessionKeyRaw = (link?.sessionKey ?? "").trim();
      const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : `node-${nodeId}`;
      const ownerUserId = await resolveNodeOwnerUserId(nodeId);
      const cfg = loadConfig();
      if (
        !canNodeAccessSession({
          cfg,
          sessionKey,
          nodeOwnerUserId: ownerUserId,
          allowMissingSessionOwner: true,
        })
      ) {
        ctx.logGateway.warn(`node agent.request denied node=${nodeId} session=${sessionKey}`);
        return;
      }
      const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey, { ownerUserId });
      if (ownerUserId && resolveGatewayMultiUserMode(cfg) !== "off") {
        const ownerAccess = assertSessionAccess({
          owner: createNodeOwnerContext({ nodeId, ownerUserId }),
          entry,
          sessionKey: canonicalKey,
          cfg,
        });
        if (!ownerAccess.ok) {
          ctx.logGateway.warn(`node agent.request denied node=${nodeId} session=${canonicalKey}`);
          return;
        }
      }
      const now = Date.now();
      const sessionId = entry?.sessionId ?? randomUUID();
      const effectiveOwnerUserId = normalizeOwnerUserId(entry?.ownerUserId) ?? ownerUserId;
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[canonicalKey] = {
            ...entry,
            ...(effectiveOwnerUserId ? { ownerUserId: effectiveOwnerUserId } : {}),
            sessionId,
            updatedAt: now,
            thinkingLevel: entry?.thinkingLevel,
            verboseLevel: entry?.verboseLevel,
            reasoningLevel: entry?.reasoningLevel,
            systemSent: entry?.systemSent,
            sendPolicy: entry?.sendPolicy,
            lastChannel: entry?.lastChannel,
            lastTo: entry?.lastTo,
          };
        });
      }

      void agentCommand(
        {
          message,
          sessionId,
          sessionKey,
          thinking: link?.thinking ?? undefined,
          deliver,
          to,
          channel,
          timeout:
            typeof link?.timeoutSeconds === "number" ? link.timeoutSeconds.toString() : undefined,
          messageChannel: "node",
        },
        defaultRuntime,
        ctx.deps,
      ).catch((err) => {
        ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
      });
      return;
    }
    case "chat.subscribe": {
      if (!evt.payloadJSON) {
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(evt.payloadJSON) as unknown;
      } catch {
        return;
      }
      const obj =
        typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
      if (!sessionKey) {
        return;
      }
      const cfg = loadConfig();
      const nodeOwnerUserId = await resolveNodeOwnerUserId(nodeId);
      if (!canNodeAccessSession({ cfg, sessionKey, nodeOwnerUserId })) {
        ctx.logGateway.warn(`node subscribe denied node=${nodeId} session=${sessionKey}`);
        return;
      }
      ctx.nodeSubscribe(nodeId, sessionKey);
      return;
    }
    case "chat.unsubscribe": {
      if (!evt.payloadJSON) {
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(evt.payloadJSON) as unknown;
      } catch {
        return;
      }
      const obj =
        typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
      if (!sessionKey) {
        return;
      }
      const cfg = loadConfig();
      const nodeOwnerUserId = await resolveNodeOwnerUserId(nodeId);
      if (!canNodeAccessSession({ cfg, sessionKey, nodeOwnerUserId })) {
        ctx.logGateway.warn(`node unsubscribe denied node=${nodeId} session=${sessionKey}`);
        return;
      }
      ctx.nodeUnsubscribe(nodeId, sessionKey);
      return;
    }
    case "exec.started":
    case "exec.finished":
    case "exec.denied": {
      if (!evt.payloadJSON) {
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(evt.payloadJSON) as unknown;
      } catch {
        return;
      }
      const obj =
        typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const sessionKey =
        typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : `node-${nodeId}`;
      if (!sessionKey) {
        return;
      }
      const cfg = loadConfig();
      const nodeOwnerUserId = await resolveNodeOwnerUserId(nodeId);
      if (!canNodeAccessSession({ cfg, sessionKey, nodeOwnerUserId })) {
        ctx.logGateway.warn(`node exec event denied node=${nodeId} session=${sessionKey}`);
        return;
      }
      const runId = typeof obj.runId === "string" ? obj.runId.trim() : "";
      const command = typeof obj.command === "string" ? obj.command.trim() : "";
      const exitCode =
        typeof obj.exitCode === "number" && Number.isFinite(obj.exitCode)
          ? obj.exitCode
          : undefined;
      const timedOut = obj.timedOut === true;
      const output = typeof obj.output === "string" ? obj.output.trim() : "";
      const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";

      let text = "";
      if (evt.event === "exec.started") {
        text = `Exec started (node=${nodeId}${runId ? ` id=${runId}` : ""})`;
        if (command) {
          text += `: ${command}`;
        }
      } else if (evt.event === "exec.finished") {
        const exitLabel = timedOut ? "timeout" : `code ${exitCode ?? "?"}`;
        text = `Exec finished (node=${nodeId}${runId ? ` id=${runId}` : ""}, ${exitLabel})`;
        if (output) {
          text += `\n${output}`;
        }
      } else {
        text = `Exec denied (node=${nodeId}${runId ? ` id=${runId}` : ""}${reason ? `, ${reason}` : ""})`;
        if (command) {
          text += `: ${command}`;
        }
      }

      enqueueSystemEvent(text, { sessionKey, contextKey: runId ? `exec:${runId}` : "exec" });
      requestHeartbeatNow({ reason: "exec-event" });
      return;
    }
    default:
      return;
  }
};
