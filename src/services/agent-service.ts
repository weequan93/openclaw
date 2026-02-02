/**
 * Agent Service
 * 
 * Manages agents with tenant isolation in multi-tenant system.
 */

import { Agent, CreateAgentInput, UpdateAgentInput, AgentBinding, AgentSkill } from '../models/agent.js';
import { getDatabasePool } from '../infra/database/pool.js';

export class AgentService {
    /**
     * Create a new agent
     */
    async createAgent(input: CreateAgentInput): Promise<Agent> {
        const pool = getDatabasePool();

        const result = await pool.query<Agent>(
            `INSERT INTO agents (tenant_id, name, description, model, system_prompt, config, workspace_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
            [
                input.tenantId,
                input.name,
                input.description || null,
                input.model || 'claude-3-5-sonnet-20241022',
                input.systemPrompt || null,
                JSON.stringify(input.config || {}),
                input.workspacePath || null,
            ]
        );

        return this.mapAgentRow(result[0]);
    }

    /**
     * Get agent by ID
     */
    async getAgentById(agentId: string): Promise<Agent | null> {
        const pool = getDatabasePool();

        const result = await pool.query<Agent>(
            'SELECT * FROM agents WHERE id = $1 AND deleted_at IS NULL',
            [agentId]
        );

        return result[0] ? this.mapAgentRow(result[0]) : null;
    }

    /**
     * Get agent by name (within tenant)
     */
    async getAgentByName(tenantId: string, name: string): Promise<Agent | null> {
        const pool = getDatabasePool();

        const result = await pool.query<Agent>(
            'SELECT * FROM agents WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL',
            [tenantId, name]
        );

        return result[0] ? this.mapAgentRow(result[0]) : null;
    }

    /**
     * Update agent
     */
    async updateAgent(agentId: string, input: UpdateAgentInput): Promise<Agent> {
        const pool = getDatabasePool();

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (input.name) {
            updates.push(`name = $${paramIndex++}`);
            values.push(input.name);
        }

        if (input.description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(input.description);
        }

        if (input.model) {
            updates.push(`model = $${paramIndex++}`);
            values.push(input.model);
        }

        if (input.systemPrompt !== undefined) {
            updates.push(`system_prompt = $${paramIndex++}`);
            values.push(input.systemPrompt);
        }

        if (input.config) {
            // Merge with existing config
            const agent = await this.getAgentById(agentId);
            if (!agent) {
                throw new Error('Agent not found');
            }

            const mergedConfig = {
                ...agent.config,
                ...input.config,
            };

            updates.push(`config = $${paramIndex++}`);
            values.push(JSON.stringify(mergedConfig));
        }

        if (input.workspacePath !== undefined) {
            updates.push(`workspace_path = $${paramIndex++}`);
            values.push(input.workspacePath);
        }

        if (updates.length === 0) {
            throw new Error('No updates provided');
        }

        values.push(agentId);

        const result = await pool.query<Agent>(
            `UPDATE agents SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex} AND deleted_at IS NULL
       RETURNING *`,
            values
        );

        if (!result[0]) {
            throw new Error('Agent not found');
        }

        return this.mapAgentRow(result[0]);
    }

    /**
     * Delete agent (soft delete)
     */
    async deleteAgent(agentId: string): Promise<void> {
        const pool = getDatabasePool();

        await pool.query(
            'UPDATE agents SET deleted_at = NOW() WHERE id = $1',
            [agentId]
        );
    }

    /**
     * List agents in tenant
     */
    async listAgents(tenantId: string, limit = 50, offset = 0): Promise<Agent[]> {
        const pool = getDatabasePool();

        const result = await pool.query<Agent>(
            `SELECT * FROM agents 
       WHERE tenant_id = $1 AND deleted_at IS NULL 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
            [tenantId, limit, offset]
        );

