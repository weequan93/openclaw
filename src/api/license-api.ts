/**
 * License API Endpoints
 */

import type { Request, Response } from 'express';
import { LicenseValidator } from '../license/validator';

let licenseValidator: LicenseValidator | null = null;
let cachedLicense: any = null;

/**
 * Initialize license validator
 */
export function initializeLicenseValidator(publicKey: string, privateKey?: string) {
    licenseValidator = new LicenseValidator(publicKey, privateKey);
}

/**
 * POST /api/license/validate
 * Validate a license key
 */
export async function validateLicense(req: Request, res: Response): Promise<void> {
    try {
        if (!licenseValidator) {
            throw new Error('License validator not initialized');
        }

        const { licenseKey } = req.body;

        if (!licenseKey) {
            res.status(400).json({ error: 'License key required' });
            return;
        }

        const license = await licenseValidator.validateLicense(licenseKey);

        // Cache the license
        cachedLicense = license;

        res.json({
            valid: true,
            license: {
                id: license.id,
                customerId: license.customerId,
                customerName: license.customerName,
                plan: license.plan,
                expiresAt: license.expiresAt,
            },
        });
    } catch (error) {
        res.status(400).json({
            valid: false,
            error: error instanceof Error ? error.message : 'Invalid license',
        });
    }
}

/**
 * GET /api/license/info
 * Get current license information
 */
export async function getLicenseInfo(req: Request, res: Response): Promise<void> {
    try {
        if (!cachedLicense) {
            res.status(404).json({ error: 'No license configured' });
            return;
        }

        res.json({
            id: cachedLicense.id,
            customerId: cachedLicense.customerId,
            customerName: cachedLicense.customerName,
            plan: cachedLicense.plan,
            issuedAt: cachedLicense.issuedAt,
            expiresAt: cachedLicense.expiresAt,
        });
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to get license info',
        });
    }
}

/**
 * GET /api/license/features
 * Get enabled features for current license
 */
export async function getLicenseFeatures(req: Request, res: Response): Promise<void> {
    try {
        if (!cachedLicense) {
            res.status(404).json({ error: 'No license configured' });
            return;
        }

        res.json(cachedLicense.features);
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to get features',
        });
    }
}

/**
 * GET /api/license/usage
 * Get current usage vs limits
 */
export async function getLicenseUsage(req: Request, res: Response): Promise<void> {
    try {
        if (!cachedLicense) {
            res.status(404).json({ error: 'No license configured' });
            return;
        }

        // TODO: Get actual usage from database
        const usage = {
            tenantCount: 0,
            userCount: 0,
            agentCount: 0,
            sessionCount: 0,
        };

        res.json({
            limits: cachedLicense.limits,
            usage,
            remaining: {
                tenants: cachedLicense.limits.maxTenants - usage.tenantCount,
                users: cachedLicense.limits.maxUsersPerTenant - usage.userCount,
                agents: cachedLicense.limits.maxAgentsPerTenant - usage.agentCount,
                sessions: cachedLicense.limits.maxSessionsPerMonth - usage.sessionCount,
            },
        });
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to get usage',
        });
    }
}
