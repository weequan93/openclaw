import { beforeEach, describe, expect, it, vi } from "vitest";

let testConfig: Record<string, unknown> = {};
let writtenConfig: Record<string, unknown> | null = null;
const buildWorkspaceSkillStatusMock = vi.fn();
const loadWorkspaceSkillEntriesMock = vi.fn(() => []);
const getPairedNodeMock = vi.fn(async () => null);

vi.mock("../../config/config.js", () => ({
  loadConfig: () => testConfig,
  writeConfigFile: async (cfg: Record<string, unknown>) => {
    writtenConfig = cfg;
    testConfig = cfg;
  },
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: (cfg: { agents?: { list?: Array<{ id?: string }> } }) =>
    (cfg.agents?.list ?? [])
      .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
      .filter(Boolean),
  resolveAgentWorkspaceDir: (_cfg: unknown, agentId: string) => `/tmp/workspace-${agentId}`,
  resolveDefaultAgentId: () => "main",
}));

vi.mock("../../agents/skills-status.js", () => ({
  buildWorkspaceSkillStatus: (...args: unknown[]) => buildWorkspaceSkillStatusMock(...args),
}));

vi.mock("../../agents/skills.js", () => ({
  loadWorkspaceSkillEntries: (...args: unknown[]) => loadWorkspaceSkillEntriesMock(...args),
}));

vi.mock("../../agents/skills-install.js", () => ({
  installSkill: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: () => ({}),
}));

vi.mock("../../infra/node-pairing.js", () => ({
  getPairedNode: (...args: unknown[]) => getPairedNodeMock(...args),
}));

function makeSkill(name: string) {
  return {
    name,
    description: `${name} description`,
    source: "workspace",
    bundled: false,
    filePath: `/tmp/workspace-main/.skills/${name}/SKILL.md`,
    baseDir: `/tmp/workspace-main/.skills/${name}`,
    skillKey: name,
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
    missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
    configChecks: [],
    install: [],
  };
}

function makeWorkspaceEntry(params: { name: string; skillKey?: string; bins?: string[] }) {
  return {
    skill: {
      name: params.name,
    },
    metadata: {
      ...(params.skillKey ? { skillKey: params.skillKey } : {}),
      requires: {
        bins: params.bins ?? [],
      },
    },
  };
}

function makeOwner(role: "admin" | "user", userId = "user-a", groupIds?: string[]) {
  return {
    userId,
    principalId: `principal:${userId}`,
    role,
    sourceRole: "operator",
    scopes: role === "admin" ? ["operator.admin"] : ["operator.read"],
    ...(groupIds ? { groupIds } : {}),
  };
}

function makeNodeOwner(userId = "device-node-a") {
  return {
    userId,
    principalId: `device:${userId}`,
    role: "node" as const,
    sourceRole: "node" as const,
    scopes: [],
  };
}

