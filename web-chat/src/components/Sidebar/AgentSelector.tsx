/**
 * Agent Selector Component
 */

import React, { useEffect, useState } from 'react';
import { useChat } from '../../contexts/ChatContext';
import { api } from '../../lib/api';
import type { Agent } from '../../types';
import { Bot, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

export function AgentSelector() {
    const { selectedAgent, selectAgent, createSession } = useChat();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        api
            .listAgents()
            .then((data) => {
                setAgents(data);
                if (data.length > 0 && !selectedAgent) {
                    selectAgent(data[0]);
                }
            })
            .catch((error) => {
                console.error('Failed to load agents:', error);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [selectedAgent, selectAgent]);

    const handleSelectAgent = async (agent: Agent) => {
        selectAgent(agent);
        setIsOpen(false);

        // Create new session with selected agent
        try {
            await createSession(agent.id);
        } catch (error) {
            console.error('Failed to create session:', error);
        }
    };

    if (isLoading) {
        return (
            <div className="p-4 border-b border-gray-200">
                <div className="animate-pulse bg-gray-200 h-10 rounded-lg"></div>
            </div>
        );
    }

    return (
        <div className="p-4 border-b border-gray-200 relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between gap-2 p-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-primary-600" />
                    <div className="text-left">
                        <div className="font-medium text-sm">
                            {selectedAgent?.name || 'Select an agent'}
                        </div>
                        {selectedAgent && (
                            <div className="text-xs text-gray-500">{selectedAgent.model}</div>
                        )}
                    </div>
                </div>
                <ChevronDown
                    className={clsx(
                        'w-4 h-4 text-gray-600 transition-transform',
                        isOpen && 'transform rotate-180'
                    )}
                />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute top-full left-4 right-4 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto">
                        {agents.map((agent) => (
                            <button
                                key={agent.id}
                                onClick={() => handleSelectAgent(agent)}
                                className={clsx(
                                    'w-full p-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0',
                                    selectedAgent?.id === agent.id && 'bg-primary-50'
                                )}
                            >
                                <div className="font-medium text-sm">{agent.name}</div>
                                <div className="text-xs text-gray-500">{agent.model}</div>
                                {agent.description && (
                                    <div className="text-xs text-gray-600 mt-1">
                                        {agent.description}
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
