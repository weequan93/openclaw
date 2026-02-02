# RBAC Permission Matrix

**Version**: 1.0.0  
**Date**: 2026-02-02  
**Status**: Design  
**Related**: [Database Schema](database-schema), [RLS Policies](rls-policies)

---

## Overview

This document defines the Role-Based Access Control (RBAC) permission matrix for OpenClaw's multi-tenant SaaS deployment. The system supports **5 roles** with hierarchical permissions as required by FR-005.

**Roles** (from highest to lowest privilege):
1. **Owner** - Full control, billing, user management
2. **Admin** - User management, configuration, no billing
3. **Developer** - Agent/skill management, session access
4. **Operator** - Agent operation, monitoring, no configuration
5. **Viewer** - Read-only access

---

## Permission Matrix

### Legend
- ✅ **Allowed** - Role has permission
- ❌ **Denied** - Role does not have permission
- 🔒 **Self Only** - Can only perform action on own resources

| Resource | Action | Owner | Admin | Developer | Operator | Viewer |
|----------|--------|-------|-------|-----------|----------|--------|
| **Tenants** |
| View tenant settings | ✅ | ✅ | ✅ | ✅ | ✅ |
| Update tenant settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete tenant | ✅ | ❌ | ❌ | ❌ | ❌ |
| View billing | ✅ | ❌ | ❌ | ❌ | ❌ |
| Update billing | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Users** |
| List users | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Update users | ✅ | ✅ | 🔒 | 🔒 | 🔒 |
| Delete users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Assign roles | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Agents** |
| List agents | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create agents | ✅ | ✅ | ✅ | ✅ | ❌ |
| Update agents | ✅ | ✅ | ✅ | ✅ | ❌ |
| Delete agents | ✅ | ✅ | ❌ | ❌ | ❌ |
| Configure model | ✅ | ✅ | ✅ | ❌ | ❌ |
| Configure system prompt | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Sessions** |
| List sessions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create sessions | ✅ | ✅ | ✅ | ✅ | ❌ |
| View session messages | ✅ | ✅ | ✅ | ✅ | ✅ |
| Delete sessions | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Skills** |
| List skills | ✅ | ✅ | ✅ | ✅ | ✅ |
| Install skills | ✅ | ✅ | ✅ | ✅ | ❌ |
| Configure skills | ✅ | ✅ | ✅ | ❌ | ❌ |
| Remove skills | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Bindings** |
| List bindings | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create bindings | ✅ | ✅ | ✅ | ✅ | ❌ |
| Update bindings | ✅ | ✅ | ✅ | ✅ | ❌ |
| Delete bindings | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Audit Logs** |
| View audit logs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Export audit logs | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Resource Quotas** |
| View quotas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Update quotas | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Observability** |
| View metrics | ✅ | ✅ | ✅ | ✅ | ✅ |
| View traces | ✅ | ✅ | ✅ | ✅ | ❌ |
| View logs | ✅ | ✅ | ✅ | ✅ | ❌ |
| Configure alerts | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## Role Descriptions

### Owner

**Purpose**: Tenant administrator with full control

**Permissions**:
- All Admin permissions
- Billing management (view/update payment methods, invoices)
- Tenant settings (name, slug, plan)
- Resource quota management
- Delete tenant

**Use Cases**:
- Company founder/CTO managing OpenClaw deployment
- Billing contact for enterprise account
- Final authority for critical changes

**Constraints**:
- Must have at least one Owner per tenant
- Cannot delete self if last Owner
- Cannot downgrade self if last Owner

---

### Admin

**Purpose**: User and system management without billing access

**Permissions**:
- User management (create, update, delete, assign roles)
- Agent management (create, update, delete)
- Session management (delete for data retention)
- Audit log export
- Alert configuration

**Use Cases**:
- IT administrator managing user accounts
- Security officer reviewing audit logs
- Operations lead configuring monitoring

**Constraints**:
- Cannot access billing information
- Cannot modify tenant-level quotas
- Cannot delete tenant

---

### Developer

**Purpose**: Build and configure agents and skills

**Permissions**:
- Agent creation and configuration
- Skill installation and configuration
- Binding management
- Session creation and viewing
- Trace/log viewing for debugging

**Use Cases**:
- AI engineer building custom agents
- Developer integrating OpenClaw with internal tools
- Skill creator testing new capabilities

**Constraints**:
- Cannot manage users (except own profile)
- Cannot delete agents (prevents accidental data loss)
- Cannot configure alerts

