import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn(async () => undefined);
const loadConfigSchemaMock = vi.fn(async () => undefined);
const loadDebugMock = vi.fn(async () => undefined);
const loadSecurityMock = vi.fn(async () => undefined);
const loadChannelsMock = vi.fn(async () => undefined);
const loadPresenceMock = vi.fn(async () => undefined);
const loadSessionsMock = vi.fn(async () => undefined);
const loadCronStatusMock = vi.fn(async () => undefined);
const loadNodesMock = vi.fn(async () => undefined);
const loadDevicesMock = vi.fn(async () => undefined);
const loadExecApprovalsMock = vi.fn(async () => undefined);

vi.mock("./controllers/config.ts", () => ({
  loadConfig: loadConfigMock,
  loadConfigSchema: loadConfigSchemaMock,
}));

vi.mock("./controllers/debug.ts", () => ({
  loadDebug: loadDebugMock,
}));

vi.mock("./controllers/security.ts", () => ({
  loadSecurity: loadSecurityMock,
}));

vi.mock("./controllers/channels.ts", () => ({
  loadChannels: loadChannelsMock,
}));

vi.mock("./controllers/presence.ts", () => ({
  loadPresence: loadPresenceMock,
}));

vi.mock("./controllers/sessions.ts", () => ({
  loadSessions: loadSessionsMock,
}));

vi.mock("./controllers/cron.ts", () => ({
  loadCronStatus: loadCronStatusMock,
  loadCronJobs: vi.fn(async () => undefined),
}));

vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: loadNodesMock,
}));

vi.mock("./controllers/devices.ts", () => ({
  loadDevices: loadDevicesMock,
}));

vi.mock("./controllers/exec-approvals.ts", () => ({
  loadExecApprovals: loadExecApprovalsMock,
}));

