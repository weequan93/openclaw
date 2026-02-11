/**
 * Tenant Context Middleware
 * Injects tenant context into requests based on subdomain or header
 */

import { Request, Response, NextFunction } from 'express';
import { pool } from './pool.js';

export interface TenantContext {
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
}

// Extend Express Request to include tenant context
declare global {
    namespace Express {
        interface Request {
            tenant?: TenantContext;
        }
    }
}

/**
 * Middleware to extract and inject tenant context
 */
export async function tenantContextMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Try to get tenant from header first
        const tenantHeader = req.headers['x-tenant-id'] as string;

        if (tenantHeader) {
            const tenant = await getTenantById(tenantHeader);
            if (tenant) {
                req.tenant = tenant;
                return next();
            }
        }

        // Try to get tenant from subdomain
        const host = req.headers.host || '';
        const subdomain = host.split('.')[0];

        if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
            const tenant = await getTenantBySlug(subdomain);
            if (tenant) {
                req.tenant = tenant;
                return next();
            }
        }

        // No tenant found - this might be okay for some routes
        next();
    } catch (error) {
        console.error('Tenant context middleware error:', error);
        next();
    }
}

/**
 * Middleware to require tenant context
 */
export function requireTenant(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (!req.tenant) {
        res.status(400).json({ error: 'Tenant context required' });
        return;
    }
    next();
}

/**
 * Get tenant by ID
 */
async function getTenantById(id: string): Promise<TenantContext | null> {
    try {
        const result = await pool.query(
            'SELECT id, slug, name FROM tenants WHERE id = $1 AND status = $2',
            [id, 'active']
        );

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            tenantId: row.id,
            tenantSlug: row.slug,
            tenantName: row.name,
        };
    } catch (error) {
        console.error('Error fetching tenant by ID:', error);
        return null;
    }
}

/**
 * Get tenant by slug
 */
async function getTenantBySlug(slug: string): Promise<TenantContext | null> {
    try {
        const result = await pool.query(
            'SELECT id, slug, name FROM tenants WHERE slug = $1 AND status = $2',
            [slug, 'active']
        );

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            tenantId: row.id,
            tenantSlug: row.slug,
            tenantName: row.name,
        };
    } catch (error) {
        console.error('Error fetching tenant by slug:', error);
        return null;
    }
}

export default {
    tenantContextMiddleware,
    requireTenant,
};
