-- UP
-- Migration 007: Add platform_admin + tenant_admin roles and update RLS policies

-- Expand allowed roles
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE users
    ADD CONSTRAINT users_role_valid
    CHECK (role IN ('owner', 'tenant_admin', 'platform_admin', 'admin', 'developer', 'operator', 'viewer'));

-- Migrate legacy owner role to tenant_admin
UPDATE users SET role = 'tenant_admin' WHERE role = 'owner';

-- Update RLS policies to recognize tenant_admin (owner kept for compatibility)
DROP POLICY IF EXISTS users_insert_admin ON users;
CREATE POLICY users_insert_admin ON users
    FOR INSERT
    WITH CHECK (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin')
        )
    );

DROP POLICY IF EXISTS users_update_admin ON users;
CREATE POLICY users_update_admin ON users
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin')
        )
    );

DROP POLICY IF EXISTS users_delete_owner ON users;
CREATE POLICY users_delete_owner ON users
    FOR DELETE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin')
        )
    );

DROP POLICY IF EXISTS agents_insert ON agents;
CREATE POLICY agents_insert ON agents
    FOR INSERT
    WITH CHECK (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin', 'developer', 'operator')
        )
    );

DROP POLICY IF EXISTS agents_update ON agents;
CREATE POLICY agents_update ON agents
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin', 'developer', 'operator')
        )
    );

DROP POLICY IF EXISTS agents_delete ON agents;
CREATE POLICY agents_delete ON agents
    FOR DELETE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin')
        )
    );

DROP POLICY IF EXISTS sessions_delete ON sessions;
CREATE POLICY sessions_delete ON sessions
    FOR DELETE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin')
        )
    );

DROP POLICY IF EXISTS quotas_update ON resource_quotas;
CREATE POLICY quotas_update ON resource_quotas
    FOR UPDATE
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin')
        )
    );

DROP POLICY IF EXISTS bindings_modify ON agent_bindings;
CREATE POLICY bindings_modify ON agent_bindings
    FOR ALL
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin', 'developer', 'operator')
        )
    );

DROP POLICY IF EXISTS skills_modify ON agent_skills;
CREATE POLICY skills_modify ON agent_skills
    FOR ALL
    USING (
        tenant_id = current_tenant_id() AND
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = current_user_id()
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('owner', 'tenant_admin', 'admin', 'developer', 'operator')
        )
    );

-- DOWN
-- Revert role migration and RLS policy updates
UPDATE users SET role = 'owner' WHERE role = 'tenant_admin';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE users
    ADD CONSTRAINT users_role_valid
    CHECK (role IN ('owner', 'admin', 'developer', 'operator', 'viewer'));

DROP POLICY IF EXISTS users_insert_admin ON users;
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

DROP POLICY IF EXISTS users_update_admin ON users;
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

DROP POLICY IF EXISTS users_delete_owner ON users;
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

DROP POLICY IF EXISTS agents_insert ON agents;
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

DROP POLICY IF EXISTS agents_update ON agents;
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

DROP POLICY IF EXISTS agents_delete ON agents;
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

DROP POLICY IF EXISTS sessions_delete ON sessions;
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

DROP POLICY IF EXISTS quotas_update ON resource_quotas;
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

DROP POLICY IF EXISTS bindings_modify ON agent_bindings;
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

DROP POLICY IF EXISTS skills_modify ON agent_skills;
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
