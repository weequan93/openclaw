/**
 * Resource Quota Service
 * 
 * Manages and enforces tenant resource quotas.
 */

import { ResourceQuota } from '../models/session.js';
import { getDatabasePool } from '../infra/database/pool.js';

export class ResourceQuotaService {
    /**
     * Get quota for tenant
     */
    async getQuota(tenantId: string): Promise<ResourceQuota | null> {
        const pool = getDatabasePool();

        const result = await pool.query<ResourceQuota>(
            'SELECT * FROM resource_quotas WHERE tenant_id = $1',
            [tenantId]
        );

        return result[0] ? this.mapRow(result[0]) : null;
    }

    /**
     * Update quota limits
     */
    async updateQuotaLimits(
        tenantId: string,
        limits: Partial<Pick<ResourceQuota, 'maxUsers' | 'maxAgents' | 'maxSessions' | 'maxTokensPerMonth'>>
    ): Promise<ResourceQuota> {
        const pool = getDatabasePool();

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (limits.maxUsers !== undefined) {
            updates.push(`max_users = $${paramIndex++}`);
            values.push(limits.maxUsers);
        }

        if (limits.maxAgents !== undefined) {
            updates.push(`max_agents = $${paramIndex++}`);
            values.push(limits.maxAgents);
        }

        if (limits.maxSessions !== undefined) {
            updates.push(`max_sessions = $${paramIndex++}`);
            values.push(limits.maxSessions);
        }

        if (limits.maxTokensPerMonth !== undefined) {
            updates.push(`max_tokens_per_month = $${paramIndex++}`);
            values.push(limits.maxTokensPerMonth);
        }

        if (updates.length === 0) {
            throw new Error('No quota updates provided');
        }

        values.push(tenantId);

        const result = await pool.query<ResourceQuota>(
            `UPDATE resource_quotas SET ${updates.join(', ')}, updated_at = NOW()
       WHERE tenant_id = $${paramIndex}
       RETURNING *`,
            values
        );

        if (!result[0]) {
            throw new Error('Quota not found');
        }

        return this.mapRow(result[0]);
    }

    /**
     * Increment usage counters
     */
    async incrementUsage(
        tenantId: string,
        type: 'users' | 'agents' | 'sessions' | 'tokens',
        amount = 1
    ): Promise<void> {
        const pool = getDatabasePool();

        const column = `current_${type}${type === 'tokens' ? '_this_month' : ''}`;

        await pool.query(
            `UPDATE resource_quotas 
       SET ${column} = ${column} + $1, updated_at = NOW()
       WHERE tenant_id = $2`,
            [amount, tenantId]
        );
    }

    /**
     * Decrement usage counters
     */
    async decrementUsage(
        tenantId: string,
        type: 'users' | 'agents' | 'sessions',
        amount = 1
    ): Promise<void> {
        const pool = getDatabasePool();

        const column = `current_${type}`;

        await pool.query(
            `UPDATE resource_quotas 
       SET ${column} = GREATEST(0, ${column} - $1), updated_at = NOW()
       WHERE tenant_id = $2`,
            [amount, tenantId]
        );
    }

    /**
     * Check if quota allows operation
     */
    async checkQuota(
        tenantId: string,
        type: 'users' | 'agents' | 'sessions' | 'tokens',
        amount = 1
    ): Promise<{ allowed: boolean; current: number; max: number }> {
        const quota = await this.getQuota(tenantId);

        if (!quota) {
            throw new Error('Quota not found');
        }

        const currentKey = `current${type.charAt(0).toUpperCase() + type.slice(1)}${type === 'tokens' ? 'ThisMonth' : ''}` as keyof ResourceQuota;
        const maxKey = `max${type.charAt(0).toUpperCase() + type.slice(1)}${type === 'tokens' ? 'PerMonth' : ''}` as keyof ResourceQuota;

        const current = quota[currentKey] as number;
        const max = quota[maxKey] as number;

        return {
            allowed: current + amount <= max,
            current,
            max,
        };
    }

    /**
     * Reset monthly quotas (called by cron job)
     */
    async resetMonthlyQuotas(): Promise<void> {
        const pool = getDatabasePool();

        await pool.query(
            `UPDATE resource_quotas 
       SET current_tokens_this_month = 0,
           quota_reset_at = DATE_TRUNC('month', NOW() + INTERVAL '1 month'),
           updated_at = NOW()
       WHERE quota_reset_at <= NOW()`
        );
    }

    /**
     * Get quota utilization percentage
     */
    async getUtilization(tenantId: string): Promise<{
        users: number;
        agents: number;
        sessions: number;
        tokens: number;
    }> {
        const quota = await this.getQuota(tenantId);

        if (!quota) {
            throw new Error('Quota not found');
        }

        return {
            users: (quota.currentUsers / quota.maxUsers) * 100,
            agents: (quota.currentAgents / quota.maxAgents) * 100,
            sessions: (quota.currentSessions / quota.maxSessions) * 100,
            tokens: (quota.currentTokensThisMonth / quota.maxTokensPerMonth) * 100,
        };
    }

    /**
     * Map database row to ResourceQuota model
     */
    private mapRow(row: any): ResourceQuota {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            maxUsers: row.max_users,
            maxAgents: row.max_agents,
            maxSessions: row.max_sessions,
            maxTokensPerMonth: parseInt(row.max_tokens_per_month, 10),
            maxCpuCores: row.max_cpu_cores,
            maxMemoryMb: row.max_memory_mb,
            maxDiskMb: row.max_disk_mb,
            currentUsers: row.current_users,
            currentAgents: row.current_agents,
            currentSessions: row.current_sessions,
            currentTokensThisMonth: parseInt(row.current_tokens_this_month, 10),
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            quotaResetAt: new Date(row.quota_reset_at),
        };
    }
}
