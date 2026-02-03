# Gateway Multi-Tenant Integration Guide

**Task**: T032 - Add tenant context to Gateway routing  
**Status**: Integration Guide  
**Complexity**: Medium (requires careful integration with existing code)

---

## Overview

This guide provides step-by-step instructions for integrating the multi-tenant infrastructure with the existing OpenClaw Gateway. The integration adds tenant context to all message routing and ensures proper isolation.

---

## Architecture Understanding

### Current Gateway Flow
1. **HTTP Server** (`server-http.ts`) - Handles HTTP requests, WebSocket upgrades
2. **Chat Handler** (`server-chat.ts`) - Processes chat messages, broadcasts events
3. **Session Management** - Currently uses JSONL files
4. **Agent Execution** - Runs agents based on configuration

### Multi-Tenant Requirements
1. **Tenant Identification** - Extract tenant from request (slug, header, JWT)
2. **Context Setting** - Set `app.current_tenant_id` for RLS
3. **Agent Resolution** - Find agent by tenant + binding
4. **Session Persistence** - Use PostgreSQL instead of JSONL
5. **Audit Logging** - Log all tenant actions

---

## Integration Steps

### Step 1: Add Tenant Middleware to HTTP Server

**File**: `src/gateway/server-http.ts`

**Location**: In `createGatewayHttpServer`, before `handleRequest`

```typescript
import { setTenantContext, getTenantIdFromRequest } from '../infra/database/tenant-context.js';
import { TenantService } from '../services/tenant-service.js';

// Add to createGatewayHttpServer function
const tenantService = new TenantService();

// Wrap handleRequest with tenant context
const handleRequestWithTenant = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    // Extract tenant from request
    const tenantId = await getTenantIdFromRequest(req, tenantService);
    
    if (!tenantId) {
      // No tenant = reject request (or use default tenant for backward compatibility)
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tenant not found' }));
      return;
    }

    // Set tenant context for this request
    await setTenantContext(req, res, async () => {
      await handleRequest(req, res);
    });
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
```

**Helper Function**: Add to `tenant-context.ts`

```typescript
/**
 * Extract tenant ID from request
 * Supports: subdomain slug, header, JWT token
 */
export async function getTenantIdFromRequest(
  req: IncomingMessage,
  tenantService: TenantService
): Promise<string | null> {
  // Option 1: Extract from subdomain (e.g., acme.openclaw.com)
  const host = req.headers.host || '';
  const subdomain = host.split('.')[0];
  
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    const tenant = await tenantService.getTenantBySlug(subdomain);
    if (tenant) {
      return tenant.id;
    }
  }

  // Option 2: Extract from X-Tenant-ID header
  const tenantHeader = req.headers['x-tenant-id'] as string;
  if (tenantHeader) {
    return tenantHeader;
  }

  // Option 3: Extract from JWT token (if using SSO)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // Decode JWT and extract tenant_id claim
    // const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // return decoded.tenant_id;
  }

  // Option 4: Default tenant for backward compatibility
  // return process.env.DEFAULT_TENANT_ID || null;

  return null;
}
```

---

### Step 2: Update Agent Resolution

**File**: `src/gateway/server-discovery.ts` (or wherever agents are resolved)

**Change**: Use `AgentService.findAgentByBinding` instead of config-based lookup

```typescript
import { AgentService } from '../services/agent-service.js';
import { getTenantIdFromContext } from '../infra/database/tenant-context.js';

const agentService = new AgentService();

// Replace existing agent lookup with:
async function resolveAgentForMessage(channel: string, accountId?: string, peerId?: string) {
  const tenantId = getTenantIdFromContext();
  
  if (!tenantId) {
    throw new Error('No tenant context set');
  }

  const agent = await agentService.findAgentByBinding(
    tenantId,
    channel,
    accountId,
    peerId
  );

  if (!agent) {
    throw new Error(`No agent found for channel ${channel}`);
  }

  return agent;
}
```

---

### Step 3: Replace Session Manager

**File**: `src/gateway/session-utils.ts` (or wherever sessions are loaded)

