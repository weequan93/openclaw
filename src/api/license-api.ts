/**
 * License API
 * Endpoints for license validation and management
 */

import { Router, Request, Response } from 'express';
import { LicenseValidator } from '../license/validator.js';

const router: Router = Router();

// Stub public key for development
const PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || 'dev-public-key';
const validator = new LicenseValidator(PUBLIC_KEY);

/**
 * POST /api/license/validate
 * Validate a license key
 */
router.post('/validate', async (req: Request, res: Response) => {
    try {
        const { licenseKey } = req.body;

        if (!licenseKey) {
            res.status(400).json({ error: 'License key required' });
            return;
        }

        const license = await validator.validateLicense(licenseKey);
        res.json({ valid: true, license });
    } catch (error) {
        res.status(400).json({
            valid: false,
            error: error instanceof Error ? error.message : 'Invalid license',
        });
    }
});

/**
 * GET /api/license/info
 * Get current license information
 */
router.get('/info', async (req: Request, res: Response) => {
    // Stub implementation
    res.json({
        plan: 'enterprise',
        features: {
            multiTenant: true,
            sso: true,
            auditLog: true,
        },
    });
});

export default router;
