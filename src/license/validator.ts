/**
 * License Validation Service
 * JWT-based license keys with offline validation
 */

import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

export interface LicenseInfo {
    id: string;
    customerId: string;
    customerName: string;
    plan: 'starter' | 'professional' | 'enterprise';
    features: FeatureFlags;
    limits: ResourceLimits;
    issuedAt: Date;
    expiresAt: Date;
    signature: string;
}

export interface FeatureFlags {
    multiTenant: boolean;
    sso: boolean;
    auditLog: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    advancedAnalytics: boolean;
}

export interface ResourceLimits {
    maxTenants: number;
    maxUsersPerTenant: number;
    maxAgentsPerTenant: number;
    maxSessionsPerMonth: number;
}

export interface Usage {
    tenantCount: number;
    userCount: number;
    agentCount: number;
    sessionCount: number;
}

export class LicenseValidator {
    private publicKey: string;
    private privateKey?: string;

    constructor(publicKey: string, privateKey?: string) {
        this.publicKey = publicKey;
        this.privateKey = privateKey;
    }

    /**
     * Validate license key
     */
    async validateLicense(licenseKey: string): Promise<LicenseInfo> {
        try {
            // Verify JWT signature
            const decoded = jwt.verify(licenseKey, this.publicKey, {
                algorithms: ['RS256'],
            }) as any;

            const license: LicenseInfo = {
                id: decoded.id,
                customerId: decoded.customerId,
                customerName: decoded.customerName,
                plan: decoded.plan,
                features: decoded.features,
                limits: decoded.limits,
                issuedAt: new Date(decoded.iat * 1000),
                expiresAt: new Date(decoded.exp * 1000),
                signature: licenseKey,
            };

            // Check expiration
            if (!(await this.checkExpiration(license))) {
                throw new Error('License has expired');
            }

            return license;
        } catch (error) {
            throw new Error(`Invalid license: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check if license is expired
     */
    async checkExpiration(license: LicenseInfo): Promise<boolean> {
        return license.expiresAt > new Date();
    }

    /**
     * Get feature flags from license
     */
    async getFeatureFlags(license: LicenseInfo): Promise<FeatureFlags> {
        return license.features;
    }

    /**
     * Enforce resource limits
     */
    async enforceLimits(license: LicenseInfo, usage: Usage): Promise<void> {
        const { limits } = license;

        if (usage.tenantCount >= limits.maxTenants) {
            throw new Error(`Tenant limit reached (${limits.maxTenants})`);
        }

        if (usage.userCount >= limits.maxUsersPerTenant) {
            throw new Error(`User limit reached (${limits.maxUsersPerTenant})`);
        }

        if (usage.agentCount >= limits.maxAgentsPerTenant) {
            throw new Error(`Agent limit reached (${limits.maxAgentsPerTenant})`);
        }

        if (usage.sessionCount >= limits.maxSessionsPerMonth) {
            throw new Error(`Session limit reached (${limits.maxSessionsPerMonth})`);
        }
    }

    /**
     * Generate license key (requires private key)
     */
    async generateLicense(info: Omit<LicenseInfo, 'issuedAt' | 'expiresAt' | 'signature'>): Promise<string> {
        if (!this.privateKey) {
            throw new Error('Private key required to generate licenses');
        }

        const now = Math.floor(Date.now() / 1000);
        const expiresIn = 365 * 24 * 60 * 60; // 1 year

        const payload = {
            ...info,
            iat: now,
            exp: now + expiresIn,
        };

        return jwt.sign(payload, this.privateKey, {
            algorithm: 'RS256',
        });
    }

    /**
     * Get license limits for plan
     */
    static getLimitsForPlan(plan: 'starter' | 'professional' | 'enterprise'): ResourceLimits {
        switch (plan) {
            case 'starter':
                return {
                    maxTenants: 1,
                    maxUsersPerTenant: 10,
                    maxAgentsPerTenant: 5,
                    maxSessionsPerMonth: 1000,
                };
            case 'professional':
                return {
                    maxTenants: 10,
                    maxUsersPerTenant: 100,
                    maxAgentsPerTenant: 25,
                    maxSessionsPerMonth: 10000,
                };
            case 'enterprise':
                return {
                    maxTenants: 100,
                    maxUsersPerTenant: 1000,
                    maxAgentsPerTenant: 100,
                    maxSessionsPerMonth: 100000,
                };
        }
    }

    /**
     * Get feature flags for plan
     */
    static getFeaturesForPlan(plan: 'starter' | 'professional' | 'enterprise'): FeatureFlags {
        switch (plan) {
            case 'starter':
                return {
                    multiTenant: false,
                    sso: false,
                    auditLog: false,
                    customBranding: false,
                    apiAccess: true,
                    advancedAnalytics: false,
                };
            case 'professional':
                return {
                    multiTenant: true,
                    sso: false,
                    auditLog: true,
                    customBranding: true,
                    apiAccess: true,
                    advancedAnalytics: false,
                };
            case 'enterprise':
                return {
                    multiTenant: true,
                    sso: true,
                    auditLog: true,
                    customBranding: true,
                    apiAccess: true,
                    advancedAnalytics: true,
                };
        }
    }
}
