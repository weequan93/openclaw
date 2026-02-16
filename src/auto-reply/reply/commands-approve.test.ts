import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "../../gateway/authz-denied-events.js";
import { callGateway } from "../../gateway/call.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

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

describe("/approve command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authzDeniedEventsTest.clear();
  });

  it("rejects invalid usage", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/approve", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Usage: /approve");
  });

  it("submits approval", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      SenderId: "123",
      GatewayOwnerUserId: "user-1",
      GatewayOwnerAlias: "Alice",
      GatewayOwnerPrincipalId: "principal:user-1",
    });

    const mockCallGateway = vi.mocked(callGateway);
    mockCallGateway.mockResolvedValueOnce({ ok: true });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Exec approval allow-once submitted");
    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "exec.approval.resolve",
        params: { id: "abc", decision: "allow-once" },
        identity: { userId: "user-1", principalId: "principal:user-1", alias: "Alice" },
      }),
    );
  });

  it("rejects gateway clients without approvals scope", async () => {
    const cfg = {
      commands: { text: true },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      Provider: "webchat",
      Surface: "webchat",
      GatewayClientScopes: ["operator.write"],
    });

    const mockCallGateway = vi.mocked(callGateway);
    mockCallGateway.mockResolvedValueOnce({ ok: true });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("requires operator.approvals");
    expect(mockCallGateway).not.toHaveBeenCalled();
  });

  it("allows gateway clients with approvals scope", async () => {
    const cfg = {
      commands: { text: true },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      Provider: "webchat",
      Surface: "webchat",
      GatewayClientScopes: ["operator.approvals"],
    });

    const mockCallGateway = vi.mocked(callGateway);
    mockCallGateway.mockResolvedValueOnce({ ok: true });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Exec approval allow-once submitted");
    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "exec.approval.resolve",
        params: { id: "abc", decision: "allow-once" },
      }),
    );
    const events = listGatewayAuthzDenyEvents({ method: "command.approve" });
    expect(events).toHaveLength(0);
  });

  it("allows gateway clients with admin scope", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      Provider: "webchat",
      Surface: "webchat",
      GatewayOwnerRole: "admin",
      GatewayClientScopes: ["operator.admin"],
    });

    const mockCallGateway = vi.mocked(callGateway);
    mockCallGateway.mockResolvedValueOnce({ ok: true });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Exec approval allow-once submitted");
    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "exec.approval.resolve",
        params: { id: "abc", decision: "allow-once" },
      }),
    );
    const events = listGatewayAuthzDenyEvents({ method: "command.approve" });
    expect(events).toHaveLength(0);
  });

  it("blocks gateway clients with admin scope when role is missing in strict mode", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      Provider: "webchat",
      Surface: "webchat",
      GatewayClientScopes: ["operator.admin"],
    });

    const mockCallGateway = vi.mocked(callGateway);
    mockCallGateway.mockResolvedValueOnce({ ok: true });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("admin scope requires admin principal role");
    expect(mockCallGateway).not.toHaveBeenCalled();
    const events = listGatewayAuthzDenyEvents({ method: "command.approve" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.actorRole).toBeNull();
  });

  it("blocks gateway clients with admin scope when role is non-admin", async () => {
    const cfg = {
      commands: { text: true },
      gateway: { multiUser: { mode: "strict" } },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      Provider: "webchat",
      Surface: "webchat",
      GatewayOwnerRole: "user",
      GatewayClientScopes: ["operator.admin"],
    });

    const mockCallGateway = vi.mocked(callGateway);
    mockCallGateway.mockResolvedValueOnce({ ok: true });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("admin scope requires admin principal role");
    expect(mockCallGateway).not.toHaveBeenCalled();
    const events = listGatewayAuthzDenyEvents({ method: "command.approve" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("ROLE_FORBIDDEN");
    expect(events[0]?.actorRole).toBe("user");
  });

  it("records authz deny event for unauthorized sender", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["owner-only"] } },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      CommandAuthorized: false,
    });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    const events = listGatewayAuthzDenyEvents({ method: "command.approve" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });

  it("records authz deny event for missing approvals scope", async () => {
    const cfg = {
      commands: { text: true },
    } as OpenClawConfig;
    const params = buildParams("/approve abc allow-once", cfg, {
      Provider: "webchat",
      Surface: "webchat",
      GatewayOwnerUserId: "user-1",
      GatewayOwnerAlias: "Alice",
      GatewayOwnerPrincipalId: "principal:user-1",
      GatewayClientScopes: ["operator.write"],
    });

    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("requires operator.approvals");

    const events = listGatewayAuthzDenyEvents({ method: "command.approve" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("SCOPE_MISSING");
    expect(events[0]?.userId).toBe("user-1");
    expect(events[0]?.userAlias).toBe("Alice");
    expect(events[0]?.principalId).toBe("principal:user-1");
  });
});
