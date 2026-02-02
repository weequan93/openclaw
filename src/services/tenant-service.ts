/**
 * Tenant Service
 * 
 * Manages tenant lifecycle and settings in multi-tenant SaaS.
 */

import { PoolClient } from 'pg';
import { Tenant, CreateTenantInput, UpdateTenantInput, TenantSettings } from '../models/tenant.js';
import { getDatabasePool } from '../infra/database/pool.js';
import { withTenantContext } from '../infra/database/tenant-context.js';

export class TenantService {
    /**
     * Create a new tenant
     */
    async createTenant(input: CreateTenantInput): Promise<Tenant> {
        const pool = getDatabasePool();

        const defaultSettings: TenantSettings = {
            plan: 'free',
            features: {
                multiAgent: true,
                sso: false,
                customSkills: false,
            },
            limits: {
                maxUsers: 5,
                maxAgents: 3,
                maxSessions: 100,
            },
            ...input.settings,
        };

        const result = await pool.query<Tenant>(
            `INSERT INTO tenants (name, slug, settings)
       VALUES ($1, $2, $3)
       RETURNING *`,
            [input.name, input.slug, JSON.stringify(defaultSettings)]
        );

        const tenant = this.mapRow(result[0]);

        // Create default resource quota
        await pool.query(
            `INSERT INTO resource_quotas (tenant_id, max_users, max_agents, max_sessions)
       VALUES ($1, $2, $3, $4)`,
            [tenant.id, defaultSettings.limits.maxUsers, defaultSettings.limits.maxAgents, defaultSettings.limits.maxSessions]
        );

        return tenant;
    }

    /**
     * Get tenant by ID
     */
    async getTenantById(tenantId: string): Promise<Tenant | null> {
        const pool = getDatabasePool();

        const result = await pool.query<Tenant>(
            'SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL',
            [tenantId]
        );

        return result[0] ? this.mapRow(result[0]) : null;
    }

    /**
     * Get tenant by slug
     */
    async getTenantBySlug(slug: string): Promise<Tenant | null> {
        const pool = getDatabasePool();

        const result = await pool.query<Tenant>(
            'SELECT * FROM tenants WHERE slug = $1 AND deleted_at IS NULL',
            [slug]
        );

        return result[0] ? this.mapRow(result[0]) : null;
    }

    /**
     * Update tenant
     */
    async updateTenant(tenantId: string, input: UpdateTenantInput): Promise<Tenant> {
        const pool = getDatabasePool();

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (input.name) {
            updates.push(`name = $${paramIndex++}`);
            values.push(input.name);
        }

        if (input.settings) {
            // Merge with existing settings
            const tenant = await this.getTenantById(tenantId);
            if (!tenant) {
                throw new Error('Tenant not found');
            }

            const mergedSettings = {
                ...tenant.settings,
                ...input.settings,
                features: { ...tenant.settings.features, ...input.settings.features },
                limits: { ...tenant.settings.limits, ...input.settings.limits },
            };

            updates.push(`settings = $${paramIndex++}`);
            values.push(JSON.stringify(mergedSettings));
        }

        if (updates.length === 0) {
            throw new Error('No updates provided');
        }

        values.push(tenantId);

        const result = await pool.query<Tenant>(
            `UPDATE tenants SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex} AND deleted_at IS NULL
       RETURNING *`,
            values
        );

        if (!result[0]) {
            throw new Error('Tenant not found');
        }

        return this.mapRow(result[0]);
    }

    /**
     * Delete tenant (soft delete)
     */
    async deleteTenant(tenantId: string): Promise<void> {
        const pool = getDatabasePool();

        await pool.query(
            'UPDATE tenants SET deleted_at = NOW() WHERE id = $1',
            [tenantId]
        );
    }

    /**
     * List all tenants
     */
    async listTenants(limit = 50, offset = 0): Promise<Tenant[]> {
        const pool = getDatabasePool();

        const result = await pool.query<Tenant>(
            `SELECT * FROM tenants 
       WHERE deleted_at IS NULL 
       ORDER BY created_at DESC 
       LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        return result.map(row => this.mapRow(row));
    }

    /**
     * Map database row to Tenant model
     */
    private mapRow(row: any): Tenant {
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            deletedAt: row.deleted_at ? new Date(row.deleted_at) : undefined,
        };
    }
}
