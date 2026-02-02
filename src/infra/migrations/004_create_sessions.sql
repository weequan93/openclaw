-- UP
-- Migration 004: Create sessions table

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Session Identity
    session_key VARCHAR(500) NOT NULL,
    
    -- Conversation Data
    messages JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    
    -- Statistics
    message_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT sessions_key_unique UNIQUE (tenant_id, session_key)
);

CREATE INDEX idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_key ON sessions(session_key);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Resource quotas table
CREATE TABLE resource_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Quotas
    max_users INTEGER DEFAULT 5,
    max_agents INTEGER DEFAULT 3,
    max_sessions INTEGER DEFAULT 100,
    max_tokens_per_month BIGINT DEFAULT 1000000,
    max_cpu_cores INTEGER DEFAULT 2,
    max_memory_mb INTEGER DEFAULT 2048,
    max_disk_mb INTEGER DEFAULT 10240,
    
    -- Current Usage
    current_users INTEGER DEFAULT 0,
    current_agents INTEGER DEFAULT 0,
    current_sessions INTEGER DEFAULT 0,
    current_tokens_this_month BIGINT DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    quota_reset_at TIMESTAMP WITH TIME ZONE DEFAULT DATE_TRUNC('month', NOW() + INTERVAL '1 month'),
    
    -- Constraints
    CONSTRAINT quotas_tenant_unique UNIQUE (tenant_id)
);

CREATE INDEX idx_quotas_tenant ON resource_quotas(tenant_id);

CREATE TRIGGER quotas_updated_at BEFORE UPDATE ON resource_quotas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- DOWN
DROP TRIGGER IF EXISTS quotas_updated_at ON resource_quotas;
DROP TABLE IF EXISTS resource_quotas CASCADE;
DROP TRIGGER IF EXISTS sessions_updated_at ON sessions;
DROP TABLE IF EXISTS sessions CASCADE;
