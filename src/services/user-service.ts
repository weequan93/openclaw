/**
 * User Service
 * 
 * Manages users with RBAC in multi-tenant system.
 */

import { PoolClient } from 'pg';
import { User, CreateUserInput, UpdateUserInput, UserRole } from '../models/user.js';
import { getDatabasePool } from '../infra/database/pool.js';
import { withTenantContext } from '../infra/database/tenant-context.js';
import * as crypto from 'crypto';

export class UserService {
    /**
     * Create a new user
     */
    async createUser(input: CreateUserInput): Promise<User> {
        const pool = getDatabasePool();

        const passwordHash = input.password
            ? await this.hashPassword(input.password)
            : null;

        const result = await pool.query<User>(
            `INSERT INTO users (tenant_id, email, password_hash, role, full_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
            [
                input.tenantId,
                input.email,
                passwordHash,
                input.role || 'viewer',
                input.fullName || null,
                JSON.stringify(input.metadata || {}),
            ]
        );

        return this.mapRow(result[0]);
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        const pool = getDatabasePool();

        const result = await pool.query<User>(
            'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
            [userId]
        );

        return result[0] ? this.mapRow(result[0]) : null;
    }

    /**
     * Get user by email (within tenant)
     */
    async getUserByEmail(tenantId: string, email: string): Promise<User | null> {
        const pool = getDatabasePool();

        const result = await pool.query<User>(
            'SELECT * FROM users WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL',
            [tenantId, email]
        );

        return result[0] ? this.mapRow(result[0]) : null;
    }

    /**
     * Update user
     */
    async updateUser(userId: string, input: UpdateUserInput): Promise<User> {
        const pool = getDatabasePool();

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (input.email) {
            updates.push(`email = $${paramIndex++}`);
            values.push(input.email);
        }

        if (input.password) {
            const passwordHash = await this.hashPassword(input.password);
            updates.push(`password_hash = $${paramIndex++}`);
            values.push(passwordHash);
        }

        if (input.role) {
            updates.push(`role = $${paramIndex++}`);
            values.push(input.role);
        }

        if (input.fullName !== undefined) {
            updates.push(`full_name = $${paramIndex++}`);
            values.push(input.fullName);
        }

        if (input.metadata) {
            // Merge with existing metadata
            const user = await this.getUserById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const mergedMetadata = {
                ...user.metadata,
                ...input.metadata,
                preferences: { ...user.metadata.preferences, ...input.metadata.preferences },
                sso: { ...user.metadata.sso, ...input.metadata.sso },
            };

            updates.push(`metadata = $${paramIndex++}`);
            values.push(JSON.stringify(mergedMetadata));
        }

        if (updates.length === 0) {
            throw new Error('No updates provided');
        }

        values.push(userId);

        const result = await pool.query<User>(
            `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex} AND deleted_at IS NULL
       RETURNING *`,
            values
        );

        if (!result[0]) {
            throw new Error('User not found');
        }

        return this.mapRow(result[0]);
    }

    /**
     * Delete user (soft delete)
     */
    async deleteUser(userId: string): Promise<void> {
        const pool = getDatabasePool();

        // Check if user is last owner
        const user = await this.getUserById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.role === 'owner') {
            const ownerCount = await this.countUsersByRole(user.tenantId, 'owner');
            if (ownerCount <= 1) {
                throw new Error('Cannot delete last owner');
            }
        }

        await pool.query(
            'UPDATE users SET deleted_at = NOW() WHERE id = $1',
            [userId]
        );
    }

    /**
     * List users in tenant
     */
    async listUsers(tenantId: string, limit = 50, offset = 0): Promise<User[]> {
        const pool = getDatabasePool();

        const result = await pool.query<User>(
            `SELECT * FROM users 
       WHERE tenant_id = $1 AND deleted_at IS NULL 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
            [tenantId, limit, offset]
        );

        return result.map(row => this.mapRow(row));
    }

    /**
     * Count users by role
     */
    async countUsersByRole(tenantId: string, role: UserRole): Promise<number> {
        const pool = getDatabasePool();

        const result = await pool.query<{ count: string }>(
            'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND role = $2 AND deleted_at IS NULL',
            [tenantId, role]
        );

        return parseInt(result[0].count, 10);
    }

    /**
     * Verify password
     */
    async verifyPassword(userId: string, password: string): Promise<boolean> {
        const user = await this.getUserById(userId);
        if (!user || !user.passwordHash) {
            return false;
        }

        const hash = await this.hashPassword(password);
        return hash === user.passwordHash;
    }

    /**
     * Update last login timestamp
     */
    async updateLastLogin(userId: string): Promise<void> {
        const pool = getDatabasePool();

        await pool.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1',
            [userId]
        );
    }

    /**
     * Hash password (simple implementation - use bcrypt in production)
     */
    private async hashPassword(password: string): Promise<string> {
        return crypto.createHash('sha256').update(password).digest('hex');
    }

    /**
     * Map database row to User model
     */
    private mapRow(row: any): User {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            email: row.email,
            passwordHash: row.password_hash,
            role: row.role,
            fullName: row.full_name,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            deletedAt: row.deleted_at ? new Date(row.deleted_at) : undefined,
            lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : undefined,
        };
    }
}
