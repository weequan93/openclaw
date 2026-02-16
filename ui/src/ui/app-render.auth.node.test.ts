import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadChannels: vi.fn(),
  loadNodes: vi.fn(),
  loadDevices: vi.fn(),
  approveDevicePairing: vi.fn(),
  rejectDevicePairing: vi.fn(),
  rotateDeviceToken: vi.fn(),
  revokeDeviceToken: vi.fn(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  updateConfigFormValue: vi.fn(),
  removeConfigFormValue: vi.fn(),
  loadExecApprovals: vi.fn(),
  saveExecApprovals: vi.fn(),
  updateExecApprovalsFormValue: vi.fn(),
  removeExecApprovalsFormValue: vi.fn(),
  renderChannels: vi.fn(() => undefined),
  renderNodes: vi.fn(() => undefined),
}));

vi.mock("./controllers/channels.ts", () => ({
  loadChannels: mocks.loadChannels,
}));

vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: mocks.loadNodes,
}));

vi.mock("./controllers/devices.ts", () => ({
  loadDevices: mocks.loadDevices,
  approveDevicePairing: mocks.approveDevicePairing,
  rejectDevicePairing: mocks.rejectDevicePairing,
  rotateDeviceToken: mocks.rotateDeviceToken,
  revokeDeviceToken: mocks.revokeDeviceToken,
}));

vi.mock("./controllers/config.ts", () => ({
  applyConfig: vi.fn(),
  loadConfig: mocks.loadConfig,
  runUpdate: vi.fn(),
  saveConfig: mocks.saveConfig,
  updateConfigFormValue: mocks.updateConfigFormValue,
  removeConfigFormValue: mocks.removeConfigFormValue,
}));

vi.mock("./controllers/exec-approvals.ts", () => ({
  loadExecApprovals: mocks.loadExecApprovals,
  saveExecApprovals: mocks.saveExecApprovals,
  updateExecApprovalsFormValue: mocks.updateExecApprovalsFormValue,
  removeExecApprovalsFormValue: mocks.removeExecApprovalsFormValue,
}));

vi.mock("./views/channels.ts", () => ({
  renderChannels: mocks.renderChannels,
}));

vi.mock("./views/nodes.ts", () => ({
  renderNodes: mocks.renderNodes,
}));

const { renderApp } = await import("./app-render.ts");

type RenderChannelsProps = {
  canManage?: boolean;
  onRefresh: (...args: unknown[]) => unknown;
  onWhatsAppStart: (...args: unknown[]) => unknown;
  onWhatsAppWait: (...args: unknown[]) => unknown;
  onWhatsAppLogout: (...args: unknown[]) => unknown;
  onConfigPatch: (...args: unknown[]) => unknown;
  onConfigSave: (...args: unknown[]) => unknown;
  onConfigReload: (...args: unknown[]) => unknown;
  onNostrProfileEdit: (...args: unknown[]) => unknown;
  onNostrProfileCancel: (...args: unknown[]) => unknown;
  onNostrProfileFieldChange: (...args: unknown[]) => unknown;
  onNostrProfileSave: (...args: unknown[]) => unknown;
  onNostrProfileImport: (...args: unknown[]) => unknown;
  onNostrProfileToggleAdvanced: (...args: unknown[]) => unknown;
};

type RenderNodesProps = {
  canManage?: boolean;
  onRefresh: (...args: unknown[]) => unknown;
  onDevicesRefresh: (...args: unknown[]) => unknown;
  onDeviceApprove: (...args: unknown[]) => unknown;
  onDeviceReject: (...args: unknown[]) => unknown;
  onDeviceRotate: (...args: unknown[]) => unknown;
  onDeviceRevoke: (...args: unknown[]) => unknown;
  onLoadConfig: (...args: unknown[]) => unknown;
  onLoadExecApprovals: (...args: unknown[]) => unknown;
  onBindDefault: (...args: unknown[]) => unknown;
  onBindAgent: (...args: unknown[]) => unknown;
  onSaveBindings: (...args: unknown[]) => unknown;
  onExecApprovalsTargetChange: (...args: unknown[]) => unknown;
  onExecApprovalsSelectAgent: (...args: unknown[]) => unknown;
  onExecApprovalsPatch: (...args: unknown[]) => unknown;
  onExecApprovalsRemove: (...args: unknown[]) => unknown;
  onSaveExecApprovals: (...args: unknown[]) => unknown;
};

