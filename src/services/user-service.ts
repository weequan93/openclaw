/**
 * User Service
 * Manages user accounts within tenants
 */

import { pool } from '../infra/database/pool.js';
import type { UserRole } from '../models/user.js';

export interface User {
    id: string;
    tenantId: string;
    email: string;
    fullName?: string;
    passwordHash?: string;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
}

export class UserService {
    /**
     * Create a new user
     */
    async createUser(data: {
        tenantId: string;
        email: string;
        fullName?: string;
        passwordHash?: string;
        role: UserRole;
    }): Promise<User> {
        const result = await pool.query(
            `INSERT INTO users (tenant_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
            [data.tenantId, data.email, data.fullName || null, data.passwordHash || null, data.role]
        );

        return this.mapRow(result.rows[0]);
    }

    /**
     * Get user by ID
     */
    async getUserById(id: string): Promise<User | null> {
        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );

        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    /**
     * Get user by email
     */
    async getUserByEmail(email: string): Promise<User | null> {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    /**
     * Get user by email within a tenant
     */
    async getUserByEmailForTenant(tenantId: string, email: string): Promise<User | null> {
        const result = await pool.query(
            'SELECT * FROM users WHERE tenant_id = $1 AND email = $2',
            [tenantId, email]
        );

        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }

    /**
     * Find or create user by email (for SSO)
     */
    async findOrCreateByEmail(data: {
        email: string;
        fullName?: string;
        role?: UserRole;
        tenantId: string;
    }): Promise<User> {
        const existing = await this.getUserByEmail(data.email);
        if (existing) {
            // Update name if changed
            if ((existing.fullName || '') !== (data.fullName || '')) {
                return this.updateUser(existing.id, { fullName: data.fullName });
            }
            return existing;
        }

        return this.createUser({
            email: data.email,
            fullName: data.fullName,
            role: data.role || 'viewer',
            tenantId: data.tenantId,
        });
    }

    /**
     * Update user
     */
    async updateUser(
        id: string,
        data: Omit<Partial<User>, "passwordHash"> & { passwordHash?: string | null },
    ): Promise<User> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (data.fullName !== undefined) {
            fields.push(`full_name = $${paramIndex++}`);
            values.push(data.fullName);
        }
        if (data.passwordHash !== undefined) {
            fields.push(`password_hash = $${paramIndex++}`);
            values.push(data.passwordHash ?? null);
        }
        if (data.role) {
            fields.push(`role = $${paramIndex++}`);
            values.push(data.role);
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );

        return this.mapRow(result.rows[0]);
    }

    /**
     * Delete user
     */
    async deleteUser(id: string): Promise<void> {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }

    /**
     * List users for a tenant
     */
    async listUsersForTenant(
        tenantId: string,
        options?: {
            limit?: number;
            offset?: number;
            role?: string;
        }
    ): Promise<User[]> {
        const limit = options?.limit || 100;
        const offset = options?.offset || 0;

        let query = 'SELECT * FROM users WHERE tenant_id = $1';
        const params: any[] = [tenantId];

        if (options?.role) {
            params.push(options.role);
            query += ` AND role = $${params.length}`;
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows.map(this.mapRow);
    }

    /**
     * Alias for listUsersForTenant - used by some APIs
     */
    async listUsers(tenantId: string, options?: {
        limit?: number;
        offset?: number;
        role?: string;
    }): Promise<User[]> {
        return this.listUsersForTenant(tenantId, options);
    }

    private mapRow(row: any): User {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            email: row.email,
            fullName: row.full_name ?? undefined,
            passwordHash: row.password_hash ?? undefined,
            role: row.role,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export default new UserService();
