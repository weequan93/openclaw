/**
 * Audit Log Service
 * 
 * Manages immutable audit trail for compliance.
 */

import { AuditLog, CreateAuditLogInput } from '../models/audit-log.js';
import { getDatabasePool } from '../infra/database/pool.js';

export class AuditLogService {
    /**
     * Create audit log entry
     */
    async createAuditLog(input: CreateAuditLogInput): Promise<AuditLog> {
        const pool = getDatabasePool();

        const result = await pool.query<AuditLog>(
            `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
            [
                input.tenantId,
                input.userId || null,
                input.action,
                input.resourceType || null,
                input.resourceId || null,
                JSON.stringify(input.details || {}),
                input.ipAddress || null,
                input.userAgent || null,
            ]
        );

        return this.mapRow(result[0]);
    }

    /**
     * Get audit logs for tenant
     */
    async getAuditLogs(
        tenantId: string,
        options: {
            userId?: string;
            action?: string;
            resourceType?: string;
            resourceId?: string;
            startDate?: Date;
            endDate?: Date;
            limit?: number;
            offset?: number;
        } = {}
    ): Promise<AuditLog[]> {
        const pool = getDatabasePool();

        const conditions: string[] = ['tenant_id = $1'];
        const values: any[] = [tenantId];
        let paramIndex = 2;

        if (options.userId) {
            conditions.push(`user_id = $${paramIndex++}`);
            values.push(options.userId);
        }

        if (options.action) {
            conditions.push(`action = $${paramIndex++}`);
            values.push(options.action);
        }

        if (options.resourceType) {
            conditions.push(`resource_type = $${paramIndex++}`);
            values.push(options.resourceType);
        }

        if (options.resourceId) {
            conditions.push(`resource_id = $${paramIndex++}`);
            values.push(options.resourceId);
        }

        if (options.startDate) {
            conditions.push(`created_at >= $${paramIndex++}`);
            values.push(options.startDate);
        }

        if (options.endDate) {
            conditions.push(`created_at <= $${paramIndex++}`);
            values.push(options.endDate);
        }

        const limit = options.limit || 100;
        const offset = options.offset || 0;

        values.push(limit, offset);

        const result = await pool.query<AuditLog>(
            `SELECT * FROM audit_logs 
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
            values
        );

        return result.map(row => this.mapRow(row));
    }

    /**
     * Export audit logs (for compliance)
     */
    async exportAuditLogs(
        tenantId: string,
        startDate: Date,
        endDate: Date
    ): Promise<AuditLog[]> {
        return this.getAuditLogs(tenantId, {
            startDate,
            endDate,
            limit: 10000, // Large limit for export
        });
    }

    /**
     * Map database row to AuditLog model
     */
    private mapRow(row: any): AuditLog {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            userId: row.user_id,
            action: row.action,
            resourceType: row.resource_type,
            resourceId: row.resource_id,
            details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            createdAt: new Date(row.created_at),
        };
    }
}
