import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "./navigation.ts";
import { setTabFromRoute } from "./app-settings.ts";

type SettingsHost = Parameters<typeof setTabFromRoute>[0] & {
  logsPollInterval: ReturnType<typeof setInterval> | null;
  debugPollInterval: ReturnType<typeof setInterval> | null;
  securityPollInterval: ReturnType<typeof setInterval> | null;
};

const createHost = (tab: Tab): SettingsHost => ({
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
  applySessionKey: "main",
  sessionKey: "main",
  tab,
  connected: false,
  chatHasAutoScrolled: false,
  logsAtBottom: false,
  eventLog: [],
  eventLogBuffer: [],
  basePath: "",
  themeMedia: null,
  themeMediaHandler: null,
  logsPollInterval: null,
  debugPollInterval: null,
  securityPollInterval: null,
});

describe("setTabFromRoute", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and stops log polling based on the tab", () => {
    const host = createHost("chat");

    setTabFromRoute(host, "logs");
    expect(host.logsPollInterval).not.toBeNull();
    expect(host.debugPollInterval).toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.logsPollInterval).toBeNull();
  });

  it("starts and stops debug polling based on the tab", () => {
    const host = createHost("chat");

    setTabFromRoute(host, "debug");
    expect(host.debugPollInterval).not.toBeNull();
    expect(host.logsPollInterval).toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.debugPollInterval).toBeNull();
  });

  it("starts and stops security polling based on the tab", () => {
    const host = createHost("chat");

    setTabFromRoute(host, "security");
    expect(host.securityPollInterval).not.toBeNull();
    expect(host.logsPollInterval).toBeNull();
    expect(host.debugPollInterval).toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.securityPollInterval).toBeNull();
  });

  it("redirects admin-only tab routes to chat for non-admin principal", () => {
    const host = createHost("chat");
    host.hello = {
      auth: {
        principalRole: "user",
        role: "operator",
        scopes: ["operator.admin"],
      },
    };

    setTabFromRoute(host, "security");

    expect(host.tab).toBe("chat");
    expect(host.securityPollInterval).toBeNull();
    expect(host.debugPollInterval).toBeNull();
    expect(host.logsPollInterval).toBeNull();
  });
});
