/**
 * User Model
 * 
 * Represents a user with RBAC roles in a multi-tenant system.
 */

export type UserRole =
  | 'platform_admin'
  | 'tenant_admin'
  | 'owner'
  | 'admin'
  | 'developer'
  | 'operator'
  | 'viewer';

export interface User {
    id: string;
    tenantId: string;
    email: string;
    passwordHash?: string; // NULL for SSO-only users
    role: UserRole;
    fullName?: string;
    metadata: UserMetadata;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
    lastLoginAt?: Date;
}

export interface UserMetadata {
    preferences?: {
        theme?: 'light' | 'dark';
        notifications?: boolean;
    };
    sso?: {
        provider?: 'okta' | 'azure' | 'google';
        externalId?: string;
    };
}

export interface CreateUserInput {
    tenantId: string;
    email: string;
    password?: string;
    role?: UserRole;
    fullName?: string;
    metadata?: UserMetadata;
}

export interface UpdateUserInput {
    email?: string;
    password?: string;
    role?: UserRole;
    fullName?: string;
    metadata?: Partial<UserMetadata>;
}
