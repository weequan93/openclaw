/**
 * Chat Context
 * Manages chat state and WebSocket connection
 */

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { wsClient } from '../lib/websocket';
import { api } from '../lib/api';
import type { Agent, Session, Message, ChatState } from '../types';
import { useAuth } from './AuthContext';

interface ChatContextValue extends ChatState {
    selectAgent: (agent: Agent) => void;
    createSession: (agentId: string) => Promise<void>;
    loadSession: (sessionId: string) => Promise<void>;
    sendMessage: (content: string) => Promise<void>;
    uploadFile: (file: File) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated, token } = useAuth();
    const [state, setState] = useState<ChatState>({
        activeSession: null,
        messages: [],
        selectedAgent: null,
        isConnected: false,
        isLoading: false,
    });

    // Connect WebSocket when authenticated
    useEffect(() => {
        if (isAuthenticated && token) {
            const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
            wsClient.connect(wsUrl, token);

            wsClient.on('connect', () => {
                setState((prev) => ({ ...prev, isConnected: true }));
            });

            wsClient.on('disconnect', () => {
                setState((prev) => ({ ...prev, isConnected: false }));
            });

            wsClient.on('chat', (payload: any) => {
                if (payload.state === 'delta' || payload.state === 'final') {
                    const message: Message = {
                        role: 'assistant',
                        content: payload.message.content,
                        timestamp: new Date(payload.message.timestamp),
                    };

                    setState((prev) => {
                        const existingIndex = prev.messages.findIndex(
                            (m) => m.id === payload.runId
                        );

                        if (existingIndex >= 0) {
                            // Update existing message
                            const newMessages = [...prev.messages];
                            newMessages[existingIndex] = { ...message, id: payload.runId };
                            return { ...prev, messages: newMessages };
                        } else {
                            // Add new message
                            return {
                                ...prev,
                                messages: [...prev.messages, { ...message, id: payload.runId }],
                            };
                        }
                    });
                }
            });

            return () => {
                wsClient.disconnect();
            };
        }
    }, [isAuthenticated, token]);

    const selectAgent = useCallback((agent: Agent) => {
        setState((prev) => ({ ...prev, selectedAgent: agent }));
    }, []);

    const createSession = useCallback(async (agentId: string) => {
        setState((prev) => ({ ...prev, isLoading: true }));

        try {
            const session = await api.createSession(agentId);
            setState((prev) => ({
                ...prev,
                activeSession: session,
                messages: session.messages || [],
                isLoading: false,
            }));
        } catch (error) {
            setState((prev) => ({ ...prev, isLoading: false }));
            throw error;
        }
    }, []);

    const loadSession = useCallback(async (sessionId: string) => {
        setState((prev) => ({ ...prev, isLoading: true }));

        try {
            const session = await api.getSession(sessionId);
            setState((prev) => ({
                ...prev,
                activeSession: session,
                messages: session.messages || [],
                isLoading: false,
            }));
        } catch (error) {
            setState((prev) => ({ ...prev, isLoading: false }));
            throw error;
        }
    }, []);

    const sendMessage = useCallback(async (content: string) => {
        if (!state.activeSession) {
            throw new Error('No active session');
        }

        // Add user message optimistically
        const userMessage: Message = {
            role: 'user',
            content: [{ type: 'text', text: content }],
            timestamp: new Date(),
        };

        setState((prev) => ({
            ...prev,
            messages: [...prev.messages, userMessage],
        }));

        try {
            await api.sendMessage(state.activeSession.id, content);
        } catch (error) {
            // Remove optimistic message on error
            setState((prev) => ({
                ...prev,
                messages: prev.messages.slice(0, -1),
            }));
            throw error;
        }
    }, [state.activeSession]);

    const uploadFile = useCallback(async (file: File) => {
        if (!state.activeSession) {
            throw new Error('No active session');
        }

        setState((prev) => ({ ...prev, isLoading: true }));

        try {
            const url = await api.uploadFile(state.activeSession.id, file);

            // Add file message
            const fileMessage: Message = {
                role: 'user',
                content: [
                    {
                        type: 'file',
                        url,
                        filename: file.name,
                        mimeType: file.type,
                        size: file.size,
                    },
                ],
                timestamp: new Date(),
            };

            setState((prev) => ({
                ...prev,
                messages: [...prev.messages, fileMessage],
                isLoading: false,
            }));
        } catch (error) {
            setState((prev) => ({ ...prev, isLoading: false }));
            throw error;
        }
    }, [state.activeSession]);

    const deleteSession = useCallback(async (sessionId: string) => {
        await api.deleteSession(sessionId);

        if (state.activeSession?.id === sessionId) {
            setState((prev) => ({
                ...prev,
                activeSession: null,
                messages: [],
            }));
        }
    }, [state.activeSession]);

    return (
        <ChatContext.Provider
            value={{
                ...state,
                selectAgent,
                createSession,
                loadSession,
                sendMessage,
                uploadFile,
                deleteSession,
            }}
        >
            {children}
        </ChatContext.Provider>
    );
}

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChat must be used within ChatProvider');
    }
    return context;
}
