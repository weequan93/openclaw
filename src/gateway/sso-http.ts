import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import passport from 'passport';
// @ts-ignore - missing types
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { MultiSamlStrategy } from '@node-saml/passport-saml';
import { loadConfig } from '../config/config.js';
import userService from '../services/user-service.js';
import tenantService from '../services/tenant-service.js';
import jwt from 'jsonwebtoken';
import { getAdminJwtSecret } from "./admin-auth.js";

const SSO_PREFIX = '/auth';

// Helper to run middleware
const runMiddleware = (req: any, res: any, fn: Function) => {
    return new Promise((resolve, reject) => {
        fn(req, res, (result: any) => {
            if (result instanceof Error) {
                return reject(result);
            }
            return resolve(result);
        });
    });
};

// Polyfill for req.query/req.body needed by Passport
const polyfillRequest = async (req: any, res: any) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    req.query = Object.fromEntries(url.searchParams);

    if (req.method === 'POST') {
        req.body = await new Promise((resolve) => {
            let data = '';
            req.on('data', (chunk: any) => data += chunk);
            req.on('end', () => {
                // Parse form-urlencoded (common for SAML/OAuth)
                const params = new URLSearchParams(data);
                resolve(Object.fromEntries(params));
            });
        });
    } else {
        req.body = {};
    }

    // Polyfill Request methods
    (req as any).query = req.query || {};
    if (!(req as any).get) {
        (req as any).get = (name: string) => req.headers[name.toLowerCase()];
    }

    // Polyfill Response methods used by Passport
    if (!(res as any).set) {
        (res as any).set = (name: string, value: string) => res.setHeader(name, value);
    }

    if (!(res as any).redirect) {
        (res as any).redirect = (statusOrUrl: string | number, url?: string) => {
            let redirectUrl = url;
            let status = 302;

            if (typeof statusOrUrl === 'string') {
                redirectUrl = statusOrUrl;
            } else {
                status = statusOrUrl;
                redirectUrl = url;
            }

            res.statusCode = status;
            res.setHeader('Location', redirectUrl || '/');
            res.end();
        };
    }

    if (!(res as any).send) {
        (res as any).send = (body: string) => {
            res.end(body);
        };
    }

    if (!(res as any).json) {
        (res as any).json = (body: any) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body));
        };
    }

    if (!(res as any).status) {
        (res as any).status = (code: number) => {
            res.statusCode = code;
            return res;
        };
    }
};

let passportInitialized = false;

