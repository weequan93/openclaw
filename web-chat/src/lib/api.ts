/**
 * HTTP API Client for OpenClaw REST API
 */

import axios, { AxiosInstance } from 'axios';
import type { User, Agent, Session, Message } from '../types';

class ApiClient {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Add auth token to requests
        this.client.interceptors.request.use((config) => {
            const token = localStorage.getItem('auth_token');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        });

        // Handle auth errors
        this.client.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401) {
                    localStorage.removeItem('auth_token');
                    window.location.href = '/login';
                }
                return Promise.reject(error);
            }
        );
    }

    // ============================================================================
    // Authentication
    // ============================================================================

    async login(email: string, password: string): Promise<{ user: User; token: string }> {
        const response = await this.client.post('/api/auth/login', { email, password });
        return response.data;
    }

    async logout(): Promise<void> {
        await this.client.post('/api/auth/logout');
        localStorage.removeItem('auth_token');
    }

    async getCurrentUser(): Promise<User> {
        const response = await this.client.get('/api/auth/me');
        return response.data.user;
    }

    // ============================================================================
    // Agents
    // ============================================================================

    async listAgents(): Promise<Agent[]> {
        const response = await this.client.get('/api/admin/agents');
        return response.data.agents;
    }

    async getAgent(id: string): Promise<Agent> {
        const response = await this.client.get(`/api/admin/agents/${id}`);
        return response.data.agent;
    }

    async createAgent(data: Partial<Agent>): Promise<Agent> {
        const response = await this.client.post('/api/admin/agents', data);
        return response.data.agent;
    }

    // ============================================================================
    // Sessions
    // ============================================================================

    async listSessions(limit = 50, offset = 0): Promise<Session[]> {
        const response = await this.client.get('/api/admin/sessions', {
            params: { limit, offset },
        });
        return response.data.sessions;
    }

    async getSession(id: string): Promise<Session> {
        const response = await this.client.get(`/api/admin/sessions/${id}`);
        return response.data.session;
    }

    async createSession(agentId: string): Promise<Session> {
        const response = await this.client.post('/api/sessions', { agentId });
        return response.data.session;
    }

    async deleteSession(id: string): Promise<void> {
        await this.client.delete(`/api/admin/sessions/${id}`);
    }

    // ============================================================================
    // Messages
    // ============================================================================

    async sendMessage(sessionId: string, content: string): Promise<void> {
        await this.client.post(`/api/sessions/${sessionId}/messages`, {
            content,
        });
    }

    async uploadFile(sessionId: string, file: File): Promise<string> {
        const formData = new FormData();
        formData.append('file', file);

        const response = await this.client.post(
            `/api/sessions/${sessionId}/upload`,
            formData,
            {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            }
        );

        return response.data.url;
    }
}

export const api = new ApiClient();