**Change**: Use `PostgresSessionManager` instead of JSONL

```typescript
import { PostgresSessionManager } from '../sessions/postgres-session-manager.js';
import { getTenantIdFromContext } from '../infra/database/tenant-context.js';

const sessionManager = new PostgresSessionManager();

// Replace loadSessionEntry with:
async function loadSessionEntry(sessionKey: string) {
  const tenantId = getTenantIdFromContext();
  
  if (!tenantId) {
    throw new Error('No tenant context set');
  }

  const session = await sessionManager.getSessionByKey(tenantId, sessionKey);
  
  if (!session) {
    // Create new session
    const agent = await resolveAgentForMessage(/* ... */);
    return await sessionManager.createSession({
      tenantId,
      agentId: agent.id,
      sessionKey,
    });
  }

  return session;
}

// Replace saveSessionEntry with:
async function saveSessionEntry(sessionKey: string, message: SessionMessage) {
  const session = await loadSessionEntry(sessionKey);
  
  await sessionManager.addMessage(session.id, message);
}
```

---

### Step 4: Add Audit Logging

**File**: `src/gateway/server-chat.ts`

**Change**: Log all chat interactions

```typescript
import { AuditLogService, AuditActions } from '../services/audit-log-service.js';
import { getTenantIdFromContext, getUserIdFromContext } from '../infra/database/tenant-context.js';

const auditService = new AuditLogService();

// Add to chat message handler:
async function handleChatMessage(message: string, sessionKey: string) {
  const tenantId = getTenantIdFromContext();
  const userId = getUserIdFromContext();

  // Log message received
  await auditService.createAuditLog({
    tenantId,
    userId,
    action: AuditActions.MESSAGE_SENT,
    resourceType: 'session',
    resourceId: sessionKey,
    details: { messageLength: message.length },
  });

  // Process message...
}
```

---

### Step 5: Update WebSocket Handler

**File**: `src/gateway/server-http.ts` - `attachGatewayUpgradeHandler`

**Change**: Add tenant context to WebSocket connections

```typescript
// In attachGatewayUpgradeHandler:
wss.on('connection', async (ws, req) => {
  try {
    // Extract tenant from upgrade request
    const tenantId = await getTenantIdFromRequest(req, tenantService);
    
    if (!tenantId) {
      ws.close(1008, 'Tenant not found');
      return;
    }

    // Store tenant ID on WebSocket connection
    (ws as any).tenantId = tenantId;

    // Set tenant context for all WebSocket messages
    ws.on('message', async (data) => {
      await setTenantContextById(tenantId, async () => {
        // Handle WebSocket message
        await handleWebSocketMessage(ws, data);
      });
    });
  } catch (error) {
    ws.close(1011, 'Internal server error');
  }
});
```

---

### Step 6: Update Resource Quota Checks

**File**: Wherever agents are executed

**Change**: Check quotas before execution

```typescript
import { ResourceQuotaService } from '../services/resource-quota-service.js';

const quotaService = new ResourceQuotaService();

async function executeAgent(agentId: string, message: string) {
  const tenantId = getTenantIdFromContext();

  // Check token quota
  const estimatedTokens = message.length * 1.3; // Rough estimate
  const quotaCheck = await quotaService.checkQuota(tenantId, 'tokens', estimatedTokens);

  if (!quotaCheck.allowed) {
    throw new Error(`Token quota exceeded: ${quotaCheck.current}/${quotaCheck.max}`);
  }

  // Execute agent...
  const result = await runAgent(/* ... */);

  // Track actual token usage
  await quotaService.incrementUsage(tenantId, 'tokens', result.tokenCount);

  return result;
}
```

---

## Migration Strategy

### Phase 1: Dual-Write (Backward Compatible)
1. Keep existing JSONL session storage
2. Add PostgreSQL writes alongside JSONL
3. Read from JSONL, write to both
4. Validate data consistency

### Phase 2: Dual-Read
1. Read from PostgreSQL first
2. Fall back to JSONL if not found
3. Migrate JSONL sessions to PostgreSQL in background

