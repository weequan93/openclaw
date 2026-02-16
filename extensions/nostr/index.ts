import type { IncomingMessage } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { timingSafeEqual } from "node:crypto";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import type { NostrProfile } from "./src/config-schema.js";
import { nostrPlugin } from "./src/channel.js";
import { createNostrProfileHttpHandler } from "./src/nostr-profile-http.js";
import { setNostrRuntime, getNostrRuntime } from "./src/runtime.js";
import { resolveNostrAccount } from "./src/types.js";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function headerValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) {
    return raw[0] ?? "";
  }
  return typeof raw === "string" ? raw : "";
}

function resolveGatewayAuthCredential(req: IncomingMessage): string {
  const authHeader = headerValue(req.headers.authorization).trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }
  const tokenHeader = headerValue(req.headers["x-openclaw-token"]).trim();
  return tokenHeader;
}

function isAuthorizedNostrProfileRequest(req: IncomingMessage): boolean {
  const runtime = getNostrRuntime();
  const cfg = runtime.config.loadConfig();
  const gatewayAuth = cfg.gateway?.auth;
  const authMode =
    gatewayAuth?.mode === "password" || gatewayAuth?.mode === "token"
      ? gatewayAuth.mode
      : gatewayAuth?.password
        ? "password"
        : "token";
  const providedCredential = resolveGatewayAuthCredential(req);
  if (!providedCredential) {
    return false;
  }

  const expectedCredential =
    authMode === "password" ? gatewayAuth?.password?.trim() : gatewayAuth?.token?.trim();
  if (!expectedCredential) {
    return false;
  }
  return safeEqual(providedCredential, expectedCredential);
}

const plugin = {
  id: "nostr",
  name: "Nostr",
  description: "Nostr DM channel plugin via NIP-04",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setNostrRuntime(api.runtime);
    api.registerChannel({ plugin: nostrPlugin });

    // Register HTTP handler for profile management
    const httpHandler = createNostrProfileHttpHandler({
      getConfigProfile: (accountId: string) => {
        const runtime = getNostrRuntime();
        const cfg = runtime.config.loadConfig();
        const account = resolveNostrAccount({ cfg, accountId });
        return account.profile;
      },
      updateConfigProfile: async (accountId: string, profile: NostrProfile) => {
        const runtime = getNostrRuntime();
        const cfg = runtime.config.loadConfig();

        // Build the config patch for channels.nostr.profile
        const channels = (cfg.channels ?? {}) as Record<string, unknown>;
        const nostrConfig = (channels.nostr ?? {}) as Record<string, unknown>;

        const updatedNostrConfig = {
          ...nostrConfig,
          profile,
        };

        const updatedChannels = {
          ...channels,
          nostr: updatedNostrConfig,
        };

        await runtime.config.writeConfigFile({
          ...cfg,
          channels: updatedChannels,
        });
      },
      getAccountInfo: (accountId: string) => {
        const runtime = getNostrRuntime();
        const cfg = runtime.config.loadConfig();
        const account = resolveNostrAccount({ cfg, accountId });
        if (!account.configured || !account.publicKey) {
          return null;
        }
        return {
          pubkey: account.publicKey,
          relays: account.relays,
        };
      },
      authorizeRequest: isAuthorizedNostrProfileRequest,
      log: api.logger,
    });

    api.registerHttpHandler(httpHandler);
  },
};

export default plugin;
