import { beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "../../gateway/authz-denied-events.js";
import { extractMessageText } from "./commands-subagents.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseConfigCommand } from "./config-commands.js";
import { parseDebugCommand } from "./debug-commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

function buildParams(commandBody: string, cfg: OpenClawConfig, ctxOverrides?: Partial<MsgContext>) {
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: true,
    Provider: "whatsapp",
    Surface: "whatsapp",
    ...ctxOverrides,
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim().toLowerCase(),
    commandAuthorized: true,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: "/tmp",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off" as const,
    resolvedReasoningLevel: "off" as const,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "whatsapp",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("parseConfigCommand", () => {
  it("parses show/unset", () => {
    expect(parseConfigCommand("/config")).toEqual({ action: "show" });
    expect(parseConfigCommand("/config show")).toEqual({
      action: "show",
      path: undefined,
    });
    expect(parseConfigCommand("/config show foo.bar")).toEqual({
      action: "show",
      path: "foo.bar",
    });
    expect(parseConfigCommand("/config get foo.bar")).toEqual({
      action: "show",
      path: "foo.bar",
    });
    expect(parseConfigCommand("/config unset foo.bar")).toEqual({
      action: "unset",
      path: "foo.bar",
    });
  });

  it("parses set with JSON", () => {
    const cmd = parseConfigCommand('/config set foo={"a":1}');
    expect(cmd).toEqual({ action: "set", path: "foo", value: { a: 1 } });
  });
});

describe("parseDebugCommand", () => {
  it("parses show/reset", () => {
    expect(parseDebugCommand("/debug")).toEqual({ action: "show" });
    expect(parseDebugCommand("/debug show")).toEqual({ action: "show" });
    expect(parseDebugCommand("/debug reset")).toEqual({ action: "reset" });
  });

  it("parses set with JSON", () => {
    const cmd = parseDebugCommand('/debug set foo={"a":1}');
    expect(cmd).toEqual({ action: "set", path: "foo", value: { a: 1 } });
  });

  it("parses unset", () => {
    const cmd = parseDebugCommand("/debug unset foo.bar");
    expect(cmd).toEqual({ action: "unset", path: "foo.bar" });
  });
});

describe("extractMessageText", () => {
  it("preserves user text that looks like tool call markers", () => {
    const message = {
      role: "user",
      content: "Here [Tool Call: foo (ID: 1)] ok",
    };
    const result = extractMessageText(message);
    expect(result?.text).toContain("[Tool Call: foo (ID: 1)]");
  });

  it("sanitizes assistant tool call markers", () => {
    const message = {
      role: "assistant",
      content: "Here [Tool Call: foo (ID: 1)] ok",
    };
    const result = extractMessageText(message);
    expect(result?.text).toBe("Here ok");
  });
});

describe("handleCommands /config configWrites gating", () => {
  beforeEach(() => {
    authzDeniedEventsTest.clear();
  });

  it("blocks /config set when channel config writes are disabled", async () => {
    const cfg = {
      commands: { config: true, text: true },
      gateway: { multiUser: { mode: "off" } },
      channels: { whatsapp: { allowFrom: ["*"], configWrites: false } },
    } as OpenClawConfig;
    const params = buildParams('/config set messages.ackReaction=":)"', cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Config writes are disabled");
  });

  it("blocks /config for non-gateway senders in multi-user mode", async () => {
    const cfg = {
      commands: { config: true, text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"], configWrites: true } },
    } as OpenClawConfig;
    const params = buildParams("/config show", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/config is admin-only");
    const events = listGatewayAuthzDenyEvents({ method: "command.config" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("blocks /config for non-admin gateway principals", async () => {
    const cfg = {
      commands: { config: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"], configWrites: true } },
    } as OpenClawConfig;
    const params = buildParams("/config show", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayClientScopes: ["operator.read", "operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/config is admin-only");
    const events = listGatewayAuthzDenyEvents({ method: "command.config" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.userId).toBe("user-1");
    expect(events[0]?.principalId).toBe("principal:user-1");
  });

  it("blocks /config when gateway principal has admin scope but non-admin role", async () => {
    const cfg = {
      commands: { config: true, text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"], configWrites: true } },
    } as OpenClawConfig;
    const params = buildParams("/config show", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayOwnerRole: "user",
      GatewayClientScopes: ["operator.admin", "operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/config is admin-only");
    const events = listGatewayAuthzDenyEvents({ method: "command.config" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.actorRole).toBe("user");
    expect(events[0]?.userId).toBe("user-1");
    expect(events[0]?.principalId).toBe("principal:user-1");
  });
});
