import type { OpenClawConfig } from "../../config/config.js";
import type { GatewayOwnerContext } from "../owner-context.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../../agents/skills.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { getPairedNode } from "../../infra/node-pairing.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { assertAgentOwnership } from "../agent-owner-policy.js";
import { resolveGatewayMultiUserMode } from "../multi-user-mode.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsBinsParams,
  validateSkillsInstallParams,
  validateSkillsStatusParams,
  validateSkillsUpdateParams,
} from "../protocol/index.js";

type SkillVisibility = "shared" | "group_shared" | "user_private";

function listWorkspaceDirs(params: {
  cfg: OpenClawConfig;
  owner?: GatewayOwnerContext | null;
}): string[] {
  const dirs = new Set<string>();
  const cfg = params.cfg;
  const owner = params.owner;
  const list = cfg.agents?.list;
  const considerAgent = (agentId: string) => {
    const access = assertAgentOwnership({
      cfg,
      owner: owner ?? null,
      agentId,
    });
    if (!access.ok) {
      return;
    }
    dirs.add(resolveAgentWorkspaceDir(cfg, agentId));
  };
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === "object" && typeof entry.id === "string") {
        considerAgent(entry.id);
      }
    }
  }
  considerAgent(resolveDefaultAgentId(cfg));
  return [...dirs];
}

function collectSkillBins(entries: SkillEntry[]): string[] {
  const bins = new Set<string>();
  for (const entry of entries) {
    const required = entry.metadata?.requires?.bins ?? [];
    const anyBins = entry.metadata?.requires?.anyBins ?? [];
    const install = entry.metadata?.install ?? [];
    for (const bin of required) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const bin of anyBins) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const spec of install) {
      const specBins = spec?.bins ?? [];
      for (const bin of specBins) {
        const trimmed = String(bin).trim();
        if (trimmed) {
          bins.add(trimmed);
        }
      }
    }
  }
  return [...bins].toSorted();
}

function normalizeSkillVisibility(raw: unknown): SkillVisibility {
  if (raw === "group_shared") {
    return "group_shared";
  }
  return raw === "user_private" ? "user_private" : "shared";
}

function normalizeGroupIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveSkillConfigEntry(params: {
  cfg: OpenClawConfig;
  skillKey?: string;
  skillName?: string;
}): { visibility?: unknown; ownerUserId?: unknown; groupIds?: unknown } | undefined {
  const entries = params.cfg.skills?.entries;
  if (!entries || typeof entries !== "object") {
    return undefined;
  }
  const byKey = params.skillKey ? entries[params.skillKey] : undefined;
  if (byKey && typeof byKey === "object") {
    return byKey as { visibility?: unknown; ownerUserId?: unknown; groupIds?: unknown };
  }
  const byName = params.skillName ? entries[params.skillName] : undefined;
  if (byName && typeof byName === "object") {
    return byName as { visibility?: unknown; ownerUserId?: unknown; groupIds?: unknown };
  }
  return undefined;
}

function canViewSkillForOwner(params: {
  cfg: OpenClawConfig;
  owner: { role: string; userId: string; groupIds?: string[] } | null | undefined;
  skillKey?: string;
  skillName?: string;
}): boolean {
  const entry = resolveSkillConfigEntry({
    cfg: params.cfg,
    skillKey: params.skillKey,
    skillName: params.skillName,
  });
  const visibility = normalizeSkillVisibility(entry?.visibility);
  if (visibility === "shared") {
    return true;
  }
  const owner = params.owner;
  if (!owner || owner.role === "admin") {
    return true;
  }
  const mode = resolveGatewayMultiUserMode(params.cfg);
  if (mode === "off") {
    return true;
  }
  if (visibility === "group_shared") {
    const allowedGroupIds = normalizeGroupIds(entry?.groupIds);
    if (allowedGroupIds.length === 0) {
      return mode !== "strict";
    }
    const viewerGroupIds = normalizeGroupIds(owner.groupIds);
    if (viewerGroupIds.length === 0) {
      return false;
    }
    const viewerGroups = new Set(viewerGroupIds);
    return allowedGroupIds.some((groupId) => viewerGroups.has(groupId));
  }
  const ownerUserId = typeof entry?.ownerUserId === "string" ? entry.ownerUserId.trim() : "";
  return ownerUserId.length > 0 && ownerUserId === owner.userId;
}