function createState(tab: "channels" | "nodes", principalRole?: "admin" | "user") {
  return {
    tab,
    onboarding: false,
    connected: true,
    basePath: "",
    lastError: null,
    password: "",
    sessionKey: "main",
    chatMessage: "",
    chatAvatarUrl: null,
    hello: {
      auth: {
        ...(principalRole ? { principalRole } : {}),
        role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write"],
      },
    },
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
    theme: "system",
    themeResolved: "dark",
    applySettings: vi.fn(),
    setTheme: vi.fn(),
    setTab: vi.fn(),
    connect: vi.fn(),
    loadOverview: vi.fn(),
    loadAssistantIdentity: vi.fn(async () => undefined),
    resetToolStream: vi.fn(),

    presenceEntries: [],
    sessionsResult: null,
    cronStatus: null,

    channelsLoading: false,
    channelsSnapshot: null,
    channelsError: null,
    channelsLastSuccess: null,
    whatsappLoginMessage: null,
    whatsappLoginQrDataUrl: null,
    whatsappLoginConnected: null,
    whatsappBusy: false,
    configSchema: null,
    configSchemaLoading: false,
    configForm: null,
    configSnapshot: null,
    configUiHints: {},
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    handleWhatsAppStart: vi.fn(async () => undefined),
    handleWhatsAppWait: vi.fn(async () => undefined),
    handleWhatsAppLogout: vi.fn(async () => undefined),
    handleChannelConfigSave: vi.fn(async () => undefined),
    handleChannelConfigReload: vi.fn(async () => undefined),
    handleNostrProfileEdit: vi.fn(),
    handleNostrProfileCancel: vi.fn(),
    handleNostrProfileFieldChange: vi.fn(),
    handleNostrProfileSave: vi.fn(async () => undefined),
    handleNostrProfileImport: vi.fn(async () => undefined),
    handleNostrProfileToggleAdvanced: vi.fn(),

    nodesLoading: false,
    nodes: [],
    devicesLoading: false,
    devicesError: null,
    devicesList: null,
    execApprovalsLoading: false,
    execApprovalsSaving: false,
    execApprovalsDirty: false,
    execApprovalsSnapshot: null,
    execApprovalsForm: null,
    execApprovalsSelectedAgent: null,
    execApprovalsTarget: "gateway" as const,
    execApprovalsTargetNodeId: null,
    execApprovalQueue: [],
    execApprovalBusy: false,
    execApprovalError: null,
    configFormMode: "form" as const,
    pendingGatewayUrl: null,
    handleExecApprovalDecision: vi.fn(),
    handleGatewayUrlConfirm: vi.fn(),
    handleGatewayUrlCancel: vi.fn(),
  };
}

