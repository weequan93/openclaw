/**
 * PostgreSQL Session Manager
 * Manages chat sessions in PostgreSQL
 */

import { pool } from '../infra/database/pool.js';

export interface Session {
    id: string;
    tenantId: string;
    userId: string;
    agentId: string;
    status: 'active' | 'ended';
    createdAt: Date;
    updatedAt: Date;
}

export class PostgresSessionManager {
    async createSession(data: {
        tenantId: string;
        userId: string;
        agentId: string;
    }): Promise<Session> {
        const result = await pool.query(
            `INSERT INTO sessions (tenant_id, user_id, agent_id, status) VALUES ($1, $2, $3, 'active') RETURNING *`,
            [data.tenantId, data.userId, data.agentId]
        );
        return this.mapRow(result.rows[0]);
    }

    async getSessionById(id: string): Promise<Session | null> {
        const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    async listSessionsForTenant(tenantId: string, options?: { limit?: number; offset?: number; userId?: string }): Promise<Session[]> {
        const limit = options?.limit || 100;
        const offset = options?.offset || 0;

        let query = 'SELECT * FROM sessions WHERE tenant_id = $1';
        const params: any[] = [tenantId];

        if (options?.userId) {
            params.push(options.userId);
            query += ` AND user_id = $${params.length}`;
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows.map(this.mapRow);
    }

    async deleteSession(id: string): Promise<void> {
        await pool.query(
            'UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2',
            ['ended', id]
        );
    }

    private mapRow(row: any): Session {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            userId: row.user_id,
            agentId: row.agent_id,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export default new PostgresSessionManager();
