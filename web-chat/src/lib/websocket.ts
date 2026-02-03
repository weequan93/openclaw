/**
 * WebSocket Client for real-time communication with OpenClaw Gateway
 */

import { io, Socket } from 'socket.io-client';

type EventHandler = (...args: any[]) => void;

export class WebSocketClient {
    private socket: Socket | null = null;
    private url: string = '';
    private token: string | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;

    /**
     * Connect to WebSocket server
     */
    connect(url: string, token?: string): void {
        this.url = url;
        this.token = token || null;

        const socketUrl = url.replace(/^http/, 'ws');

        this.socket = io(socketUrl, {
            auth: {
                token: this.token,
            },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: 5000,
        });

        this.socket.on('connect', () => {
            console.log('[WebSocket] Connected');
            this.reconnectAttempts = 0;
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[WebSocket] Disconnected:', reason);
        });

        this.socket.on('connect_error', (error) => {
            console.error('[WebSocket] Connection error:', error);
            this.reconnectAttempts++;
        });

        this.socket.on('reconnect', (attemptNumber) => {
            console.log('[WebSocket] Reconnected after', attemptNumber, 'attempts');
        });

        this.socket.on('reconnect_failed', () => {
            console.error('[WebSocket] Reconnection failed');
        });
    }

    /**
     * Disconnect from WebSocket server
     */
    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    /**
     * Send event to server
     */
    send(event: string, data: any): void {
        if (!this.socket) {
            console.error('[WebSocket] Not connected');
            return;
        }

        this.socket.emit(event, data);
    }

    /**
     * Listen for event from server
     */
    on(event: string, handler: EventHandler): void {
        if (!this.socket) {
            console.error('[WebSocket] Not connected');
            return;
        }

        this.socket.on(event, handler);
    }

    /**
     * Remove event listener
     */
    off(event: string, handler?: EventHandler): void {
        if (!this.socket) {
            return;
        }

        if (handler) {
            this.socket.off(event, handler);
        } else {
            this.socket.off(event);
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }

    /**
     * Get socket ID
     */
    getSocketId(): string | undefined {
        return this.socket?.id;
    }
}

// Singleton instance
export const wsClient = new WebSocketClient();
