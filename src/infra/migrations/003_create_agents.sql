-- UP
-- Migration 003: Create agents table

CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Agent Identity
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Configuration
    model VARCHAR(100) NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
    system_prompt TEXT,
    config JSONB DEFAULT '{}',
    
    -- Workspace
    workspace_path VARCHAR(500),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT agents_name_tenant_unique UNIQUE (tenant_id, name, deleted_at)
);

CREATE INDEX idx_agents_tenant ON agents(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_agents_name ON agents(tenant_id, name);

CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Agent bindings table
CREATE TABLE agent_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    
    -- Binding Rules
    channel VARCHAR(50) NOT NULL,
    account_id VARCHAR(255),
    peer_type VARCHAR(50),
    peer_id VARCHAR(255),
    guild_id VARCHAR(255),
    
    -- Priority (lower = higher priority)
    priority INTEGER DEFAULT 100,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT bindings_channel_valid CHECK (channel IN ('telegram', 'discord', 'slack', 'signal', 'whatsapp', 'imessage', 'web'))
);

CREATE INDEX idx_bindings_tenant ON agent_bindings(tenant_id);
CREATE INDEX idx_bindings_agent ON agent_bindings(agent_id);
CREATE INDEX idx_bindings_lookup ON agent_bindings(tenant_id, channel, account_id, peer_id);

CREATE TRIGGER bindings_updated_at BEFORE UPDATE ON agent_bindings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Agent skills table
CREATE TABLE agent_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    
    -- Skill Identity
    skill_name VARCHAR(255) NOT NULL,
    skill_version VARCHAR(50) NOT NULL,
    
    -- Configuration
    enabled BOOLEAN DEFAULT TRUE,
    config JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT skills_agent_name_unique UNIQUE (agent_id, skill_name)
);

CREATE INDEX idx_skills_agent ON agent_skills(agent_id) WHERE enabled = TRUE;
CREATE INDEX idx_skills_tenant ON agent_skills(tenant_id);

CREATE TRIGGER skills_updated_at BEFORE UPDATE ON agent_skills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- DOWN
DROP TRIGGER IF EXISTS skills_updated_at ON agent_skills;
DROP TABLE IF EXISTS agent_skills CASCADE;
DROP TRIGGER IF EXISTS bindings_updated_at ON agent_bindings;
DROP TABLE IF EXISTS agent_bindings CASCADE;
DROP TRIGGER IF EXISTS agents_updated_at ON agents;
DROP TABLE IF EXISTS agents CASCADE;
