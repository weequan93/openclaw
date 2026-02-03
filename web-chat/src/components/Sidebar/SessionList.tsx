/**
 * Session List Component
 */

import React, { useEffect, useState } from 'react';
import { useChat } from '../../contexts/ChatContext';
import { api } from '../../lib/api';
import type { Session } from '../../types';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

export function SessionList() {
    const { activeSession, loadSession, deleteSession, selectedAgent, createSession } = useChat();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const loadSessions = () => {
        setIsLoading(true);
        api
            .listSessions(50, 0)
            .then((data) => {
                setSessions(data);
            })
            .catch((error) => {
                console.error('Failed to load sessions:', error);
            })
            .finally(() => {
                setIsLoading(false);
            });
    };

    useEffect(() => {
        loadSessions();
    }, []);

    const handleNewSession = async () => {
        if (!selectedAgent) {
            return;
        }

        try {
            await createSession(selectedAgent.id);
            loadSessions();
        } catch (error) {
            console.error('Failed to create session:', error);
        }
    };

    const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();

        if (!confirm('Are you sure you want to delete this session?')) {
            return;
        }

        try {
            await deleteSession(sessionId);
            loadSessions();
        } catch (error) {
            console.error('Failed to delete session:', error);
        }
    };

    if (isLoading) {
        return (
            <div className="flex-1 p-4 space-y-2">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse bg-gray-200 h-16 rounded-lg"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-200">
                <button
                    onClick={handleNewSession}
                    disabled={!selectedAgent}
                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    New Session
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {sessions.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-sm">
                        No sessions yet
                    </div>
                ) : (
                    sessions.map((session) => (
                        <button
                            key={session.id}
                            onClick={() => loadSession(session.id)}
                            className={clsx(
                                'w-full p-3 rounded-lg text-left transition-colors group relative',
                                activeSession?.id === session.id
                                    ? 'bg-primary-100 border border-primary-300'
                                    : 'bg-white border border-gray-200 hover:bg-gray-50'
                            )}
                        >
                            <div className="flex items-start gap-2">
                                <MessageSquare className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate">
                                        Session {session.sessionKey.slice(0, 8)}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {session.messageCount} messages
                                    </div>
                                    {session.lastMessageAt && (
                                        <div className="text-xs text-gray-400">
                                            {formatDistanceToNow(new Date(session.lastMessageAt), {
                                                addSuffix: true,
                                            })}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={(e) => handleDeleteSession(session.id, e)}
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity"
                                    title="Delete session"
                                >
                                    <Trash2 className="w-4 h-4 text-red-600" />
                                </button>
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
