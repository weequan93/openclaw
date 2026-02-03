/**
 * Chat Window Component
 */

import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { useChat } from '../../contexts/ChatContext';
import { Loader2 } from 'lucide-react';

export function ChatWindow() {
    const { messages, isLoading, activeSession } = useChat();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    if (!activeSession) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="text-6xl mb-4">💬</div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">
                        No active session
                    </h3>
                    <p className="text-gray-600">
                        Select an agent and start a new conversation
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
            <div className="max-w-4xl mx-auto space-y-4">
                {messages.length === 0 && !isLoading && (
                    <div className="text-center py-12">
                        <div className="text-4xl mb-4">👋</div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Start a conversation
                        </h3>
                        <p className="text-gray-600">
                            Type a message below to begin chatting with the agent
                        </p>
                    </div>
                )}

                {messages.map((message, idx) => (
                    <MessageBubble key={idx} message={message} />
                ))}

                {isLoading && (
                    <div className="flex items-center gap-2 text-gray-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Agent is thinking...</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>
        </div>
    );
}