---

### Operator

**Purpose**: Run agents and monitor operations

**Permissions**:
- Agent operation (create/update, but not delete)
- Session creation
- Binding management
- Metrics viewing

**Use Cases**:
- Support engineer troubleshooting user issues
- Operations team member monitoring agent health
- Customer success manager reviewing usage

**Constraints**:
- Cannot configure agents (model, system prompt)
- Cannot install/remove skills
- Cannot view traces/logs (prevents sensitive data access)

---

### Viewer

**Purpose**: Read-only access for auditing and monitoring

**Permissions**:
- View all resources (tenants, users, agents, sessions, skills, bindings)
- View metrics
- View audit logs

**Use Cases**:
- Auditor reviewing system usage
- Stakeholder monitoring deployment
- Compliance officer checking data access

**Constraints**:
- Cannot create, update, or delete any resources
- Cannot view traces/logs (may contain sensitive data)
- Cannot export audit logs

---

## Permission Enforcement

### Database Level (RLS Policies)

```sql
-- Example: Check if user has 'admin' or 'owner' role
CREATE POLICY users_insert_admin ON users
    FOR INSERT
    WITH CHECK (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin')
        )
    );
```

### Application Level (Middleware)

```typescript
// src/infra/auth/rbac.ts

export enum Role {
  Owner = 'owner',
  Admin = 'admin',
  Developer = 'developer',
  Operator = 'operator',
  Viewer = 'viewer',
}

export enum Permission {
  // Users
  UsersCreate = 'users:create',
  UsersUpdate = 'users:update',
  UsersDelete = 'users:delete',
  UsersAssignRole = 'users:assign-role',
  
  // Agents
  AgentsCreate = 'agents:create',
  AgentsUpdate = 'agents:update',
  AgentsDelete = 'agents:delete',
  AgentsConfigureModel = 'agents:configure-model',
  
  // Sessions
  SessionsCreate = 'sessions:create',
  SessionsDelete = 'sessions:delete',
  
  // Skills
  SkillsInstall = 'skills:install',
  SkillsConfigure = 'skills:configure',
  SkillsRemove = 'skills:remove',
  
  // Tenant
  TenantUpdate = 'tenant:update',
  TenantDelete = 'tenant:delete',
  BillingView = 'billing:view',
  BillingUpdate = 'billing:update',
  
  // Observability
  TracesView = 'traces:view',
  LogsView = 'logs:view',
  AlertsConfigure = 'alerts:configure',
}

// Permission matrix
const rolePermissions: Record<Role, Permission[]> = {
  [Role.Owner]: [
    // All permissions
    Permission.UsersCreate,
    Permission.UsersUpdate,
    Permission.UsersDelete,
    Permission.UsersAssignRole,
    Permission.AgentsCreate,
    Permission.AgentsUpdate,
    Permission.AgentsDelete,
    Permission.AgentsConfigureModel,
    Permission.SessionsCreate,
    Permission.SessionsDelete,
    Permission.SkillsInstall,
    Permission.SkillsConfigure,
    Permission.SkillsRemove,
    Permission.TenantUpdate,
    Permission.TenantDelete,
    Permission.BillingView,
    Permission.BillingUpdate,
    Permission.TracesView,
    Permission.LogsView,
    Permission.AlertsConfigure,
  ],
  
  [Role.Admin]: [
    Permission.UsersCreate,
    Permission.UsersUpdate,
    Permission.UsersDelete,
    Permission.UsersAssignRole,
    Permission.AgentsCreate,
    Permission.AgentsUpdate,
    Permission.AgentsDelete,
    Permission.AgentsConfigureModel,
    Permission.SessionsCreate,
    Permission.SessionsDelete,
    Permission.SkillsInstall,
    Permission.SkillsConfigure,
    Permission.SkillsRemove,
    Permission.TracesView,
    Permission.LogsView,
    Permission.AlertsConfigure,
  ],
  
  [Role.Developer]: [
    Permission.AgentsCreate,
    Permission.AgentsUpdate,
    Permission.AgentsConfigureModel,
    Permission.SessionsCreate,
    Permission.SkillsInstall,
    Permission.SkillsConfigure,
    Permission.SkillsRemove,
    Permission.TracesView,
    Permission.LogsView,
  ],
  
  [Role.Operator]: [
    Permission.AgentsCreate,
    Permission.AgentsUpdate,
    Permission.SessionsCreate,
  ],
  
  [Role.Viewer]: [
    // Read-only, enforced by RLS
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

// Middleware
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    next();
  };
}
```

