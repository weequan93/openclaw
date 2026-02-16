import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSessionEntryMock = vi.fn();
const resolveAgentRunOwnerMock = vi.fn();

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: (...args: unknown[]) => loadSessionEntryMock(...args),
}));

vi.mock("./server-methods/agent-job.js", () => ({
  resolveAgentRunOwner: (...args: unknown[]) => resolveAgentRunOwnerMock(...args),
}));

import { registerAgentRunContext, resetAgentRunContextForTest } from "../infra/agent-events.js";
import {
  createAgentEventHandler,
  createChatRunState,
  createToolEventRecipientRegistry,
} from "./server-chat.js";

describe("tool verbose owner scoping", () => {
  beforeEach(() => {
    loadSessionEntryMock.mockReset();
    resolveAgentRunOwnerMock.mockReset();
    resolveAgentRunOwnerMock.mockReturnValue(undefined);
    loadSessionEntryMock.mockReturnValue({
      cfg: {
        agents: {
          defaults: {
            verboseDefault: "off",
          },
        },
      },
      entry: {},
    });
  });

  afterEach(() => {
    resetAgentRunContextForTest();
  });

  it("uses run owner for session lookup in tool verbose fallback", () => {
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();

    registerAgentRunContext("run-owner", { sessionKey: "session-1" });
    resolveAgentRunOwnerMock.mockReturnValue("user-1");
    loadSessionEntryMock.mockReturnValue({
      cfg: {
        agents: {
          defaults: {
            verboseDefault: "off",
          },
        },
      },
      entry: {
        verboseLevel: "on",
      },
    });
    toolEventRecipients.add("run-owner", "conn-1");

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => "session-1",
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    handler({
      runId: "run-owner",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t-owner" },
    });

    expect(loadSessionEntryMock).toHaveBeenCalledWith("session-1", {
      ownerUserId: "user-1",
    });
    expect(nodeSendToSession).toHaveBeenCalled();
  });

  it("passes undefined owner when run owner is not available", () => {
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();

    registerAgentRunContext("run-no-owner", { sessionKey: "session-2" });
    loadSessionEntryMock.mockReturnValue({
      cfg: {
        agents: {
          defaults: {
            verboseDefault: "off",
          },
        },
      },
      entry: {
        verboseLevel: "on",
      },
    });
    toolEventRecipients.add("run-no-owner", "conn-2");

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => "session-2",
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    handler({
      runId: "run-no-owner",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t-no-owner" },
    });

    expect(loadSessionEntryMock).toHaveBeenCalledWith("session-2", {
      ownerUserId: undefined,
    });
  });
});
