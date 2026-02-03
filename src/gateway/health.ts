/**
 * Health Check Endpoints
 * Provides liveness, readiness, and general health checks for Kubernetes
 */

import type { Request, Response } from 'express';
import { getDatabasePool } from '../infra/database/pool';

export interface HealthCheck {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
    latency?: number;
}

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
        database: HealthCheck;
        disk: HealthCheck;
        memory: HealthCheck;
    };
    uptime: number;
    version: string;
    timestamp: string;
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();

    try {
        const pool = getDatabasePool();
        await pool.query('SELECT 1');

        return {
            status: 'healthy',
            latency: Date.now() - start,
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Database connection failed',
            latency: Date.now() - start,
        };
    }
}

/**
 * Check disk space
 */
function checkDisk(): HealthCheck {
    try {
        // Simple check - in production, use actual disk space monitoring
        const usage = process.memoryUsage();
        const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;

        if (heapUsedPercent > 90) {
            return {
                status: 'unhealthy',
                message: `Heap usage at ${heapUsedPercent.toFixed(1)}%`,
            };
        } else if (heapUsedPercent > 75) {
            return {
                status: 'degraded',
                message: `Heap usage at ${heapUsedPercent.toFixed(1)}%`,
            };
        }

        return {
            status: 'healthy',
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Disk check failed',
        };
    }
}

/**
 * Check memory usage
 */
function checkMemory(): HealthCheck {
    try {
        const usage = process.memoryUsage();
        const rssPercent = (usage.rss / (2 * 1024 * 1024 * 1024)) * 100; // Assume 2GB limit

        if (rssPercent > 90) {
            return {
                status: 'unhealthy',
                message: `Memory usage at ${rssPercent.toFixed(1)}%`,
            };
        } else if (rssPercent > 75) {
            return {
                status: 'degraded',
                message: `Memory usage at ${rssPercent.toFixed(1)}%`,
            };
        }

        return {
            status: 'healthy',
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Memory check failed',
        };
    }
}

/**
 * GET /health - General health check
 * Returns overall health status with all checks
 */
export async function handleHealthCheck(req: Request, res: Response): Promise<void> {
    const checks = {
        database: await checkDatabase(),
        disk: checkDisk(),
        memory: checkMemory(),
    };

    // Determine overall status
    const statuses = Object.values(checks).map((c) => c.status);
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (statuses.includes('unhealthy')) {
        overallStatus = 'unhealthy';
    } else if (statuses.includes('degraded')) {
        overallStatus = 'degraded';
    }

    const health: HealthStatus = {
        status: overallStatus,
        checks,
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        timestamp: new Date().toISOString(),
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
}

/**
 * GET /health/live - Liveness probe
 * Returns 200 if the application is running
 * Kubernetes will restart the pod if this fails
 */
export function handleLivenessProbe(req: Request, res: Response): void {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
    });
}

/**
 * GET /health/ready - Readiness probe
 * Returns 200 if the application can serve traffic
 * Kubernetes will remove the pod from service if this fails
 */
export async function handleReadinessProbe(req: Request, res: Response): Promise<void> {
    try {
        // Check critical dependencies
        const dbCheck = await checkDatabase();

        if (dbCheck.status === 'unhealthy') {
            res.status(503).json({
                status: 'not ready',
                reason: 'Database not available',
                timestamp: new Date().toISOString(),
            });
            return;
        }

        res.status(200).json({
            status: 'ready',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(503).json({
            status: 'not ready',
            reason: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
        });
    }
}
