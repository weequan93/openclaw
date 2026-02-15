import type { CommandHandler } from "./commands-types.js";
import { callGateway } from "../../gateway/call.js";
import { resolveGatewayMultiUserMode } from "../../gateway/multi-user-mode.js";
import { logVerbose } from "../../globals.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  isInternalMessageChannel,
} from "../../utils/message-channel.js";
import { recordCommandAuthzDeny } from "./command-authz-audit.js";
import { resolveCommandGatewayOwnerIdentity } from "./owner-identity.js";

const COMMAND = "/approve";

const DECISION_ALIASES: Record<string, "allow-once" | "allow-always" | "deny"> = {
  allow: "allow-once",
  once: "allow-once",
  "allow-once": "allow-once",
  allowonce: "allow-once",
  always: "allow-always",
  "allow-always": "allow-always",
  allowalways: "allow-always",
  deny: "deny",
  reject: "deny",
  block: "deny",
};

type ParsedApproveCommand =
  | { ok: true; id: string; decision: "allow-once" | "allow-always" | "deny" }
  | { ok: false; error: string };

function parseApproveCommand(raw: string): ParsedApproveCommand | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith(COMMAND)) {
    return null;
  }
  const rest = trimmed.slice(COMMAND.length).trim();
  if (!rest) {
    return { ok: false, error: "Usage: /approve <id> allow-once|allow-always|deny" };
  }
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return { ok: false, error: "Usage: /approve <id> allow-once|allow-always|deny" };
  }

  const first = tokens[0].toLowerCase();
  const second = tokens[1].toLowerCase();

  if (DECISION_ALIASES[first]) {
    return {
      ok: true,
      decision: DECISION_ALIASES[first],
      id: tokens.slice(1).join(" ").trim(),
    };
  }
  if (DECISION_ALIASES[second]) {
    return {
      ok: true,
      decision: DECISION_ALIASES[second],
      id: tokens[0],
    };
  }
  return { ok: false, error: "Usage: /approve <id> allow-once|allow-always|deny" };
}

function buildResolvedByLabel(params: Parameters<CommandHandler>[0]): string {
  const channel = params.command.channel;
  const sender = params.command.senderId ?? "unknown";
  return `${channel}:${sender}`;
}

export const handleApproveCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  const parsed = parseApproveCommand(normalized);
  if (!parsed) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /approve from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    recordCommandAuthzDeny({
      ctx: params.ctx,
      command: params.command,
      method: "command.approve",
      reasonCode: "UNKNOWN_SENDER",
      message: "/approve denied for unauthorized sender",
    });
    return { shouldContinue: false };
  }

  if (!parsed.ok) {
    return { shouldContinue: false, reply: { text: parsed.error } };
  }

  if (isInternalMessageChannel(params.command.channel)) {
    const scopes = params.ctx.GatewayClientScopes ?? [];
    const hasApprovalsScope = scopes.includes("operator.approvals");
    const hasAdminScope = scopes.includes("operator.admin");
    const multiUserMode = resolveGatewayMultiUserMode(params.cfg);
    const ownerRole =
      typeof params.ctx.GatewayOwnerRole === "string"
        ? params.ctx.GatewayOwnerRole.trim().toLowerCase()
        : "";
    const adminScopeAllowed = hasAdminScope && (multiUserMode === "off" || ownerRole === "admin");
    const requiresAdminRole = hasAdminScope && multiUserMode !== "off" && ownerRole !== "admin";
    if (!hasApprovalsScope && requiresAdminRole) {
      logVerbose("Ignoring /approve from gateway client requiring admin principal role.");
      recordCommandAuthzDeny({
        ctx: params.ctx,
        command: params.command,
        method: "command.approve",
        reasonCode: "ROLE_FORBIDDEN",
        message: "/approve admin scope requires admin principal role",
      });
      return {
        shouldContinue: false,
        reply: {
          text: "❌ /approve admin scope requires admin principal role.",
        },
      };
    }
    if (!hasApprovalsScope && !adminScopeAllowed) {
      logVerbose("Ignoring /approve from gateway client missing operator.approvals.");
      recordCommandAuthzDeny({
        ctx: params.ctx,
        command: params.command,
        method: "command.approve",
        reasonCode: "SCOPE_MISSING",
        message: "/approve requires operator.approvals for gateway clients",
      });
      return {
        shouldContinue: false,
        reply: {
          text: "❌ /approve requires operator.approvals for gateway clients.",
        },
      };
    }
  }

  const resolvedBy = buildResolvedByLabel(params);
  const ownerIdentity = resolveCommandGatewayOwnerIdentity(params);
  try {
    await callGateway({
      method: "exec.approval.resolve",
      params: { id: parsed.id, decision: parsed.decision },
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: `Chat approval (${resolvedBy})`,
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      ...(ownerIdentity ? { identity: ownerIdentity } : {}),
    });
  } catch (err) {
    return {
      shouldContinue: false,
      reply: {
        text: `❌ Failed to submit approval: ${String(err)}`,
      },
    };
  }

  return {
    shouldContinue: false,
    reply: { text: `✅ Exec approval ${parsed.decision} submitted for ${parsed.id}.` },
  };
};
