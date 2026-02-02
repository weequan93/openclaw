/**
 * AuditLog Model
 * 
 * Represents an immutable audit log entry for compliance.
 */

export interface AuditLog {
    id: string;
    tenantId: string;
    userId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    details: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
}

export interface CreateAuditLogInput {
    tenantId: string;
    userId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
}

// Common audit actions
export const AuditActions = {
    // User actions
    USER_LOGIN: 'user.login',
    USER_LOGOUT: 'user.logout',
    USER_CREATED: 'user.created',
    USER_UPDATED: 'user.updated',
    USER_DELETED: 'user.deleted',
    USER_ROLE_CHANGED: 'user.role_changed',

    // Agent actions
    AGENT_CREATED: 'agent.created',
    AGENT_UPDATED: 'agent.updated',
    AGENT_DELETED: 'agent.deleted',
    AGENT_CONFIG_CHANGED: 'agent.config_changed',

    // Session actions
    SESSION_CREATED: 'session.created',
    SESSION_DELETED: 'session.deleted',

    // Skill actions
    SKILL_INSTALLED: 'skill.installed',
    SKILL_REMOVED: 'skill.removed',
    SKILL_CONFIGURED: 'skill.configured',

    // Config actions
    CONFIG_UPDATED: 'config.updated',
    QUOTA_UPDATED: 'quota.updated',

    // Permission actions
    PERMISSION_GRANTED: 'permission.granted',
    PERMISSION_DENIED: 'permission.denied',
} as const;
