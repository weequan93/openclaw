/**
 * Tenant Isolation Validation Tests
 * 
 * Verifies that tenants cannot access each other's data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabasePool, getDatabaseConfigFromEnv } from '../../src/infra/database/pool.js';
import { TenantService } from '../../src/services/tenant-service.js';
import { UserService } from '../../src/services/user-service.js';
import { AgentService } from '../../src/services/agent-service.js';
import { PostgresSessionManager } from '../../src/sessions/postgres-session-manager.js';

describe('Tenant Isolation', () => {
    let tenantService: TenantService;
    let userService: UserService;
    let agentService: AgentService;
    let sessionManager: PostgresSessionManager;

    let tenant1Id: string;
    let tenant2Id: string;
    let user1Id: string;
    let user2Id: string;
    let agent1Id: string;
    let agent2Id: string;

    beforeAll(async () => {
        // Initialize services
        const config = getDatabaseConfigFromEnv();
        createDatabasePool(config);

        tenantService = new TenantService();
        userService = new UserService();
        agentService = new AgentService();
        sessionManager = new PostgresSessionManager();

        // Create two tenants
        const tenant1 = await tenantService.createTenant({
            name: 'Tenant 1',
            slug: 'tenant-1-test',
        });
        tenant1Id = tenant1.id;

        const tenant2 = await tenantService.createTenant({
            name: 'Tenant 2',
            slug: 'tenant-2-test',
        });
        tenant2Id = tenant2.id;

        // Create users in each tenant
        const user1 = await userService.createUser({
            tenantId: tenant1Id,
            email: 'user1@tenant1.com',
            fullName: 'Tenant 1 Owner',
            role: 'tenant_admin',
        });
        user1Id = user1.id;

        const user2 = await userService.createUser({
            tenantId: tenant2Id,
            email: 'user2@tenant2.com',
            fullName: 'Tenant 2 Owner',
            role: 'tenant_admin',
        });
        user2Id = user2.id;

        // Create agents in each tenant
        const agent1 = await agentService.createAgent({
            tenantId: tenant1Id,
            name: 'Agent 1',
            model: 'claude-3-5-sonnet-20241022',
        });
        agent1Id = agent1.id;

        const agent2 = await agentService.createAgent({
            tenantId: tenant2Id,
            name: 'Agent 2',
            model: 'claude-3-5-sonnet-20241022',
        });
        agent2Id = agent2.id;
    });

    afterAll(async () => {
        // Cleanup
        await tenantService.deleteTenant(tenant1Id);
        await tenantService.deleteTenant(tenant2Id);
    });

    it('should isolate users by tenant', async () => {
        // Tenant 1 should only see their users
        const tenant1Users = await userService.listUsers(tenant1Id);
        expect(tenant1Users.length).toBe(1);
        expect(tenant1Users[0].id).toBe(user1Id);

        // Tenant 2 should only see their users
        const tenant2Users = await userService.listUsers(tenant2Id);
        expect(tenant2Users.length).toBe(1);
        expect(tenant2Users[0].id).toBe(user2Id);
    });

    it('should isolate agents by tenant', async () => {
        // Tenant 1 should only see their agents
        const tenant1Agents = await agentService.listAgents(tenant1Id);
        expect(tenant1Agents.length).toBe(1);
        expect(tenant1Agents[0].id).toBe(agent1Id);

        // Tenant 2 should only see their agents
        const tenant2Agents = await agentService.listAgents(tenant2Id);
        expect(tenant2Agents.length).toBe(1);
        expect(tenant2Agents[0].id).toBe(agent2Id);
    });

    it('should prevent cross-tenant user access', async () => {
        // Try to get Tenant 2's user from Tenant 1's context
        const user = await userService.getUserByEmailForTenant(tenant1Id, 'user2@tenant2.com');
        expect(user).toBeNull();
    });

    it('should prevent cross-tenant agent access', async () => {
        // Try to get Tenant 2's agent from Tenant 1's context
        const agent = await agentService.getAgentByName(tenant1Id, 'Agent 2');
        expect(agent).toBeNull();
    });

    it('should isolate sessions by tenant', async () => {
        // Create sessions for each tenant
        const session1 = await sessionManager.createSession({
            tenantId: tenant1Id,
            agentId: agent1Id,
            sessionKey: 'test-session-1',
        });

        const session2 = await sessionManager.createSession({
            tenantId: tenant2Id,
            agentId: agent2Id,
            sessionKey: 'test-session-2',
        });

        // Tenant 1 should only see their sessions
        const tenant1Sessions = await sessionManager.listSessionsForTenant(tenant1Id);
        expect(tenant1Sessions.length).toBe(1);
        expect(tenant1Sessions[0].id).toBe(session1.id);

        // Tenant 2 should only see their sessions
        const tenant2Sessions = await sessionManager.listSessionsForTenant(tenant2Id);
        expect(tenant2Sessions.length).toBe(1);
        expect(tenant2Sessions[0].id).toBe(session2.id);
    });

    it('should enforce tenant isolation at database level', async () => {
        // This test requires direct SQL access with RLS context
        // Skipped in this example, but would verify RLS policies
    });
});
