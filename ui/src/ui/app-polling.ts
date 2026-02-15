import type { OpenClawApp } from "./app.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadSecurity } from "./controllers/security.ts";

type PollInterval = ReturnType<typeof setInterval>;

type PollingHost = {
  nodesPollInterval: PollInterval | null;
  logsPollInterval: PollInterval | null;
  debugPollInterval: PollInterval | null;
  securityPollInterval: PollInterval | null;
  securityPinnedHistory?: boolean;
  tab: string;
};

export function startNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval != null) {
    return;
  }
  host.nodesPollInterval = globalThis.setInterval(
    () => void loadNodes(host as unknown as OpenClawApp, { quiet: true }),
    5000,
  );
}

export function stopNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval == null) {
    return;
  }
  clearInterval(host.nodesPollInterval);
  host.nodesPollInterval = null;
}

export function startLogsPolling(host: PollingHost) {
  if (host.logsPollInterval != null) {
    return;
  }
  host.logsPollInterval = globalThis.setInterval(() => {
    if (host.tab !== "logs") {
      return;
    }
    void loadLogs(host as unknown as OpenClawApp, { quiet: true });
  }, 2000);
}

export function stopLogsPolling(host: PollingHost) {
  if (host.logsPollInterval == null) {
    return;
  }
  clearInterval(host.logsPollInterval);
  host.logsPollInterval = null;
}

export function startDebugPolling(host: PollingHost) {
  if (host.debugPollInterval != null) {
    return;
  }
  host.debugPollInterval = globalThis.setInterval(() => {
    if (host.tab !== "debug") {
      return;
    }
    void loadDebug(host as unknown as OpenClawApp);
  }, 3000);
}

export function stopDebugPolling(host: PollingHost) {
  if (host.debugPollInterval == null) {
    return;
  }
  clearInterval(host.debugPollInterval);
  host.debugPollInterval = null;
}

export function startSecurityPolling(host: PollingHost) {
  if (host.securityPollInterval != null) {
    return;
  }
  host.securityPollInterval = globalThis.setInterval(() => {
    if (host.tab !== "security") {
      return;
    }
    if (host.securityPinnedHistory) {
      return;
    }
    void loadSecurity(host as unknown as OpenClawApp);
  }, 3000);
}

export function stopSecurityPolling(host: PollingHost) {
  if (host.securityPollInterval == null) {
    return;
  }
  clearInterval(host.securityPollInterval);
  host.securityPollInterval = null;
}
