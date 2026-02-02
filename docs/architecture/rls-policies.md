# Row-Level Security (RLS) Policies

**Version**: 1.0.0  
**Date**: 2026-02-02  
**Status**: Design  
**Related**: [Database Schema](database-schema), [RBAC Matrix](rbac-matrix)

---

## Overview

This document defines PostgreSQL Row-Level Security (RLS) policies for OpenClaw's multi-tenant SaaS deployment. RLS provides **4-layer tenant isolation** as required by the constitution (Principle VII):

1. **Application filtering**: Queries include `WHERE tenant_id = current_tenant_id()`
2. **PostgreSQL RLS**: Database enforces tenant boundaries
3. **Session locks**: Tenant context set via `SET LOCAL`
4. **Foreign key cascades**: Automatic cleanup on tenant deletion

**Security Goal**: Prevent 100% of cross-tenant data access attempts (SC-006)

---

## Tenant Context Management

### Setting Tenant Context

```sql
-- Function to get current tenant from session variable
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get current user from session variable
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;
```

### Application Usage

```typescript
// src/infra/database/tenant-context.ts
export async function setTenantContext(
  client: PoolClient,
  tenantId: string,
  userId?: string
): Promise<void> {
  await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
  if (userId) {
    await client.query('SET LOCAL app.current_user_id = $1', [userId]);
  }
}

// Middleware usage
app.use(async (req, res, next) => {
  const client = await pool.connect();
  try {
    await setTenantContext(client, req.user.tenantId, req.user.id);
    req.dbClient = client;
    next();
  } catch (err) {
    client.release();
    next(err);
  }
});
```

---

## RLS Policy Definitions

### 1. `tenants` Table

```sql
-- Enable RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own tenant
CREATE POLICY tenants_isolation ON tenants
    FOR ALL
    USING (id = current_tenant_id());

-- Policy: System admin can see all tenants (for migrations, support)
CREATE POLICY tenants_admin ON tenants
    FOR ALL
    USING (current_setting('app.is_admin', TRUE)::BOOLEAN = TRUE);
```

**Rationale**: Tenants should never see other tenants' data. Admin bypass is for system operations only.

---

### 2. `users` Table

```sql
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see users in their tenant
CREATE POLICY users_tenant_isolation ON users
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Policy: Only owners/admins can insert users
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

-- Policy: Only owners/admins can update users
CREATE POLICY users_update_admin ON users
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin')
        )
    );

-- Policy: Users can update their own profile
CREATE POLICY users_update_self ON users
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        id = current_user_id()
    )
    WITH CHECK (
        -- Prevent role escalation
        role = (SELECT role FROM users WHERE id = current_user_id())
    );

-- Policy: Only owners can delete users
CREATE POLICY users_delete_owner ON users
    FOR DELETE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role = 'owner'
        )
    );
```

**Rationale**: 
- All users see tenant members (for collaboration)
- Only admins/owners can manage users
- Users can update their own profile but not change their role
- Only owners can delete users (prevents accidental lockout)

---

### 3. `agents` Table

```sql
-- Enable RLS
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

-- Policy: All users can see agents in their tenant
CREATE POLICY agents_select ON agents
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Policy: Developers/operators/admins/owners can create agents
CREATE POLICY agents_insert ON agents
    FOR INSERT
    WITH CHECK (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin', 'developer', 'operator')
        )
    );

-- Policy: Developers/operators/admins/owners can update agents
CREATE POLICY agents_update ON agents
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin', 'developer', 'operator')
        )
    );

-- Policy: Only admins/owners can delete agents
CREATE POLICY agents_delete ON agents
    FOR DELETE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin')
        )
    );
```

**Rationale**: Viewers can see agents but not modify. Developers/operators can manage agents. Only admins/owners can delete.

---

### 4. `sessions` Table

```sql
-- Enable RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see all sessions in their tenant
CREATE POLICY sessions_select ON sessions
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Policy: All authenticated users can create sessions
CREATE POLICY sessions_insert ON sessions
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

-- Policy: Users can update sessions in their tenant
CREATE POLICY sessions_update ON sessions
    FOR UPDATE
    USING (tenant_id = current_tenant_id());

-- Policy: Admins/owners can delete sessions
CREATE POLICY sessions_delete ON sessions
    FOR DELETE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin')
        )
    );
```

**Rationale**: Sessions are shared within tenant for collaboration. Only admins can delete (for data retention management).

---

### 5. `audit_logs` Table

```sql
-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: All users can see audit logs in their tenant
CREATE POLICY audit_select ON audit_logs
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Policy: System can insert audit logs (application-level only)
CREATE POLICY audit_insert ON audit_logs
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

-- Policy: No updates allowed (immutable)
-- (No UPDATE policy = all updates blocked)

-- Policy: No deletes allowed (immutable)
-- (No DELETE policy = all deletes blocked)
```

**Rationale**: Audit logs are immutable and append-only. All tenant members can view for transparency.

---

### 6. `resource_quotas` Table

```sql
-- Enable RLS
ALTER TABLE resource_quotas ENABLE ROW LEVEL SECURITY;

-- Policy: All users can see their tenant's quotas
CREATE POLICY quotas_select ON resource_quotas
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Policy: Only owners can update quotas
CREATE POLICY quotas_update ON resource_quotas
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role = 'owner'
        )
    );

-- Policy: System can insert quotas (during tenant creation)
CREATE POLICY quotas_insert ON resource_quotas
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());
```

