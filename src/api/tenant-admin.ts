/**
 * Tenant Admin API
 * 
 * REST API endpoints for tenant, user, and agent management.
 * Enforces RBAC permissions.
 */

import { Router, Request, Response } from 'express';
import { TenantService } from '../services/tenant-service.js';
import { UserService } from '../services/user-service.js';
import { AgentService } from '../services/agent-service.js';
import { PostgresSessionManager } from '../sessions/postgres-session-manager.js';
import { AuditLogService, AuditActions } from '../services/audit-log-service.js';
import { ResourceQuotaService } from '../services/resource-quota-service.js';

const router = Router();

const tenantService = new TenantService();
const userService = new UserService();
const agentService = new AgentService();
const sessionManager = new PostgresSessionManager();
const auditService = new AuditLogService();
const quotaService = new ResourceQuotaService();

/**
 * Middleware to check user role
 */
function requireRole(...roles: string[]) {
    return (req: Request, res: Response, next: Function) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        next();
    };
}

// ============================================================================
// Tenant Management
// ============================================================================

/**
 * GET /api/admin/tenants
 * List all tenants (system admin only)
 */
router.get('/tenants', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const tenants = await tenantService.listTenants(limit, offset);
        res.json({ tenants });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * GET /api/admin/tenants/:id
 * Get tenant by ID
 */
router.get('/tenants/:id', async (req: Request, res: Response) => {
    try {
        const tenant = await tenantService.getTenantById(req.params.id);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        res.json({ tenant });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * POST /api/admin/tenants
 * Create new tenant (system admin only)
 */
router.post('/tenants', async (req: Request, res: Response) => {
    try {
        const tenant = await tenantService.createTenant(req.body);

        await auditService.createAuditLog({
            tenantId: tenant.id,
            userId: req.user?.id,
            action: 'tenant.created',
            resourceType: 'tenant',
            resourceId: tenant.id,
            details: { name: tenant.name, slug: tenant.slug },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(201).json({ tenant });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * PATCH /api/admin/tenants/:id
 * Update tenant (owner only)
 */
router.patch('/tenants/:id', requireRole('owner'), async (req: Request, res: Response) => {
    try {
        const tenant = await tenantService.updateTenant(req.params.id, req.body);

        await auditService.createAuditLog({
            tenantId: tenant.id,
            userId: req.user!.id,
            action: 'tenant.updated',
            resourceType: 'tenant',
            resourceId: tenant.id,
            details: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.json({ tenant });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * DELETE /api/admin/tenants/:id
 * Delete tenant (owner only)
 */
router.delete('/tenants/:id', requireRole('owner'), async (req: Request, res: Response) => {
    try {
        await tenantService.deleteTenant(req.params.id);

        await auditService.createAuditLog({
            tenantId: req.params.id,
            userId: req.user!.id,
            action: 'tenant.deleted',
            resourceType: 'tenant',
            resourceId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ============================================================================
// User Management
// ============================================================================

/**
 * GET /api/admin/users
 * List users in tenant
 */
router.get('/users', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const users = await userService.listUsers(req.user!.tenantId, limit, offset);
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * GET /api/admin/users/:id
 * Get user by ID
 */
router.get('/users/:id', async (req: Request, res: Response) => {
    try {
        const user = await userService.getUserById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * POST /api/admin/users
 * Create new user (admin+ only)
 */
router.post('/users', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    try {
        // Check quota
        const quotaCheck = await quotaService.checkQuota(req.user!.tenantId, 'users');
        if (!quotaCheck.allowed) {
            return res.status(429).json({
                error: 'User quota exceeded',
                current: quotaCheck.current,
                max: quotaCheck.max,
            });
        }

        const user = await userService.createUser({
            ...req.body,
            tenantId: req.user!.tenantId,
        });

        await quotaService.incrementUsage(req.user!.tenantId, 'users');

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.USER_CREATED,
            resourceType: 'user',
            resourceId: user.id,
            details: { email: user.email, role: user.role },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(201).json({ user });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * PATCH /api/admin/users/:id
 * Update user (admin+ only, or self for limited fields)
 */
router.patch('/users/:id', async (req: Request, res: Response) => {
    try {
        const isSelf = req.params.id === req.user!.id;
        const isAdmin = ['owner', 'admin'].includes(req.user!.role);

        if (!isSelf && !isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Self can only update limited fields
        if (isSelf && req.body.role) {
            return res.status(403).json({ error: 'Cannot change own role' });
        }

        const user = await userService.updateUser(req.params.id, req.body);

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.USER_UPDATED,
            resourceType: 'user',
            resourceId: user.id,
            details: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * DELETE /api/admin/users/:id
 * Delete user (owner only)
 */
router.delete('/users/:id', requireRole('owner'), async (req: Request, res: Response) => {
    try {
        await userService.deleteUser(req.params.id);
        await quotaService.decrementUsage(req.user!.tenantId, 'users');

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.USER_DELETED,
            resourceType: 'user',
            resourceId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ============================================================================
// Agent Management
// ============================================================================

/**
 * GET /api/admin/agents
 * List agents in tenant
 */
router.get('/agents', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const agents = await agentService.listAgents(req.user!.tenantId, limit, offset);
        res.json({ agents });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * GET /api/admin/agents/:id
 * Get agent by ID
 */
router.get('/agents/:id', async (req: Request, res: Response) => {
    try {
        const agent = await agentService.getAgentById(req.params.id);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }
        res.json({ agent });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * POST /api/admin/agents
 * Create new agent (developer+ only)
 */
router.post('/agents', requireRole('owner', 'admin', 'developer', 'operator'), async (req: Request, res: Response) => {
    try {
        // Check quota
        const quotaCheck = await quotaService.checkQuota(req.user!.tenantId, 'agents');
        if (!quotaCheck.allowed) {
            return res.status(429).json({
                error: 'Agent quota exceeded',
                current: quotaCheck.current,
                max: quotaCheck.max,
            });
        }

        const agent = await agentService.createAgent({
            ...req.body,
            tenantId: req.user!.tenantId,
        });

        await quotaService.incrementUsage(req.user!.tenantId, 'agents');

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.AGENT_CREATED,
            resourceType: 'agent',
            resourceId: agent.id,
            details: { name: agent.name, model: agent.model },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(201).json({ agent });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * PATCH /api/admin/agents/:id
 * Update agent (developer+ only)
 */
router.patch('/agents/:id', requireRole('owner', 'admin', 'developer', 'operator'), async (req: Request, res: Response) => {
    try {
        const agent = await agentService.updateAgent(req.params.id, req.body);

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.AGENT_UPDATED,
            resourceType: 'agent',
            resourceId: agent.id,
            details: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.json({ agent });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * DELETE /api/admin/agents/:id
 * Delete agent (admin+ only)
 */
router.delete('/agents/:id', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    try {
        await agentService.deleteAgent(req.params.id);
        await quotaService.decrementUsage(req.user!.tenantId, 'agents');

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.AGENT_DELETED,
            resourceType: 'agent',
            resourceId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ============================================================================
// Session Management
// ============================================================================

/**
 * GET /api/admin/sessions
 * List sessions
 */
router.get('/sessions', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const sessions = await sessionManager.listSessionsForTenant(req.user!.tenantId, limit, offset);
        res.json({ sessions });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * GET /api/admin/sessions/:id
 * Get session by ID
 */
router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
        const session = await sessionManager.getSessionById(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json({ session });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * DELETE /api/admin/sessions/:id
 * Delete session (admin+ only)
 */
router.delete('/sessions/:id', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    try {
        await sessionManager.deleteSession(req.params.id);

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.SESSION_DELETED,
            resourceType: 'session',
            resourceId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ============================================================================
// Resource Quotas
// ============================================================================

/**
 * GET /api/admin/quotas
 * Get resource quotas for tenant
 */
router.get('/quotas', async (req: Request, res: Response) => {
    try {
        const quota = await quotaService.getQuota(req.user!.tenantId);
        const utilization = await quotaService.getUtilization(req.user!.tenantId);

        res.json({ quota, utilization });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

/**
 * PATCH /api/admin/quotas
 * Update resource quotas (owner only)
 */
router.patch('/quotas', requireRole('owner'), async (req: Request, res: Response) => {
    try {
        const quota = await quotaService.updateQuotaLimits(req.user!.tenantId, req.body);

        await auditService.createAuditLog({
            tenantId: req.user!.tenantId,
            userId: req.user!.id,
            action: AuditActions.QUOTA_UPDATED,
            resourceType: 'quota',
            resourceId: quota.id,
            details: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.json({ quota });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ============================================================================
// Audit Logs
// ============================================================================

/**
 * GET /api/admin/audit-logs
 * Get audit logs for tenant
 */
router.get('/audit-logs', async (req: Request, res: Response) => {
    try {
        const logs = await auditService.getAuditLogs(req.user!.tenantId, {
            userId: req.query.userId as string,
            action: req.query.action as string,
            resourceType: req.query.resourceType as string,
            limit: parseInt(req.query.limit as string) || 100,
            offset: parseInt(req.query.offset as string) || 0,
        });

        res.json({ logs });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

export default router;
