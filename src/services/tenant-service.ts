/**
 * Tenant Service
 * Manages multi-tenant operations
 */

import { pool } from '../infra/database/pool.js';

export interface Tenant {
    id: string;
    name: string;
    slug: string;
    ownerId: string | null;
    plan: 'starter' | 'professional' | 'enterprise';
    status: 'active' | 'suspended' | 'deleted';
    settings?: {
        sso?: {
            enabled: boolean;
            provider: 'saml' | 'oauth2' | 'oidc';
            entryPoint?: string; // SAML
            issuer?: string;     // SAML
            cert?: string;       // SAML
            clientId?: string;     // OAuth2
            clientSecret?: string; // OAuth2
            authorizationUrl?: string; // OAuth2
            tokenUrl?: string;     // OAuth2
            userInfoUrl?: string;  // OAuth2
        };
        [key: string]: any;
    };
    createdAt: Date;
    updatedAt: Date;
}

export class TenantService {
    /**
     * Create a new tenant
     */
    async createTenant(data: {
        name: string;
        slug: string;
        ownerId?: string | null;
        plan: string;
        settings?: Record<string, any>;
    }): Promise<Tenant> {
        const result = await pool.query(
            `INSERT INTO tenants (name, slug, owner_id, plan, status, settings)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING *`,
            [data.name, data.slug, data.ownerId || null, data.plan, JSON.stringify(data.settings || {})]
        );

        return this.mapRow(result.rows[0]);
    }

    /**
     * Get tenant by ID
     */
    async getTenantById(id: string): Promise<Tenant | null> {
        const result = await pool.query(
            'SELECT * FROM tenants WHERE id = $1',
            [id]
        );

        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    /**
     * Get tenant by slug
     */
    async getTenantBySlug(slug: string): Promise<Tenant | null> {
        const result = await pool.query(
            'SELECT * FROM tenants WHERE slug = $1',
            [slug]
        );

        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    /**
     * Update tenant
     */
    async updateTenant(id: string, data: Partial<Tenant>): Promise<Tenant> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (data.name) {
            fields.push(`name = $${paramIndex++}`);
            values.push(data.name);
        }
        if (data.plan) {
            fields.push(`plan = $${paramIndex++}`);
            values.push(data.plan);
        }
        if (data.status) {
            fields.push(`status = $${paramIndex++}`);
            values.push(data.status);
        }
        if (data.ownerId) {
            fields.push(`owner_id = $${paramIndex++}`);
            values.push(data.ownerId);
        }
        if (data.settings) {
            fields.push(`settings = $${paramIndex++}`);
            values.push(JSON.stringify(data.settings));
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
            `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );

        return this.mapRow(result.rows[0]);
    }

    /**
     * Delete tenant
     */
    async deleteTenant(id: string): Promise<void> {
        await pool.query(
            'UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2',
            ['deleted', id]
        );
    }

    /**
     * List all tenants
     */
    async listTenants(options?: {
        limit?: number;
        offset?: number;
        status?: string;
    }): Promise<Tenant[]> {
        const limit = options?.limit || 100;
        const offset = options?.offset || 0;

        let query = 'SELECT * FROM tenants';
        const params: any[] = [];

        if (options?.status) {
            params.push(options.status);
            query += ` WHERE status = $1`;
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows.map(this.mapRow);
    }

    private mapRow(row: any): Tenant {
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            ownerId: row.owner_id,
            plan: row.plan,
            status: row.status,
            settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export default new TenantService();