        return result.map(row => this.mapAgentRow(row));
    }

    /**
     * Create agent binding
     */
    async createBinding(binding: Omit<AgentBinding, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentBinding> {
        const pool = getDatabasePool();

        const result = await pool.query<AgentBinding>(
            `INSERT INTO agent_bindings (tenant_id, agent_id, channel, account_id, peer_type, peer_id, guild_id, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
            [
                binding.tenantId,
                binding.agentId,
                binding.channel,
                binding.accountId || null,
                binding.peerType || null,
                binding.peerId || null,
                binding.guildId || null,
                binding.priority,
            ]
        );

        return this.mapBindingRow(result[0]);
    }

    /**
     * Get bindings for agent
     */
    async getBindings(agentId: string): Promise<AgentBinding[]> {
        const pool = getDatabasePool();

        const result = await pool.query<AgentBinding>(
            'SELECT * FROM agent_bindings WHERE agent_id = $1 ORDER BY priority ASC',
            [agentId]
        );

        return result.map(row => this.mapBindingRow(row));
    }

    /**
     * Find agent by binding
     */
    async findAgentByBinding(
        tenantId: string,
        channel: string,
        accountId?: string,
        peerId?: string
    ): Promise<Agent | null> {
        const pool = getDatabasePool();

        const result = await pool.query<Agent>(
            `SELECT a.* FROM agents a
       JOIN agent_bindings b ON a.id = b.agent_id
       WHERE a.tenant_id = $1 
         AND b.channel = $2
         AND (b.account_id = $3 OR b.account_id IS NULL)
         AND (b.peer_id = $4 OR b.peer_id IS NULL)
         AND a.deleted_at IS NULL
       ORDER BY b.priority ASC
       LIMIT 1`,
            [tenantId, channel, accountId || null, peerId || null]
        );

        return result[0] ? this.mapAgentRow(result[0]) : null;
    }

    /**
     * Delete binding
     */
    async deleteBinding(bindingId: string): Promise<void> {
        const pool = getDatabasePool();

        await pool.query('DELETE FROM agent_bindings WHERE id = $1', [bindingId]);
    }

    /**
     * Install skill for agent
     */
    async installSkill(
        agentId: string,
        tenantId: string,
        skillName: string,
        skillVersion: string,
        config: Record<string, any> = {}
    ): Promise<AgentSkill> {
        const pool = getDatabasePool();

        const result = await pool.query<AgentSkill>(
            `INSERT INTO agent_skills (tenant_id, agent_id, skill_name, skill_version, enabled, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agent_id, skill_name) 
       DO UPDATE SET skill_version = $4, config = $6, updated_at = NOW()
       RETURNING *`,
            [tenantId, agentId, skillName, skillVersion, true, JSON.stringify(config)]
        );

        return this.mapSkillRow(result[0]);
    }

    /**
     * Get skills for agent
     */
    async getSkills(agentId: string): Promise<AgentSkill[]> {
        const pool = getDatabasePool();

        const result = await pool.query<AgentSkill>(
            'SELECT * FROM agent_skills WHERE agent_id = $1 ORDER BY skill_name ASC',
            [agentId]
        );

        return result.map(row => this.mapSkillRow(row));
    }

    /**
     * Enable/disable skill
     */
    async toggleSkill(agentId: string, skillName: string, enabled: boolean): Promise<void> {
        const pool = getDatabasePool();

        await pool.query(
            'UPDATE agent_skills SET enabled = $1, updated_at = NOW() WHERE agent_id = $2 AND skill_name = $3',
            [enabled, agentId, skillName]
        );
    }

    /**
     * Uninstall skill
     */
    async uninstallSkill(agentId: string, skillName: string): Promise<void> {
        const pool = getDatabasePool();

        await pool.query(
            'DELETE FROM agent_skills WHERE agent_id = $1 AND skill_name = $2',
            [agentId, skillName]
        );
    }

    /**
     * Map database row to Agent model
     */
    private mapAgentRow(row: any): Agent {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            description: row.description,
            model: row.model,
            systemPrompt: row.system_prompt,
            config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
            workspacePath: row.workspace_path,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            deletedAt: row.deleted_at ? new Date(row.deleted_at) : undefined,
        };
    }

    /**
     * Map database row to AgentBinding model
     */
    private mapBindingRow(row: any): AgentBinding {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            agentId: row.agent_id,
            channel: row.channel,
            accountId: row.account_id,
            peerType: row.peer_type,
            peerId: row.peer_id,
            guildId: row.guild_id,
            priority: row.priority,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    /**
     * Map database row to AgentSkill model
     */
    private mapSkillRow(row: any): AgentSkill {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            agentId: row.agent_id,
            skillName: row.skill_name,
            skillVersion: row.skill_version,
            enabled: row.enabled,
            config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }
}
