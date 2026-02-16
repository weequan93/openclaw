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

  it("resolves relative paths from OPENCLAW_CONFIG_PATH directory", () => {
    vi.stubEnv("OPENCLAW_CONFIG_PATH", "/tmp/openclaw-test/config/openclaw.json");
    const resolved = resolveStorePath("sessions/{ownerUserId}.json", {
      ownerUserId: "User-A",
    });
    expect(resolved).toBe(path.resolve("/tmp/openclaw-test/config/sessions/user-a.json"));
  });

  it("resolves relative paths from OPENCLAW_STATE_DIR when OPENCLAW_CONFIG_PATH is not set", () => {
    vi.stubEnv("OPENCLAW_CONFIG_PATH", "");
    vi.stubEnv("OPENCLAW_STATE_DIR", "/tmp/openclaw-state");
    const resolved = resolveStorePath("sessions/{ownerUserId}.json", {
      ownerUserId: "User-A",
    });
    expect(resolved).toBe(path.resolve("/tmp/openclaw-state/sessions/user-a.json"));
  });
});
