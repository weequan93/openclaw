/**
 * Distributed Tracing Utilities
 * 
 * Provides utilities for creating and managing distributed tracing spans.
 * Integrates with OpenTelemetry for end-to-end request tracking.
 */

import { trace, Span, SpanStatusCode, context, Context } from '@opentelemetry/api';

const tracer = trace.getTracer('openclaw');

export interface SpanOptions {
    name: string;
    attributes?: Record<string, string | number | boolean>;
    parentContext?: Context;
}

/**
 * Create and execute a span
 */
export async function withSpan<T>(
    options: SpanOptions,
    callback: (span: Span) => Promise<T>
): Promise<T> {
    const ctx = options.parentContext || context.active();

    return tracer.startActiveSpan(
        options.name,
        { attributes: options.attributes },
        ctx,
        async (span: Span) => {
            try {
                const result = await callback(span);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : 'Unknown error',
                });
                span.recordException(error as Error);
                throw error;
            } finally {
                span.end();
            }
        }
    );
}

/**
 * Add attributes to current span
 */
export function addSpanAttributes(attributes: Record<string, string | number | boolean>): void {
    const span = trace.getActiveSpan();
    if (span) {
        Object.entries(attributes).forEach(([key, value]) => {
            span.setAttribute(key, value);
        });
    }
}

/**
 * Add event to current span
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = trace.getActiveSpan();
    if (span) {
        span.addEvent(name, attributes);
    }
}

/**
 * Record exception in current span
 */
export function recordSpanException(error: Error): void {
    const span = trace.getActiveSpan();
    if (span) {
        span.recordException(error);
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
        });
    }
}

/**
 * Express middleware for request tracing
 */
export function tracingMiddleware() {
    return (req: any, res: any, next: any) => {
        const spanName = `${req.method} ${req.route?.path || req.path}`;

        withSpan(
            {
                name: spanName,
                attributes: {
                    'http.method': req.method,
                    'http.url': req.url,
                    'http.route': req.route?.path || req.path,
                    'tenant.id': req.user?.tenantId || 'anonymous',
                    'user.id': req.user?.id || 'anonymous',
                },
            },
            async (span) => {
                // Add response status when request completes
                res.on('finish', () => {
                    span.setAttribute('http.status_code', res.statusCode);

                    if (res.statusCode >= 400) {
                        span.setStatus({
                            code: SpanStatusCode.ERROR,
                            message: `HTTP ${res.statusCode}`,
                        });
                    }
                });

                next();
            }
        ).catch(next);
    };
}

/**
 * Trace database queries
 */
export async function traceQuery<T>(
    queryText: string,
    params: any[] | undefined,
    executor: () => Promise<T>
): Promise<T> {
    return withSpan(
        {
            name: 'db.query',
            attributes: {
                'db.system': 'postgresql',
                'db.statement': queryText.substring(0, 200), // Truncate long queries
                'db.params.count': params?.length || 0,
            },
        },
        async (span) => {
            const startTime = Date.now();
            try {
                const result = await executor();
                const duration = Date.now() - startTime;
                span.setAttribute('db.duration_ms', duration);
                return result;
            } catch (error) {
                span.recordException(error as Error);
                throw error;
            }
        }
    );
}

/**
 * Trace agent execution
 */
export async function traceAgentExecution<T>(
    agentId: string,
    sessionKey: string,
    executor: () => Promise<T>
): Promise<T> {
    return withSpan(
        {
            name: 'agent.execute',
            attributes: {
                'agent.id': agentId,
                'session.key': sessionKey,
            },
        },
        executor
    );
}

/**
 * Trace skill execution
 */
export async function traceSkillExecution<T>(
    skillName: string,
    agentId: string,
    executor: () => Promise<T>
): Promise<T> {
    return withSpan(
        {
            name: `skill.${skillName}`,
            attributes: {
                'skill.name': skillName,
                'agent.id': agentId,
            },
        },
        executor
    );
}