describe("refreshActiveTab config auth gating", async () => {
  const { refreshActiveTab, setTabFromRoute } = await import("./app-settings.ts");

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    loadConfigMock.mockClear();
    loadConfigSchemaMock.mockClear();
    loadDebugMock.mockClear();
    loadSecurityMock.mockClear();
    loadChannelsMock.mockClear();
    loadPresenceMock.mockClear();
    loadSessionsMock.mockClear();
    loadCronStatusMock.mockClear();
    loadNodesMock.mockClear();
    loadDevicesMock.mockClear();
    loadExecApprovalsMock.mockClear();
  });

  it("skips config loads for non-admin principal role", async () => {
    const host = {
      tab: "config",
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadConfigSchemaMock).not.toHaveBeenCalled();
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it("allows config loads for admin principal role", async () => {
    const host = {
      tab: "config",
      hello: {
        auth: {
          principalRole: "admin",
          role: "operator",
          scopes: ["operator.read"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadConfigSchemaMock).toHaveBeenCalledTimes(1);
    expect(loadConfigMock).toHaveBeenCalledTimes(1);
  });

  it("skips security loads for non-admin principal role", async () => {
    const host = {
      tab: "security",
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadSecurityMock).not.toHaveBeenCalled();
  });

  it("skips debug loads for non-admin principal role", async () => {
    const host = {
      tab: "debug",
      eventLog: [],
      eventLogBuffer: [],
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadDebugMock).not.toHaveBeenCalled();
  });

  it("routes non-admin admin-only tabs back to chat", () => {
    const host = {
      tab: "chat",
      connected: false,
      chatHasAutoScrolled: false,
      logsPollInterval: null,
      debugPollInterval: null,
      securityPollInterval: null,
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    } as unknown as Parameters<typeof setTabFromRoute>[0] & {
      logsPollInterval: ReturnType<typeof setInterval> | null;
      debugPollInterval: ReturnType<typeof setInterval> | null;
      securityPollInterval: ReturnType<typeof setInterval> | null;
    };

    setTabFromRoute(host, "security");

    expect(host.tab).toBe("chat");
    expect(host.logsPollInterval).toBeNull();
    expect(host.debugPollInterval).toBeNull();
    expect(host.securityPollInterval).toBeNull();
  });

  it("routes non-admin operational admin tabs back to chat", () => {
    const host = {
      tab: "chat",
      connected: false,
      chatHasAutoScrolled: false,
      logsPollInterval: null,
      debugPollInterval: null,
      securityPollInterval: null,
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.read"],
        },
      },
    } as unknown as Parameters<typeof setTabFromRoute>[0] & {
      logsPollInterval: ReturnType<typeof setInterval> | null;
      debugPollInterval: ReturnType<typeof setInterval> | null;
      securityPollInterval: ReturnType<typeof setInterval> | null;
    };

    setTabFromRoute(host, "instances");
    expect(host.tab).toBe("chat");

    setTabFromRoute(host, "cron");
    expect(host.tab).toBe("chat");
  });

  it("loads channels tab without config reads for non-admin principal role", async () => {
    const host = {
      tab: "channels",
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.read"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadChannelsMock).toHaveBeenCalledTimes(1);
    expect(loadConfigSchemaMock).not.toHaveBeenCalled();
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it("loads nodes tab without config or approvals reads for non-admin principal role", async () => {
    const host = {
      tab: "nodes",
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.read"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadNodesMock).toHaveBeenCalledTimes(1);
    expect(loadDevicesMock).toHaveBeenCalledTimes(1);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(loadExecApprovalsMock).not.toHaveBeenCalled();
  });

  it("loads non-admin overview without presence or cron status reads", async () => {
    const host = {
      tab: "overview",
      hello: {
        auth: {
          principalRole: "user",
          role: "operator",
          scopes: ["operator.read"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadChannelsMock).toHaveBeenCalledTimes(1);
    expect(loadSessionsMock).toHaveBeenCalledTimes(1);
    expect(loadPresenceMock).not.toHaveBeenCalled();
    expect(loadCronStatusMock).not.toHaveBeenCalled();
    expect(loadDebugMock).not.toHaveBeenCalled();
  });

  it("treats connected sessions without hello auth metadata as non-admin", async () => {
    const host = {
      tab: "config",
      connected: true,
      hello: {
        auth: null,
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadConfigSchemaMock).not.toHaveBeenCalled();
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it("treats connected sessions without principalRole as non-admin even with operator.admin scope", async () => {
    const host = {
      tab: "config",
      connected: true,
      hello: {
        auth: {
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadConfigSchemaMock).not.toHaveBeenCalled();
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it("treats connected sessions without hello payload as non-admin", async () => {
    const host = {
      tab: "config",
      connected: true,
    } as unknown as Parameters<typeof refreshActiveTab>[0];

    await refreshActiveTab(host);

    expect(loadConfigSchemaMock).not.toHaveBeenCalled();
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it("routes connected sessions without hello auth metadata away from admin tabs", () => {
    const host = {
      tab: "chat",
      connected: true,
      chatHasAutoScrolled: false,
      chatUserNearBottom: true,
      chatNewMessagesBelow: false,
      chatScrollFrame: null,
      chatScrollTimeout: null,
      querySelector: () => null,
      updateComplete: Promise.resolve(),
      style: {} as CSSStyleDeclaration,
      topbarObserver: null,
      logsPollInterval: null,
      debugPollInterval: null,
      securityPollInterval: null,
      hello: {
        auth: null,
      },
    } as unknown as Parameters<typeof setTabFromRoute>[0] & {
      logsPollInterval: ReturnType<typeof setInterval> | null;
      debugPollInterval: ReturnType<typeof setInterval> | null;
      securityPollInterval: ReturnType<typeof setInterval> | null;
    };

    setTabFromRoute(host, "security");

    expect(host.tab).toBe("chat");
    expect(host.securityPollInterval).toBeNull();
  });

  it("routes connected sessions without hello payload away from admin tabs", () => {
    const host = {
      tab: "chat",
      connected: true,
      chatHasAutoScrolled: false,
      chatUserNearBottom: true,
      chatNewMessagesBelow: false,
      chatScrollFrame: null,
      chatScrollTimeout: null,
      querySelector: () => null,
      updateComplete: Promise.resolve(),
      style: {} as CSSStyleDeclaration,
      topbarObserver: null,
      logsPollInterval: null,
      debugPollInterval: null,
      securityPollInterval: null,
    } as unknown as Parameters<typeof setTabFromRoute>[0] & {
      logsPollInterval: ReturnType<typeof setInterval> | null;
      debugPollInterval: ReturnType<typeof setInterval> | null;
      securityPollInterval: ReturnType<typeof setInterval> | null;
    };

    setTabFromRoute(host, "security");

    expect(host.tab).toBe("chat");
    expect(host.securityPollInterval).toBeNull();
  });
});