// Initialize Passport with Dynamic Strategies
function initPassport() {
    if (passportInitialized) return;

    passport.serializeUser((user: any, done) => done(null, user));
    passport.deserializeUser((user: any, done) => done(null, user));

    // Multi-SAML Strategy
    const samlStrategy = new (MultiSamlStrategy as unknown as new (...args: any[]) => passport.Strategy)(
        {
            passReqToCallback: true,
            getSamlOptions: async (req: any, done: any) => {
                try {
                    // Extract tenant slug from query param or relay state
                    const url = new URL(req.url, `http://${req.headers.host}`);
                    let slug = url.searchParams.get('tenant') || (req.body && req.body.RelayState);

                    if (!slug) {
                        // Attempt to parse from URL path if it's a callback /auth/saml/callback/:slug
                        const parts = url.pathname.split('/');
                        if (parts.includes('callback') && parts.length > 4) {
                            slug = parts[parts.length - 1];
                        }
                    }

                    if (!slug) return done(new Error('Tenant slug not found'), null);

                    const tenant = await tenantService.getTenantBySlug(slug);
                    if (!tenant) return done(new Error('Tenant not found'), null);
                    if (!tenant.settings?.sso?.enabled || tenant.settings.sso.provider !== 'saml') {
                        return done(new Error('SAML not enabled for this tenant'), null);
                    }

                    const sso = tenant.settings.sso;
                    return done(null, {
                        entryPoint: sso.entryPoint,
                        issuer: sso.issuer,
                        cert: sso.cert,
                        callbackUrl: `http://${req.headers.host}/auth/saml/callback/${slug}`, // Dynamic Callback
                    } as any);

                } catch (err) {
                    return done(err, null);
                }
            }
        },
        async (req: any, profile: any, done: any) => {
            try {
                // Re-fetch slug to ensure we link to correct tenant
                const url = new URL(req.url, `http://${req.headers.host}`);
                // For callback, slug is usually in path
                const parts = url.pathname.split('/');
                const slug = parts[parts.length - 1] || (req.body && req.body.RelayState);

                if (!slug) return done(new Error('Tenant context lost'), null);

                const tenant = await tenantService.getTenantBySlug(slug);
                if (!tenant) return done(new Error('Tenant not found'), null);

                const email = profile.email || profile.nameID;
                // Find OR Create User LINKED to this Tenant
                const user = await userService.findOrCreateByEmail({
                    email,
                    fullName: profile.displayName || email,
                    role: 'viewer', // Default role for auto-provisioning
                    tenantId: tenant.id
                });
                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    );
    passport.use('saml', samlStrategy);

    // Dynamic OAuth2 Strategy Wrapper
    // We register a 'tenant-oauth2' strategy that dynamically reconfigures itself?
    // Passport doesn't support "MultiOAuth" natively easily. 
    // Instead we will handle the OAuth2 flow manually or use a customized strategy if needed.
    // For simplicity in Phase 1, we will stick to SAML for tenants and keep Global OAuth for public.

    // Global Google/Public OAuth (from env)
    const config = loadConfig();
    const globalSso = config.sso;
    if (globalSso?.oauth2?.clientId) {
        passport.use('global-oauth2', new OAuth2Strategy({
            authorizationURL: globalSso.oauth2.authorizationUrl!,
            tokenURL: globalSso.oauth2.tokenUrl!,
            clientID: globalSso.oauth2.clientId!,
            clientSecret: globalSso.oauth2.clientSecret!,
            callbackURL: globalSso.oauth2.callbackUrl!,
        }, async (accessToken: string, refreshToken: string, profile: any, cb: any) => {
            try {
                // Global OAuth - Creates specific "Public" tenant or Default
                // Ideally this flow requires the user to Create a Tenant UI flow next
                // For now, map to default

                // Fetch user info
                let email = 'unknown@example.com';
                let name = 'OAuth User';

                if (globalSso.oauth2?.userInfoUrl) {
                    const userRes = await fetch(globalSso.oauth2.userInfoUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });
                    const userData = await userRes.json();
                    email = userData.email || userData.sub || email;
                    name = userData.name || userData.login || name;
                }

                const user = await userService.findOrCreateByEmail({
                    email,
                    fullName: name,
                    role: 'tenant_admin', // Public signup implies creating a new account effectively
                    tenantId: 'default-tenant-id' // Temp placeholder until tenant creation flow
                });
                return cb(null, user);
            } catch (e) { return cb(e); }
        }));
    }

    passportInitialized = true;
}

export async function handleSsoHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (!url.pathname.startsWith(SSO_PREFIX)) {
        return false;
    }

    // Lazy init
    initPassport();
    await polyfillRequest(req, res);

    // Initialize passport middleware
    await runMiddleware(req, res, passport.initialize());

    try {
        console.log('[SSO] Handling request:', url.pathname);

        // 1. Global Public Login (Google/etc)
        if (url.pathname === '/auth/login/google') {
            // @ts-ignore
            await runMiddleware(req, res, passport.authenticate('global-oauth2', { session: false, state: false } as any));
            return true;
        }

        if (url.pathname === '/auth/oauth2/callback') {
            await runMiddleware(req, res, passport.authenticate('global-oauth2', { session: false, failureRedirect: '/login?error=1' } as any));
            const user = (req as any).user;
            issueTokenAndRedirect(res, user);
            return true;
        }

        // 2. Tenant SAML Login
        // /auth/login/sso?tenant=acme
        if (url.pathname === '/auth/login/sso') {
            const tenantSlug = url.searchParams.get('tenant');
            if (!tenantSlug) {
                res.statusCode = 400;
                res.end('Missing tenant parameter');
                return true;
            }
            // Authenticate using 'saml' strategy, passing RelayState = slug so we know who it is on callback
            await runMiddleware(req, res, passport.authenticate('saml', { session: false, additionalParams: { RelayState: tenantSlug } } as any));
            return true;
        }

        // 3. Tenant SAML Callback
        // /auth/saml/callback/:slug
        if (url.pathname.startsWith('/auth/saml/callback')) {
            await runMiddleware(req, res, passport.authenticate('saml', { session: false, failureRedirect: '/login?error=1' } as any));
            const user = (req as any).user;
            issueTokenAndRedirect(res, user);
            return true;
        }

    } catch (err) {
        console.error('SSO Error:', err);
        res.statusCode = 500;
        res.end('Authentication Error: ' + (err as Error).message);
        return true;
    }

    return false;
}

function issueTokenAndRedirect(res: ServerResponse, user: any) {
    // 1. Generate JWT
    const token = jwt.sign(
        { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
        getAdminJwtSecret(),
        { expiresIn: '24h' }
    );

    // 2. Set Cookie
    res.setHeader('Set-Cookie', `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax`);

    // 3. Redirect to Admin UI
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
}
