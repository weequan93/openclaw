import { adminApiBase, adminStorageKey } from '../admin-config';

const ADMIN_API_BASE = adminApiBase;

export interface AdminApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

const getToken = () => localStorage.getItem(adminStorageKey) || '';
const setToken = (token: string) => localStorage.setItem(adminStorageKey, token);
const clearToken = () => localStorage.removeItem(adminStorageKey);

export const adminApi = {
    getToken,
    setToken,
    clearToken,
    login: async <T>(body: Record<string, unknown>): Promise<AdminApiResponse<T>> => {
        try {
            const res = await fetch(`${ADMIN_API_BASE}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    throw new Error(json.error || res.statusText);
                } catch {
                    throw new Error(text || res.statusText);
                }
            }
            const data = await res.json();
            return { success: true, data };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    },
    me: async <T>(): Promise<AdminApiResponse<T>> => {
        try {
            const res = await fetch(`${ADMIN_API_BASE}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    throw new Error(json.error || res.statusText);
                } catch {
                    throw new Error(text || res.statusText);
                }
            }
            const data = await res.json();
            return { success: true, data };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    },
    get: async <T>(path: string): Promise<AdminApiResponse<T>> => {
        try {
            const res = await fetch(`${ADMIN_API_BASE}${path}`, {
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    throw new Error(json.error || res.statusText);
                } catch {
                    throw new Error(text || res.statusText);
                }
            }
            const data = await res.json();
            return { success: true, data };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    },

    post: async <T>(path: string, body: any): Promise<AdminApiResponse<T>> => {
        try {
            const res = await fetch(`${ADMIN_API_BASE}${path}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    throw new Error(json.error || res.statusText);
                } catch {
                    throw new Error(text || res.statusText);
                }
            }
            const data = await res.json();
            return { success: true, data };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    },

    patch: async <T>(path: string, body: any): Promise<AdminApiResponse<T>> => {
        try {
            const res = await fetch(`${ADMIN_API_BASE}${path}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    throw new Error(json.error || res.statusText);
                } catch {
                    throw new Error(text || res.statusText);
                }
            }
            const data = await res.json();
            return { success: true, data };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    }
};
