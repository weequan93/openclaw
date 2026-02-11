/**
 * Billing Service
 * 
 * Integration hooks for billing providers (Stripe, Paddle).
 * Handles usage tracking, invoicing, and webhook processing.
 */

import { ResourceQuotaService } from './resource-quota-service.js';
import { AuditLogService } from './audit-log-service.js';
import { TenantService } from './tenant-service.js';

export interface BillingEvent {
    type: 'subscription.created' | 'subscription.updated' | 'subscription.cancelled' | 'invoice.paid' | 'invoice.failed';
    tenantId: string;
    customerId?: string;
    subscriptionId?: string;
    amount?: number;
    currency?: string;
    metadata?: Record<string, any>;
}

export interface UsageRecord {
    tenantId: string;
    resourceType: 'tokens' | 'users' | 'agents' | 'sessions';
    quantity: number;
    timestamp: Date;
}

export class BillingService {
    private quotaService: ResourceQuotaService;
    private auditService: AuditLogService;
    private tenantService: TenantService;

    constructor() {
        this.quotaService = new ResourceQuotaService();
        this.auditService = new AuditLogService();
        this.tenantService = new TenantService();
    }

    /**
     * Handle Stripe webhook
     */
    async handleStripeWebhook(event: any): Promise<void> {
        const billingEvent: BillingEvent = {
            type: event.type,
            tenantId: event.data.object.metadata?.tenantId,
            customerId: event.data.object.customer,
            subscriptionId: event.data.object.subscription,
            amount: event.data.object.amount_total,
            currency: event.data.object.currency,
            metadata: event.data.object.metadata,
        };

        await this.processBillingEvent(billingEvent);
    }

    /**
     * Handle Paddle webhook
     */
    async handlePaddleWebhook(event: any): Promise<void> {
        const billingEvent: BillingEvent = {
            type: this.mapPaddleEventType(event.alert_name),
            tenantId: event.passthrough,
            customerId: event.user_id,
            subscriptionId: event.subscription_id,
            amount: parseFloat(event.sale_gross),
            currency: event.currency,
            metadata: event,
        };

        await this.processBillingEvent(billingEvent);
    }

    /**
     * Process billing event
     */
    private async processBillingEvent(event: BillingEvent): Promise<void> {
        if (!event.tenantId) {
            console.error('Billing event missing tenantId:', event);
            return;
        }

        switch (event.type) {
            case 'subscription.created':
                await this.handleSubscriptionCreated(event);
                break;
            case 'subscription.updated':
                await this.handleSubscriptionUpdated(event);
                break;
            case 'subscription.cancelled':
                await this.handleSubscriptionCancelled(event);
                break;
            case 'invoice.paid':
                await this.handleInvoicePaid(event);
                break;
            case 'invoice.failed':
                await this.handleInvoiceFailed(event);
                break;
        }

        // Audit log
        await this.auditService.createAuditLog({
            tenantId: event.tenantId,
            userId: 'system',
            action: `billing.${event.type}`,
            resourceType: 'billing',
            resourceId: event.subscriptionId || event.tenantId,
            details: event,
        });
    }

    /**
     * Handle subscription created
     */
    private async handleSubscriptionCreated(event: BillingEvent): Promise<void> {
        const plan = event.metadata?.plan || 'pro';

        // Update tenant settings
        await this.tenantService.updateTenant(event.tenantId, {
            settings: {
                plan,
                features: this.getPlanFeatures(plan),
                limits: this.getPlanLimits(plan),
            },
        });

        // Update quotas
        const limits = this.getPlanLimits(plan);
        await this.quotaService.updateQuotaLimits(event.tenantId, {
            maxUsers: limits.maxUsers,
            maxAgents: limits.maxAgents,
            maxSessions: limits.maxSessions,
            maxTokensPerMonth: limits.maxTokensPerMonth,
        });
    }

