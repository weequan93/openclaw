/**
 * Agent Model
 * 
 * Represents an AI agent configuration in a multi-tenant system.
 */

export interface Agent {
    id: string;
    tenantId: string;
    name: string;
    description?: string;
    model: string;
    systemPrompt?: string;
    config: AgentConfig;
    workspacePath?: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
}

export interface AgentConfig {
    temperature?: number;
    maxTokens?: number;
    dmPolicy?: 'open' | 'pairing' | 'allowlist';
    dmScope?: 'main' | 'per-peer' | 'per-channel-peer';
    skills?: {
        enabled?: string[];
        disabled?: string[];
    };
}

export interface CreateAgentInput {
    tenantId: string;
    name: string;
    description?: string;
    model?: string;
    systemPrompt?: string;
    config?: AgentConfig;
    workspacePath?: string;
}

export interface UpdateAgentInput {
    name?: string;
    description?: string;
    model?: string;
    systemPrompt?: string;
    config?: Partial<AgentConfig>;
    workspacePath?: string;
}

export interface AgentBinding {
    id: string;
    tenantId: string;
    agentId: string;
    channel: 'telegram' | 'discord' | 'slack' | 'signal' | 'whatsapp' | 'imessage' | 'web';
    accountId?: string;
    peerType?: string;
    peerId?: string;
    guildId?: string;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface AgentSkill {
    id: string;
    tenantId: string;
    agentId: string;
    skillName: string;
    skillVersion: string;
    enabled: boolean;
    config: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}
