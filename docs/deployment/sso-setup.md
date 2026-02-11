# SSO Configuration Guide

This guide explains how to configure Single Sign-On (SSO) for OpenClaw using SAML or OAuth2/OIDC.

## Overview

OpenClaw supports two SSO protocols:
- **SAML 2.0** - For enterprise identity providers (Okta, Azure AD, OneLogin)
- **OAuth2/OIDC** - For modern providers (Auth0, Google, GitHub)

## SAML Configuration

### Supported Providers
- Okta
- Azure Active Directory
- OneLogin
- Google Workspace
- Any SAML 2.0 compliant IdP

### 1. Configure Your IdP

#### Okta

1. Log in to Okta Admin Console
2. Go to **Applications** → **Create App Integration**
3. Select **SAML 2.0**
4. Configure:
   - **Single sign on URL**: `https://openclaw.yourdomain.com/auth/saml/callback`
   - **Audience URI**: `openclaw`
   - **Name ID format**: `EmailAddress`

5. Add attribute statements:
   - `email` → `user.email`
   - `firstName` → `user.firstName`
   - `lastName` → `user.lastName`
   - `groups` → `user.groups`

6. Download IdP metadata

#### Azure AD

1. Go to **Azure Portal** → **Azure Active Directory** → **Enterprise Applications**
2. Click **New application** → **Create your own application**
3. Select **Integrate any other application you don't find in the gallery (Non-gallery)**
4. Go to **Single sign-on** → **SAML**
5. Configure:
   - **Identifier (Entity ID)**: `openclaw`
   - **Reply URL**: `https://openclaw.yourdomain.com/auth/saml/callback`

6. Add claims:
   - `email` → `user.mail`
   - `firstName` → `user.givenname`
   - `lastName` → `user.surname`
   - `groups` → `user.groups`

7. Download **Federation Metadata XML**

### 2. Configure OpenClaw (Tenant SSO)

**New!** You can now configure SAML explicitly for each tenant using the Admin UI.

1.  **Log in** to your OpenClaw Admin Dashboard.
2.  Navigate to **Tenants**.
3.  Click **Settings** on the tenant you wish to configure.
4.  Enable **SSO** and select **SAML 2.0**.
5.  Enter the details from your IdP:
    *   **Entry Point**: (e.g., `https://your-idp.okta.com/app/...`)
    *   **Issuer**: (e.g., `openclaw`)
    *   **Certificate**: Paste the raw X.509 certificate.
6.  Save Configuration.

The **Callback URL** for your IdP is displayed on this settings page.

*Note: The global `openclaw.json` or Kubernetes ConfigMap is no longer used for Tenant SAML settings, but can still be used for Global defaults if needed.*

### 3. Group to Role Mapping

OpenClaw maps SAML groups to roles:

| SAML Group | OpenClaw Role | Permissions |
|------------|---------------|-------------|
| `openclaw-owners` | `owner` | Full access, billing |
| `openclaw-admins` | `admin` | Manage users, agents |
| `openclaw-developers` | `developer` | Create agents, sessions |
| `openclaw-operators` | `operator` | View only, execute |
| (default) | `viewer` | Read-only access |

Configure these groups in your IdP.

### 4. Test SAML Login

1. Navigate to `https://openclaw.yourdomain.com/auth/login/sso?tenant=YOUR_TENANT_SLUG`
2. You should be redirected to your IdP
3. Log in with your credentials
4. You should be redirected back to OpenClaw

## OAuth2/OIDC Configuration

### Supported Providers
- Auth0
- Google
- GitHub
- Azure AD
- Any OAuth2/OIDC compliant provider

### 1. Configure Your Provider

#### Auth0

1. Go to **Applications** → **Create Application**
2. Select **Regular Web Application**
3. Configure:
   - **Allowed Callback URLs**: `https://openclaw.yourdomain.com/auth/oauth2/callback`
   - **Allowed Logout URLs**: `https://openclaw.yourdomain.com`