    /**
     * Handle subscription updated
     */
    private async handleSubscriptionUpdated(event: BillingEvent): Promise<void> {
        const plan = event.metadata?.plan || 'pro';

        await this.tenantService.updateTenant(event.tenantId, {
            settings: {
                plan,
                features: this.getPlanFeatures(plan),
                limits: this.getPlanLimits(plan),
            },
        });

        const limits = this.getPlanLimits(plan);
        await this.quotaService.updateQuotaLimits(event.tenantId, {
            maxUsers: limits.maxUsers,
            maxAgents: limits.maxAgents,
            maxSessions: limits.maxSessions,
            maxTokensPerMonth: limits.maxTokensPerMonth,
        });
    }

    /**
     * Handle subscription cancelled
     */
    private async handleSubscriptionCancelled(event: BillingEvent): Promise<void> {
        // Downgrade to free plan
        await this.tenantService.updateTenant(event.tenantId, {
            settings: {
                plan: 'free',
                features: this.getPlanFeatures('free'),
                limits: this.getPlanLimits('free'),
            },
        });

        const limits = this.getPlanLimits('free');
        await this.quotaService.updateQuotaLimits(event.tenantId, {
            maxUsers: limits.maxUsers,
            maxAgents: limits.maxAgents,
            maxSessions: limits.maxSessions,
            maxTokensPerMonth: limits.maxTokensPerMonth,
        });
    }

    /**
     * Handle invoice paid
     */
    private async handleInvoicePaid(event: BillingEvent): Promise<void> {
        // Reset monthly quotas if needed
        await this.quotaService.resetMonthlyQuotas(event.tenantId);
    }

    /**
     * Handle invoice failed
     */
    private async handleInvoiceFailed(event: BillingEvent): Promise<void> {
        // Could send notification to tenant owner
        console.warn(`Invoice failed for tenant ${event.tenantId}`);
    }

    /**
     * Record usage for billing
     */
    async recordUsage(record: UsageRecord): Promise<void> {
        // Track usage in quota service
        await this.quotaService.incrementUsage(
            record.tenantId,
            record.resourceType,
            record.quantity
        );

        // Could also send to billing provider for usage-based billing
        // await this.sendUsageToStripe(record);
    }

    /**
     * Get current usage for tenant
     */
    async getUsage(tenantId: string): Promise<{
        tokens: number;
        users: number;
        agents: number;
        sessions: number;
    }> {
        const quota = await this.quotaService.getQuota(tenantId);

        if (!quota) {
            throw new Error('Quota not found');
        }

        return {
            tokens: quota.currentTokensThisMonth,
            users: quota.currentUsers,
            agents: quota.currentAgents,
            sessions: quota.currentSessions,
        };
    }

    /**
     * Get plan features
     */
    private getPlanFeatures(plan: string): any {
        const features = {
            free: {
                multiAgent: false,
                sso: false,
                customSkills: false,
            },
            pro: {
                multiAgent: true,
                sso: false,
                customSkills: true,
            },
            enterprise: {
                multiAgent: true,
                sso: true,
                customSkills: true,
            },
        };

        return features[plan as keyof typeof features] || features.free;
    }

    /**
     * Get plan limits
     */
    private getPlanLimits(plan: string): any {
        const limits = {
            free: {
                maxUsers: 5,
                maxAgents: 1,
                maxSessions: 50,
                maxTokensPerMonth: 100000,
            },
            pro: {
                maxUsers: 25,
                maxAgents: 5,
                maxSessions: 500,
                maxTokensPerMonth: 1000000,
            },
            enterprise: {
                maxUsers: 1000,
                maxAgents: 50,
                maxSessions: 10000,
                maxTokensPerMonth: 10000000,
            },
        };

        return limits[plan as keyof typeof limits] || limits.free;
    }

    /**
     * Map Paddle event types to standard types
     */
    private mapPaddleEventType(alertName: string): BillingEvent['type'] {
        const mapping: Record<string, BillingEvent['type']> = {
            'subscription_created': 'subscription.created',
            'subscription_updated': 'subscription.updated',
            'subscription_cancelled': 'subscription.cancelled',
            'subscription_payment_succeeded': 'invoice.paid',
            'subscription_payment_failed': 'invoice.failed',
        };

        return mapping[alertName] || 'invoice.paid';
    }
}
