export type AdminMode = 'platform' | 'tenant';

type AdminEnv = {
    VITE_ADMIN_MODE?: string;
    VITE_ADMIN_API_BASE?: string;
    VITE_ADMIN_STORAGE_KEY?: string;
};

const env = (import.meta as { env?: AdminEnv }).env ?? {};

export const adminMode = (env.VITE_ADMIN_MODE || 'platform') as AdminMode;

export const adminApiBase =
    env.VITE_ADMIN_API_BASE ||
    (adminMode === 'tenant' ? '/api/v1/tenant' : '/api/v1/platform');

export const adminStorageKey =
    env.VITE_ADMIN_STORAGE_KEY ||
    (adminMode === 'tenant' ? 'openclaw_tenant_admin_token' : 'openclaw_platform_admin_token');
