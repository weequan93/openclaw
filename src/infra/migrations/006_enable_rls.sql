-- UP
-- Migration 006: Enable Row-Level Security (RLS)

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
ALTER TABLE agent_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Tenants policies
CREATE POLICY tenants_isolation ON tenants
    FOR ALL
    USING (id = current_tenant_id());

-- Users policies
CREATE POLICY users_tenant_isolation ON users
    FOR SELECT
    USING (tenant_id = current_tenant_id());

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

CREATE POLICY users_update_self ON users
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        id = current_user_id()
    )
    WITH CHECK (
        role = (SELECT role FROM users WHERE id = current_user_id())
    );

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

-- Agents policies
CREATE POLICY agents_select ON agents
    FOR SELECT
    USING (tenant_id = current_tenant_id());

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

-- Sessions policies
CREATE POLICY sessions_select ON sessions
    FOR SELECT
    USING (tenant_id = current_tenant_id());

CREATE POLICY sessions_insert ON sessions
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY sessions_update ON sessions
    FOR UPDATE
    USING (tenant_id = current_tenant_id());

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

-- Audit logs policies
CREATE POLICY audit_select ON audit_logs
    FOR SELECT
    USING (tenant_id = current_tenant_id());

CREATE POLICY audit_insert ON audit_logs
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

-- Resource quotas policies
CREATE POLICY quotas_select ON resource_quotas
    FOR SELECT
    USING (tenant_id = current_tenant_id());

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

CREATE POLICY quotas_insert ON resource_quotas
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

-- Agent bindings policies
CREATE POLICY bindings_select ON agent_bindings
    FOR SELECT
    USING (tenant_id = current_tenant_id());

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

-- Agent skills policies
CREATE POLICY skills_select ON agent_skills
    FOR SELECT
    USING (tenant_id = current_tenant_id());

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

-- DOWN
-- Drop all policies
DROP POLICY IF EXISTS tenants_isolation ON tenants;
DROP POLICY IF EXISTS users_tenant_isolation ON users;
DROP POLICY IF EXISTS users_insert_admin ON users;
DROP POLICY IF EXISTS users_update_admin ON users;
DROP POLICY IF EXISTS users_update_self ON users;
DROP POLICY IF EXISTS users_delete_owner ON users;
DROP POLICY IF EXISTS agents_select ON agents;
DROP POLICY IF EXISTS agents_insert ON agents;
DROP POLICY IF EXISTS agents_update ON agents;
DROP POLICY IF EXISTS agents_delete ON agents;
DROP POLICY IF EXISTS sessions_select ON sessions;
DROP POLICY IF EXISTS sessions_insert ON sessions;
DROP POLICY IF EXISTS sessions_update ON sessions;
DROP POLICY IF EXISTS sessions_delete ON sessions;
DROP POLICY IF EXISTS audit_select ON audit_logs;
DROP POLICY IF EXISTS audit_insert ON audit_logs;
DROP POLICY IF EXISTS quotas_select ON resource_quotas;
DROP POLICY IF EXISTS quotas_update ON resource_quotas;
DROP POLICY IF EXISTS quotas_insert ON resource_quotas;
DROP POLICY IF EXISTS bindings_select ON agent_bindings;
DROP POLICY IF EXISTS bindings_modify ON agent_bindings;
DROP POLICY IF EXISTS skills_select ON agent_skills;
DROP POLICY IF EXISTS skills_modify ON agent_skills;

-- Disable RLS
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_bindings DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE resource_quotas DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- Drop helper functions
DROP FUNCTION IF EXISTS current_user_id();
DROP FUNCTION IF EXISTS current_tenant_id();
