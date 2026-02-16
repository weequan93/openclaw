import os from "node:os";
import path from "node:path";
import type { SessionEntry } from "./types.js";
import { expandHomePrefix, resolveRequiredHomeDir } from "../../infra/home-dir.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import { resolveConfigPath, resolveStateDir } from "../paths.js";

function resolveAgentSessionsDir(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  const root = resolveStateDir(env, homedir);
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  return path.join(root, "agents", id, "sessions");
}

export function resolveSessionTranscriptsDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  return resolveAgentSessionsDir(DEFAULT_AGENT_ID, env, homedir);
}

export function resolveSessionTranscriptsDirForAgent(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  return resolveAgentSessionsDir(agentId, env, homedir);
}

export function resolveDefaultSessionStorePath(agentId?: string): string {
  return path.join(resolveAgentSessionsDir(agentId), "sessions.json");
}

export function resolveSessionTranscriptPath(
  sessionId: string,
  agentId?: string,
  topicId?: string | number,
): string {
  const safeTopicId =
    typeof topicId === "string"
      ? encodeURIComponent(topicId)
      : typeof topicId === "number"
        ? String(topicId)
        : undefined;
  const fileName =
    safeTopicId !== undefined ? `${sessionId}-topic-${safeTopicId}.jsonl` : `${sessionId}.jsonl`;
  return path.join(resolveAgentSessionsDir(agentId), fileName);
}

export function resolveSessionFilePath(
  sessionId: string,
  entry?: SessionEntry,
  opts?: { agentId?: string },
): string {
  const candidate = entry?.sessionFile?.trim();
  return candidate ? candidate : resolveSessionTranscriptPath(sessionId, opts?.agentId);
}

export function resolveStorePath(
  store?: string,
  opts?: { agentId?: string; ownerUserId?: string },
) {
  const agentId = normalizeAgentId(opts?.agentId ?? DEFAULT_AGENT_ID);
  const ownerUserId =
    typeof opts?.ownerUserId === "string" && opts.ownerUserId.trim()
      ? opts.ownerUserId.trim().toLowerCase()
      : undefined;
  const ownerSegment = ownerUserId
    ? ownerUserId
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "") || "shared"
    : "shared";
  const expand = (value: string) => {
    if (value.startsWith("~")) {
      return path.resolve(
        expandHomePrefix(value, {
          home: resolveRequiredHomeDir(process.env, os.homedir),
          env: process.env,
          homedir: os.homedir,
        }),
      );
    }
    if (path.isAbsolute(value)) {
      return path.resolve(value);
    }
    // Resolve relative session store paths from the active config directory so
    // environment-isolated runs (for example test workers) do not share cwd files.
    const configDir = path.dirname(resolveConfigPath());
    return path.resolve(configDir, value);
  };

  if (!store) {
    return resolveDefaultSessionStorePath(agentId);
  }
  const expandedTemplate = store
    .replaceAll("{agentId}", agentId)
    .replaceAll("{ownerUserId}", ownerSegment);
  return expand(expandedTemplate);
}
