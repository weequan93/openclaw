import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSessionOwnerUserId, resolveOwnedSessionFilesForAgent } from "./owner-partition.js";

describe("memory owner partition helpers", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("resolves ownerUserId from session store by session key", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-owner-"));
    const storePath = path.join(tmpDir, "sessions.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          "agent:main:user-a": {
            sessionId: "sess-a",
            updatedAt: 1,
            ownerUserId: "user-a",
            sessionFile: "/tmp/sess-a.jsonl",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const cfg = { session: { store: storePath } };
    const resolved = resolveSessionOwnerUserId({
      cfg,
      agentId: "main",
      sessionKey: "agent:main:user-a",
    });
    expect(resolved).toBe("user-a");
  });

  it("lists only owned session files for owner partition", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-owner-"));
    const storePath = path.join(tmpDir, "sessions.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          "agent:main:user-a": {
            sessionId: "sess-a",
            updatedAt: 1,
            ownerUserId: "user-a",
            sessionFile: "/tmp/sess-a.jsonl",
          },
          "agent:main:user-b": {
            sessionId: "sess-b",
            updatedAt: 2,
            ownerUserId: "user-b",
            sessionFile: "/tmp/sess-b.jsonl",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const cfg = { session: { store: storePath } };
    const owned = resolveOwnedSessionFilesForAgent({
      cfg,
      agentId: "main",
      ownerUserId: "user-a",
    });
    expect(owned).not.toBeNull();
    expect(owned?.has(path.resolve("/tmp/sess-a.jsonl"))).toBe(true);
    expect(owned?.has(path.resolve("/tmp/sess-b.jsonl"))).toBe(false);
  });
});
