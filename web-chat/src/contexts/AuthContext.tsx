/**
 * Authentication Context
 * Manages user authentication state and operations
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';
import type { User, Tenant, AuthState } from '../types';

interface AuthContextValue extends AuthState {
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        tenant: null,
        token: null,
        isAuthenticated: false,
        isLoading: true,
    });

    // Check for existing auth on mount
    useEffect(() => {
        const token = localStorage.getItem('auth_token');
        if (token) {
            api
                .getCurrentUser()
                .then((user) => {
                    setState({
                        user,
                        tenant: null, // TODO: Fetch tenant
                        token,
                        isAuthenticated: true,
                        isLoading: false,
                    });
                })
                .catch(() => {
                    localStorage.removeItem('auth_token');
                    setState((prev) => ({ ...prev, isLoading: false }));
                });
        } else {
            setState((prev) => ({ ...prev, isLoading: false }));
        }
    }, []);

    const login = async (email: string, password: string) => {
        setState((prev) => ({ ...prev, isLoading: true }));

        try {
            const { user, token } = await api.login(email, password);
            localStorage.setItem('auth_token', token);

            setState({
                user,
                tenant: null, // TODO: Fetch tenant
                token,
                isAuthenticated: true,
                isLoading: false,
            });
        } catch (error) {
            setState((prev) => ({ ...prev, isLoading: false }));
            throw error;
        }
    };

    const logout = async () => {
        try {
            await api.logout();
        } finally {
            localStorage.removeItem('auth_token');
            setState({
                user: null,
                tenant: null,
                token: null,
                isAuthenticated: false,
                isLoading: false,
            });
        }
    };

    const refreshUser = async () => {
        const user = await api.getCurrentUser();
        setState((prev) => ({ ...prev, user }));
    };

    return (
        <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