### API Usage

```typescript
// src/api/agents.ts
import { requirePermission, Permission } from '../infra/auth/rbac';

router.post('/agents', 
  requirePermission(Permission.AgentsCreate),
  async (req, res) => {
    // Create agent
  }
);

router.delete('/agents/:id',
  requirePermission(Permission.AgentsDelete),
  async (req, res) => {
    // Delete agent
  }
);
```

---

## Special Cases

### Self-Service Profile Updates

All users can update their own profile (name, preferences), but cannot change their role:

```typescript
router.patch('/users/:id', async (req, res) => {
  const targetUserId = req.params.id;
  const currentUserId = req.user.id;
  
  // Allow self-update
  if (targetUserId === currentUserId) {
    // Prevent role escalation
    if (req.body.role && req.body.role !== req.user.role) {
      return res.status(403).json({ error: 'Cannot change own role' });
    }
    // Allow profile updates
    await updateUser(targetUserId, req.body);
    return res.json({ success: true });
  }
  
  // Require admin permission for other users
  if (!hasPermission(req.user.role, Permission.UsersUpdate)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  await updateUser(targetUserId, req.body);
  res.json({ success: true });
});
```

### Last Owner Protection

Prevent deleting or downgrading the last Owner:

```typescript
async function deleteUser(userId: string, tenantId: string, currentUserRole: Role) {
  const user = await getUser(userId);
  
  if (user.role === Role.Owner) {
    const ownerCount = await countUsersByRole(tenantId, Role.Owner);
    if (ownerCount <= 1) {
      throw new Error('Cannot delete last owner');
    }
  }
  
  await db.users.delete({ id: userId });
}
```

---

## Audit Logging

All permission checks should be logged:

```typescript
async function logPermissionCheck(
  userId: string,
  tenantId: string,
  permission: Permission,
  granted: boolean,
  resourceId?: string
) {
  await db.audit_logs.insert({
    tenant_id: tenantId,
    user_id: userId,
    action: granted ? 'permission.granted' : 'permission.denied',
    details: {
      permission,
      resourceId,
    },
  });
}
```

---

## Testing

### Unit Tests

```typescript
describe('RBAC Permission Checks', () => {
  it('Owner has all permissions', () => {
    expect(hasPermission(Role.Owner, Permission.BillingUpdate)).toBe(true);
    expect(hasPermission(Role.Owner, Permission.AgentsDelete)).toBe(true);
  });
  
  it('Viewer has no write permissions', () => {
    expect(hasPermission(Role.Viewer, Permission.AgentsCreate)).toBe(false);
    expect(hasPermission(Role.Viewer, Permission.UsersUpdate)).toBe(false);
  });
  
  it('Developer can manage agents but not delete', () => {
    expect(hasPermission(Role.Developer, Permission.AgentsCreate)).toBe(true);
    expect(hasPermission(Role.Developer, Permission.AgentsUpdate)).toBe(true);
    expect(hasPermission(Role.Developer, Permission.AgentsDelete)).toBe(false);
  });
});
```

### Integration Tests

```typescript
describe('RBAC API Enforcement', () => {
  it('Viewer cannot create agents', async () => {
    const viewer = await createUser({ role: Role.Viewer });
    const token = await generateToken(viewer);
    
    const response = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Agent' });
    
    expect(response.status).toBe(403);
  });
  
  it('Developer can create but not delete agents', async () => {
    const developer = await createUser({ role: Role.Developer });
    const token = await generateToken(developer);
    
    // Create succeeds
    const createRes = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Agent' });
    expect(createRes.status).toBe(201);
    
    // Delete fails
    const deleteRes = await request(app)
      .delete(`/api/agents/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(403);
  });
});
```

---

## Migration & Rollout

### Phase 1: Default Roles
- Assign all existing users `owner` role during migration
- Allows gradual role assignment

### Phase 2: Role Assignment
- Tenant owners assign appropriate roles to team members
- Audit log tracks all role changes

### Phase 3: Enforcement
- Enable permission checks in API
- Monitor audit logs for denied requests

---

## Next Steps

1. ✅ Review RBAC matrix
2. → Implement RBAC middleware (T027)
3. → Add permission checks to API endpoints
4. → Create role assignment UI
5. → Test permission enforcement (integration tests)