4. Note your:
   - **Domain**: `your-tenant.auth0.com`
   - **Client ID**
   - **Client Secret**

#### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Go to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure:
   - **Application type**: Web application
   - **Authorized redirect URIs**: `https://openclaw.yourdomain.com/auth/oauth2/callback`

6. Note your **Client ID** and **Client Secret**

#### GitHub

1. Go to **Settings** → **Developer settings** → **OAuth Apps**
2. Click **New OAuth App**
3. Configure:
   - **Homepage URL**: `https://openclaw.yourdomain.com`
   - **Authorization callback URL**: `https://openclaw.yourdomain.com/auth/oauth2/callback`

4. Note your **Client ID** and **Client Secret**

### 2. Configure OpenClaw

Update your Kubernetes ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: openclaw-config
data:
  sso.enabled: "true"
  oauth2.authorizationUrl: "https://your-tenant.auth0.com/authorize"
  oauth2.tokenUrl: "https://your-tenant.auth0.com/oauth/token"
  oauth2.userInfoUrl: "https://your-tenant.auth0.com/userinfo"
  oauth2.callbackUrl: "https://openclaw.yourdomain.com/auth/oauth2/callback"
```

Update your Kubernetes Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: openclaw-secrets
stringData:
  oauth2.clientId: "YOUR_CLIENT_ID"
  oauth2.clientSecret: "YOUR_CLIENT_SECRET"
```

### 3. Test OAuth2 Login

1. Navigate to `https://openclaw.yourdomain.com/auth/oauth2/login`
2. You should be redirected to your OAuth2 provider
3. Authorize the application
4. You should be redirected back to OpenClaw

## Helm Configuration

If using Helm, configure SSO in `values.yaml`:

```yaml
config:
  sso:
    enabled: true
    
    # SAML Configuration
    saml:
      entryPoint: "https://your-idp.okta.com/app/xxx/sso/saml"
      issuer: "openclaw"
      callbackUrl: "https://openclaw.yourdomain.com/auth/saml/callback"
      cert: |
        -----BEGIN CERTIFICATE-----
        ...
        -----END CERTIFICATE-----
    
    # OAuth2 Configuration
    oauth2:
      authorizationUrl: "https://your-tenant.auth0.com/authorize"
      tokenUrl: "https://your-tenant.auth0.com/oauth/token"
      userInfoUrl: "https://your-tenant.auth0.com/userinfo"
      callbackUrl: "https://openclaw.yourdomain.com/auth/oauth2/callback"
      clientId: "YOUR_CLIENT_ID"
      clientSecret: "YOUR_CLIENT_SECRET"
```

## Troubleshooting

### SAML Issues

**Invalid signature**:
- Verify the IdP certificate is correct
- Check that the certificate includes BEGIN/END markers
- Ensure no extra whitespace

**Assertion expired**:
- Check server time synchronization (NTP)
- Verify timezone settings

**Attribute mapping**:
- Check IdP attribute statements
- Verify attribute names match expected values
- Check logs for received attributes

### OAuth2 Issues

**Invalid redirect_uri**:
- Verify callback URL matches exactly
- Check for trailing slashes
- Ensure HTTPS is used

**Invalid client**:
- Verify client ID and secret
- Check that credentials are not expired
- Ensure client is enabled

**Token validation failed**:
- Check token endpoint URL
- Verify client credentials
- Check network connectivity

## Security Best Practices

1. **Use HTTPS**: Always use HTTPS for SSO endpoints
2. **Validate signatures**: Ensure SAML responses are signed
3. **Check timestamps**: Validate assertion timestamps
4. **Rotate secrets**: Regularly rotate client secrets
5. **Audit logs**: Monitor SSO login attempts
6. **MFA**: Enable multi-factor authentication at IdP
7. **Session timeout**: Configure appropriate session timeouts
8. **CSRF protection**: Use state parameter in OAuth2

## Support

For SSO configuration help:
- Documentation: https://docs.openclaw.com/sso
- Email: support@openclaw.com
- GitHub Issues: https://github.com/openclaw/openclaw/issues
