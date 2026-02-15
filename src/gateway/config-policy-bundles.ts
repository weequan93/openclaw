import type { OpenClawConfig } from "../config/config.js";

export const GATEWAY_POLICY_BUNDLE_IDS = [
  "single_user",
  "multi_user_isolated",
  "strict_admin_control",
] as const;

export type GatewayPolicyBundleId = (typeof GATEWAY_POLICY_BUNDLE_IDS)[number];

export type GatewayPolicyBundle = {
  id: GatewayPolicyBundleId;
  title: string;
  description: string;
  patch: Record<string, unknown>;
};

const BUNDLES: Record<GatewayPolicyBundleId, Omit<GatewayPolicyBundle, "id">> = {
  single_user: {
    title: "Single User",
    description: "Disable multi-user ownership enforcement for one trusted operator.",
    patch: {
      gateway: {
        multiUser: {
          mode: "off",
        },
      },
    },
  },
  multi_user_isolated: {
    title: "Multi User Isolated",
    description:
      "Enable owner checks in compatibility mode and disable chat-side config mutation commands.",
    patch: {
      gateway: {
        multiUser: {
          mode: "compat",
        },
      },
      commands: {
        config: false,
        debug: false,
      },
    },
  },
  strict_admin_control: {
    title: "Strict Admin Control",
    description:
      "Enable strict owner enforcement and disable chat-side config mutation commands by default.",
    patch: {
      gateway: {
        multiUser: {
          mode: "strict",
        },
      },
      commands: {
        config: false,
        debug: false,
      },
    },
  },
};

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    const current = next[key];
    if (isRecord(value) && isRecord(current)) {
      next[key] = mergePatch(current, value);
      continue;
    }
    if (isRecord(value)) {
      next[key] = mergePatch({}, value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function isGatewayPolicyBundleId(value: unknown): value is GatewayPolicyBundleId {
  return (
    typeof value === "string" &&
    (GATEWAY_POLICY_BUNDLE_IDS as readonly string[]).includes(value.trim())
  );
}

export function listGatewayPolicyBundles(): GatewayPolicyBundle[] {
  return GATEWAY_POLICY_BUNDLE_IDS.map((id) => ({
    id,
    title: BUNDLES[id].title,
    description: BUNDLES[id].description,
    patch: deepClone(BUNDLES[id].patch),
  }));
}

export function resolveGatewayPolicyBundle(
  bundleId: GatewayPolicyBundleId,
): GatewayPolicyBundle | null {
  const bundle = BUNDLES[bundleId];
  if (!bundle) {
    return null;
  }
  return {
    id: bundleId,
    title: bundle.title,
    description: bundle.description,
    patch: deepClone(bundle.patch),
  };
}

export function applyGatewayPolicyBundle(params: {
  config: OpenClawConfig;
  bundleId: GatewayPolicyBundleId;
}): OpenClawConfig {
  const bundle = resolveGatewayPolicyBundle(params.bundleId);
  if (!bundle) {
    return params.config;
  }
  return mergePatch(
    params.config as unknown as Record<string, unknown>,
    bundle.patch,
  ) as OpenClawConfig;
}
