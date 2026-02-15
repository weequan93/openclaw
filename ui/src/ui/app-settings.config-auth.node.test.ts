import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn(async () => undefined);
const loadConfigSchemaMock = vi.fn(async () => undefined);
const loadDebugMock = vi.fn(async () => undefined);
const loadSecurityMock = vi.fn(async () => undefined);
const loadChannelsMock = vi.fn(async () => undefined);
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
    loadConfigMock.mockClear();
    loadConfigSchemaMock.mockClear();
    loadDebugMock.mockClear();
    loadSecurityMock.mockClear();
    loadChannelsMock.mockClear();
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
});
