/**
 * Session Model
 * 
 * Represents a conversation session in a multi-tenant system.
 */

export interface Session {
    id: string;
    tenantId: string;
    agentId: string;
    userId?: string;
    sessionKey: string;
    messages: SessionMessage[];
    metadata: SessionMetadata;
    messageCount: number;
    tokenCount: number;
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt?: Date;
}

export interface SessionMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: {
        channel?: string;
        peerId?: string;
        tokenCount?: number;
    };
}

export interface SessionMetadata {
    channel?: string;
    peerType?: string;
    peerId?: string;
    guildId?: string;
    [key: string]: any;
}

export interface CreateSessionInput {
    tenantId: string;
    agentId: string;
    userId?: string;
    sessionKey: string;
    metadata?: SessionMetadata;
}

export interface UpdateSessionInput {
    messages?: SessionMessage[];
    metadata?: Partial<SessionMetadata>;
    messageCount?: number;
    tokenCount?: number;
    lastMessageAt?: Date;
}

export interface ResourceQuota {
    id: string;
    tenantId: string;
    maxUsers: number;
    maxAgents: number;
    maxSessions: number;
    maxTokensPerMonth: number;
    maxCpuCores: number;
    maxMemoryMb: number;
    maxDiskMb: number;
    currentUsers: number;
    currentAgents: number;
    currentSessions: number;
    currentTokensThisMonth: number;
    createdAt: Date;
    updatedAt: Date;
    quotaResetAt: Date;
}