### Phase 3: PostgreSQL Only
1. Remove JSONL reads
2. Remove JSONL writes
3. Archive old JSONL files

---

## Testing Checklist

### Unit Tests
- [ ] Tenant extraction from subdomain
- [ ] Tenant extraction from header
- [ ] Tenant extraction from JWT
- [ ] Agent resolution by binding
- [ ] Session creation/retrieval
- [ ] Quota checking

### Integration Tests
- [ ] Create tenant via API
- [ ] Send message as Tenant A
- [ ] Verify Tenant B cannot access Tenant A's sessions
- [ ] Verify quota limits are enforced
- [ ] Verify audit logs are created

### End-to-End Tests
- [ ] Full chat flow with multi-tenant
- [ ] WebSocket connection with tenant context
- [ ] Agent execution with quota tracking
- [ ] Session persistence across restarts

---

## Environment Variables

Add to `.env`:

```bash
# Multi-Tenant Configuration
ENABLE_MULTI_TENANT=true
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000000
TENANT_EXTRACTION_METHOD=subdomain  # subdomain | header | jwt

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openclaw
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=your_password

# JWT (if using SSO)
JWT_SECRET=your_secret_key
JWT_ISSUER=https://your-domain.com
```

---

## Backward Compatibility

### Option 1: Feature Flag
```typescript
const MULTI_TENANT_ENABLED = process.env.ENABLE_MULTI_TENANT === 'true';

if (MULTI_TENANT_ENABLED) {
  // Use multi-tenant flow
} else {
  // Use legacy single-tenant flow
}
```

### Option 2: Default Tenant
```typescript
// If no tenant found, use default tenant
const tenantId = await getTenantIdFromRequest(req, tenantService) 
  || process.env.DEFAULT_TENANT_ID;
```

---

## Performance Considerations

### Database Connection Pooling
- Already implemented in `pool.ts`
- Max 20 connections
- Health checks enabled

### Caching
Consider caching:
- Tenant lookups by slug (1 hour TTL)
- Agent bindings (5 minute TTL)
- Resource quotas (1 minute TTL)

```typescript
import { LRUCache } from 'lru-cache';

const tenantCache = new LRUCache<string, Tenant>({
  max: 1000,
  ttl: 1000 * 60 * 60, // 1 hour
});
```

### RLS Performance
- RLS policies use indexes
- `app.current_tenant_id` is set once per request
- No performance impact on queries

---

## Security Checklist

- [ ] All requests have tenant context
- [ ] RLS policies are active
- [ ] Cross-tenant access is blocked
- [ ] Audit logs are immutable
- [ ] Quota limits are enforced
- [ ] JWT tokens are validated
- [ ] SQL injection is prevented

---

## Rollback Plan

If issues arise:

1. **Disable multi-tenant**: Set `ENABLE_MULTI_TENANT=false`
2. **Revert to JSONL**: Remove PostgreSQL session reads
3. **Clear RLS context**: Remove `setTenantContext` calls
4. **Restore original agent resolution**: Use config-based lookup

---

## Next Steps

1. **Review this guide** with the team
2. **Create feature branch**: `feature/multi-tenant-gateway`
3. **Implement Phase 1** (dual-write)
4. **Test thoroughly** with integration tests
5. **Deploy to staging** with feature flag
6. **Monitor metrics** (latency, errors, quota usage)
7. **Roll out to production** gradually

---

## Estimated Effort

- **Phase 1 (Dual-Write)**: 4-6 hours
- **Phase 2 (Dual-Read)**: 2-3 hours
- **Phase 3 (PostgreSQL Only)**: 1-2 hours
- **Testing**: 3-4 hours
- **Total**: 10-15 hours

---

## Support

For questions or issues:
- Review design docs in `docs/architecture/`
- Check service implementations in `src/services/`
- Refer to test suites in `src/services/__tests__/` and `tests/security/`

---

*This integration guide completes Task T032 by providing a comprehensive roadmap for adding tenant context to Gateway routing.*
