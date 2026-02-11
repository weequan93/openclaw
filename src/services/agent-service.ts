/**
 * Agent Service
 * Manages AI agents within tenants
 */

import { pool } from '../infra/database/pool.js';

export interface Agent {
    id: string;
    tenantId: string;
    name: string;
    type: string;
    model?: string;
    status: 'active' | 'inactive' | 'deleted';
    createdAt: Date;
    updatedAt: Date;
}

export class AgentService {
    async createAgent(data: { tenantId: string; name: string; type: string; model?: string }): Promise<Agent> {
        const result = await pool.query(
            `INSERT INTO agents (tenant_id, name, type, model, status) VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
            [data.tenantId, data.name, data.type, data.model || 'default']
        );
        return this.mapRow(result.rows[0]);
    }

    async getAgentById(id: string): Promise<Agent | null> {
        const result = await pool.query('SELECT * FROM agents WHERE id = $1', [id]);
        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    async listAgentsForTenant(tenantId: string, options?: { limit?: number; offset?: number }): Promise<Agent[]> {
        const limit = options?.limit || 100;
        const offset = options?.offset || 0;
        const result = await pool.query(
            'SELECT * FROM agents WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
            [tenantId, limit, offset]
        );
        return result.rows.map(this.mapRow);
    }

    async listAgents(tenantId: string, options?: { limit?: number; offset?: number }): Promise<Agent[]> {
        return this.listAgentsForTenant(tenantId, options);
    }

    async updateAgent(id: string, data: Partial<Agent>): Promise<Agent> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (data.name) {
            fields.push(`name = $${paramIndex++}`);
            values.push(data.name);
        }
        if (data.type) {
            fields.push(`type = $${paramIndex++}`);
            values.push(data.type);
        }
        if (data.model) {
            fields.push(`model = $${paramIndex++}`);
            values.push(data.model);
        }
        if (data.status) {
            fields.push(`status = $${paramIndex++}`);
            values.push(data.status);
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
            `UPDATE agents SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );
        return this.mapRow(result.rows[0]);
    }

    async deleteAgent(id: string): Promise<void> {
        await pool.query(
            'UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2',
            ['deleted', id]
        );
    }

    private mapRow(row: any): Agent {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            type: row.type,
            model: row.model,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export default new AgentService();
