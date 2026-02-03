/**
 * TypeScript type definitions for OpenClaw Web Chat
 */

export interface User {
    id: string;
    tenantId: string;
    email: string;
    name?: string;
    role: 'owner' | 'admin' | 'developer' | 'operator' | 'viewer';
    createdAt: Date;
}

export interface Tenant {
    id: string;
    name: string;
    slug: string;
    settings: Record<string, any>;
}

export interface Agent {
    id: string;
    tenantId: string;
    name: string;
    description?: string;
    model: string;
    systemPrompt?: string;
    config: Record<string, any>;
}

export interface Session {
    id: string;
    tenantId: string;
    agentId: string;
    userId?: string;
    sessionKey: string;
    messages: Message[];
    metadata: Record<string, any>;
    messageCount: number;
    tokenCount: number;
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt?: Date;
}

export interface Message {
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: MessageContent[];
    timestamp: Date;
}

export type MessageContent = TextContent | ImageContent | FileContent;

export interface TextContent {
    type: 'text';
    text: string;
}

export interface ImageContent {
    type: 'image';
    url: string;
    alt?: string;
}

export interface FileContent {
    type: 'file';
    url: string;
    filename: string;
    mimeType: string;
    size: number;
}

export interface ChatState {
    activeSession: Session | null;
    messages: Message[];
    selectedAgent: Agent | null;
    isConnected: boolean;
    isLoading: boolean;
}

export interface AuthState {
    user: User | null;
    tenant: Tenant | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
}
