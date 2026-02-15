import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  buildWorkspaceSkillCommandSpecs,
  buildWorkspaceSkillsPrompt,
  buildWorkspaceSkillSnapshot,
  loadWorkspaceSkillEntries,
} from "./skills.js";

type SkillFixture = {
  dir: string;
  name: string;
  description: string;
  metadata?: string;
  body?: string;
  frontmatterExtra?: string;
};

const tempDirs: string[] = [];

const makeWorkspace = async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-"));
  tempDirs.push(workspaceDir);
  return workspaceDir;
};

const writeSkill = async (params: SkillFixture) => {
  const { dir, name, description, metadata, body, frontmatterExtra } = params;
  await fs.mkdir(dir, { recursive: true });
  const frontmatter = [
    `name: ${name}`,
    `description: ${description}`,
    metadata ? `metadata: ${metadata}` : "",
    frontmatterExtra ?? "",
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\n${body ?? `# ${name}\n`}`,
    "utf-8",
  );
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("buildWorkspaceSkillCommandSpecs", () => {
  it("sanitizes and de-duplicates command names", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "hello-world"),
      name: "hello-world",
      description: "Hello world skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "hello_world"),
      name: "hello_world",
      description: "Hello underscore skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "help"),
      name: "help",
      description: "Help skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "hidden"),
      name: "hidden-skill",
      description: "Hidden skill",
      frontmatterExtra: "user-invocable: false",
    });

    const commands = buildWorkspaceSkillCommandSpecs(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      reservedNames: new Set(["help"]),
    });

    const names = commands.map((entry) => entry.name).toSorted();
    expect(names).toEqual(["hello_world", "hello_world_2", "help_2"]);
    expect(commands.find((entry) => entry.skillName === "hidden-skill")).toBeUndefined();
  });

  it("truncates descriptions longer than 100 characters for Discord compatibility", async () => {
    const workspaceDir = await makeWorkspace();
    const longDescription =
      "This is a very long description that exceeds Discord's 100 character limit for slash command descriptions and should be truncated";
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "long-desc"),
      name: "long-desc",
      description: longDescription,
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "short-desc"),
      name: "short-desc",
      description: "Short description",
    });

    const commands = buildWorkspaceSkillCommandSpecs(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });

    const longCmd = commands.find((entry) => entry.skillName === "long-desc");
    const shortCmd = commands.find((entry) => entry.skillName === "short-desc");

    expect(longCmd?.description.length).toBeLessThanOrEqual(100);
    expect(longCmd?.description.endsWith("…")).toBe(true);
    expect(shortCmd?.description).toBe("Short description");
  });

  it("includes tool-dispatch metadata from frontmatter", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "tool-dispatch"),
      name: "tool-dispatch",
      description: "Dispatch to a tool",
      frontmatterExtra: "command-dispatch: tool\ncommand-tool: sessions_send",
    });

    const commands = buildWorkspaceSkillCommandSpecs(workspaceDir);
    const cmd = commands.find((entry) => entry.skillName === "tool-dispatch");
    expect(cmd?.dispatch).toEqual({ kind: "tool", toolName: "sessions_send", argMode: "raw" });
  });

  it("hides user-private skills for non-owners in strict multi-user mode", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "shared-skill"),
      name: "shared-skill",
      description: "Shared skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "private-skill"),
      name: "private-skill",
      description: "Private skill",
    });
    const config = {
      gateway: { multiUser: { mode: "strict" as const } },
      skills: {
        entries: {
          "shared-skill": { visibility: "shared" as const },
          "private-skill": {
            visibility: "user_private" as const,
            ownerUserId: "user-a",
          },
        },
      },
    };

    const otherUser = buildWorkspaceSkillCommandSpecs(workspaceDir, {
      config,
      viewer: { userId: "user-b", role: "user" },
    });
    const ownerUser = buildWorkspaceSkillCommandSpecs(workspaceDir, {
      config,
      viewer: { userId: "user-a", role: "user" },
    });

    expect(otherUser.some((entry) => entry.skillName === "shared-skill")).toBe(true);
    expect(otherUser.some((entry) => entry.skillName === "private-skill")).toBe(false);
    expect(ownerUser.some((entry) => entry.skillName === "shared-skill")).toBe(true);
    expect(ownerUser.some((entry) => entry.skillName === "private-skill")).toBe(true);
  });

  it("shows group-shared skills only for viewers in allowed groups", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "shared-skill"),
      name: "shared-skill",
      description: "Shared skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "ops-skill"),
      name: "ops-skill",
      description: "Ops only skill",
    });
    const config = {
      gateway: { multiUser: { mode: "strict" as const } },
      skills: {
        entries: {
          "shared-skill": { visibility: "shared" as const },
          "ops-skill": {
            visibility: "group_shared" as const,
            groupIds: ["ops"],
          },
        },
      },
    };

    const opsViewer = buildWorkspaceSkillCommandSpecs(workspaceDir, {
      config,
      viewer: { userId: "user-a", role: "user", groupIds: ["ops"] },
    });
    const financeViewer = buildWorkspaceSkillCommandSpecs(workspaceDir, {
      config,
      viewer: { userId: "user-b", role: "user", groupIds: ["finance"] },
    });

    expect(opsViewer.some((entry) => entry.skillName === "shared-skill")).toBe(true);
    expect(opsViewer.some((entry) => entry.skillName === "ops-skill")).toBe(true);
    expect(financeViewer.some((entry) => entry.skillName === "shared-skill")).toBe(true);
    expect(financeViewer.some((entry) => entry.skillName === "ops-skill")).toBe(false);
  });
});

describe("buildWorkspaceSkillsPrompt", () => {
  it("returns empty prompt when skills dirs are missing", async () => {
    const workspaceDir = await makeWorkspace();

    const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });

    expect(prompt).toBe("");
  });

  it("loads bundled skills when present", async () => {
    const workspaceDir = await makeWorkspace();
    const bundledDir = path.join(workspaceDir, ".bundled");
    const bundledSkillDir = path.join(bundledDir, "peekaboo");

    await writeSkill({
      dir: bundledSkillDir,
      name: "peekaboo",
      description: "Capture UI",
      body: "# Peekaboo\n",
    });

    const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: bundledDir,
    });
    expect(prompt).toContain("peekaboo");
    expect(prompt).toContain("Capture UI");
    expect(prompt).toContain(path.join(bundledSkillDir, "SKILL.md"));
  });

  it("loads extra skill folders from config (lowest precedence)", async () => {
    const workspaceDir = await makeWorkspace();
    const extraDir = path.join(workspaceDir, ".extra");
    const bundledDir = path.join(workspaceDir, ".bundled");
    const managedDir = path.join(workspaceDir, ".managed");

    await writeSkill({
      dir: path.join(extraDir, "demo-skill"),
      name: "demo-skill",
      description: "Extra version",
      body: "# Extra\n",
    });
    await writeSkill({
      dir: path.join(bundledDir, "demo-skill"),
      name: "demo-skill",
      description: "Bundled version",
      body: "# Bundled\n",
    });
    await writeSkill({
      dir: path.join(managedDir, "demo-skill"),
      name: "demo-skill",
      description: "Managed version",
      body: "# Managed\n",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "demo-skill"),
      name: "demo-skill",
      description: "Workspace version",
      body: "# Workspace\n",
    });

    const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
      bundledSkillsDir: bundledDir,
      managedSkillsDir: managedDir,
      config: { skills: { load: { extraDirs: [extraDir] } } },
    });

    expect(prompt).toContain("Workspace version");
    expect(prompt).not.toContain("Managed version");
    expect(prompt).not.toContain("Bundled version");
    expect(prompt).not.toContain("Extra version");
  });

  it("loads skills from workspace skills/", async () => {
    const workspaceDir = await makeWorkspace();
    const skillDir = path.join(workspaceDir, "skills", "demo-skill");

    await writeSkill({
      dir: skillDir,
      name: "demo-skill",
      description: "Does demo things",
      body: "# Demo Skill\n",
    });

    const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
    });
    expect(prompt).toContain("demo-skill");
    expect(prompt).toContain("Does demo things");
    expect(prompt).toContain(path.join(skillDir, "SKILL.md"));
  });

  it("hides user-private skills for non-owners in strict multi-user mode", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "shared-skill"),
      name: "shared-skill",
      description: "Shared skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "private-skill"),
      name: "private-skill",
      description: "Private skill",
    });
    const config = {
      gateway: { multiUser: { mode: "strict" as const } },
      skills: {
        entries: {
          "shared-skill": { visibility: "shared" as const },
          "private-skill": {
            visibility: "user_private" as const,
            ownerUserId: "user-a",
          },
        },
      },
    };

    const promptForOtherUser = buildWorkspaceSkillsPrompt(workspaceDir, {
      config,
      viewer: { userId: "user-b", role: "user" },
    });
    const promptForOwner = buildWorkspaceSkillsPrompt(workspaceDir, {
      config,
      viewer: { userId: "user-a", role: "user" },
    });

    expect(promptForOtherUser).toContain("shared-skill");
    expect(promptForOtherUser).not.toContain("private-skill");
    expect(promptForOwner).toContain("shared-skill");
    expect(promptForOwner).toContain("private-skill");
  });

  it("hides group-shared skills from viewers outside configured groups", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "shared-skill"),
      name: "shared-skill",
      description: "Shared skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "ops-skill"),
      name: "ops-skill",
      description: "Ops only skill",
    });
    const config = {
      gateway: { multiUser: { mode: "strict" as const } },
      skills: {
        entries: {
          "shared-skill": { visibility: "shared" as const },
          "ops-skill": {
            visibility: "group_shared" as const,
            groupIds: ["ops"],
          },
        },
      },
    };

    const promptForOps = buildWorkspaceSkillsPrompt(workspaceDir, {
      config,
      viewer: { userId: "user-a", role: "user", groupIds: ["ops"] },
    });
    const promptForFinance = buildWorkspaceSkillsPrompt(workspaceDir, {
      config,
      viewer: { userId: "user-b", role: "user", groupIds: ["finance"] },
    });

    expect(promptForOps).toContain("shared-skill");
    expect(promptForOps).toContain("ops-skill");
    expect(promptForFinance).toContain("shared-skill");
    expect(promptForFinance).not.toContain("ops-skill");
  });
});

describe("applySkillEnvOverrides", () => {
  it("sets and restores env vars", async () => {
    const workspaceDir = await makeWorkspace();
    const skillDir = path.join(workspaceDir, "skills", "env-skill");
    await writeSkill({
      dir: skillDir,
      name: "env-skill",
      description: "Needs env",
      metadata: '{"openclaw":{"requires":{"env":["ENV_KEY"]},"primaryEnv":"ENV_KEY"}}',
    });

    const entries = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
    });

    const originalEnv = process.env.ENV_KEY;
    delete process.env.ENV_KEY;

    const restore = applySkillEnvOverrides({
      skills: entries,
      config: { skills: { entries: { "env-skill": { apiKey: "injected" } } } },
    });

    try {
      expect(process.env.ENV_KEY).toBe("injected");
    } finally {
      restore();
      if (originalEnv === undefined) {
        expect(process.env.ENV_KEY).toBeUndefined();
      } else {
        expect(process.env.ENV_KEY).toBe(originalEnv);
      }
    }
  });

  it("applies env overrides from snapshots", async () => {
    const workspaceDir = await makeWorkspace();
    const skillDir = path.join(workspaceDir, "skills", "env-skill");
    await writeSkill({
      dir: skillDir,
      name: "env-skill",
      description: "Needs env",
      metadata: '{"openclaw":{"requires":{"env":["ENV_KEY"]},"primaryEnv":"ENV_KEY"}}',
    });

    const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      config: { skills: { entries: { "env-skill": { apiKey: "snap-key" } } } },
    });

    const originalEnv = process.env.ENV_KEY;
    delete process.env.ENV_KEY;

    const restore = applySkillEnvOverridesFromSnapshot({
      snapshot,
      config: { skills: { entries: { "env-skill": { apiKey: "snap-key" } } } },
    });

    try {
      expect(process.env.ENV_KEY).toBe("snap-key");
    } finally {
      restore();
      if (originalEnv === undefined) {
        expect(process.env.ENV_KEY).toBeUndefined();
      } else {
        expect(process.env.ENV_KEY).toBe(originalEnv);
      }
    }
  });

  it("does not inject private skill secrets for non-owners in strict mode", async () => {
    const workspaceDir = await makeWorkspace();
    const skillDir = path.join(workspaceDir, "skills", "env-skill");
    await writeSkill({
      dir: skillDir,
      name: "env-skill",
      description: "Needs env",
      metadata: '{"openclaw":{"requires":{"env":["ENV_KEY"]},"primaryEnv":"ENV_KEY"}}',
    });

    const entries = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
    });
    const config = {
      gateway: { multiUser: { mode: "strict" as const } },
      skills: {
        entries: {
          "env-skill": {
            apiKey: "private-key",
            visibility: "user_private" as const,
            ownerUserId: "user-a",
          },
        },
      },
    };
    const originalEnv = process.env.ENV_KEY;
    delete process.env.ENV_KEY;

    const restoreDenied = applySkillEnvOverrides({
      skills: entries,
      config,
      viewer: { userId: "user-b", role: "user" },
    });
    try {
      expect(process.env.ENV_KEY).toBeUndefined();
    } finally {
      restoreDenied();
    }

    const restoreAllowed = applySkillEnvOverrides({
      skills: entries,
      config,
      viewer: { userId: "user-a", role: "user" },
    });
    try {
      expect(process.env.ENV_KEY).toBe("private-key");
    } finally {
      restoreAllowed();
      if (originalEnv === undefined) {
        expect(process.env.ENV_KEY).toBeUndefined();
      } else {
        expect(process.env.ENV_KEY).toBe(originalEnv);
      }
    }
  });

  it("does not inject private snapshot secrets for non-owners in strict mode", async () => {
    const workspaceDir = await makeWorkspace();
    const skillDir = path.join(workspaceDir, "skills", "env-skill");
    await writeSkill({
      dir: skillDir,
      name: "env-skill",
      description: "Needs env",
      metadata: '{"openclaw":{"requires":{"env":["ENV_KEY"]},"primaryEnv":"ENV_KEY"}}',
    });
    const config = {
      gateway: { multiUser: { mode: "strict" as const } },
      skills: {
        entries: {
          "env-skill": {
            apiKey: "private-key",
            visibility: "user_private" as const,
            ownerUserId: "user-a",
          },
        },
      },
    };
    const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
      config,
      viewer: { userId: "user-a", role: "user" },
    });
    const originalEnv = process.env.ENV_KEY;
    delete process.env.ENV_KEY;

    const restoreDenied = applySkillEnvOverridesFromSnapshot({
      snapshot,
      config,
      viewer: { userId: "user-b", role: "user" },
    });
    try {
      expect(process.env.ENV_KEY).toBeUndefined();
    } finally {
      restoreDenied();
    }

    const restoreAllowed = applySkillEnvOverridesFromSnapshot({
      snapshot,
      config,
      viewer: { userId: "user-a", role: "user" },
    });
    try {
      expect(process.env.ENV_KEY).toBe("private-key");
    } finally {
      restoreAllowed();
      if (originalEnv === undefined) {
        expect(process.env.ENV_KEY).toBeUndefined();
      } else {
        expect(process.env.ENV_KEY).toBe(originalEnv);
      }
    }
  });
});
