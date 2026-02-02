/**
 * Tenant Model
 * 
 * Represents a tenant in the multi-tenant SaaS deployment.
 */

export interface Tenant {
    id: string;
    name: string;
    slug: string;
    settings: TenantSettings;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
}

export interface TenantSettings {
    plan: 'free' | 'pro' | 'enterprise';
    features: {
        multiAgent: boolean;
        sso: boolean;
        customSkills: boolean;
    };
    limits: {
        maxUsers: number;
        maxAgents: number;
        maxSessions: number;
    };
}

export interface CreateTenantInput {
    name: string;
    slug: string;
    settings?: Partial<TenantSettings>;
}

export interface UpdateTenantInput {
    name?: string;
    settings?: Partial<TenantSettings>;
}
