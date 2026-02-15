import type { OpenClawConfig } from "../config/config.js";
import type { GatewayOwnerContext } from "./owner-context.js";
import { hasGatewayDelegatedAccess } from "./delegation-policy.js";
import { resolveGatewayMultiUserMode } from "./multi-user-mode.js";
import { ErrorCodes, errorShape, type ErrorShape } from "./protocol/index.js";

const ROLE_FORBIDDEN = "ROLE_FORBIDDEN";
const OWNER_MISMATCH = "OWNER_MISMATCH";

type BrowserPolicyInput = {
  cfg: OpenClawConfig;
  owner: GatewayOwnerContext | null | undefined;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

type BrowserPolicyResult =
  | {
      ok: true;
      query?: Record<string, unknown>;
      body?: unknown;
      effectiveProfile?: string;
    }
  | { ok: false; error: ErrorShape };

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isProfileMutationPath(path: string): boolean {
  if (path === "/profiles") {
    return true;
  }
  return path.startsWith("/profiles/");
}

function extractRequestedProfile(params: {
  query?: Record<string, unknown>;
  body?: unknown;
}): string | undefined {
  const profileFromQuery = normalizeString(params.query?.profile);
  if (profileFromQuery) {
    return profileFromQuery;
  }
  if (!params.body || typeof params.body !== "object" || Array.isArray(params.body)) {
    return undefined;
  }
  return normalizeString((params.body as Record<string, unknown>).profile);
}

function deny(params: {
  message: string;
  reasonCode: typeof ROLE_FORBIDDEN | typeof OWNER_MISMATCH;
  details?: Record<string, unknown>;
}): BrowserPolicyResult {
  return {
    ok: false,
    error: errorShape(ErrorCodes.INVALID_REQUEST, params.message, {
      details: {
        reasonCode: params.reasonCode,
        ...(params.details ?? {}),
      },
    }),
  };
}

function canAccessProfileOwner(params: {
  cfg: OpenClawConfig;
  viewerUserId: string;
  profileOwnerUserId: string;
}): boolean {
  if (params.viewerUserId === params.profileOwnerUserId) {
    return true;
  }
  return hasGatewayDelegatedAccess({
    cfg: params.cfg,
    fromUserId: params.viewerUserId,
    ownerUserId: params.profileOwnerUserId,
    resource: "browser",
  });
}

function resolveAllowedProfiles(params: { cfg: OpenClawConfig; ownerUserId: string }): Set<string> {
  const profiles = params.cfg.browser?.profiles ?? {};
  const allowed = new Set<string>();
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile) {
      continue;
    }
    if (profile.shared === true) {
      allowed.add(name);
      continue;
    }
    const profileOwner = normalizeString(profile.ownerUserId);
    if (
      profileOwner &&
      canAccessProfileOwner({
        cfg: params.cfg,
        viewerUserId: params.ownerUserId,
        profileOwnerUserId: profileOwner,
      })
    ) {
      allowed.add(name);
    }
  }
  return allowed;
}

export function enforceBrowserOwnerPolicy(params: BrowserPolicyInput): BrowserPolicyResult {
  const owner = params.owner;
  if (!owner || owner.role === "admin") {
    return { ok: true, query: params.query, body: params.body };
  }
  const mode = resolveGatewayMultiUserMode(params.cfg);
  if (mode === "off") {
    return { ok: true, query: params.query, body: params.body };
  }

  if (isProfileMutationPath(params.path)) {
    return deny({
      message: "browser profile configuration is admin-only",
      reasonCode: ROLE_FORBIDDEN,
      details: { path: params.path },
    });
  }

  const allowedProfiles = resolveAllowedProfiles({
    cfg: params.cfg,
    ownerUserId: owner.userId,
  });
  const requestedProfile = extractRequestedProfile({
    query: params.query,
    body: params.body,
  });
  const defaultProfile = normalizeString(params.cfg.browser?.defaultProfile);
  const effectiveProfile = requestedProfile ?? defaultProfile;
  if (!effectiveProfile) {
    return deny({
      message: "browser profile is required",
      reasonCode: OWNER_MISMATCH,
      details: { ownerUserId: owner.userId },
    });
  }
  const effectiveProfileConfig = params.cfg.browser?.profiles?.[effectiveProfile];
  const effectiveProfileOwner = normalizeString(effectiveProfileConfig?.ownerUserId);
  const extensionRelayProfile = effectiveProfileConfig?.driver === "extension";
  // Extension relay profiles expose personal browser tabs; require explicit owner binding.
  if (
    extensionRelayProfile &&
    (!effectiveProfileOwner ||
      !canAccessProfileOwner({
        cfg: params.cfg,
        viewerUserId: owner.userId,
        profileOwnerUserId: effectiveProfileOwner,
      }))
  ) {
    return deny({
      message: `browser extension relay profile owner mismatch: ${effectiveProfile}`,
      reasonCode: OWNER_MISMATCH,
      details: { profile: effectiveProfile, ownerUserId: owner.userId },
    });
  }

  if (!allowedProfiles.has(effectiveProfile)) {
    const profile = effectiveProfileConfig;
    const profileOwner = effectiveProfileOwner;
    if (mode === "compat" && profile && profile.shared !== true && !profileOwner) {
      const nextQuery: Record<string, unknown> = {
        ...(params.query ?? {}),
        profile: effectiveProfile,
      };
      let nextBody = params.body;
      if (params.body && typeof params.body === "object" && !Array.isArray(params.body)) {
        nextBody = {
          ...(params.body as Record<string, unknown>),
          profile: effectiveProfile,
        };
      }
      return {
        ok: true,
        query: nextQuery,
        body: nextBody,
        effectiveProfile,
      };
    }
    return deny({
      message: `browser profile owner mismatch: ${effectiveProfile}`,
      reasonCode: OWNER_MISMATCH,
      details: { profile: effectiveProfile, ownerUserId: owner.userId },
    });
  }

  const nextQuery: Record<string, unknown> = {
    ...(params.query ?? {}),
    profile: effectiveProfile,
  };
  let nextBody = params.body;
  if (params.body && typeof params.body === "object" && !Array.isArray(params.body)) {
    nextBody = {
      ...(params.body as Record<string, unknown>),
      profile: effectiveProfile,
    };
  }
  return {
    ok: true,
    query: nextQuery,
    body: nextBody,
    effectiveProfile,
  };
}