describe("renderApp callback auth gating", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) {
      fn.mockClear();
    }
  });

  it("keeps channels mutation callbacks no-op for non-admin principals", () => {
    const state = createState("channels", "user");

    renderApp(state as never);

    const channelsCalls = mocks.renderChannels.mock.calls as unknown as Array<[unknown]>;
    expect(channelsCalls).toHaveLength(1);
    const props = channelsCalls[0]?.[0] as RenderChannelsProps;
    expect(props.canManage).toBe(false);

    props.onRefresh(true);
    props.onWhatsAppStart(true);
    props.onWhatsAppWait();
    props.onWhatsAppLogout();
    props.onConfigPatch(["channels", "whatsapp", "enabled"], true);
    props.onConfigSave();
    props.onConfigReload();
    props.onNostrProfileEdit("default", null);
    props.onNostrProfileCancel();
    props.onNostrProfileFieldChange("name", "alice");
    props.onNostrProfileSave();
    props.onNostrProfileImport();
    props.onNostrProfileToggleAdvanced();

    expect(mocks.loadChannels).toHaveBeenCalledTimes(1);
    expect(state.handleWhatsAppStart).not.toHaveBeenCalled();
    expect(state.handleWhatsAppWait).not.toHaveBeenCalled();
    expect(state.handleWhatsAppLogout).not.toHaveBeenCalled();
    expect(state.handleChannelConfigSave).not.toHaveBeenCalled();
    expect(state.handleChannelConfigReload).not.toHaveBeenCalled();
    expect(state.handleNostrProfileEdit).not.toHaveBeenCalled();
    expect(state.handleNostrProfileCancel).not.toHaveBeenCalled();
    expect(state.handleNostrProfileFieldChange).not.toHaveBeenCalled();
    expect(state.handleNostrProfileSave).not.toHaveBeenCalled();
    expect(state.handleNostrProfileImport).not.toHaveBeenCalled();
    expect(state.handleNostrProfileToggleAdvanced).not.toHaveBeenCalled();
    expect(mocks.updateConfigFormValue).not.toHaveBeenCalled();
  });

  it("keeps nodes mutation callbacks no-op for non-admin principals", () => {
    const state = createState("nodes", "user");

    renderApp(state as never);

    const nodesCalls = mocks.renderNodes.mock.calls as unknown as Array<[unknown]>;
    expect(nodesCalls).toHaveLength(1);
    const props = nodesCalls[0]?.[0] as RenderNodesProps;
    expect(props.canManage).toBe(false);

    props.onRefresh();
    props.onDevicesRefresh();
    props.onDeviceApprove("request-1");
    props.onDeviceReject("request-1");
    props.onDeviceRotate("device-1", "operator", ["operator.read"]);
    props.onDeviceRevoke("device-1", "operator");
    props.onLoadConfig();
    props.onLoadExecApprovals();
    props.onBindDefault("node-1");
    props.onBindAgent(0, "node-1");
    props.onSaveBindings();
    props.onExecApprovalsTargetChange("node", "node-1");
    props.onExecApprovalsSelectAgent("main");
    props.onExecApprovalsPatch(["defaults", "security"], "allowlist");
    props.onExecApprovalsRemove(["defaults", "security"]);
    props.onSaveExecApprovals();

    expect(mocks.loadNodes).toHaveBeenCalledTimes(1);
    expect(mocks.loadDevices).toHaveBeenCalledTimes(1);
    expect(mocks.approveDevicePairing).not.toHaveBeenCalled();
    expect(mocks.rejectDevicePairing).not.toHaveBeenCalled();
    expect(mocks.rotateDeviceToken).not.toHaveBeenCalled();
    expect(mocks.revokeDeviceToken).not.toHaveBeenCalled();
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(mocks.updateConfigFormValue).not.toHaveBeenCalled();
    expect(mocks.removeConfigFormValue).not.toHaveBeenCalled();
    expect(mocks.loadExecApprovals).not.toHaveBeenCalled();
    expect(mocks.saveExecApprovals).not.toHaveBeenCalled();
    expect(mocks.updateExecApprovalsFormValue).not.toHaveBeenCalled();
    expect(mocks.removeExecApprovalsFormValue).not.toHaveBeenCalled();
    expect(state.execApprovalsTarget).toBe("gateway");
    expect(state.execApprovalsTargetNodeId).toBeNull();
    expect(state.execApprovalsSelectedAgent).toBeNull();
  });

  it("keeps channels mutation callbacks no-op when principalRole is missing on connected sessions", () => {
    const state = createState("channels");

    renderApp(state as never);

    const channelsCalls = mocks.renderChannels.mock.calls as unknown as Array<[unknown]>;
    expect(channelsCalls).toHaveLength(1);
    const props = channelsCalls[0]?.[0] as RenderChannelsProps;
    expect(props.canManage).toBe(false);
  });
});
