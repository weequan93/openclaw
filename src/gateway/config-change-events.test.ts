import { beforeEach, describe, expect, it } from "vitest";
import {
  __test as configChangeEventsTest,
  listGatewayConfigChangeEventsPage,
  recordGatewayConfigChangeEvent,
} from "./config-change-events.js";

describe("gateway config change events", () => {
  beforeEach(() => {
    configChangeEventsTest.clear();
  });

  it("returns latest events first with pagination cursor", () => {
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
    recordGatewayConfigChangeEvent({
      ts: 300,
      requestId: "req-3",
      method: "config.set",
      path: "/tmp/openclaw.json",
      userId: "user-b",
      principalId: "principal:b",
      actorRole: "admin",
      sourceRole: "operator",
    });

    const page1 = listGatewayConfigChangeEventsPage({ limit: 2 });
    expect(page1.events.map((event) => event.requestId)).toEqual(["req-3", "req-2"]);
    expect(page1.hasMore).toBe(true);
    expect(typeof page1.nextCursor).toBe("string");

    const page2 = listGatewayConfigChangeEventsPage({ limit: 2, cursor: page1.nextCursor ?? "" });
    expect(page2.events.map((event) => event.requestId)).toEqual(["req-1"]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it("filters events by actor and method", () => {
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
      userId: "user-b",
      principalId: "principal:b",
      actorRole: "admin",
      sourceRole: "operator",
    });

    const filtered = listGatewayConfigChangeEventsPage({
      method: "config.apply",
      userId: "user-b",
    });
    expect(filtered.events).toHaveLength(1);
    expect(filtered.events[0]?.requestId).toBe("req-2");
  });
});
