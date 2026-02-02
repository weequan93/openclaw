/**
 * Tenant Context Middleware
 * 
 * Sets tenant context for Row-Level Security (RLS) enforcement.
 * Ensures all database queries are scoped to the current tenant.
 */

import { PoolClient } from 'pg';
import { Request, Response, NextFunction } from 'express';

export interface TenantContext {
    tenantId: string;
    userId?: string;
    isAdmin?: boolean;
}

/**
 * Set tenant context for RLS
 */
export async function setTenantContext(
    client: PoolClient,
    context: TenantContext
): Promise<void> {
    // Set tenant ID (required)
    await client.query('SET LOCAL app.current_tenant_id = $1', [context.tenantId]);

    // Set user ID (optional)
    if (context.userId) {
        await client.query('SET LOCAL app.current_user_id = $1', [context.userId]);
    }

    // Set admin flag (optional, for system operations)
    if (context.isAdmin) {
        await client.query('SET LOCAL app.is_admin = $1', [context.isAdmin]);
    }
}

/**
 * Clear tenant context
 */
export async function clearTenantContext(client: PoolClient): Promise<void> {
    await client.query('RESET app.current_tenant_id');
    await client.query('RESET app.current_user_id');
    await client.query('RESET app.is_admin');
}

/**
 * Express middleware to set tenant context
 */
export function tenantContextMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
        // Skip if no user (public endpoints)
        if (!req.user) {
            return next();
        }

        // Get database client from pool
        const { getDatabasePool } = await import('./pool.js');
        const pool = getDatabasePool();
        const client = await pool.getClient();

        try {
            // Set tenant context
            await setTenantContext(client, {
                tenantId: req.user.tenantId,
                userId: req.user.id,
                isAdmin: req.user.isSystemAdmin || false,
            });

            // Attach client to request for use in handlers
            req.dbClient = client;

            // Ensure client is released after response
            res.on('finish', () => {
                client.release();
            });

            res.on('close', () => {
                client.release();
            });

            next();
        } catch (error) {
            client.release();
            next(error);
        }
    };
}

/**
 * Utility to execute query with tenant context
 */
export async function withTenantContext<T>(
    context: TenantContext,
    callback: (client: PoolClient) => Promise<T>
): Promise<T> {
    const { getDatabasePool } = await import('./pool.js');
    const pool = getDatabasePool();
    const client = await pool.getClient();

    try {
        await setTenantContext(client, context);
        return await callback(client);
    } finally {
        await clearTenantContext(client);
        client.release();
    }
}

/**
 * Utility to execute transaction with tenant context
 */
export async function withTenantTransaction<T>(
    context: TenantContext,
    callback: (client: PoolClient) => Promise<T>
): Promise<T> {
    const { getDatabasePool } = await import('./pool.js');
    const pool = getDatabasePool();
    const client = await pool.getClient();

    try {
        await client.query('BEGIN');
        await setTenantContext(client, context);

        const result = await callback(client);

        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await clearTenantContext(client);
        client.release();
    }
}

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            dbClient?: PoolClient;
            user?: {
                id: string;
                tenantId: string;
                email: string;
                role: string;
                isSystemAdmin?: boolean;
            };
        }
    }
}
