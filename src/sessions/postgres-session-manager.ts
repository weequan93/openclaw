/**
 * PostgreSQL Session Manager
 * 
 * Replaces JSONL-based session storage with PostgreSQL backend.
 * Provides multi-tenant session persistence with message history.
 */

import { Session, CreateSessionInput, UpdateSessionInput, SessionMessage } from '../models/session.js';
import { getDatabasePool } from '../infra/database/pool.js';

export class PostgresSessionManager {
    /**
     * Create a new session
     */
    async createSession(input: CreateSessionInput): Promise<Session> {
        const pool = getDatabasePool();

        const result = await pool.query<Session>(
            `INSERT INTO sessions (tenant_id, agent_id, user_id, session_key, messages, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
            [
                input.tenantId,
                input.agentId,
                input.userId || null,
                input.sessionKey,
                JSON.stringify([]),
                JSON.stringify(input.metadata || {}),
            ]
        );

        return this.mapRow(result[0]);
    }

    /**
     * Get session by ID
     */
    async getSessionById(sessionId: string): Promise<Session | null> {
        const pool = getDatabasePool();

        const result = await pool.query<Session>(
            'SELECT * FROM sessions WHERE id = $1',
            [sessionId]
        );

        return result[0] ? this.mapRow(result[0]) : null;
    }

    /**
     * Get session by key
     */
    async getSessionByKey(tenantId: string, sessionKey: string): Promise<Session | null> {
        const pool = getDatabasePool();

        const result = await pool.query<Session>(
            'SELECT * FROM sessions WHERE tenant_id = $1 AND session_key = $2',
            [tenantId, sessionKey]
        );

        return result[0] ? this.mapRow(result[0]) : null;
    }

    /**
     * Add message to session
     */
    async addMessage(
        sessionId: string,
        message: SessionMessage,
        tokenCount = 0
    ): Promise<Session> {
        const pool = getDatabasePool();

        const result = await pool.query<Session>(
            `UPDATE sessions 
       SET messages = messages || $1::jsonb,
           message_count = message_count + 1,
           token_count = token_count + $2,
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
            [JSON.stringify(message), tokenCount, sessionId]
        );

        if (!result[0]) {
            throw new Error('Session not found');
        }

        return this.mapRow(result[0]);
    }

    /**
     * Update session metadata
     */
    async updateSession(sessionId: string, input: UpdateSessionInput): Promise<Session> {
        const pool = getDatabasePool();

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (input.messages) {
            updates.push(`messages = $${paramIndex++}`);
            values.push(JSON.stringify(input.messages));
        }

        if (input.metadata) {
            // Merge with existing metadata
            const session = await this.getSessionById(sessionId);
            if (!session) {
                throw new Error('Session not found');
            }

            const mergedMetadata = {
                ...session.metadata,
                ...input.metadata,
            };

            updates.push(`metadata = $${paramIndex++}`);
            values.push(JSON.stringify(mergedMetadata));
        }

        if (input.messageCount !== undefined) {
            updates.push(`message_count = $${paramIndex++}`);
            values.push(input.messageCount);
        }

        if (input.tokenCount !== undefined) {
            updates.push(`token_count = $${paramIndex++}`);
            values.push(input.tokenCount);
        }

        if (input.lastMessageAt) {
            updates.push(`last_message_at = $${paramIndex++}`);
            values.push(input.lastMessageAt);
        }

        if (updates.length === 0) {
            throw new Error('No updates provided');
        }

        values.push(sessionId);

        const result = await pool.query<Session>(
            `UPDATE sessions SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
            values
        );

        if (!result[0]) {
            throw new Error('Session not found');
        }

        return this.mapRow(result[0]);
    }

    /**
     * List sessions for agent
     */
    async listSessionsForAgent(
        agentId: string,
        limit = 50,
        offset = 0
    ): Promise<Session[]> {
        const pool = getDatabasePool();

        const result = await pool.query<Session>(
            `SELECT * FROM sessions 
       WHERE agent_id = $1 
       ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
       LIMIT $2 OFFSET $3`,
            [agentId, limit, offset]
        );

        return result.map(row => this.mapRow(row));
    }

    /**
     * List sessions for tenant
     */
    async listSessionsForTenant(
        tenantId: string,
        limit = 50,
        offset = 0
    ): Promise<Session[]> {
        const pool = getDatabasePool();

        const result = await pool.query<Session>(
            `SELECT * FROM sessions 
       WHERE tenant_id = $1 
       ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
       LIMIT $2 OFFSET $3`,
            [tenantId, limit, offset]
        );

        return result.map(row => this.mapRow(row));
    }

    /**
     * List sessions for user
     */
    async listSessionsForUser(
        userId: string,
        limit = 50,
        offset = 0
    ): Promise<Session[]> {
        const pool = getDatabasePool();

        const result = await pool.query<Session>(
            `SELECT * FROM sessions 
       WHERE user_id = $1 
       ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
       LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );

        return result.map(row => this.mapRow(row));
    }

    /**
     * Delete session
     */
    async deleteSession(sessionId: string): Promise<void> {
        const pool = getDatabasePool();

        await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    }

    /**
     * Delete old sessions (cleanup)
     */
    async deleteOldSessions(daysOld = 90): Promise<number> {
        const pool = getDatabasePool();

        const result = await pool.query<{ count: string }>(
            `DELETE FROM sessions 
       WHERE updated_at < NOW() - INTERVAL '${daysOld} days'
       RETURNING id`
        );

        return result.length;
    }

    /**
     * Get session statistics
     */
    async getSessionStats(tenantId: string): Promise<{
        totalSessions: number;
        activeSessions: number;
        totalMessages: number;
        totalTokens: number;
    }> {
        const pool = getDatabasePool();

        const result = await pool.query<any>(
            `SELECT 
         COUNT(*) as total_sessions,
         COUNT(CASE WHEN last_message_at > NOW() - INTERVAL '24 hours' THEN 1 END) as active_sessions,
         SUM(message_count) as total_messages,
         SUM(token_count) as total_tokens
       FROM sessions
       WHERE tenant_id = $1`,
            [tenantId]
        );

        const row = result[0];
        return {
            totalSessions: parseInt(row.total_sessions, 10),
            activeSessions: parseInt(row.active_sessions, 10),
            totalMessages: parseInt(row.total_messages || '0', 10),
            totalTokens: parseInt(row.total_tokens || '0', 10),
        };
    }

    /**
     * Map database row to Session model
     */
    private mapRow(row: any): Session {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            agentId: row.agent_id,
            userId: row.user_id,
            sessionKey: row.session_key,
            messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
            messageCount: row.message_count,
            tokenCount: row.token_count,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : undefined,
        };
    }
}