**Rationale**: All users see quotas (for transparency). Only owners can modify (prevents abuse).

---

### 7. `agent_bindings` Table

```sql
-- Enable RLS
ALTER TABLE agent_bindings ENABLE ROW LEVEL SECURITY;

-- Policy: All users can see bindings in their tenant
CREATE POLICY bindings_select ON agent_bindings
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Policy: Developers/operators/admins/owners can manage bindings
CREATE POLICY bindings_modify ON agent_bindings
    FOR ALL
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin', 'developer', 'operator')
        )
    );
```

---

### 8. `agent_skills` Table

```sql
-- Enable RLS
ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;

-- Policy: All users can see skills in their tenant
CREATE POLICY skills_select ON agent_skills
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Policy: Developers/operators/admins/owners can manage skills
CREATE POLICY skills_modify ON agent_skills
    FOR ALL
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'admin', 'developer', 'operator')
        )
    );
```

---

## Testing RLS Policies

### Penetration Test Suite

```sql
-- Test 1: Cross-tenant data access (should fail)
BEGIN;
SET LOCAL app.current_tenant_id = 'tenant-a-uuid';
SELECT * FROM agents WHERE tenant_id = 'tenant-b-uuid';
-- Expected: 0 rows (RLS blocks access)
ROLLBACK;

-- Test 2: Viewer cannot create agents (should fail)
BEGIN;
SET LOCAL app.current_tenant_id = 'tenant-a-uuid';
SET LOCAL app.current_user_id = 'viewer-user-uuid';
INSERT INTO agents (tenant_id, name) VALUES ('tenant-a-uuid', 'test');
-- Expected: ERROR: new row violates row-level security policy
ROLLBACK;

-- Test 3: User cannot escalate role (should fail)
BEGIN;
SET LOCAL app.current_tenant_id = 'tenant-a-uuid';
SET LOCAL app.current_user_id = 'developer-user-uuid';
UPDATE users SET role = 'owner' WHERE id = 'developer-user-uuid';
-- Expected: ERROR: new row violates row-level security policy
ROLLBACK;

-- Test 4: Audit logs are immutable (should fail)
BEGIN;
SET LOCAL app.current_tenant_id = 'tenant-a-uuid';
DELETE FROM audit_logs WHERE id = 'some-log-uuid';
-- Expected: ERROR: permission denied
ROLLBACK;
```

### Automated Test Implementation

```typescript
// tests/security/rls-penetration.test.ts
describe('RLS Penetration Tests', () => {
  it('should block cross-tenant data access', async () => {
    const tenantA = await createTenant({ name: 'Tenant A' });
    const tenantB = await createTenant({ name: 'Tenant B' });
    
    const agentB = await createAgent({ tenantId: tenantB.id, name: 'Agent B' });
    
    // Try to access Tenant B's agent from Tenant A's context
    const client = await pool.connect();
    await setTenantContext(client, tenantA.id);
    
    const result = await client.query(
      'SELECT * FROM agents WHERE id = $1',
      [agentB.id]
    );
    
    expect(result.rows).toHaveLength(0); // RLS should block
    client.release();
  });
  
  it('should prevent role escalation', async () => {
    const tenant = await createTenant({ name: 'Test' });
    const developer = await createUser({ 
      tenantId: tenant.id, 
      role: 'developer' 
    });
    
    const client = await pool.connect();
    await setTenantContext(client, tenant.id, developer.id);
    
    await expect(
      client.query(
        'UPDATE users SET role = $1 WHERE id = $2',
        ['owner', developer.id]
      )
    ).rejects.toThrow(/row-level security policy/);
    
    client.release();
  });
});
```

---

## Performance Considerations

### Index Optimization

All RLS policies filter by `tenant_id`, so ensure indexes exist:

```sql
-- Already defined in schema, but critical for RLS performance
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
```

### Query Plan Analysis

```sql
-- Verify RLS doesn't cause sequential scans
EXPLAIN ANALYZE
SELECT * FROM agents WHERE tenant_id = current_tenant_id();

-- Expected: Index Scan using idx_agents_tenant
```

---

## Migration Script

```sql
-- File: src/infra/migrations/006_enable_rls.sql

-- Create helper functions
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;

-- Create all policies (see above for full definitions)
-- ... (policies defined in sections 1-8)
```

---

## Compliance & Auditing

### SOC 2 Requirements

✅ **Access Control (CC6.1)**: RLS enforces tenant boundaries at database level  
✅ **Logical Access (CC6.2)**: RBAC policies prevent unauthorized modifications  
✅ **Audit Logging (CC7.2)**: Immutable audit_logs table tracks all sensitive operations

### GDPR Requirements

✅ **Data Isolation (Art. 32)**: RLS prevents cross-tenant data access  
✅ **Right to Erasure (Art. 17)**: Soft deletes with `deleted_at` allow data retention compliance  
✅ **Audit Trail (Art. 30)**: Comprehensive logging of data processing activities

---

## Next Steps

1. ✅ Review RLS policies
2. → Define RBAC permission matrix ([rbac-matrix.md](rbac-matrix))
3. → Implement migration script (T009)
4. → Run penetration tests (T036)
5. → Verify 100% isolation (SC-006)
