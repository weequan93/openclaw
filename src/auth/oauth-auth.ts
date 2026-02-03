/**
 * OAuth2/OIDC Authentication Provider
 * Supports Auth0, Google, GitHub, Azure AD, etc.
 */

import type { Request, Response } from 'express';
import axios from 'axios';

export interface OAuth2Config {
    clientId: string;
    clientSecret: string;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    callbackUrl: string;
    scope?: string;
}

export interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    id_token?: string;
}

export interface OAuthUser {
    id: string;
    email: string;
    name: string;
    picture?: string;
    role: string;
}

export class OAuth2Provider {
    private config: OAuth2Config;

    constructor(config: OAuth2Config) {
        this.config = config;
    }

    /**
     * Get authorization URL for OAuth2 flow
     */
    async getAuthorizationUrl(state: string): Promise<string> {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.callbackUrl,
            response_type: 'code',
            scope: this.config.scope || 'openid profile email',
            state,
        });

        return `${this.config.authorizationUrl}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(code: string): Promise<TokenResponse> {
        try {
            const response = await axios.post<TokenResponse>(
                this.config.tokenUrl,
                new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: this.config.callbackUrl,
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );

            return response.data;
        } catch (error) {
            throw new Error(`Token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate access token
     */
    async validateToken(token: string): Promise<boolean> {
        try {
            // Try to get user info - if successful, token is valid
            await this.getUserInfo(token);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get user information from access token
     */
    async getUserInfo(accessToken: string): Promise<OAuthUser> {
        try {
            const response = await axios.get(this.config.userInfoUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const data = response.data;

            // Map provider-specific fields to standard format
            return {
                id: data.sub || data.id || data.user_id,
                email: data.email,
                name: data.name || data.display_name || data.email,
                picture: data.picture || data.avatar_url,
                role: this.mapToRole(data),
            };
        } catch (error) {
            throw new Error(`Failed to get user info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshToken(refreshToken: string): Promise<TokenResponse> {
        try {
            const response = await axios.post<TokenResponse>(
                this.config.tokenUrl,
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );

            return response.data;
        } catch (error) {
            throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Map OAuth user data to OpenClaw role
     */
    private mapToRole(userData: any): string {
        // Check for role in various common fields
        const roles = userData.roles || userData.groups || [];

        if (roles.includes('owner') || roles.includes('admin')) return 'admin';
        if (roles.includes('developer')) return 'developer';
        if (roles.includes('operator')) return 'operator';

        // Default role
        return 'viewer';
    }
}

/**
 * Express middleware for OAuth2 authentication
 */
export function createOAuth2Middleware(config: OAuth2Config) {
    const provider = new OAuth2Provider(config);

    return {
        /**
         * Initiate OAuth2 login
         */
        login: async (req: Request, res: Response) => {
            try {
                // Generate state for CSRF protection
                const state = Math.random().toString(36).substring(7);

                // Store state in session (in production, use proper session management)
                // req.session.oauthState = state;

                const authUrl = await provider.getAuthorizationUrl(state);
                res.redirect(authUrl);
            } catch (error) {
                res.status(500).json({
                    error: 'OAuth2 login failed',
                    message: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        },

        /**
         * Handle OAuth2 callback
         */
        callback: async (req: Request, res: Response) => {
            try {
                const { code, state, error } = req.query;

                if (error) {
                    throw new Error(`OAuth2 error: ${error}`);
                }

                if (!code) {
                    throw new Error('Missing authorization code');
                }

                // Verify state (CSRF protection)
                // if (state !== req.session.oauthState) {
                //   throw new Error('Invalid state parameter');
                // }

                // Exchange code for token
                const tokenResponse = await provider.exchangeCodeForToken(code as string);

                // Get user info
                const user = await provider.getUserInfo(tokenResponse.access_token);

                // TODO: Create session, issue JWT token
                // For now, just return user info
                res.json({ user, tokens: tokenResponse });
            } catch (error) {
                res.status(401).json({
                    error: 'OAuth2 authentication failed',
                    message: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        },

        /**
         * Refresh access token
         */
        refresh: async (req: Request, res: Response) => {
            try {
                const { refresh_token } = req.body;

                if (!refresh_token) {
                    throw new Error('Missing refresh token');
                }

                const tokenResponse = await provider.refreshToken(refresh_token);
                res.json(tokenResponse);
            } catch (error) {
                res.status(401).json({
                    error: 'Token refresh failed',
                    message: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        },
    };
}
