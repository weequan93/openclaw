/**
 * Audit Log Service
 * Tracks all administrative actions for compliance and security
 */

import { pool } from '../infra/database/pool.js';

export enum AuditActions {
    TENANT_CREATED = 'tenant.created',
    TENANT_UPDATED = 'tenant.updated',
    TENANT_DELETED = 'tenant.deleted',
    USER_CREATED = 'user.created',
    USER_UPDATED = 'user.updated',
    USER_DELETED = 'user.deleted',
    AGENT_CREATED = 'agent.created',
    AGENT_UPDATED = 'agent.updated',
    AGENT_DELETED = 'agent.deleted',
    SESSION_STARTED = 'session.started',
    SESSION_ENDED = 'session.ended',
    SESSION_DELETED = 'session.deleted',
    QUOTA_UPDATED = 'quota.updated',
    BILLING_SUBSCRIPTION_CREATED = 'billing.subscription.created',
    BILLING_SUBSCRIPTION_UPDATED = 'billing.subscription.updated',
    BILLING_SUBSCRIPTION_CANCELLED = 'billing.subscription.cancelled',
    BILLING_INVOICE_PAID = 'billing.invoice.paid',
    BILLING_INVOICE_FAILED = 'billing.invoice.failed',
}

export interface AuditLogEntry {
    id: string;
    tenantId: string;
    userId: string;
    action: AuditActions | string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
}

export class AuditLogService {
    /**
     * Log an audit event
     */
    async log(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<void> {
        try {
            await pool.query(
                `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    entry.tenantId,
                    entry.userId,
                    entry.action,
                    entry.resourceType,
                    entry.resourceId,
                    JSON.stringify(entry.details || {}),
                    entry.ipAddress,
                    entry.userAgent,
                ]
            );
        } catch (error) {
            console.error('Failed to log audit event:', error);
            // Don't throw - audit logging should not break the main flow
        }
    }

    /**
     * Get audit logs for a tenant
     */
    async getLogsForTenant(
        tenantId: string,
        options?: {
            limit?: number;
            offset?: number;
            action?: AuditActions | string;
            userId?: string;
        }
    ): Promise<AuditLogEntry[]> {
        const limit = options?.limit || 100;
        const offset = options?.offset || 0;

        let query = `
      SELECT * FROM audit_logs
      WHERE tenant_id = $1
    `;
        const params: any[] = [tenantId];

        if (options?.action) {
            params.push(options.action);
            query += ` AND action = $${params.length}`;
        }

        if (options?.userId) {
            params.push(options.userId);
            query += ` AND user_id = $${params.length}`;
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows.map((row: any) => ({
            id: row.id,
            tenantId: row.tenant_id,
            userId: row.user_id,
            action: row.action,
            resourceType: row.resource_type,
            resourceId: row.resource_id,
            details: row.details,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            createdAt: row.created_at,
        }));
    }

    /**
     * Alias for log() - used by some APIs
     */
    async createAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<void> {
        return this.log(entry);
    }

    /**
     * Alias for getLogsForTenant() - used by some APIs
     */
    async getAuditLogs(
        tenantId: string,
        options?: {
            limit?: number;
            offset?: number;
            action?: AuditActions | string;
            userId?: string;
        }
    ): Promise<AuditLogEntry[]> {
        return this.getLogsForTenant(tenantId, options);
    }
}

export default new AuditLogService();
