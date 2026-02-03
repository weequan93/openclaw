/**
 * Prometheus Metrics Endpoint
 * Exposes application metrics for monitoring
 */

import type { Request, Response } from 'express';
import { register, Counter, Histogram, Gauge } from 'prom-client';

// HTTP Request Metrics
export const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status'],
});

export const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'path', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

// WebSocket Metrics
export const websocketConnectionsActive = new Gauge({
    name: 'websocket_connections_active',
    help: 'Number of active WebSocket connections',
});

export const websocketMessagesTotal = new Counter({
    name: 'websocket_messages_total',
    help: 'Total number of WebSocket messages',
    labelNames: ['direction'], // 'inbound' or 'outbound'
});

// Database Metrics
export const databaseQueriesTotal = new Counter({
    name: 'database_queries_total',
    help: 'Total number of database queries',
    labelNames: ['operation'], // 'select', 'insert', 'update', 'delete'
});

export const databaseQueryDuration = new Histogram({
    name: 'database_query_duration_seconds',
    help: 'Database query duration in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

export const databaseConnectionsActive = new Gauge({
    name: 'database_connections_active',
    help: 'Number of active database connections',
});

// Agent Metrics
export const agentExecutionsTotal = new Counter({
    name: 'agent_executions_total',
    help: 'Total number of agent executions',
    labelNames: ['agent_id', 'status'], // 'success' or 'error'
});

export const agentExecutionDuration = new Histogram({
    name: 'agent_execution_duration_seconds',
    help: 'Agent execution duration in seconds',
    labelNames: ['agent_id'],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
});

// Session Metrics
export const sessionsActive = new Gauge({
    name: 'sessions_active',
    help: 'Number of active sessions',
});

export const sessionsTotal = new Counter({
    name: 'sessions_total',
    help: 'Total number of sessions created',
    labelNames: ['tenant_id'],
});

export const sessionMessagesTotal = new Counter({
    name: 'session_messages_total',
    help: 'Total number of messages in sessions',
    labelNames: ['role'], // 'user' or 'assistant'
});

// Tenant Metrics
export const tenantsActive = new Gauge({
    name: 'tenants_active',
    help: 'Number of active tenants',
});

export const tenantUsersTotal = new Gauge({
    name: 'tenant_users_total',
    help: 'Total number of users across all tenants',
    labelNames: ['tenant_id'],
});

// Resource Quota Metrics
export const quotaUsage = new Gauge({
    name: 'quota_usage',
    help: 'Resource quota usage',
    labelNames: ['tenant_id', 'resource'], // resource: 'users', 'agents', 'sessions'
});

export const quotaLimit = new Gauge({
    name: 'quota_limit',
    help: 'Resource quota limit',
    labelNames: ['tenant_id', 'resource'],
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
export async function handleMetrics(req: Request, res: Response): Promise<void> {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        res.status(500).json({
            error: 'Failed to generate metrics',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

/**
 * Middleware to track HTTP request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: Function) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const path = req.route?.path || req.path;
        const method = req.method;
        const status = res.statusCode.toString();

        httpRequestsTotal.inc({ method, path, status });
        httpRequestDuration.observe({ method, path, status }, duration);
    });

    next();
}
