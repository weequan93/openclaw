import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStorePath } from "./paths.js";

describe("resolveStorePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses OPENCLAW_HOME for tilde expansion", () => {
    vi.stubEnv("OPENCLAW_HOME", "/srv/openclaw-home");
    vi.stubEnv("HOME", "/home/other");

    const resolved = resolveStorePath("~/.openclaw/agents/{agentId}/sessions/sessions.json", {
      agentId: "research",
    });

    expect(resolved).toBe(
      path.resolve("/srv/openclaw-home/.openclaw/agents/research/sessions/sessions.json"),
    );
  });

  it("replaces ownerUserId template when provided", () => {
    vi.stubEnv("HOME", "/home/test");
    const resolved = resolveStorePath(
      "~/.openclaw/agents/{agentId}/sessions/{ownerUserId}/sessions.json",
      {
        agentId: "ops",
        ownerUserId: "User-A",
      },
    );
    expect(resolved).toBe(
      path.resolve("/home/test/.openclaw/agents/ops/sessions/user-a/sessions.json"),
    );
  });

  it("falls back to shared owner segment when ownerUserId is missing", () => {
    vi.stubEnv("HOME", "/home/test");
    const resolved = resolveStorePath(
      "~/.openclaw/agents/{agentId}/sessions/{ownerUserId}/sessions.json",
      {
        agentId: "ops",
      },
    );
    expect(resolved).toBe(
      path.resolve("/home/test/.openclaw/agents/ops/sessions/shared/sessions.json"),
    );
  });
});
