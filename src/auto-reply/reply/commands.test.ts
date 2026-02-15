import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "../../gateway/authz-denied-events.js";
import type { MsgContext } from "../templating.js";
import {
  addSubagentRunForTests,
  resetSubagentRegistryForTests,
} from "../../agents/subagent-registry.js";
import * as internalHooks from "../../hooks/internal-hooks.js";
import { clearPluginCommands, registerPluginCommand } from "../../plugins/commands.js";
import { resetBashChatCommandForTests } from "./bash-command.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

// Avoid expensive workspace scans during /context tests.
vi.mock("./commands-context-report.js", () => ({
  buildContextReply: async (params: { command: { commandBodyNormalized: string } }) => {
    const normalized = params.command.commandBodyNormalized;
    if (normalized === "/context list") {
      return { text: "Injected workspace files:\n- AGENTS.md" };
    }
    if (normalized === "/context detail") {
      return { text: "Context breakdown (detailed)\nTop tools (schema size):" };
    }
    return { text: "/context\n- /context list\nInline shortcut" };
  },
}));

let testWorkspaceDir = os.tmpdir();

beforeAll(async () => {
  testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-commands-"));
  await fs.writeFile(path.join(testWorkspaceDir, "AGENTS.md"), "# Agents\n", "utf-8");
});

afterAll(async () => {
  await fs.rm(testWorkspaceDir, { recursive: true, force: true });
});

beforeEach(() => {
  authzDeniedEventsTest.clear();
});

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
    commandAuthorized: ctx.CommandAuthorized !== false,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: testWorkspaceDir,
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

