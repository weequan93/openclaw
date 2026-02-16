import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAssistantIdentity: vi.fn(async () => undefined),
  loadAgents: vi.fn(async () => undefined),
  loadNodes: vi.fn(async () => undefined),
  loadDevices: vi.fn(async () => undefined),
  refreshChat: vi.fn(async () => undefined),
  flushChatQueueForEvent: vi.fn(async () => undefined),
  scheduleChatScroll: vi.fn(),
  scheduleLogsScroll: vi.fn(),
}));

vi.mock("./controllers/assistant-identity.ts", () => ({
  loadAssistantIdentity: mocks.loadAssistantIdentity,
}));

vi.mock("./controllers/agents.ts", () => ({
  loadAgents: mocks.loadAgents,
}));

vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: mocks.loadNodes,
}));

vi.mock("./controllers/devices.ts", () => ({
  loadDevices: mocks.loadDevices,
}));

vi.mock("./app-chat.ts", () => ({
  CHAT_SESSIONS_ACTIVE_MINUTES: 30,
  flushChatQueueForEvent: mocks.flushChatQueueForEvent,
  refreshChat: mocks.refreshChat,
}));

vi.mock("./app-scroll.ts", () => ({
  scheduleChatScroll: mocks.scheduleChatScroll,
  scheduleLogsScroll: mocks.scheduleLogsScroll,
}));

const { handleGatewayHello } = await import("./app-gateway.ts");

function createHost() {
  return {
    settings: {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    password: "",
    client: null,
    connected: false,
    hello: null,
    lastError: "stale error",
    eventLogBuffer: [],
    eventLog: [],
    tab: "security" as const,
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    debugHealth: null,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    assistantAgentId: null,
    sessionKey: "main",
    chatRunId: "run-1",
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
    chatStream: "partial",
    chatStreamStartedAt: Date.now(),
    toolStreamById: new Map<string, unknown>(),
    toolStreamOrder: ["tool-1"],
    chatToolMessages: [{ role: "assistant" }],
    toolStreamSyncTimer: null,
    chatHasAutoScrolled: false,
    logsPollInterval: null,
    debugPollInterval: null,
    securityPollInterval: null,
  };
}

describe("handleGatewayHello", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) {
      fn.mockClear();
    }
  });

  it("revalidates active tab authz and reroutes non-admin hello sessions away from admin-only tabs", () => {
    const host = createHost();
    const hello = {
      type: "hello-ok",
      protocol: 3,
      auth: {
        role: "operator",
        principalRole: "user",
        scopes: ["operator.admin", "operator.read", "operator.write"],
      },
    };

    handleGatewayHello(host as never, hello as never);

    expect(host.connected).toBe(true);
    expect(host.lastError).toBeNull();
    expect(host.hello).toEqual(hello);
    expect(host.tab).toBe("chat");
    expect(host.securityPollInterval).toBeNull();
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatStreamStartedAt).toBeNull();
    expect(host.toolStreamOrder).toEqual([]);
    expect(host.chatToolMessages).toEqual([]);

    expect(mocks.loadAssistantIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.loadAgents).toHaveBeenCalledTimes(1);
    expect(mocks.loadNodes).toHaveBeenCalledTimes(1);
    expect(mocks.loadDevices).toHaveBeenCalledTimes(1);
  });

  it("treats missing principalRole as non-admin on hello revalidation even with operator.admin scope", () => {
    const host = createHost();
    const hello = {
      type: "hello-ok",
      protocol: 3,
      auth: {
        role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write"],
      },
    };

    handleGatewayHello(host as never, hello as never);

    expect(host.connected).toBe(true);
    expect(host.hello).toEqual(hello);
    expect(host.tab).toBe("chat");
    expect(host.securityPollInterval).toBeNull();
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatStreamStartedAt).toBeNull();

    expect(mocks.loadAssistantIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.loadAgents).toHaveBeenCalledTimes(1);
    expect(mocks.loadNodes).toHaveBeenCalledTimes(1);
    expect(mocks.loadDevices).toHaveBeenCalledTimes(1);
  });
});