function collectVisibleBins(params: {
  cfg: OpenClawConfig;
  ownerForWorkspaces?: GatewayOwnerContext | null;
  viewer:
    | {
        role: string;
        userId: string;
        groupIds?: string[];
      }
    | null;
}): string[] {
  const workspaceDirs = listWorkspaceDirs({
    cfg: params.cfg,
    owner: params.ownerForWorkspaces,
  });
  const bins = new Set<string>();
  for (const workspaceDir of workspaceDirs) {
    const entries = loadWorkspaceSkillEntries(workspaceDir, { config: params.cfg });
    const filteredEntries = entries.filter((entry) =>
      canViewSkillForOwner({
        cfg: params.cfg,
        owner: params.viewer,
        skillKey: entry.metadata?.skillKey,
        skillName: entry.skill.name,
      }),
    );
    for (const bin of collectSkillBins(filteredEntries)) {
      bins.add(bin);
    }
  }
  return [...bins].toSorted();
}

export const skillsHandlers: GatewayRequestHandlers = {
  "skills.status": ({ params, respond, owner }) => {
    if (!validateSkillsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.status params: ${formatValidationErrors(validateSkillsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
    const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : resolveDefaultAgentId(cfg);
    if (agentIdRaw) {
      const knownAgents = listAgentIds(cfg);
      if (!knownAgents.includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${agentIdRaw}"`),
        );
        return;
      }
    }
    const access = assertAgentOwnership({
      cfg,
      owner,
      agentId,
    });
    if (!access.ok) {
      respond(false, undefined, access.error);
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const report = buildWorkspaceSkillStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    const filtered = report.skills.filter((entry) =>
      canViewSkillForOwner({
        cfg,
        owner: owner
          ? {
              role: owner.role,
              userId: owner.userId,
              ...(owner.groupIds ? { groupIds: owner.groupIds } : {}),
            }
          : null,
        skillKey: entry.skillKey,
        skillName: entry.name,
      }),
    );
    respond(
      true,
      {
        ...report,
        skills: filtered,
      },
      undefined,
    );
  },
  "skills.bins": async ({ params, respond, owner, client }) => {
    if (!validateSkillsBinsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.bins params: ${formatValidationErrors(validateSkillsBinsParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const mode = resolveGatewayMultiUserMode(cfg);
    let ownerForWorkspaces: GatewayOwnerContext | null | undefined = owner;
    let visibilityOwner = owner
      ? {
          role: owner.role,
          userId: owner.userId,
          ...(owner.groupIds ? { groupIds: owner.groupIds } : {}),
        }
      : null;

    if (owner?.role === "node") {
      const nodeId =
        normalizeToken((params as { nodeId?: unknown }).nodeId) ??
        normalizeToken(client?.connect?.device?.id) ??
        normalizeToken(client?.connect?.client?.id) ??
        normalizeToken(owner.principalId?.replace(/^device:/, ""));
      let pairedOwnerUserId: string | undefined;
      try {
        pairedOwnerUserId = normalizeToken((await getPairedNode(nodeId ?? ""))?.ownerUserId);
      } catch {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "failed to resolve node owner"));
        return;
      }
      if (!pairedOwnerUserId) {
        if (mode === "strict") {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "node owner mismatch", {
              details: {
                reasonCode: "OWNER_MISMATCH",
                nodeId: nodeId ?? null,
                ownerUserId: owner.userId,
                nodeOwnerUserId: null,
              },
            }),
          );
          return;
        }
      } else {
        ownerForWorkspaces = {
          userId: pairedOwnerUserId,
          principalId: `node-owner:${pairedOwnerUserId}`,
          role: "user",
          sourceRole: "operator",
          scopes: [],
        };
        visibilityOwner = { role: "user", userId: pairedOwnerUserId };
      }
    }
    const bins = collectVisibleBins({
      cfg,
      ownerForWorkspaces,
      viewer: visibilityOwner,
    });
    respond(true, { bins }, undefined);
  },
  "skills.install": async ({ params, respond }) => {
    if (!validateSkillsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.install params: ${formatValidationErrors(validateSkillsInstallParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      name: string;
      installId: string;
      timeoutMs?: number;
    };
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const result = await installSkill({
      workspaceDir: workspaceDirRaw,
      skillName: p.name,
      installId: p.installId,
      timeoutMs: p.timeoutMs,
      config: cfg,
    });
    respond(
      result.ok,
      result,
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },
  "skills.update": async ({ params, respond }) => {
    if (!validateSkillsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.update params: ${formatValidationErrors(validateSkillsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      skillKey: string;
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
      visibility?: SkillVisibility;
      ownerUserId?: string;
      groupIds?: string[];
    };
    const cfg = loadConfig();
    const skills = cfg.skills ? { ...cfg.skills } : {};
    const entries = skills.entries ? { ...skills.entries } : {};
    const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
    if (typeof p.enabled === "boolean") {
      current.enabled = p.enabled;
    }
    if (typeof p.apiKey === "string") {
      const trimmed = normalizeSecretInput(p.apiKey);
      if (trimmed) {
        current.apiKey = trimmed;
      } else {
        delete current.apiKey;
      }
    }
    if (p.env && typeof p.env === "object") {
      const nextEnv = current.env ? { ...current.env } : {};
      for (const [key, value] of Object.entries(p.env)) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          continue;
        }
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          delete nextEnv[trimmedKey];
        } else {
          nextEnv[trimmedKey] = trimmedVal;
        }
      }
      current.env = nextEnv;
    }
    let nextVisibility = normalizeSkillVisibility(current.visibility);
    if (p.visibility) {
      nextVisibility = normalizeSkillVisibility(p.visibility);
    }
    const nextOwnerUserIdRaw = typeof p.ownerUserId === "string" ? p.ownerUserId.trim() : undefined;
    const hasExplicitOwnerUserId = typeof p.ownerUserId === "string";
    const nextGroupIds = normalizeGroupIds(p.groupIds);
    const hasExplicitGroupIds = Array.isArray(p.groupIds);
    if (hasExplicitOwnerUserId && nextOwnerUserIdRaw && nextVisibility !== "user_private") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "ownerUserId is only valid when visibility is user_private",
        ),
      );
      return;
    }
    if (hasExplicitGroupIds && nextGroupIds.length > 0 && nextVisibility !== "group_shared") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "groupIds is only valid when visibility is group_shared",
        ),
      );
      return;
    }
    if (nextVisibility === "shared") {
      current.visibility = "shared";
      delete current.ownerUserId;
      delete current.groupIds;
    } else if (nextVisibility === "group_shared") {
      current.visibility = "group_shared";
      delete current.ownerUserId;
      if (hasExplicitGroupIds) {
        if (nextGroupIds.length > 0) {
          current.groupIds = nextGroupIds;
        } else {
          delete current.groupIds;
        }
      }
      const effectiveGroupIds = normalizeGroupIds(current.groupIds);
      if (effectiveGroupIds.length === 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "groupIds is required when visibility is group_shared",
          ),
        );
        return;
      }
      current.groupIds = effectiveGroupIds;
    } else {
      current.visibility = "user_private";
      delete current.groupIds;
      if (hasExplicitOwnerUserId) {
        if (nextOwnerUserIdRaw) {
          current.ownerUserId = nextOwnerUserIdRaw;
        } else {
          delete current.ownerUserId;
        }
      }
      const effectiveOwnerUserId =
        typeof current.ownerUserId === "string" ? current.ownerUserId.trim() : "";
      if (!effectiveOwnerUserId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "ownerUserId is required when visibility is user_private",
          ),
        );
        return;
      }
      current.ownerUserId = effectiveOwnerUserId;
    }
    entries[p.skillKey] = current;
    skills.entries = entries;
    const nextConfig: OpenClawConfig = {
      ...cfg,
      skills,
    };
    await writeConfigFile(nextConfig);
    respond(true, { ok: true, skillKey: p.skillKey, config: current }, undefined);
  },
};
