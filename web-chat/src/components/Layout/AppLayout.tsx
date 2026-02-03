/**
 * App Layout Component
 */

import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { AgentSelector } from '../Sidebar/AgentSelector';
import { SessionList } from '../Sidebar/SessionList';
import { LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';

interface AppLayoutProps {
    children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
    const { user, logout } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleLogout = async () => {
        if (confirm('Are you sure you want to log out?')) {
            await logout();
        }
    };

    return (
        <div className="h-screen flex flex-col bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
                    >
                        {sidebarOpen ? (
                            <X className="w-5 h-5" />
                        ) : (
                            <Menu className="w-5 h-5" />
                        )}
                    </button>
                    <h1 className="text-xl font-bold text-gray-900">
                        {import.meta.env.VITE_APP_NAME || 'OpenClaw Chat'}
                    </h1>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-sm text-gray-600">
                        {user?.email}
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Log out"
                    >
                        <LogOut className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <aside
                    className={clsx(
                        'w-80 bg-white border-r border-gray-200 flex flex-col transition-transform lg:translate-x-0',
                        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
                        'absolute lg:relative z-20 h-full'
                    )}
                >
                    <AgentSelector />
                    <SessionList />
                </aside>

                {/* Overlay for mobile */}
                {sidebarOpen && (
                    <div
                        className="fixed inset-0 bg-black bg-opacity-50 z-10 lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* Main Content */}
                <main className="flex-1 flex flex-col overflow-hidden">
                    {children}
                </main>
            </div>
        </div>
    );
}