describe("handleCommands gating", () => {
  it("blocks /bash when disabled", async () => {
    resetBashChatCommandForTests();
    const cfg = {
      commands: { bash: false, text: true },
      whatsapp: { allowFrom: ["*"] },
    } as OpenClawConfig;
    const params = buildParams("/bash echo hi", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("bash is disabled");
  });

  it("blocks /bash when elevated is not allowlisted", async () => {
    resetBashChatCommandForTests();
    const cfg = {
      commands: { bash: true, text: true },
      whatsapp: { allowFrom: ["*"] },
    } as OpenClawConfig;
    const params = buildParams("/bash echo hi", cfg);
    params.elevated = {
      enabled: true,
      allowed: false,
      failures: [{ gate: "allowFrom", key: "tools.elevated.allowFrom.whatsapp" }],
    };
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("elevated is not available");
  });

  it("blocks /config when disabled", async () => {
    const cfg = {
      commands: { config: false, debug: false, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/config show", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/config is disabled");
  });

  it("blocks /debug when disabled", async () => {
    const cfg = {
      commands: { config: false, debug: false, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/debug show", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/debug is disabled");
  });

  it("blocks /debug for non-admin gateway principals", async () => {
    const cfg = {
      commands: { config: true, debug: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/debug show", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayClientScopes: ["operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/debug is admin-only");
  });

  it("blocks /debug for non-gateway senders in multi-user mode", async () => {
    const cfg = {
      commands: { config: true, debug: true, text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/debug show", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/debug is admin-only");
  });

  it("blocks /debug when gateway principal has admin scope but non-admin role", async () => {
    const cfg = {
      commands: { config: true, debug: true, text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/debug show", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayOwnerRole: "user",
      GatewayClientScopes: ["operator.admin", "operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/debug is admin-only");
    const events = listGatewayAuthzDenyEvents({ method: "command.debug" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.actorRole).toBe("user");
  });

  it("blocks /debug when gateway principal has admin scope but unresolved role", async () => {
    const cfg = {
      commands: { config: true, debug: true, text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/debug show", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayClientScopes: ["operator.admin", "operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/debug is admin-only");
    const events = listGatewayAuthzDenyEvents({ method: "command.debug" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.actorRole).toBeNull();
  });

  it("records authz deny event for unauthorized /usage", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/usage", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.usage" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /restart", async () => {
    const cfg = {
      commands: { text: true, restart: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/restart", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.restart" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /stop", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/stop", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.stop" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /send", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/send off", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.send" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /activation in group", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/activation mention", cfg, { CommandAuthorized: false });
    params.isGroup = true;
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.activation" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /reset", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/reset", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.reset" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /compact", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/compact", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.compact" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /tts", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/tts status", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.tts" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for unauthorized /help", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/help", cfg, { CommandAuthorized: false });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);

    const events = listGatewayAuthzDenyEvents({ method: "command.help" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny events for unauthorized info commands", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;

    const checks = [
      { commandBody: "/commands", method: "command.commands" },
      { commandBody: "/status", method: "command.status" },
      { commandBody: "/context", method: "command.context" },
      { commandBody: "/whoami", method: "command.whoami" },
    ] as const;

    for (const check of checks) {
      const params = buildParams(check.commandBody, cfg, { CommandAuthorized: false });
      const result = await handleCommands(params);
      expect(result.shouldContinue).toBe(false);
      const events = listGatewayAuthzDenyEvents({ method: check.method });
      expect(events).toHaveLength(1);
      expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
    }
  });
});

describe("handleCommands bash alias", () => {
  it("routes !poll through the /bash handler", async () => {
    resetBashChatCommandForTests();
    const cfg = {
      commands: { bash: true, text: true },
      whatsapp: { allowFrom: ["*"] },
    } as OpenClawConfig;
    const params = buildParams("!poll", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("No active bash job");
  });

  it("routes !stop through the /bash handler", async () => {
    resetBashChatCommandForTests();
    const cfg = {
      commands: { bash: true, text: true },
      whatsapp: { allowFrom: ["*"] },
    } as OpenClawConfig;
    const params = buildParams("!stop", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("No active bash job");
  });

  it("records authz deny event for unauthorized /bash", async () => {
    resetBashChatCommandForTests();
    const cfg = {
      commands: { bash: true, text: true },
      whatsapp: { allowFrom: ["*"] },
    } as OpenClawConfig;
    const params = buildParams("/bash echo hi", cfg, {
      CommandAuthorized: false,
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply).toBeUndefined();

    const events = listGatewayAuthzDenyEvents({ method: "command.bash" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });
});

describe("handleCommands plugin commands", () => {
  it("dispatches registered plugin commands", async () => {
    clearPluginCommands();
    const result = registerPluginCommand("test-plugin", {
      name: "card",
      description: "Test card",
      handler: async () => ({ text: "from plugin" }),
    });
    expect(result.ok).toBe(true);

    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/card", cfg);
    const commandResult = await handleCommands(params);

    expect(commandResult.shouldContinue).toBe(false);
    expect(commandResult.reply?.text).toBe("from plugin");
    clearPluginCommands();
  });

  it("records authz deny event for unauthorized plugin command requiring auth", async () => {
    clearPluginCommands();
    const result = registerPluginCommand("test-plugin", {
      name: "card",
      description: "Test card",
      handler: async () => ({ text: "from plugin" }),
    });
    expect(result.ok).toBe(true);

    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/card", cfg, { CommandAuthorized: false });
    const commandResult = await handleCommands(params);

    expect(commandResult.shouldContinue).toBe(false);
    expect(commandResult.reply?.text).toContain("requires authorization");
    const events = listGatewayAuthzDenyEvents({ method: "command.plugin" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
    clearPluginCommands();
  });
});

describe("handleCommands identity", () => {
  it("returns sender details for /whoami", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/whoami", cfg, {
      SenderId: "12345",
      SenderUsername: "TestUser",
      ChatType: "direct",
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Channel: whatsapp");
    expect(result.reply?.text).toContain("User id: 12345");
    expect(result.reply?.text).toContain("Username: @TestUser");
    expect(result.reply?.text).toContain("AllowFrom: 12345");
  });
});

describe("handleCommands hooks", () => {
  it("triggers hooks for /new with arguments", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/new take notes", cfg);
    const spy = vi.spyOn(internalHooks, "triggerInternalHook").mockResolvedValue();

    await handleCommands(params);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "command", action: "new" }));
    spy.mockRestore();
  });
});

describe("handleCommands context", () => {
  it("returns context help for /context", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/context", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/context list");
    expect(result.reply?.text).toContain("Inline shortcut");
  });

  it("returns a per-file breakdown for /context list", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/context list", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Injected workspace files:");
    expect(result.reply?.text).toContain("AGENTS.md");
  });

  it("returns a detailed breakdown for /context detail", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/context detail", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Context breakdown (detailed)");
    expect(result.reply?.text).toContain("Top tools (schema size):");
  });
});

describe("handleCommands subagents", () => {
  it("lists subagents when none exist", async () => {
    resetSubagentRegistryForTests();
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/subagents list", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Subagents: none");
  });

  it("lists subagents for the current command session over the target session", async () => {
    resetSubagentRegistryForTests();
    addSubagentRunForTests({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:abc",
      requesterSessionKey: "agent:main:slack:slash:u1",
      requesterDisplayKey: "agent:main:slack:slash:u1",
      task: "do thing",
      cleanup: "keep",
      createdAt: 1000,
      startedAt: 1000,
    });
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/subagents list", cfg, {
      CommandSource: "native",
      CommandTargetSessionKey: "agent:main:main",
    });
    params.sessionKey = "agent:main:slack:slash:u1";
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Subagents (current session)");
    expect(result.reply?.text).toContain("agent:main:subagent:abc");
  });

  it("omits subagent status line when none exist", async () => {
    resetSubagentRegistryForTests();
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as OpenClawConfig;
    const params = buildParams("/status", cfg);
    params.resolvedVerboseLevel = "on";
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).not.toContain("Subagents:");
  });

  it("returns help for unknown subagents action", async () => {
    resetSubagentRegistryForTests();
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/subagents foo", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/subagents");
  });

  it("returns usage for subagents info without target", async () => {
    resetSubagentRegistryForTests();
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/subagents info", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/subagents info");
  });

  it("includes subagent count in /status when active", async () => {
    resetSubagentRegistryForTests();
    addSubagentRunForTests({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:abc",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "do thing",
      cleanup: "keep",
      createdAt: 1000,
      startedAt: 1000,
    });
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as OpenClawConfig;
    const params = buildParams("/status", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("🤖 Subagents: 1 active");
  });

  it("includes subagent details in /status when verbose", async () => {
    resetSubagentRegistryForTests();
    addSubagentRunForTests({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:abc",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "do thing",
      cleanup: "keep",
      createdAt: 1000,
      startedAt: 1000,
    });
    addSubagentRunForTests({
      runId: "run-2",
      childSessionKey: "agent:main:subagent:def",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "finished task",
      cleanup: "keep",
      createdAt: 900,
      startedAt: 900,
      endedAt: 1200,
      outcome: { status: "ok" },
    });
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as OpenClawConfig;
    const params = buildParams("/status", cfg);
    params.resolvedVerboseLevel = "on";
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("🤖 Subagents: 1 active");
    expect(result.reply?.text).toContain("· 1 done");
  });

  it("returns info for a subagent", async () => {
    resetSubagentRegistryForTests();
    addSubagentRunForTests({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:abc",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "do thing",
      cleanup: "keep",
      createdAt: 1000,
      startedAt: 1000,
      endedAt: 2000,
      outcome: { status: "ok" },
    });
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as OpenClawConfig;
    const params = buildParams("/subagents info 1", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Subagent info");
    expect(result.reply?.text).toContain("Run: run-1");
    expect(result.reply?.text).toContain("Status: done");
  });
});

describe("handleCommands /tts", () => {
  it("returns status for bare /tts on text command surfaces", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { tts: { prefsPath: path.join(testWorkspaceDir, "tts.json") } },
    } as OpenClawConfig;
    const params = buildParams("/tts", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("TTS status");
  });

  it("blocks /tts setting changes for non-admin gateway principals in strict mode", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { tts: { prefsPath: path.join(testWorkspaceDir, "tts-strict-user.json") } },
    } as OpenClawConfig;
    const params = buildParams("/tts on", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayClientScopes: ["operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/tts settings are admin-only");

    const events = listGatewayAuthzDenyEvents({ method: "command.tts" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
  });

  it("blocks /tts setting changes for non-gateway senders in strict mode", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { tts: { prefsPath: path.join(testWorkspaceDir, "tts-strict-non-gateway.json") } },
    } as OpenClawConfig;
    const params = buildParams("/tts on", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/tts settings are admin-only");

    const events = listGatewayAuthzDenyEvents({ method: "command.tts" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("blocks /tts setting changes when gateway principal has admin scope but non-admin role", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { tts: { prefsPath: path.join(testWorkspaceDir, "tts-strict-admin-scope-user-role.json") } },
    } as OpenClawConfig;
    const params = buildParams("/tts on", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayOwnerRole: "user",
      GatewayClientScopes: ["operator.admin", "operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("/tts settings are admin-only");

    const events = listGatewayAuthzDenyEvents({ method: "command.tts" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.actorRole).toBe("user");
  });

  it("allows non-admin gateway principals to use /tts status in strict mode", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { tts: { prefsPath: path.join(testWorkspaceDir, "tts-strict-status.json") } },
    } as OpenClawConfig;
    const params = buildParams("/tts status", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayClientScopes: ["operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("TTS status");

    const events = listGatewayAuthzDenyEvents({ method: "command.tts" });
    expect(events).toHaveLength(0);
  });

  it("allows non-admin gateway principals to use /tts audio help path in strict mode", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { tts: { prefsPath: path.join(testWorkspaceDir, "tts-strict-audio.json") } },
    } as OpenClawConfig;
    const params = buildParams("/tts audio", cfg, {
      GatewayOwnerUserId: "user-1",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayClientScopes: ["operator.write"],
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Usage: /tts audio");

    const events = listGatewayAuthzDenyEvents({ method: "command.tts" });
    expect(events).toHaveLength(0);
  });
});
