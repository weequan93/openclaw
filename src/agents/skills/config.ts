import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig, SkillConfig } from "../../config/config.js";
import type { SkillEligibilityContext, SkillEntry } from "./types.js";
import { resolveSkillKey } from "./frontmatter.js";

const DEFAULT_CONFIG_VALUES: Record<string, boolean> = {
  "browser.enabled": true,
  "browser.evaluateEnabled": true,
};

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

export function resolveConfigPath(config: OpenClawConfig | undefined, pathStr: string) {
  const parts = pathStr.split(".").filter(Boolean);
  let current: unknown = config;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function isConfigPathTruthy(config: OpenClawConfig | undefined, pathStr: string): boolean {
  const value = resolveConfigPath(config, pathStr);
  if (value === undefined && pathStr in DEFAULT_CONFIG_VALUES) {
    return DEFAULT_CONFIG_VALUES[pathStr];
  }
  return isTruthy(value);
}

export function resolveSkillConfig(
  config: OpenClawConfig | undefined,
  skillKey: string,
): SkillConfig | undefined {
  const skills = config?.skills?.entries;
  if (!skills || typeof skills !== "object") {
    return undefined;
  }
  const entry = (skills as Record<string, SkillConfig | undefined>)[skillKey];
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  return entry;
}

export function resolveRuntimePlatform(): string {
  return process.platform;
}

function normalizeAllowlist(input: unknown): string[] | undefined {
  if (!input) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    return undefined;
  }
  const normalized = input.map((entry) => String(entry).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

const BUNDLED_SOURCES = new Set(["openclaw-bundled"]);

type GatewayMultiUserMode = "off" | "compat" | "strict";

export type SkillVisibilityViewer = {
  role?: string;
  userId?: string;
  groupIds?: string[];
};

function normalizeStringToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveGatewayMultiUserMode(cfg?: OpenClawConfig): GatewayMultiUserMode {
  const raw = cfg?.gateway?.multiUser?.mode;
  if (raw === "off" || raw === "compat" || raw === "strict") {
    return raw;
  }
  return "strict";
}

function normalizeGroupIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const normalized = Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

function resolveSkillVisibility(skillConfig?: SkillConfig): "shared" | "group_shared" | "user_private" {
  if (skillConfig?.visibility === "user_private") {
    return "user_private";
  }
  if (skillConfig?.visibility === "group_shared") {
    return "group_shared";
  }
  return "shared";
}

export function isSkillConfigVisibleToViewer(params: {
  config?: OpenClawConfig;
  skillConfig?: SkillConfig;
  viewer?: SkillVisibilityViewer;
}): boolean {
  const visibility = resolveSkillVisibility(params.skillConfig);
  if (visibility === "shared") {
    return true;
  }
  const mode = resolveGatewayMultiUserMode(params.config);
  if (mode === "off") {
    return true;
  }
  const viewerRole = normalizeStringToken(params.viewer?.role)?.toLowerCase();
  if (viewerRole === "admin") {
    return true;
  }
  if (visibility === "group_shared") {
    const allowedGroupIds = normalizeGroupIds(params.skillConfig?.groupIds);
    if (!allowedGroupIds || allowedGroupIds.length === 0) {
      return mode !== "strict";
    }
    const viewerGroupIds = normalizeGroupIds(params.viewer?.groupIds);
    if (!viewerGroupIds || viewerGroupIds.length === 0) {
      return false;
    }
    const viewerGroups = new Set(viewerGroupIds);
    return allowedGroupIds.some((groupId) => viewerGroups.has(groupId));
  }
  const ownerUserId = normalizeStringToken(params.skillConfig?.ownerUserId);
  if (!ownerUserId) {
    return mode !== "strict";
  }
  const viewerUserId = normalizeStringToken(params.viewer?.userId);
  return Boolean(viewerUserId && viewerUserId === ownerUserId);
}

function isBundledSkill(entry: SkillEntry): boolean {
  return BUNDLED_SOURCES.has(entry.skill.source);
}

export function resolveBundledAllowlist(config?: OpenClawConfig): string[] | undefined {
  return normalizeAllowlist(config?.skills?.allowBundled);
}

export function isBundledSkillAllowed(entry: SkillEntry, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) {
    return true;
  }
  if (!isBundledSkill(entry)) {
    return true;
  }
  const key = resolveSkillKey(entry.skill, entry);
  return allowlist.includes(key) || allowlist.includes(entry.skill.name);
}

export function hasBinary(bin: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  for (const part of parts) {
    const candidate = path.join(part, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

export function shouldIncludeSkill(params: {
  entry: SkillEntry;
  config?: OpenClawConfig;
  eligibility?: SkillEligibilityContext;
  viewer?: SkillVisibilityViewer;
}): boolean {
  const { entry, config, eligibility } = params;
  const skillKey = resolveSkillKey(entry.skill, entry);
  const skillConfig = resolveSkillConfig(config, skillKey);
  const allowBundled = normalizeAllowlist(config?.skills?.allowBundled);
  const osList = entry.metadata?.os ?? [];
  const remotePlatforms = eligibility?.remote?.platforms ?? [];

  if (skillConfig?.enabled === false) {
    return false;
  }
  if (!isBundledSkillAllowed(entry, allowBundled)) {
    return false;
  }
  if (!isSkillConfigVisibleToViewer({ config, skillConfig, viewer: params.viewer })) {
    return false;
  }
  if (
    osList.length > 0 &&
    !osList.includes(resolveRuntimePlatform()) &&
    !remotePlatforms.some((platform) => osList.includes(platform))
  ) {
    return false;
  }
  if (entry.metadata?.always === true) {
    return true;
  }

  const requiredBins = entry.metadata?.requires?.bins ?? [];
  if (requiredBins.length > 0) {
    for (const bin of requiredBins) {
      if (hasBinary(bin)) {
        continue;
      }
      if (eligibility?.remote?.hasBin?.(bin)) {
        continue;
      }
      return false;
    }
  }
  const requiredAnyBins = entry.metadata?.requires?.anyBins ?? [];
  if (requiredAnyBins.length > 0) {
    const anyFound =
      requiredAnyBins.some((bin) => hasBinary(bin)) ||
      eligibility?.remote?.hasAnyBin?.(requiredAnyBins);
    if (!anyFound) {
      return false;
    }
  }

  const requiredEnv = entry.metadata?.requires?.env ?? [];
  if (requiredEnv.length > 0) {
    for (const envName of requiredEnv) {
      if (process.env[envName]) {
        continue;
      }
      if (skillConfig?.env?.[envName]) {
        continue;
      }
      if (skillConfig?.apiKey && entry.metadata?.primaryEnv === envName) {
        continue;
      }
      return false;
    }
  }

  const requiredConfig = entry.metadata?.requires?.config ?? [];
  if (requiredConfig.length > 0) {
    for (const configPath of requiredConfig) {
      if (!isConfigPathTruthy(config, configPath)) {
        return false;
      }
    }
  }

  return true;
}
