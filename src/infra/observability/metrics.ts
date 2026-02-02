/**
 * Prometheus Metrics Exporter
 * 
 * Exports metrics to Prometheus for monitoring and alerting.
 * Tracks gateway uptime, message processing, agent queue depth, and error rates.
 */

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

// Create registry
export const register = new Registry();

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics({ register });

/**
 * Gateway Metrics
 */

// Gateway uptime
export const gatewayUptime = new Gauge({
    name: 'openclaw_gateway_uptime_seconds',
    help: 'Gateway uptime in seconds',
    registers: [register],
});

// Start time for uptime calculation
const startTime = Date.now();
setInterval(() => {
    gatewayUptime.set((Date.now() - startTime) / 1000);
}, 5000);

/**
 * Message Processing Metrics
 */

// Messages received counter
export const messagesReceived = new Counter({
    name: 'openclaw_messages_received_total',
    help: 'Total number of messages received',
    labelNames: ['channel', 'tenant_id'],
    registers: [register],
});

// Messages processed counter
export const messagesProcessed = new Counter({
    name: 'openclaw_messages_processed_total',
    help: 'Total number of messages processed',
    labelNames: ['channel', 'tenant_id', 'agent_id', 'status'],
    registers: [register],
});

// Message processing duration
export const messageProcessingDuration = new Histogram({
    name: 'openclaw_message_processing_duration_seconds',
    help: 'Message processing duration in seconds',
    labelNames: ['channel', 'tenant_id', 'agent_id'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [register],
});

/**
 * Agent Queue Metrics
 */

// Agent queue depth
export const agentQueueDepth = new Gauge({
    name: 'openclaw_agent_queue_depth',
    help: 'Number of messages in agent queue',
    labelNames: ['agent_id', 'tenant_id'],
    registers: [register],
});

// Active agents
export const activeAgents = new Gauge({
    name: 'openclaw_active_agents',
    help: 'Number of active agents',
    labelNames: ['tenant_id'],
    registers: [register],
});

/**
 * Error Metrics
 */

// Error counter
export const errors = new Counter({
    name: 'openclaw_errors_total',
    help: 'Total number of errors',
    labelNames: ['type', 'tenant_id', 'agent_id'],
    registers: [register],
});

// Error rate (errors per minute)
export const errorRate = new Gauge({
    name: 'openclaw_error_rate',
    help: 'Error rate (errors per minute)',
    labelNames: ['tenant_id'],
    registers: [register],
});

/**
 * Session Metrics
 */

// Active sessions
export const activeSessions = new Gauge({
    name: 'openclaw_active_sessions',
    help: 'Number of active sessions',
    labelNames: ['tenant_id', 'agent_id'],
    registers: [register],
});

// Session duration
export const sessionDuration = new Histogram({
    name: 'openclaw_session_duration_seconds',
    help: 'Session duration in seconds',
    labelNames: ['tenant_id', 'agent_id'],
    buckets: [60, 300, 900, 1800, 3600, 7200],
    registers: [register],
});

/**
 * Database Metrics
 */

// Database query duration
export const dbQueryDuration = new Histogram({
    name: 'openclaw_db_query_duration_seconds',
    help: 'Database query duration in seconds',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [register],
});

// Database connection pool
export const dbPoolConnections = new Gauge({
    name: 'openclaw_db_pool_connections',
    help: 'Database connection pool statistics',
    labelNames: ['state'], // 'total', 'idle', 'waiting'
    registers: [register],
});

/**
 * Resource Quota Metrics
 */

// Token usage
export const tokenUsage = new Counter({
    name: 'openclaw_token_usage_total',
    help: 'Total tokens used',
    labelNames: ['tenant_id', 'agent_id', 'model'],
    registers: [register],
});

// Quota utilization
export const quotaUtilization = new Gauge({
    name: 'openclaw_quota_utilization_percent',
    help: 'Resource quota utilization percentage',
    labelNames: ['tenant_id', 'resource_type'], // 'tokens', 'users', 'agents', 'sessions'
    registers: [register],
});

/**
 * HTTP Metrics
 */

// HTTP requests
export const httpRequests = new Counter({
    name: 'openclaw_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});

// HTTP request duration
export const httpRequestDuration = new Histogram({
    name: 'openclaw_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [register],
});

/**
 * Metrics endpoint handler
 */
export async function metricsHandler(req: any, res: any): Promise<void> {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
}

/**
 * Express middleware for HTTP metrics
 */
export function metricsMiddleware() {
    return (req: any, res: any, next: any) => {
        const start = Date.now();

        res.on('finish', () => {
            const duration = (Date.now() - start) / 1000;
            const route = req.route?.path || req.path;

            httpRequests.inc({
                method: req.method,
                route,
                status_code: res.statusCode,
            });

            httpRequestDuration.observe(
                {
                    method: req.method,
                    route,
                    status_code: res.statusCode,
                },
                duration
            );
        });

        next();
    };
}

/**
 * Update database pool metrics
 */
export function updateDbPoolMetrics(stats: { total: number; idle: number; waiting: number }): void {
    dbPoolConnections.set({ state: 'total' }, stats.total);
    dbPoolConnections.set({ state: 'idle' }, stats.idle);
    dbPoolConnections.set({ state: 'waiting' }, stats.waiting);
}
