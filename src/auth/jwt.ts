const jwt = require('jsonwebtoken');

/**
 * JWT token utilities for OpenClaw Enterprise
 * Handles token generation, validation, and refresh
 */

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export interface TokenPayload {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
    type: 'access' | 'refresh';
}

/**
 * Generate an access token
 */
export function generateAccessToken(payload: Omit<TokenPayload, 'type'>): string {
    return jwt.sign(
        { ...payload, type: 'access' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * Generate a refresh token
 */
export function generateRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
    return jwt.sign(
        { ...payload, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
}

/**
 * Generate both access and refresh tokens
 */
export function generateTokenPair(payload: Omit<TokenPayload, 'type'>): {
    accessToken: string;
    refreshToken: string;
} {
    return {
        accessToken: generateAccessToken(payload),
        refreshToken: generateRefreshToken(payload),
    };
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): TokenPayload {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
        return decoded;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new Error('Token expired');
        }
        if (error instanceof jwt.JsonWebTokenError) {
            throw new Error('Invalid token');
        }
        throw error;
    }
}

/**
 * Decode a token without verification (for debugging)
 */
export function decodeToken(token: string): TokenPayload | null {
    try {
        return jwt.decode(token) as TokenPayload;
    } catch (error) {
        return null;
    }
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: string): boolean {
    try {
        verifyToken(token);
        return false;
    } catch (error) {
        if (error instanceof Error && error.message === 'Token expired') {
            return true;
        }
        return false;
    }
}

/**
 * Refresh an access token using a refresh token
 */
export function refreshAccessToken(refreshToken: string): string {
    const payload = verifyToken(refreshToken);

    if (payload.type !== 'refresh') {
        throw new Error('Invalid refresh token');
    }

    // Generate new access token with same payload
    return generateAccessToken({
        userId: payload.userId,
        tenantId: payload.tenantId,
        email: payload.email,
        role: payload.role,
    });
}

export default {
    generateAccessToken,
    generateRefreshToken,
    generateTokenPair,
    verifyToken,
    decodeToken,
    isTokenExpired,
    refreshAccessToken,
};
