import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __test as configChangeEventsTest,
  recordGatewayConfigChangeEvent,
} from "../config-change-events.js";
import { configHandlers } from "./config.js";

describe("config.changes.list", () => {
  beforeEach(() => {
    configChangeEventsTest.clear();
  });

  it("returns recent config change events", async () => {
    recordGatewayConfigChangeEvent({
      ts: 100,
      requestId: "req-1",
      method: "config.patch",
      path: "/tmp/openclaw.json",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "admin",
      sourceRole: "operator",
    });
    recordGatewayConfigChangeEvent({
      ts: 200,
      requestId: "req-2",
      method: "config.apply",
      path: "/tmp/openclaw.json",
      userId: "user-a",
      principalId: "principal:a",
      actorRole: "admin",
      sourceRole: "operator",
    });

    const respond = vi.fn();
    await configHandlers["config.changes.list"]({
      respond,
      params: { limit: 1 },
    } as unknown as Parameters<(typeof configHandlers)["config.changes.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        events: [expect.objectContaining({ requestId: "req-2" })],
        hasMore: true,
      }),
      undefined,
    );
  });

  it("rejects invalid params", async () => {
    const respond = vi.fn();
    await configHandlers["config.changes.list"]({
      respond,
      params: { cursor: "abc" },
    } as unknown as Parameters<(typeof configHandlers)["config.changes.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid config.changes.list params"),
      }),
    );
  });
});
