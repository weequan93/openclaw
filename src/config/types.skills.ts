export type SkillVisibility = "shared" | "group_shared" | "user_private";

export type SkillConfig = {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
  /**
   * Skill visibility policy.
   * - shared: visible to all users.
   * - group_shared: visible to users whose identity includes one of groupIds.
   * - user_private: visible only to ownerUserId (and admins).
   */
  visibility?: SkillVisibility;
  /**
   * Group IDs allowed for group_shared skills.
   */
  groupIds?: string[];
  /**
   * Owner user UUID for user_private skills.
   */
  ownerUserId?: string;
};

export type SkillsLoadConfig = {
  /**
   * Additional skill folders to scan (lowest precedence).
   * Each directory should contain skill subfolders with `SKILL.md`.
   */
  extraDirs?: string[];
  /** Watch skill folders for changes and refresh the skills snapshot. */
  watch?: boolean;
  /** Debounce for the skills watcher (ms). */
  watchDebounceMs?: number;
};

export type SkillsInstallConfig = {
  preferBrew?: boolean;
  nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
};

export type SkillsConfig = {
  /** Optional bundled-skill allowlist (only affects bundled skills). */
  allowBundled?: string[];
  load?: SkillsLoadConfig;
  install?: SkillsInstallConfig;
  entries?: Record<string, SkillConfig>;
};