describe("skills visibility ownership", () => {
  beforeEach(() => {
    writtenConfig = null;
    buildWorkspaceSkillStatusMock.mockReset();
    loadWorkspaceSkillEntriesMock.mockReset();
    getPairedNodeMock.mockReset();
    getPairedNodeMock.mockResolvedValue(null);
    loadWorkspaceSkillEntriesMock.mockReturnValue([]);
    buildWorkspaceSkillStatusMock.mockReturnValue({
      workspaceDir: "/tmp/workspace-main",
      managedSkillsDir: "/tmp/workspace-main/.skills",
      skills: [makeSkill("shared-skill"), makeSkill("private-a"), makeSkill("private-b")],
    });
    testConfig = {
      gateway: { multiUser: { mode: "strict" } },
      agents: {
        list: [
          { id: "main", ownerUserId: "user-a" },
          { id: "research", ownerUserId: "user-b" },
        ],
      },
      skills: {
        entries: {
          "shared-skill": { visibility: "shared" },
          "private-a": { visibility: "user_private", ownerUserId: "user-a" },
          "private-b": { visibility: "user_private", ownerUserId: "user-b" },
        },
      },
    };
  });

  it("filters skills.status to shared + owner private skills for user role", async () => {
    const { skillsHandlers } = await import("./skills.js");
    let responsePayload: unknown;
    await skillsHandlers["skills.status"]({
      params: {},
      owner: makeOwner("user", "user-a"),
      respond: (_ok, payload) => {
        responsePayload = payload;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.status"]>[0]);

    const names = ((responsePayload as { skills?: Array<{ name?: string }> }).skills ?? [])
      .map((entry) => entry.name)
      .filter((value): value is string => typeof value === "string");
    expect(names).toEqual(["shared-skill", "private-a"]);
  });

  it("keeps all skills.status entries for admin role", async () => {
    const { skillsHandlers } = await import("./skills.js");
    let responsePayload: unknown;
    await skillsHandlers["skills.status"]({
      params: {},
      owner: makeOwner("admin", "admin-user"),
      respond: (_ok, payload) => {
        responsePayload = payload;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.status"]>[0]);

    const names = ((responsePayload as { skills?: Array<{ name?: string }> }).skills ?? [])
      .map((entry) => entry.name)
      .filter((value): value is string => typeof value === "string");
    expect(names).toEqual(["shared-skill", "private-a", "private-b"]);
  });

  it("filters skills.bins to shared + owner private bins for user role", async () => {
    loadWorkspaceSkillEntriesMock.mockImplementation((workspaceDir: string) =>
      workspaceDir.includes("workspace-main")
        ? [
            makeWorkspaceEntry({ name: "shared-skill", bins: ["curl"] }),
            makeWorkspaceEntry({ name: "private-a", bins: ["gh"] }),
          ]
        : [makeWorkspaceEntry({ name: "private-b", bins: ["kubectl"] })],
    );
    const { skillsHandlers } = await import("./skills.js");
    let responsePayload: unknown;
    await skillsHandlers["skills.bins"]({
      params: {},
      owner: makeOwner("user", "user-a"),
      respond: (_ok, payload) => {
        responsePayload = payload;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.bins"]>[0]);

    const bins = ((responsePayload as { bins?: string[] }).bins ?? []).toSorted();
    expect(bins).toEqual(["curl", "gh"]);
  });

  it("keeps all skills.bins entries for admin role", async () => {
    loadWorkspaceSkillEntriesMock.mockImplementation((workspaceDir: string) =>
      workspaceDir.includes("workspace-main")
        ? [
            makeWorkspaceEntry({ name: "shared-skill", bins: ["curl"] }),
            makeWorkspaceEntry({ name: "private-a", bins: ["gh"] }),
          ]
        : [makeWorkspaceEntry({ name: "private-b", bins: ["kubectl"] })],
    );
    const { skillsHandlers } = await import("./skills.js");
    let responsePayload: unknown;
    await skillsHandlers["skills.bins"]({
      params: {},
      owner: makeOwner("admin", "admin-user"),
      respond: (_ok, payload) => {
        responsePayload = payload;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.bins"]>[0]);

    const bins = ((responsePayload as { bins?: string[] }).bins ?? []).toSorted();
    expect(bins).toEqual(["curl", "gh", "kubectl"]);
  });

  it("scopes node-role skills.bins to paired node owner in strict mode", async () => {
    getPairedNodeMock.mockResolvedValueOnce({ ownerUserId: "user-a" });
    loadWorkspaceSkillEntriesMock.mockImplementation((workspaceDir: string) =>
      workspaceDir.includes("workspace-main")
        ? [
            makeWorkspaceEntry({ name: "shared-skill", bins: ["curl"] }),
            makeWorkspaceEntry({ name: "private-a", bins: ["gh"] }),
          ]
        : [makeWorkspaceEntry({ name: "private-b", bins: ["kubectl"] })],
    );
    const { skillsHandlers } = await import("./skills.js");
    let responsePayload: unknown;
    await skillsHandlers["skills.bins"]({
      params: {},
      owner: makeNodeOwner(),
      client: {
        connect: {
          device: { id: "node-1" },
        },
      },
      respond: (_ok, payload) => {
        responsePayload = payload;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.bins"]>[0]);

    const bins = ((responsePayload as { bins?: string[] }).bins ?? []).toSorted();
    expect(bins).toEqual(["curl", "gh"]);
  });

  it("denies node-role skills.bins in strict mode when paired node owner is missing", async () => {
    getPairedNodeMock.mockResolvedValueOnce(null);
    const { skillsHandlers } = await import("./skills.js");
    let ok: boolean | null = null;
    let error: unknown = null;
    await skillsHandlers["skills.bins"]({
      params: {},
      owner: makeNodeOwner(),
      client: {
        connect: {
          device: { id: "node-1" },
        },
      },
      respond: (success, _payload, err) => {
        ok = success;
        error = err;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.bins"]>[0]);

    expect(ok).toBe(false);
    expect((error as { message?: string } | undefined)?.message ?? "").toContain(
      "node owner mismatch",
    );
    expect((error as { details?: { reasonCode?: string } } | undefined)?.details?.reasonCode).toBe(
      "OWNER_MISMATCH",
    );
  });

  it("denies skills.status for agent owned by another user", async () => {
    const { skillsHandlers } = await import("./skills.js");
    let ok: boolean | null = null;
    let error: unknown;
    await skillsHandlers["skills.status"]({
      params: { agentId: "research" },
      owner: makeOwner("user", "user-a"),
      respond: (success, _payload, err) => {
        ok = success;
        error = err;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.status"]>[0]);

    expect(ok).toBe(false);
    expect((error as { message?: string } | undefined)?.message ?? "").toContain(
      "agent owner mismatch",
    );
  });

  it("does not restrict skills.status by owner when multi-user mode is off", async () => {
    testConfig = {
      ...testConfig,
      gateway: { multiUser: { mode: "off" } },
    };
    const { skillsHandlers } = await import("./skills.js");
    let responsePayload: unknown;
    await skillsHandlers["skills.status"]({
      params: {},
      owner: makeOwner("user", "user-a"),
      respond: (_ok, payload) => {
        responsePayload = payload;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.status"]>[0]);

    const names = ((responsePayload as { skills?: Array<{ name?: string }> }).skills ?? [])
      .map((entry) => entry.name)
      .filter((value): value is string => typeof value === "string");
    expect(names).toEqual(["shared-skill", "private-a", "private-b"]);
  });

  it("requires ownerUserId when setting user_private visibility", async () => {
    const { skillsHandlers } = await import("./skills.js");
    let ok: boolean | null = null;
    let error: unknown = null;
    await skillsHandlers["skills.update"]({
      params: {
        skillKey: "private-missing-owner",
        visibility: "user_private",
      },
      respond: (success, _payload, err) => {
        ok = success;
        error = err;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.update"]>[0]);

    expect(ok).toBe(false);
    expect((error as { message?: string } | undefined)?.message ?? "").toContain(
      "ownerUserId is required",
    );
  });

  it("filters group_shared skills by owner group membership", async () => {
    buildWorkspaceSkillStatusMock.mockReturnValue({
      workspaceDir: "/tmp/workspace-main",
      managedSkillsDir: "/tmp/workspace-main/.skills",
      skills: [makeSkill("shared-skill"), makeSkill("group-ops"), makeSkill("group-dev")],
    });
    testConfig = {
      ...testConfig,
      skills: {
        entries: {
          "shared-skill": { visibility: "shared" },
          "group-ops": { visibility: "group_shared", groupIds: ["ops"] },
          "group-dev": { visibility: "group_shared", groupIds: ["dev"] },
        },
      },
    };
    const { skillsHandlers } = await import("./skills.js");
    let responsePayload: unknown;
    await skillsHandlers["skills.status"]({
      params: {},
      owner: makeOwner("user", "user-a", ["ops"]),
      respond: (_ok, payload) => {
        responsePayload = payload;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.status"]>[0]);

    const names = ((responsePayload as { skills?: Array<{ name?: string }> }).skills ?? [])
      .map((entry) => entry.name)
      .filter((value): value is string => typeof value === "string");
    expect(names).toEqual(["shared-skill", "group-ops"]);
  });

  it("requires groupIds when setting group_shared visibility", async () => {
    const { skillsHandlers } = await import("./skills.js");
    let ok: boolean | null = null;
    let error: unknown = null;
    await skillsHandlers["skills.update"]({
      params: {
        skillKey: "group-missing",
        visibility: "group_shared",
      },
      respond: (success, _payload, err) => {
        ok = success;
        error = err;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.update"]>[0]);

    expect(ok).toBe(false);
    expect((error as { message?: string } | undefined)?.message ?? "").toContain(
      "groupIds is required",
    );
  });

  it("stores group_shared visibility with normalized groupIds", async () => {
    const { skillsHandlers } = await import("./skills.js");
    let ok: boolean | null = null;
    await skillsHandlers["skills.update"]({
      params: {
        skillKey: "shared-for-ops",
        visibility: "group_shared",
        groupIds: ["ops", "finance", "ops"],
      },
      respond: (success) => {
        ok = success;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.update"]>[0]);

    expect(ok).toBe(true);
    expect(writtenConfig).toMatchObject({
      skills: {
        entries: {
          "shared-for-ops": {
            visibility: "group_shared",
            groupIds: ["ops", "finance"],
          },
        },
      },
    });
  });

  it("stores user_private visibility with ownerUserId", async () => {
    const { skillsHandlers } = await import("./skills.js");
    let ok: boolean | null = null;
    await skillsHandlers["skills.update"]({
      params: {
        skillKey: "private-owned",
        visibility: "user_private",
        ownerUserId: "user-a",
      },
      respond: (success) => {
        ok = success;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.update"]>[0]);

    expect(ok).toBe(true);
    expect(writtenConfig).toMatchObject({
      skills: {
        entries: {
          "private-owned": {
            visibility: "user_private",
            ownerUserId: "user-a",
          },
        },
      },
    });
  });

  it("clears ownerUserId when visibility is set to shared", async () => {
    testConfig = {
      ...testConfig,
      skills: {
        entries: {
          "private-owned": {
            visibility: "user_private",
            ownerUserId: "user-a",
          },
        },
      },
    };
    const { skillsHandlers } = await import("./skills.js");
    let ok: boolean | null = null;
    await skillsHandlers["skills.update"]({
      params: {
        skillKey: "private-owned",
        visibility: "shared",
      },
      respond: (success) => {
        ok = success;
      },
    } as unknown as Parameters<(typeof skillsHandlers)["skills.update"]>[0]);

    expect(ok).toBe(true);
    expect(writtenConfig).toMatchObject({
      skills: {
        entries: {
          "private-owned": {
            visibility: "shared",
          },
        },
      },
    });
    const savedEntry = (
      writtenConfig as {
        skills?: { entries?: Record<string, { ownerUserId?: string }> };
      }
    ).skills?.entries?.["private-owned"];
    expect(savedEntry?.ownerUserId).toBeUndefined();
  });
});
