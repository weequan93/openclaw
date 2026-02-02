# Enterprise Implementation Roadmap

> **Comprehensive plan to transform OpenClaw into an enterprise-ready multi-tenant SaaS platform with complete UI suite, security hardening, and self-hosted deployment options**
> 
> **Related Documents**: See [IMPROVEMENTS.md](./IMPROVEMENTS.md) for general architecture enhancements and developer tooling improvements.

---

## Executive Summary

### What's Designed

This roadmap provides **production-ready designs** for:

**🏢 Multi-Tenant SaaS Platform**
- 4-layer Row-Level Security (RLS) for tenant isolation
- RBAC with 5 roles (Owner, Admin, Developer, Operator, Viewer)
- Comprehensive audit logging (WHO did WHAT WHEN)
- SSO/SAML integration
- Per-tenant billing and usage tracking

**🖥️ Complete UI Suite** (4 interfaces)
1. **End User Web Interface** (15 weeks) - Web chat, agent directory, conversation history, mobile PWA
2. **Multi-Tenant Admin Portal** (12 weeks) - User/agent/binding management, usage/billing, settings
3. **Developer Console** (11 weeks) - Agent debugger, API playground, log viewer, skill tester, performance profiler
4. **Observability Dashboard** (11 weeks) - System health, distributed tracing, alerts, custom dashboards

**🔒 Self-Hosted Deployments**
- Self-Service Portal for instance management
- Privacy-safe telemetry (no PII/messages)
- License management with seat limits and feature flags
- Remote support access (time-limited, audited)
- 4 managed service tiers (Customer-Managed to Fully Managed)

**📊 Enterprise Features**
- Zero Trust architecture
- API rate limiting and abuse prevention
- Data residency controls
- Webhook integrations
- Custom branding

### Implementation Timeline

**Total Effort**: ~59 weeks (~14 months) with 8 engineers
- 4 frontend engineers
- 3 backend engineers
- 1 DevOps/SRE engineer

**Phased Rollout**:
- **Phase 1** (4 months): Core multi-tenant platform + Admin Portal
- **Phase 2** (3 months): End User Web Interface + Developer Console
- **Phase 3** (3 months): Observability Dashboard + Self-Hosted Portal
- **Phase 4** (2 months): Security hardening (SOC 2 prep)
- **Phase 5** (2 months): Beta testing + production launch

### Security & Compliance

**Achievable with this roadmap**:
- ✅ SOC 2 Type II (with Phase 4 + 6-month audit)
- ✅ GDPR compliance
- ✅ ISO 27001 (with additional process work)
- ✅ 99.9% uptime SLA
- ✅ Penetration testing ready

**Still requires additional work**:
- ⚠️ HIPAA (needs BAA, additional encryption)
- ⚠️ FedRAMP (government-specific requirements)

### What This Enables

**For Enterprises**:
- Deploy in their own VPC (compliance/data sovereignty)
- Centralized management of 100+ agents across teams
- Complete audit trail for security/compliance
- SSO integration with existing identity providers
- Multi-region deployments

**For SaaS Customers**:
- Zero infrastructure management
- Pay-as-you-grow pricing
- Web chat + messaging apps
- Real-time monitoring and alerts
- 24/7 vendor support

**For OpenClaw**:
- Unlock enterprise market potential
- Establish vendor moat (complex to replicate)
- Create ecosystem (skill marketplace, integrations)

---

## Enterprise Architecture Overview

### High-Level Multi-Tenant Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Web UI<br/>acme.openclaw.ai]
        MOBILE[Mobile Apps<br/>iOS/Android]
        API[API Clients<br/>SDKs/CLI]
        CHANNELS[Message Channels<br/>Telegram/Discord/Slack]
    end
    
    subgraph "Edge Layer"
        CF[Cloudflare<br/>DDoS/WAF/CDN]
        LB[Load Balancer<br/>HAProxy/Nginx<br/>SSL Termination]
    end
    
    subgraph "Application Layer - Gateway Cluster"
        GW1[Gateway Instance 1<br/>:18789]
        GW2[Gateway Instance 2<br/>:18789]
        GW3[Gateway Instance 3<br/>:18789]
    end
    
    subgraph "Authentication & Authorization"
        AUTH[Auth Service<br/>JWT/SSO/SAML]
        RBAC[RBAC Engine<br/>Tenant-Scoped Permissions]
    end
    
    subgraph "Data Layer - Multi-Tenant Isolated"
        PG[(PostgreSQL Primary<br/>with RLS)]
        PG_R[(PostgreSQL Replica<br/>Read-Only)]
        REDIS[(Redis Cluster<br/>Session Affinity)]
    end
    
    subgraph "Observability Stack"
        OTEL[OpenTelemetry<br/>Collector]
        JAEGER[Jaeger<br/>Distributed Tracing]
        ELK[Elasticsearch<br/>Centralized Logs]
        PROM[Prometheus<br/>Metrics]
        GRAF[Grafana<br/>Dashboards]
    end
    
    subgraph "Storage & Backup"
        S3[S3/Object Storage<br/>Backups & Archives]
    end
    
    subgraph "Tenant Isolation - Logical Partitions"
        T1[Tenant: Acme Corp<br/>- 100 users<br/>- 5 agents<br/>- 1000 sessions]
        T2[Tenant: TechStartup<br/>- 20 users<br/>- 2 agents<br/>- 200 sessions]
        T3[Tenant: Enterprise Co<br/>- 500 users<br/>- 20 agents<br/>- 10000 sessions]
    end
    
    WEB --> CF
    MOBILE --> CF
    API --> CF
    CHANNELS --> CF
    
    CF --> LB
    
    LB --> GW1
    LB --> GW2
    LB --> GW3
    
    GW1 --> AUTH
    GW2 --> AUTH
    GW3 --> AUTH
    
    AUTH --> RBAC
    
    GW1 --> REDIS
    GW2 --> REDIS
    GW3 --> REDIS
    
    GW1 --> PG
    GW2 --> PG
    GW3 --> PG
    
    PG --> PG_R
    PG --> S3
    
    GW1 --> OTEL
    GW2 --> OTEL
    GW3 --> OTEL
    
    OTEL --> JAEGER
    OTEL --> ELK
    OTEL --> PROM
    
    PROM --> GRAF
    ELK --> GRAF
    JAEGER --> GRAF
    
    PG -.tenant_id.-> T1
    PG -.tenant_id.-> T2
    PG -.tenant_id.-> T3
    
    style T1 fill:#e1f5ff
    style T2 fill:#fff4e1
    style T3 fill:#e8f5e9
    style CF fill:#ff9800
    style PG fill:#4caf50
    style REDIS fill:#f44336
    style AUTH fill:#9c27b0
    style RBAC fill:#9c27b0
```

---

### Tenant Isolation Explained

**How Logical Partitioning Works**:

OpenClaw uses **logical partitioning** (not physical database separation) with PostgreSQL **Row-Level Security (RLS)** to ensure complete tenant isolation. All tenants share the same database cluster but are **completely isolated at the data level**.

#### What's Inside Each Tenant Partition?

Each tenant is a **completely isolated workspace** containing:

```
Tenant: Acme Corp (tenant_id: uuid-acme-123)
├── Users (100 employees)
│   ├── admin@acme.com (tenant_owner)
│   ├── dev@acme.com (agent_developer)
│   ├── ops@acme.com (agent_operator)
│   └── ... (97 more users)
│
├── Agents (5 AI assistants)
│   ├── Agent: "Customer Support" (slug: support)
│   │   ├── Model: claude-3-5-sonnet
│   │   ├── Workspace: /acme/customer-support
│   │   └── Config: { temperature: 0.7, max_tokens: 4096 }
│   ├── Agent: "Developer Assistant" (slug: dev)
│   ├── Agent: "QA Bot" (slug: qa)
│   ├── Agent: "Sales Assistant" (slug: sales)
│   └── Agent: "HR Helper" (slug: hr)
│
├── Sessions (1,000 conversation histories)
│   ├── Session: telegram:user123 → support agent
│   │   ├── 45 message turns
│   │   └── Last active: 2026-02-01 10:30:00
│   ├── Session: discord:guild456:user789 → dev agent
│   ├── Session: slack:team101:channel202 → qa agent
│   └── ... (997 more sessions)
│
├── Agent Bindings (routing configuration)
│   ├── Binding: telegram:@acme_support_bot → support agent
│   ├── Binding: discord:guild456 → dev agent
│   ├── Binding: slack:team101 → sales agent
│   └── ... (more channel bindings)
│
├── Audit Log (all activity within tenant)
│   ├── 2026-02-01 10:25:15 | admin@acme.com | AGENT_CREATED | support
│   ├── 2026-02-01 10:30:42 | dev@acme.com | SKILL_INSTALLED | 1password
│   └── ... (thousands of audit entries)
│
├── Usage Records (billing data)
│   ├── 2026-02-01 | tokens: 1,234,567
│   ├── 2026-02-01 | messages: 5,432
│   └── ... (daily usage tracking)
│
└── Settings & Quotas
    ├── Plan: Enterprise
    ├── Max Agents: 100
    ├── Max Users: 1,000
    ├── Max Tokens/Month: 10,000,000
    └── Features: { sso: true, customBranding: true, auditLogs: true }
```

#### How Isolation is Enforced (Multi-Layer Defense)

**Layer 1: Application-Level Filtering**
```typescript
// Every query includes tenant_id explicitly
const agents = await db.query(
  'SELECT * FROM agents WHERE tenant_id = $1',
  [req.tenantId]  // From authenticated JWT
);
```

**Layer 2: PostgreSQL Row-Level Security (RLS)**
```sql
-- Even if application code has a bug, database enforces isolation
CREATE POLICY tenant_isolation_agents ON agents
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Set tenant context at connection start
SET app.current_tenant_id = 'uuid-acme-123';

-- All queries automatically filtered by RLS
SELECT * FROM agents;  -- PostgreSQL rewrites to:
                       -- SELECT * FROM agents WHERE tenant_id = 'uuid-acme-123'
```

**Layer 3: Session Variable Lock**
```typescript
// Middleware sets tenant context and locks it
app.use(async (req, res, next) => {
  const tenantId = rbac.getCurrentTenant(req);
  
  // Set PostgreSQL session variable (enforces RLS)
  await pool.query('SET app.current_tenant_id = $1', [tenantId]);
  
  // Lock tenant context (cannot be changed mid-request)
  Object.defineProperty(req, 'tenantId', {
    value: tenantId,
    writable: false,  // Immutable
    configurable: false
  });
  
  next();
});
```

**Layer 4: Foreign Key Cascade**
```sql
-- All tenant data deleted if tenant deleted
CREATE TABLE agents (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  -- ...
);

-- Deleting tenant automatically deletes all:
-- - Agents, Sessions, Bindings, Audit logs, Usage records
DELETE FROM tenants WHERE id = 'uuid-acme-123';
```

#### Data Isolation Examples

**Scenario 1: User from Tenant A tries to access Tenant B's agent**

```typescript
// Request from user@acme.com (Tenant A)
// Trying to access agent from TechStartup (Tenant B)

const req = {
  user: { id: 'user-acme-456', tenantId: 'uuid-acme-123' },
  params: { agentId: 'agent-techstartup-789' }  // Belongs to Tenant B!
};

// Step 1: Middleware sets RLS context
await pool.query('SET app.current_tenant_id = $1', ['uuid-acme-123']);

// Step 2: Application query
const agent = await db.query(
  'SELECT * FROM agents WHERE id = $1',
  ['agent-techstartup-789']
);

// Step 3: PostgreSQL RLS rewrites query to:
// SELECT * FROM agents 
// WHERE id = 'agent-techstartup-789' 
//   AND tenant_id = 'uuid-acme-123'  <-- Automatic filter!

// Result: Empty (agent not found), even though it exists in database
// Tenant B's data is invisible to Tenant A
```

**Scenario 2: Cross-tenant session access attempt**

```typescript
// Acme Corp user tries to view TechStartup session
GET /api/sessions/session-techstartup-999

// RLS filter applied automatically:
SELECT * FROM sessions 
WHERE id = 'session-techstartup-999' 
  AND tenant_id = 'uuid-acme-123';  -- Acme's tenant ID

// Returns: 404 Not Found (session exists but belongs to different tenant)
// Security event logged in audit log
```

**Scenario 3: Database admin tries to bypass RLS (malicious DBA)**

```sql
-- Even with superuser privileges, RLS policies are enforced
-- unless explicitly bypassed with SECURITY DEFINER functions

-- Regular query (RLS enforced)
SELECT * FROM agents;
-- Returns: Only agents from current tenant (via app.current_tenant_id)

-- Attempting to bypass (requires explicit BYPASSRLS permission)
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
-- Fails: Only superuser can disable RLS

-- Attempting direct access without tenant context
SELECT * FROM agents WHERE tenant_id = 'uuid-techstartup-456';
-- Fails: RLS policy blocks access if app.current_tenant_id != tenant_id
```

#### Physical vs Logical Isolation

| Aspect | Physical Isolation | Logical Isolation (OpenClaw) |
|--------|-------------------|------------------------------|
| **Infrastructure** | Separate database per tenant | Shared PostgreSQL cluster |
| **Cost** | High (N × DB instances) | Low (1 × DB cluster) |
| **Scalability** | Limited (100s of tenants) | High (10,000s of tenants) |
| **Backup/DR** | Complex (N × backups) | Simple (1 × backup) |
| **Performance** | Isolated (guaranteed) | Shared (requires monitoring) |
| **Security** | Very strong (network isolation) | Strong (RLS + app-level) |
| **Compliance** | Easier to explain | Requires RLS audit proof |
| **Best For** | Highly regulated industries (healthcare, finance) | SaaS products, B2B platforms |

**Why OpenClaw uses Logical Isolation:**
- **Cost-effective**: Single database cluster serves all tenants
- **Operationally simple**: One schema, one migration path
- **Proven security**: PostgreSQL RLS is battle-tested (used by Supabase, Crunchy Data)
- **Performance**: Modern PostgreSQL handles 10,000+ tenants easily
- **Compliance-ready**: RLS provides audit-provable isolation

**When to use Physical Isolation:**
- Customer explicitly requires dedicated infrastructure (contractual)
- Regulated industry (HIPAA, PCI-DSS Level 1) with dedicated DB requirement
- Tenant has >1M users and needs guaranteed performance SLA

---

### Enhanced Runtime Isolation (Container/VM-Based)

Beyond database-level isolation (RLS), enterprises may require **compute-level isolation** where each tenant gets their own isolated runtime environment for executing agents, skills, and MCP clients.

#### Isolation Levels Comparison

| Level | What's Shared | What's Isolated | Use Case | Cost Multiplier |
|-------|--------------|----------------|----------|-----------------|
| **Level 1: Logical (RLS only)** | Database, Gateway, Agents | Data only (via RLS) | Standard SaaS, <1000 tenants | 1x (baseline) |
| **Level 2: Process Isolation** | Database, Gateway | Agent processes, skill execution | Untrusted code, custom skills | 1.5x |
| **Level 3: Container Isolation** | Database only | Gateway, Agents, Skills (in containers) | Compliance, resource limits | 3x |
| **Level 4: VM Isolation** | Nothing (except platform control) | Everything (VMs per tenant) | Regulated industries, air-gapped | 10x |

#### Level 2: Process Isolation (Recommended for Most Enterprises)

**Architecture**: Shared gateway + database, isolated agent worker processes per tenant

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Components                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ Gateway 1  │  │ Gateway 2  │  │ Gateway 3  │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│  ┌────────────────────────────────────────────┐             │
│  │   PostgreSQL (with RLS)                    │             │
│  └────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
┌────────▼────────┐ ┌────▼────────┐ ┌────▼────────┐
│ Tenant: Acme    │ │ TechStartup │ │ Enterprise  │
│ Worker Pool     │ │ Worker Pool │ │ Worker Pool │
│                 │ │             │ │             │
│ ┌─────────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
│ │Agent: Support│ │ │ │Agent:Main│ │ │ │Agent:HR │ │
│ │ (Process 1)  │ │ │ │(Process)│ │ │ │(Process)│ │
│ └─────────────┘ │ │ └─────────┘ │ │ └─────────┘ │
│ ┌─────────────┐ │ │             │ │ ┌─────────┐ │
│ │Agent: DevBot │ │ │             │ │ │Agent:IT │ │
│ │ (Process 2)  │ │ │             │ │ │(Process)│ │
│ └─────────────┘ │ │             │ │ └─────────┘ │
│                 │ │             │ │             │
│ Resource Limits:│ │ Limits:     │ │ Limits:     │
│ - CPU: 4 cores  │ │ - CPU: 1c   │ │ - CPU: 16c  │
│ - RAM: 16GB     │ │ - RAM: 4GB  │ │ - RAM: 64GB │
│ - Disk: 100GB   │ │ - Disk: 20GB│ │ - Disk: 1TB │
└─────────────────┘ └─────────────┘ └─────────────┘

Each tenant's agents run in isolated processes with resource limits
```

**Implementation**:

```typescript
// src/workers/tenant-worker-pool.ts
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

interface TenantResourceLimits {
  cpuCores: number;
  memoryMB: number;
  diskMB: number;
  maxProcesses: number;
}

class TenantWorkerPool extends EventEmitter {
  private workers: Map<string, ChildProcess> = new Map();
  private limits: TenantResourceLimits;
  
  constructor(private tenantId: string, limits: TenantResourceLimits) {
    super();
    this.limits = limits;
  }
  
  /**
   * Spawn isolated agent process for this tenant
   */
  async spawnAgent(agentId: string, config: AgentConfig): Promise<void> {
    if (this.workers.size >= this.limits.maxProcesses) {
      throw new Error(`Tenant ${this.tenantId} exceeded process limit`);
    }
    
    // Use Linux cgroups for resource isolation
    const worker = spawn('node', [
      '--max-old-space-size=' + this.limits.memoryMB,
      './dist/agent-worker.js'
    ], {
      env: {
        ...process.env,
        TENANT_ID: this.tenantId,
        AGENT_ID: agentId,
        AGENT_CONFIG: JSON.stringify(config),
        
        // Isolation environment variables
        ISOLATED: 'true',
        CGROUP_NAME: `openclaw-${this.tenantId}`,
        
        // Prevent access to other tenants' data
        TENANT_WORKSPACE: `/var/openclaw/tenants/${this.tenantId}/workspaces`,
        TENANT_TMP: `/var/openclaw/tenants/${this.tenantId}/tmp`
      },
      cwd: `/var/openclaw/tenants/${this.tenantId}`,
      
      // Limit file descriptors
      stdio: ['ignore', 'pipe', 'pipe'],
      
      // Run as dedicated user (not root)
      uid: 1000 + this.getTenantNumericId(),
      gid: 1000 + this.getTenantNumericId()
    });
    
    // Apply CPU/memory limits via cgroups
    await this.applyCGroupLimits(worker.pid!, {
      cpuQuota: this.limits.cpuCores * 100000, // CPU quota in microseconds
      memoryLimit: this.limits.memoryMB * 1024 * 1024, // Bytes
      ioWeight: 500 // I/O priority
    });
    
    this.workers.set(agentId, worker);
    
    // Monitor resource usage
    this.monitorWorker(agentId, worker);
    
    // Cleanup on exit
    worker.on('exit', (code) => {
      this.workers.delete(agentId);
      this.emit('agent-exited', { agentId, code });
    });
  }
  
  /**
   * Apply Linux cgroup limits to process
   */
  private async applyCGroupLimits(pid: number, limits: {
    cpuQuota: number;
    memoryLimit: number;
    ioWeight: number;
  }) {
    const cgroupPath = `/sys/fs/cgroup/openclaw-${this.tenantId}`;
    
    // Create cgroup if not exists
    await fs.mkdir(cgroupPath, { recursive: true });
    
    // Set CPU limit (e.g., 4 cores = 400000 microseconds per 100ms period)
    await fs.writeFile(`${cgroupPath}/cpu.max`, `${limits.cpuQuota} 100000`);
    
    // Set memory limit
    await fs.writeFile(`${cgroupPath}/memory.max`, `${limits.memoryLimit}`);
    
    // Set I/O weight (100-1000, default 100)
    await fs.writeFile(`${cgroupPath}/io.weight`, `${limits.ioWeight}`);
    
    // Add process to cgroup
    await fs.writeFile(`${cgroupPath}/cgroup.procs`, `${pid}`);
  }
  
  /**
   * Monitor worker resource usage
   */
  private monitorWorker(agentId: string, worker: ChildProcess) {
    setInterval(async () => {
      const usage = await this.getProcessResourceUsage(worker.pid!);
      
      // Check if tenant exceeded limits
      if (usage.memoryMB > this.limits.memoryMB * 0.9) {
        logger.warn({
          msg: 'Tenant approaching memory limit',
          tenantId: this.tenantId,
          agentId,
          usage: usage.memoryMB,
          limit: this.limits.memoryMB
        });
        
        // Alert tenant admin
        await this.notifyTenantAdmin({
          event: 'RESOURCE_LIMIT_WARNING',
          resource: 'memory',
          usage: usage.memoryMB,
          limit: this.limits.memoryMB
        });
      }
      
      // Log usage to database for billing
      await this.recordResourceUsage({
        tenantId: this.tenantId,
        agentId,
        timestamp: new Date(),
        cpuSeconds: usage.cpuSeconds,
        memoryMB: usage.memoryMB,
        diskMB: usage.diskMB
      });
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Execute skill in isolated environment
   */
  async executeSkill(agentId: string, skillName: string, params: any): Promise<any> {
    const worker = this.workers.get(agentId);
    if (!worker) {
      throw new Error(`Agent ${agentId} not running`);
    }
    
    // Send skill execution request to worker process
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      
      worker.send({
        type: 'EXECUTE_SKILL',
        requestId,
        skillName,
        params
      });
      
      const timeout = setTimeout(() => {
        reject(new Error('Skill execution timeout'));
      }, 30000);
      
      worker.once('message', (msg) => {
        if (msg.requestId === requestId) {
          clearTimeout(timeout);
          
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve(msg.result);
          }
        }
      });
    });
  }
}

// Tenant worker pool manager (one pool per tenant)
class TenantWorkerManager {
  private pools: Map<string, TenantWorkerPool> = new Map();
  
  async getOrCreatePool(tenantId: string): Promise<TenantWorkerPool> {
    if (!this.pools.has(tenantId)) {
      const tenant = await db.query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
      const limits = this.getTenantLimits(tenant.rows[0].plan);
      
      const pool = new TenantWorkerPool(tenantId, limits);
      this.pools.set(tenantId, pool);
      
      // Cleanup on idle
      pool.on('idle', () => {
        setTimeout(() => {
          if (pool.getWorkerCount() === 0) {
            this.pools.delete(tenantId);
          }
        }, 300000); // 5 minutes
      });
    }
    
    return this.pools.get(tenantId)!;
  }
  
  private getTenantLimits(plan: string): TenantResourceLimits {
    switch (plan) {
      case 'free':
        return { cpuCores: 0.5, memoryMB: 512, diskMB: 1024, maxProcesses: 1 };
      case 'pro':
        return { cpuCores: 2, memoryMB: 4096, diskMB: 10240, maxProcesses: 5 };
      case 'enterprise':
        return { cpuCores: 16, memoryMB: 65536, diskMB: 102400, maxProcesses: 50 };
      default:
        return { cpuCores: 1, memoryMB: 2048, diskMB: 5120, maxProcesses: 2 };
    }
  }
}

export const tenantWorkers = new TenantWorkerManager();
```

#### Level 3: Container Isolation (Docker/Kubernetes)

**Architecture**: Each tenant gets dedicated containers for gateway + agents

```yaml
# kubernetes/tenant-deployment.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: tenant-acme-123
  labels:
    tenant-id: acme-123
    isolation: container

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: acme-gateway
  namespace: tenant-acme-123
spec:
  replicas: 2
  selector:
    matchLabels:
      app: openclaw-gateway
      tenant: acme-123
  template:
    metadata:
      labels:
        app: openclaw-gateway
        tenant: acme-123
    spec:
      # Security context (non-root, read-only filesystem)
      securityContext:
        runAsNonRoot: true
        runAsUser: 10000
        fsGroup: 10000
        seccompProfile:
          type: RuntimeDefault
      
      containers:
      - name: gateway
        image: openclaw/gateway:v2024.1.1
        
        # Resource limits (guaranteed CPU/memory)
        resources:
          requests:
            cpu: "2"
            memory: "8Gi"
          limits:
            cpu: "4"
            memory: "16Gi"
        
        # Environment variables (tenant-specific)
        env:
        - name: TENANT_ID
          value: "acme-123"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: acme-db-credentials
              key: url
        - name: REDIS_URL
          value: "redis://redis.tenant-acme-123.svc.cluster.local:6379"
        
        # Read-only root filesystem (security)
        volumeMounts:
        - name: workspace
          mountPath: /workspace
        - name: tmp
          mountPath: /tmp
        
        # Health checks
        livenessProbe:
          httpGet:
            path: /health
            port: 18789
          initialDelaySeconds: 30
          periodSeconds: 10
        
        readinessProbe:
          httpGet:
            path: /ready
            port: 18789
          initialDelaySeconds: 10
          periodSeconds: 5
      
      volumes:
      - name: workspace
        persistentVolumeClaim:
          claimName: acme-workspace-pvc
      - name: tmp
        emptyDir: {}

---
# Network policy: Deny all by default, explicit allows only
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tenant-isolation
  namespace: tenant-acme-123
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
  
  ingress:
  # Allow from ingress controller only
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 18789
  
  egress:
  # Allow to PostgreSQL only
  - to:
    - namespaceSelector:
        matchLabels:
          name: database
    ports:
    - protocol: TCP
      port: 5432
  
  # Allow to Redis only
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
  
  # Allow to external APIs (LLM providers)
  - to:
    - podSelector: {}
    ports:
    - protocol: TCP
      port: 443

---
# Resource quota (hard limits per tenant namespace)
apiVersion: v1
kind: ResourceQuota
metadata:
  name: tenant-quota
  namespace: tenant-acme-123
spec:
  hard:
    requests.cpu: "16"
    requests.memory: "64Gi"
    limits.cpu: "32"
    limits.memory: "128Gi"
    persistentvolumeclaims: "5"
    pods: "50"
```

**Provisioning New Tenant**:

```typescript
// src/provisioning/container-tenant.ts
import { KubeConfig, CoreV1Api, AppsV1Api } from '@kubernetes/client-node';

class ContainerTenantProvisioner {
  private k8s: {
    core: CoreV1Api;
    apps: AppsV1Api;
  };
  
  constructor() {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    
    this.k8s = {
      core: kubeConfig.makeApiClient(CoreV1Api),
      apps: kubeConfig.makeApiClient(AppsV1Api)
    };
  }
  
  /**
   * Provision isolated Kubernetes namespace + resources for new tenant
   */
  async provisionTenant(tenantId: string, plan: string): Promise<void> {
    const namespace = `tenant-${tenantId}`;
    
    // 1. Create namespace
    await this.k8s.core.createNamespace({
      metadata: {
        name: namespace,
        labels: {
          'tenant-id': tenantId,
          'isolation': 'container',
          'plan': plan
        }
      }
    });
    
    // 2. Create resource quota
    await this.k8s.core.createNamespacedResourceQuota(namespace, {
      metadata: { name: 'tenant-quota' },
      spec: {
        hard: this.getQuotaForPlan(plan)
      }
    });
    
    // 3. Create network policy (default deny)
    await this.createNetworkPolicy(namespace);
    
    // 4. Create PVC for workspace
    await this.k8s.core.createNamespacedPersistentVolumeClaim(namespace, {
      metadata: { name: `${tenantId}-workspace-pvc` },
      spec: {
        accessModes: ['ReadWriteMany'],
        resources: {
          requests: { storage: plan === 'enterprise' ? '1Ti' : '100Gi' }
        },
        storageClassName: 'fast-ssd'
      }
    });
    
    // 5. Deploy gateway
    await this.deployGateway(namespace, tenantId, plan);
    
    // 6. Create service + ingress
    await this.createService(namespace, tenantId);
    
    logger.info({
      msg: 'Tenant provisioned with container isolation',
      tenantId,
      namespace,
      plan
    });
  }
  
  private getQuotaForPlan(plan: string): Record<string, string> {
    switch (plan) {
      case 'free':
        return {
          'requests.cpu': '1',
          'requests.memory': '2Gi',
          'limits.cpu': '2',
          'limits.memory': '4Gi',
          'pods': '5'
        };
      case 'pro':
        return {
          'requests.cpu': '8',
          'requests.memory': '32Gi',
          'limits.cpu': '16',
          'limits.memory': '64Gi',
          'pods': '25'
        };
      case 'enterprise':
        return {
          'requests.cpu': '32',
          'requests.memory': '128Gi',
          'limits.cpu': '64',
          'limits.memory': '256Gi',
          'pods': '100'
        };
      default:
        return {
          'requests.cpu': '2',
          'requests.memory': '8Gi',
          'limits.cpu': '4',
          'limits.memory': '16Gi',
          'pods': '10'
        };
    }
  }
}
```

#### Level 4: VM Isolation (Firecracker / AWS Lambda)

**Architecture**: Each tenant gets dedicated microVMs

```typescript
// src/provisioning/vm-tenant.ts
import { Firecracker } from 'firecracker-nodejs';

class VMTenantProvisioner {
  /**
   * Provision isolated Firecracker microVM for tenant
   */
  async provisionTenant(tenantId: string, plan: string): Promise<void> {
    const vm = new Firecracker({
      socketPath: `/var/openclaw/vms/${tenantId}.sock`,
      
      // Kernel + root filesystem
      kernelImagePath: '/var/openclaw/images/vmlinux',
      rootDrivePath: `/var/openclaw/tenants/${tenantId}/rootfs.ext4`,
      
      // Resource limits
      vcpuCount: this.getVCPUCount(plan),
      memSizeMib: this.getMemoryMB(plan),
      
      // Network isolation
      networkInterfaces: [{
        ifaceId: 'eth0',
        guestMac: this.generateMacAddress(tenantId),
        hostDevName: `vmtap-${tenantId}`
      }],
      
      // Boot args
      bootArgs: `console=ttyS0 reboot=k panic=1 pci=off tenant_id=${tenantId}`
    });
    
    await vm.start();
    
    // Install OpenClaw inside VM
    await this.installOpenClawInVM(vm, tenantId);
    
    logger.info({
      msg: 'Tenant provisioned with VM isolation',
      tenantId,
      vmId: vm.id,
      plan
    });
  }
  
  private getVCPUCount(plan: string): number {
    switch (plan) {
      case 'free': return 1;
      case 'pro': return 4;
      case 'enterprise': return 16;
      default: return 2;
    }
  }
  
  private getMemoryMB(plan: string): number {
    switch (plan) {
      case 'free': return 1024;
      case 'pro': return 8192;
      case 'enterprise': return 65536;
      default: return 4096;
    }
  }
}
```

#### When to Use Each Isolation Level

| Requirement | Recommended Level |
|------------|------------------|
| **Standard SaaS (trusted users)** | Level 1 (RLS only) |
| **Custom skills / untrusted code** | Level 2 (Process isolation) |
| **Compliance (SOC 2, ISO 27001)** | Level 2 or 3 |
| **Healthcare (HIPAA)** | Level 3 (Containers) |
| **Financial (PCI-DSS Level 1)** | Level 3 or 4 |
| **Government / Air-gapped** | Level 4 (VMs) |
| **Performance SLA guarantees** | Level 3 or 4 |
| **Multi-region with data residency** | Level 3 or 4 |

**Cost Impact**:
- Level 1 (RLS): $10/tenant/month
- Level 2 (Process): $15/tenant/month
- Level 3 (Container): $50/tenant/month
- Level 4 (VM): $200/tenant/month

---

## Self-Hosted Enterprise Deployment

**YES** - OpenClaw fully supports self-hosted/on-premises deployments for enterprises with data residency requirements, compliance mandates, or air-gapped environments.

### Why Self-Host?

| Requirement | Self-Hosted Benefit |
|------------|---------------------|
| **Data Sovereignty** | All data stays within company/country boundaries |
| **Compliance** | Meet HIPAA, GDPR, FedRAMP, SOC 2 Type II requirements |
| **Air-Gapped Networks** | Deploy in isolated networks (government, defense, critical infrastructure) |
| **Custom Security** | Integrate with existing security infrastructure (LDAP, SAML, HSM) |
| **Performance** | Dedicated resources, no noisy neighbors |
| **Cost Control** | Predictable infrastructure costs vs per-user SaaS pricing |
| **Customization** | Modify source code, add proprietary integrations |

### Deployment Architectures

#### Architecture 1: Single-Server Deployment (Small Teams, 1-50 users)

```
┌─────────────────────────────────────────────────────────────┐
│           Single Server (Physical or VM)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │  Docker Compose Stack                             │       │
│  │                                                   │       │
│  │  ┌───────────────┐  ┌───────────────┐           │       │
│  │  │   Nginx       │  │  PostgreSQL   │           │       │
│  │  │ (Reverse Proxy│  │   (Database)  │           │       │
│  │  │  + SSL Term.) │  │               │           │       │
│  │  └───────┬───────┘  └───────────────┘           │       │
│  │          │                                        │       │
│  │  ┌───────▼───────────────────────────┐           │       │
│  │  │   OpenClaw Gateway                │           │       │
│  │  │   (All-in-one: API + Workers)     │           │       │
│  │  └───────────────────────────────────┘           │       │
│  │                                                   │       │
│  │  ┌───────────────┐  ┌───────────────┐           │       │
│  │  │     Redis     │  │    Volumes    │           │       │
│  │  │   (Session)   │  │ /data/postgres│           │       │
│  │  └───────────────┘  │ /data/workspaces          │       │
│  │                     └───────────────┘           │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
│  System Requirements:                                        │
│  - CPU: 8 cores (16 threads)                                │
│  - RAM: 32GB                                                 │
│  - Disk: 500GB SSD                                           │
│  - OS: Ubuntu 22.04 LTS, RHEL 8+, or Debian 11+             │
└─────────────────────────────────────────────────────────────┘
```

**Installation**:

```bash
# 1. Download OpenClaw self-hosted package
curl -fsSL https://openclaw.ai/install-enterprise.sh | bash

# 2. Configure environment
cd /opt/openclaw
cp .env.example .env

# Edit .env:
# - Set DATABASE_URL, REDIS_URL
# - Configure SSL certificates
# - Set admin credentials
# - Configure SMTP for email
vim .env

# 3. Start services
docker-compose up -d

# 4. Initialize database
docker-compose exec gateway openclaw db:migrate
docker-compose exec gateway openclaw admin:create

# 5. Access at https://localhost
# Default admin: admin@company.com / (set during setup)
```

**docker-compose.yml**:

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
      - /var/log/nginx:/var/log/nginx
    depends_on:
      - gateway
    restart: unless-stopped

  gateway:
    image: openclaw/gateway:2024.1.1
    environment:
      DATABASE_URL: postgresql://openclaw:${DB_PASSWORD}@postgres:5432/openclaw
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
      PORT: 18789
      
      # License key (provided by OpenClaw)
      OPENCLAW_LICENSE_KEY: ${LICENSE_KEY}
      
      # Admin setup
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      
      # SMTP for notifications
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASSWORD: ${SMTP_PASSWORD}
      
      # SSO (optional)
      SAML_ENABLED: ${SAML_ENABLED:-false}
      SAML_ENTRY_POINT: ${SAML_ENTRY_POINT}
      SAML_CERT: ${SAML_CERT}
    volumes:
      - workspaces:/var/openclaw/workspaces
      - logs:/var/openclaw/logs
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:18789/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: openclaw
      POSTGRES_USER: openclaw
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openclaw"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
  redis-data:
  workspaces:
  logs:
```

---

#### Architecture 2: High-Availability Deployment (Medium-Large, 50-1000 users)

```
┌─────────────────────────────────────────────────────────────┐
│                   Load Balancer Layer                        │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │   HAProxy 1  │  │   HAProxy 2  │  (Keepalived VIP)       │
│  │  (Primary)   │  │  (Standby)   │                         │
│  └──────┬───────┘  └──────┬───────┘                         │
└─────────┼──────────────────┼──────────────────────────────────┘
          │                  │
          └────────┬─────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
┌───▼────┐    ┌───▼────┐    ┌───▼────┐
│Gateway │    │Gateway │    │Gateway │  (Kubernetes pods or VMs)
│ Node 1 │    │ Node 2 │    │ Node 3 │
└───┬────┘    └───┬────┘    └───┬────┘
    │              │              │
    └──────────────┼──────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
┌───▼────────┐ ┌──▼──────────┐ ┌─▼──────────┐
│PostgreSQL  │ │   Redis     │ │   NFS/S3   │
│ Primary    │ │  Cluster    │ │ (Workspaces│
│            │ │  (3 nodes)  │ │  & Logs)   │
│ ┌────────┐ │ └─────────────┘ └────────────┘
│ │Replica │ │
│ └────────┘ │
└────────────┘
```

**Kubernetes Deployment**:

```yaml
# kubernetes/production/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: openclaw-production

---
# kubernetes/production/gateway-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-gateway
  namespace: openclaw-production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: openclaw-gateway
  template:
    metadata:
      labels:
        app: openclaw-gateway
    spec:
      containers:
      - name: gateway
        image: openclaw/gateway:2024.1.1
        ports:
        - containerPort: 18789
        
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: openclaw-secrets
              key: database-url
        - name: REDIS_URL
          value: "redis://redis-cluster:6379"
        - name: NODE_ENV
          value: "production"
        - name: OPENCLAW_LICENSE_KEY
          valueFrom:
            secretKeyRef:
              name: openclaw-secrets
              key: license-key
        
        resources:
          requests:
            cpu: "2"
            memory: "8Gi"
          limits:
            cpu: "4"
            memory: "16Gi"
        
        volumeMounts:
        - name: workspaces
          mountPath: /var/openclaw/workspaces
        
        livenessProbe:
          httpGet:
            path: /health
            port: 18789
          initialDelaySeconds: 30
          periodSeconds: 10
        
        readinessProbe:
          httpGet:
            path: /ready
            port: 18789
          initialDelaySeconds: 10
          periodSeconds: 5
      
      volumes:
      - name: workspaces
        persistentVolumeClaim:
          claimName: openclaw-workspaces-pvc

---
# kubernetes/production/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: openclaw-gateway
  namespace: openclaw-production
spec:
  selector:
    app: openclaw-gateway
  ports:
  - port: 80
    targetPort: 18789
  type: ClusterIP

---
# kubernetes/production/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: openclaw-ingress
  namespace: openclaw-production
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - openclaw.company.com
    secretName: openclaw-tls
  rules:
  - host: openclaw.company.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: openclaw-gateway
            port:
              number: 80
```

---

#### Architecture 3: Air-Gapped Deployment (Government, Defense, Critical Infrastructure)

**No internet connectivity - fully isolated network**

```
┌─────────────────────────────────────────────────────────────┐
│                Air-Gapped Environment                        │
│                (No Internet Access)                          │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │  Internal Certificate Authority                │         │
│  │  (For mTLS between services)                   │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │  Local Container Registry                      │         │
│  │  (Harbor or equivalent)                        │         │
│  │  - openclaw/gateway:2024.1.1                   │         │
│  │  - postgres:15, redis:7, nginx:alpine          │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │  OpenClaw Cluster (Kubernetes or VMs)          │         │
│  │  - Gateway instances (3+)                      │         │
│  │  - PostgreSQL HA cluster                       │         │
│  │  - Redis cluster                               │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │  Local LLM Model Server (Optional)             │         │
│  │  - Ollama, vLLM, or TGI                        │         │
│  │  - Llama 3, Mistral, or approved models        │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │  Update Server (Isolated)                      │         │
│  │  - Manual image transfer via USB/DVD           │         │
│  │  - Security scanning before deployment         │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

**Air-Gapped Installation Process**:

```bash
# 1. On internet-connected machine (outside air-gap):
# Download all container images
docker pull openclaw/gateway:2024.1.1
docker pull postgres:15-alpine
docker pull redis:7-alpine
docker pull nginx:alpine

# Save images to tar files
docker save openclaw/gateway:2024.1.1 -o openclaw-gateway.tar
docker save postgres:15-alpine -o postgres.tar
docker save redis:7-alpine -o redis.tar
docker save nginx:alpine -o nginx.tar

# Download installation bundle
curl -L https://openclaw.ai/releases/openclaw-enterprise-2024.1.1-airgap.tar.gz \
  -o openclaw-airgap.tar.gz

# 2. Transfer files to air-gapped environment via approved method:
# - USB drive (scanned for malware)
# - DVD/CD
# - Secure file transfer system

# 3. Inside air-gapped environment:
# Load images into local registry
docker load -i openclaw-gateway.tar
docker load -i postgres.tar
docker load -i redis.tar
docker load -i nginx.tar

# Tag for local registry
docker tag openclaw/gateway:2024.1.1 harbor.company.local/openclaw/gateway:2024.1.1
docker push harbor.company.local/openclaw/gateway:2024.1.1

# 4. Extract installation bundle
tar -xzf openclaw-airgap.tar.gz
cd openclaw-enterprise

# 5. Configure for air-gap mode
cp config/airgap.env.example .env
vim .env

# Key air-gap settings:
# AIRGAP_MODE=true
# TELEMETRY_ENABLED=false
# AUTO_UPDATE_CHECK=false
# LICENSE_VALIDATION_MODE=offline
# LLM_PROVIDER=local  # Use local Ollama/vLLM instead of cloud APIs

# 6. Deploy
./install.sh --airgap --registry harbor.company.local

# 7. Activate offline license
./openclaw license:activate --offline --file=/path/to/license.key
```

---

### Infrastructure Requirements

#### Minimum Specifications (1-50 users)

```
Single Server:
├── CPU: 8 cores (16 threads)
├── RAM: 32GB
├── Disk: 500GB SSD
├── Network: 1 Gbps
└── OS: Ubuntu 22.04 LTS, RHEL 8+, Debian 11+, or Rocky Linux 9
```

#### Recommended HA Setup (50-500 users)

```
Gateway Nodes (3+):
├── CPU: 16 cores per node
├── RAM: 64GB per node
└── Disk: 200GB SSD per node

Database Cluster:
├── Primary: 16 cores, 128GB RAM, 2TB SSD
├── Replica: 16 cores, 128GB RAM, 2TB SSD
└── Backup: 8 cores, 64GB RAM, 4TB HDD

Redis Cluster (3 nodes):
├── CPU: 8 cores per node
├── RAM: 32GB per node
└── Disk: 100GB SSD per node

Storage:
├── Workspaces: 10TB+ (NFS or S3-compatible object storage)
├── Logs: 1TB+ (rotated/compressed)
└── Backups: 20TB+ (incremental backups with retention policy)
```

#### Enterprise Scale (1000+ users)

```
Gateway Cluster (Auto-scaling):
├── Min: 5 nodes (16 cores, 64GB each)
├── Max: 20 nodes (auto-scale based on load)
└── Load Balancer: HAProxy or AWS ALB/NLB

Database:
├── PostgreSQL HA: Primary + 2 sync replicas + 3 async replicas
├── Specs: 32 cores, 256GB RAM, 10TB NVMe SSD
└── Backup: Continuous archiving + PITR

Redis:
├── Redis Cluster: 6 nodes (3 primaries + 3 replicas)
├── Specs: 16 cores, 128GB RAM per node
└── Persistence: AOF + RDB snapshots

Kubernetes Cluster:
├── Control Plane: 3 nodes (8 cores, 32GB)
├── Worker Nodes: 10+ nodes (32 cores, 128GB)
└── Storage: Ceph or dedicated SAN (100TB+)
```

---

### License Models

| Model | Best For | Pricing | Support |
|-------|----------|---------|---------|
| **SaaS (Hosted by OpenClaw)** | Small teams, startups | $25/user/month | 24/7 email + chat |
| **Self-Hosted (Standard)** | Mid-size companies | $50K/year + $150/user/year | Business hours support |
| **Self-Hosted (Enterprise)** | Large enterprises | Custom pricing | Dedicated support engineer |
| **Air-Gapped (Government)** | Defense, intelligence | Custom pricing | On-site support available |

**License includes**:
- Unlimited agents and skills
- All features (SSO, RBAC, audit logs, etc.)
- Security updates and patches
- Version upgrades (minor + major)
- Migration assistance (SaaS → self-hosted)

---

### Update & Patch Management

#### Internet-Connected Deployments

```bash
# Automated updates (recommended for non-critical environments)
# Enable in .env:
AUTO_UPDATE=true
UPDATE_CHANNEL=stable  # or 'beta', 'lts'

# Manual updates:
docker-compose pull
docker-compose up -d

# Kubernetes:
kubectl set image deployment/openclaw-gateway \
  gateway=openclaw/gateway:2024.2.1 \
  -n openclaw-production

# Rollback if needed:
kubectl rollout undo deployment/openclaw-gateway -n openclaw-production
```

#### Air-Gapped Updates

```bash
# 1. Download update bundle on internet-connected machine
curl -L https://openclaw.ai/releases/openclaw-2024.2.1-update.tar.gz \
  -o update.tar.gz

# 2. Transfer to air-gapped environment (via approved method)

# 3. Extract and verify
tar -xzf update.tar.gz
cd openclaw-update
./verify-checksums.sh  # Validates integrity

# 4. Load new images
docker load -i images/gateway-2024.2.1.tar
docker tag openclaw/gateway:2024.2.1 harbor.company.local/openclaw/gateway:2024.2.1
docker push harbor.company.local/openclaw/gateway:2024.2.1

# 5. Apply database migrations (if any)
./migrate.sh --dry-run  # Preview changes
./migrate.sh --apply

# 6. Rolling update
kubectl set image deployment/openclaw-gateway \
  gateway=harbor.company.local/openclaw/gateway:2024.2.1

# 7. Verify health
kubectl rollout status deployment/openclaw-gateway
./health-check.sh
```

---

### Data Residency & Compliance

Self-hosted deployments enable compliance with strict data residency requirements:

| Regulation | Requirement | Self-Hosted Benefit |
|-----------|-------------|---------------------|
| **GDPR (EU)** | Data must stay in EU | Deploy in EU-based datacenter |
| **HIPAA (US Healthcare)** | PHI must be encrypted + audited | Full control over encryption keys + audit logs |
| **FedRAMP (US Government)** | Cloud services must be authorized | Deploy on FedRAMP-authorized infrastructure |
| **PIPEDA (Canada)** | Personal data stays in Canada | Deploy in Canadian datacenter |
| **PDPA (Singapore)** | Personal data stays in Singapore | Deploy in Singapore datacenter |
| **China Cybersecurity Law** | Data localization required | Deploy in China region |

**Example: HIPAA-Compliant Deployment**

```yaml
# HIPAA-specific configuration
encryption:
  at_rest:
    enabled: true
    algorithm: AES-256-GCM
    key_management: HSM  # Hardware Security Module integration
  
  in_transit:
    tls_version: "1.3"
    cipher_suites:
      - TLS_AES_256_GCM_SHA384
      - TLS_CHACHA20_POLY1305_SHA256

audit:
  enabled: true
  retention_days: 2555  # 7 years (HIPAA requirement)
  immutable: true
  siem_integration: splunk
  log_phi_access: true

access_control:
  mfa_required: true
  password_policy:
    min_length: 14
    complexity: high
    rotation_days: 90
  session_timeout_minutes: 15
  auto_logout_enabled: true

backup:
  enabled: true
  encryption: true
  retention_days: 2555
  offsite_replication: true
  test_restore_frequency: monthly
```

---

### Migration: SaaS → Self-Hosted

OpenClaw provides a migration tool to move from SaaS to self-hosted:

```bash
# 1. Export data from SaaS (run from your machine)
openclaw export --output=./backup.tar.gz

# 2. Transfer backup to self-hosted server
scp backup.tar.gz admin@selfhosted-server:/opt/openclaw/

# 3. Import on self-hosted instance
ssh admin@selfhosted-server
cd /opt/openclaw
openclaw import --input=backup.tar.gz

# Includes:
# - All tenants, users, and roles
# - Agents and configurations
# - Session histories
# - Audit logs
# - Credentials (re-encrypted with new keys)

# 4. Update DNS to point to self-hosted server
# 5. Deactivate SaaS subscription
```

---

### Support & Professional Services

**Self-Hosted Support Tiers**:

1. **Community Support** (Free)
   - GitHub issues
   - Community forum
   - Documentation

2. **Business Support** ($25K/year)
   - Email support (48-hour SLA)
   - Quarterly health checks
   - Security advisory notifications

3. **Enterprise Support** ($100K/year)
   - 24/7 phone + email (4-hour SLA for P1 issues)
   - Dedicated support engineer
   - Monthly architecture reviews
   - Custom training sessions

4. **Premium Support** ($250K/year)
   - Everything in Enterprise
   - On-site visits (2x per year)
   - Custom feature development
   - Source code access

**Professional Services**:
- Installation & setup: $15K-$50K (depending on complexity)
- Migration from other platforms: $25K-$100K
- Custom integration development: $200/hour
- Security audit & penetration testing: $50K-$150K
- Training (on-site): $5K/day

---

## Self-Hosted Operations Guide

> **Comprehensive guide for managing, monitoring, and maintaining self-hosted OpenClaw deployments**

### Table of Contents

1. [Overview](#operations-overview)
2. [Health Monitoring](#health-monitoring-telemetry)
3. [License Management](#license-management)
4. [Support Access](#remote-support-access)
5. [Management Tiers](#managed-services-tiers)
6. [Customer Portal](#self-service-portal)
7. [Summary](#operations-summary)

---

### Operations Overview {#operations-overview}

Self-hosted OpenClaw deployments balance **customer control** with **vendor support** through:

- **Optional telemetry** - Privacy-safe health monitoring (can be disabled)
- **License enforcement** - Seat limits, feature flags, expiration management
- **Secure support access** - Time-limited, audited vendor assistance
- **Flexible management tiers** - Choose your level of vendor involvement
- **Self-service portal** - Manage licenses, updates, and support independently

**Core Principles**:
- ✅ Privacy first (no PII, no user data)
- ✅ Customer control (disable telemetry, approve support access)
- ✅ Full transparency (audit logs, data collection disclosure)
- ✅ Fair licensing (grace periods, warnings, upgrade paths)

---

### Health Monitoring & Telemetry {#health-monitoring-telemetry}

#### What We Monitor (Privacy-Safe)

| Collected ✅ | **NOT** Collected ❌ |
|-------------|-------------------|
| System metrics (CPU, RAM, disk) | User data or messages |
| Service health (gateway, DB, Redis) | Agent configurations |
| Error rates and latency | Session content |
| License status | Credentials or secrets |
| Version information | Business logic |
| Aggregate counts (users, agents) | Custom code |

| Collected ✅ | **NOT** Collected ❌ |
|-------------|-------------------|
| System metrics (CPU, RAM, disk) | User data or messages |
| Service health (gateway, DB, Redis) | Agent configurations |
| Error rates and latency | Session content |
| License status | Credentials or secrets |
| Version information | Business logic |
| Aggregate counts (users, agents) | Custom code |

#### Telemetry Architecture

```
Customer Environment          Internet         Vendor Service
┌──────────────────┐                          ┌─────────────────┐
│ Health Agent     │──HTTPS (TLS 1.3)────────▶│ Telemetry API   │
│ (Optional)       │  Encrypted + Auth        │ - Validate key  │
│                  │                          │ - Store metrics │
│ Collects every   │◀─────Alerts──────────────│ - Send alerts   │
│ 5 minutes:       │  (low disk, updates)     └─────────────────┘
│ - CPU: 45%       │
│ - RAM: 62%       │
│ - Disk: 38%      │
│ - Gateway: ✅     │
│ - Errors: 3      │
└──────────────────┘

Customer Controls:
• TELEMETRY_ENABLED=false  → Disable completely
• TELEMETRY_INTERVAL=600   → Report every 10 minutes
• Firewall rules           → Block outbound if needed
```

#### Configuration

```bash
# .env file
# Enable/disable telemetry
TELEMETRY_ENABLED=true  # Set to 'false' to disable

# Reporting interval (seconds)
TELEMETRY_INTERVAL=300  # Default: 5 minutes

# Custom endpoint (for proxies/testing)
TELEMETRY_ENDPOINT=https://telemetry.openclaw.ai/v1/health

# Air-gapped mode (disables all outbound calls)
AIRGAP_MODE=false
```

#### Health Metrics Structure

```json
{
  "timestamp": "2026-02-01T10:30:00Z",
  "instanceId": "a1b2c3d4e5f6g7h8",
  "version": "2024.1.1",
  
  "system": {
    "cpuUsage": 45.2,
    "memoryUsage": 62.8,
    "diskUsage": 38.1,
    "uptime": 2592000
  },
  
  "services": {
    "gateway": { "status": "healthy", "latency": 12 },
    "database": { "status": "healthy", "connectionPoolSize": 50 },
    "redis": { "status": "healthy", "memoryUsage": 256 }
  },
  
  "usage": {
    "totalUsers": 432,
    "totalAgents": 45,
    "messagesLast24h": 12567,
    "activeSessionsNow": 89
  },
  
  "errors": {
    "last24h": 3,
    "topErrorCodes": [
      { "code": "RATE_LIMIT_EXCEEDED", "count": 2 },
      { "code": "DATABASE_TIMEOUT", "count": 1 }
    ]
  },
  
  "license": {
    "maxSeats": 500,
    "usedSeats": 432,
    "expiresAt": "2027-01-15T00:00:00Z",
    "features": ["sso", "auditLogs", "customBranding"]
  }
}
```

**Vendor Response** (alerts & recommendations):

```json
{
  "status": "ok",
  "alerts": [
    {
      "severity": "warning",
      "message": "Disk space approaching limit",
      "details": "Disk usage at 38%. Consider cleanup or expansion.",
      "actionUrl": "https://docs.openclaw.ai/ops/disk-cleanup"
    }
  ],
  "updateAvailable": true,
  "latestVersion": "2024.1.2",
  "releaseNotesUrl": "https://github.com/openclaw/openclaw/releases/tag/v2024.1.2"
}
```

---

### License Management {#license-management}

#### License Structure

```typescript
interface License {
  // Identity
  licenseKey: string;        // Base64-encoded signed license
  customerId: string;        // Customer UUID
  customerName: string;      // "Acme Corp"
  
  // Type & limits
  type: 'self-hosted-standard' | 'self-hosted-enterprise' | 'air-gapped';
  maxSeats: number;          // Maximum active users
  
  // Validity
  issuedAt: string;          // "2026-01-01T00:00:00Z"
  expiresAt: string;         // "2027-01-01T00:00:00Z"
  gracePeriodDays: number;   // 30 days after expiration
  
  // Features (feature flags)
  features: {
    sso: boolean;            // SAML/OIDC support
    auditLogs: boolean;      // Compliance logging
    customBranding: boolean; // White-label UI
    apiAccess: boolean;      // REST API
    multiTenant: boolean;    // Multiple tenants
    airgapMode: boolean;     // Offline operation
    advancedRBAC: boolean;   // Fine-grained permissions
    webhooks: boolean;       // Event webhooks
  };
  
  // Support
  supportTier: 'business' | 'enterprise' | 'premium';
  
  // Signature (RSA-2048, prevents tampering)
  signature: string;
}
```

#### Enforcement Workflow

```
┌─────────────────────────────────────────────────────────┐
│ Startup: Load & Validate License                        │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
         ┌────────────────────┐
         │ Verify Signature   │──✗─▶ Error: Invalid license
         └────────┬───────────┘
                  │ ✓
                  ▼
         ┌────────────────────┐
         │ Check Expiration   │
         └────────┬───────────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
     Expired   Grace     Valid
        │      Period      │
        ▼         │         ▼
    ┌─────┐      ▼      Continue
    │ STOP│   ┌──────┐   Normally
    └─────┘   │ WARN │
              │Admin │
              └──────┘
                  │
                  ▼
         ┌────────────────────┐
         │ Check Seat Limit   │
         └────────┬───────────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
    Exceeded    90%+     Normal
        │         │         │
        ▼         ▼         ▼
    ┌─────┐   ┌──────┐  Continue
    │Block│   │Warn  │
    │ API │   │Admin │
    └─────┘   └──────┘
```

#### License Validation Example

```bash
# Set license key in environment
export OPENCLAW_LICENSE_KEY="eyJsaWNlbnNlS2V5Ijoi..."

# Start gateway (validates license on startup)
openclaw gateway run

# Output:
# ✅ License validated successfully
#    Customer: Acme Corp (acme-uuid-123)
#    Type: self-hosted-enterprise
#    Seats: 432/500 used (86%)
#    Expires: 2027-01-15 (342 days remaining)
#    Features: sso, auditLogs, customBranding, apiAccess, multiTenant
```

#### Seat Limit Warnings

```
Scenario 1: Approaching Limit (450/500 seats, 90%)
──────────────────────────────────────────────────
⚠️  Warning logged to console + admin email sent weekly

Scenario 2: At Limit (500/500 seats, 100%)
──────────────────────────────────────────────────
🚫 New user creation blocked
📧 Urgent admin notification
💡 Prompt to upgrade license

Scenario 3: Over Limit (520/500 seats, 104%)
──────────────────────────────────────────────────
🔒 Gateway refuses to start
📧 Critical admin notification
📞 Support team contacted automatically
```

#### Grace Period Handling

```typescript
License expires: 2026-12-31
Grace period:    30 days
Hard stop:       2027-01-30

Timeline:
├─ 2026-12-01: 30 days before expiration → Weekly reminder emails
├─ 2026-12-31: License expires → Daily warning logs, banner in UI
├─ 2027-01-01: Grace period (Day 1) → Gateway still runs, urgent emails
├─ 2027-01-15: Grace period (Day 15) → Daily urgent notifications
└─ 2027-01-30: Grace period ends → Gateway refuses to start
```

#### Feature Flags

```
┌─────────────────────────────────────────────────────────────┐
│         Customer Self-Hosted Environment                     │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │   OpenClaw Gateway (running locally)           │         │
│  │                                                │         │
│  │  ┌──────────────────────────────────────┐     │         │
│  │  │  Health Monitoring Agent             │     │         │
│  │  │  (Optional - customer can disable)   │     │         │
│  │  │                                       │     │         │
│  │  │  Collects:                           │     │         │
│  │  │  - System metrics (CPU, RAM, disk)   │     │         │
│  │  │  - Service health (gateway, DB, Redis)│    │         │
│  │  │  - Error rates and latency           │     │         │
│  │  │  - License status & expiration       │     │         │
│  │  │  - Version & update availability     │     │         │
│  │  │                                       │     │         │
│  │  │  Does NOT collect:                   │     │         │
│  │  │  ❌ User data or messages             │     │         │
│  │  │  ❌ Agent configurations or prompts   │     │         │
│  │  │  ❌ Session content or credentials    │     │         │
│  │  │  ❌ Business logic or custom code     │     │         │
│  │  └──────────────────────────────────────┘     │         │
│  │                    │                           │         │
│  │                    │ HTTPS (TLS 1.3)          │         │
│  │                    │ Encrypted + Authenticated │         │
│  └────────────────────┼───────────────────────────┘         │
│                       │                                      │
│  ┌────────────────────▼───────────────────────────┐         │
│  │  Firewall Rule (Customer-controlled)           │         │
│  │  - Allow outbound to telemetry.openclaw.ai     │         │
│  │  - Can be disabled for air-gapped environments │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────┼────────────────────────────────────┘
                          │
                          │ Internet
                          │
┌─────────────────────────▼────────────────────────────────────┐
│         OpenClaw Telemetry Service (Vendor-managed)          │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │   Telemetry Ingestion API                      │         │
│  │   - Validates license key                      │         │
│  │   - Rate limited per customer                  │         │
│  │   - Stores only aggregated metrics             │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │   Monitoring Dashboard                         │         │
│  │   - Real-time health status                    │         │
│  │   - Proactive alerts (low disk, high CPU)      │         │
│  │   - Upgrade recommendations                    │         │
│  │   - License expiration warnings                │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │   Support Portal                               │         │
│  │   - Customer can grant support team access     │         │
│  │   - Time-limited support tunnels               │         │
│  │   - Audit log of all vendor access             │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

**Implementation Details**: Complete TypeScript implementation available in:
- `src/telemetry/health-agent.ts` - Health monitoring agent
- `src/licensing/validator.ts` - License validation and enforcement
- `src/support/tunnel.ts` - Secure remote support access

---

#### Feature Flags

```typescript
// Check if feature is enabled in license
if (licenseValidator.hasFeature('sso')) {
  // Enable SAML/OIDC authentication
}

if (licenseValidator.hasFeature('auditLogs')) {
  // Enable compliance logging
}
```

---

### Remote Support Access {#remote-support-access}

#### Overview

Self-hosted customers can grant time-limited, audited access to OpenClaw support engineers for troubleshooting.

**Key Features**:
- ✅ Customer initiates and approves each tunnel
- ✅ Time-limited (max 8 hours)
- ✅ Permission-based (read-only, diagnostics, updates)
- ✅ Fully audited (every command logged)
- ✅ Customer can revoke access anytime

#### Architecture

```
Customer Initiates Support Tunnel
         │
         ▼
┌────────────────────────┐
│ Support Portal         │
│ manage.openclaw.ai     │
│                        │
│ [Create Tunnel]        │
│ Duration: 4 hours      │
│ Permissions:           │
│ ☑ Read logs            │
│ ☑ Run diagnostics      │
│ ☐ Modify config        │
└────────┬───────────────┘
         │
         ▼
   Tunnel Created
   ID: abc123def456
   Expires: 4 hours
         │
         ▼
┌────────────────────────┐
│ Support Engineer       │
│ Connects to tunnel     │
│                        │
│ $ logs tail 100        │
│ $ diagnostics run      │
│                        │
│ All actions logged     │
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ Audit Trail            │
│ - 10:30: Tunnel opened │
│ - 10:31: logs tail 100 │
│ - 10:35: diagnostics   │
│ - 12:15: Tunnel closed │
└────────────────────────┘
```

#### Tunnel Permissions

| Permission | Allows | Risk Level |
|-----------|--------|------------|
| `read-logs` | View application logs | Low |
| `read-metrics` | View health metrics | Low |
| `run-diagnostics` | Run health checks | Low |
| `read-config` | View configuration (masked secrets) | Medium |
| `modify-config` | Update settings (requires approval) | High |
| `apply-updates` | Install patches/updates | High |
| `database-access` | Read-only DB queries | High |

#### Creating a Support Tunnel

```bash
# Customer creates tunnel via CLI
openclaw support:create-tunnel \
  --ticket-id SUPPORT-12345 \
  --duration 4h \
  --permissions read-logs,run-diagnostics

# Output:
# ✅ Support tunnel created
#    Tunnel ID: abc123def456
#    Expires: 2026-02-01 14:30:00 UTC (4 hours)
#    Access URL: https://support.openclaw.ai/tunnel/abc123def456
#
# Share this URL with your support engineer.
# You can revoke access anytime with:
#   openclaw support:close-tunnel abc123def456
```

#### Audit Trail Example

```json
{
  "tunnelId": "abc123def456",
  "customerId": "acme-uuid-123",
  "supportEngineer": "john@openclaw.ai",
  "createdAt": "2026-02-01T10:30:00Z",
  "expiresAt": "2026-02-01T14:30:00Z",
  "permissions": ["read-logs", "run-diagnostics"],
  
  "auditLog": [
    {
      "timestamp": "2026-02-01T10:30:15Z",
      "action": "TUNNEL_CREATED",
      "details": { "ticketId": "SUPPORT-12345" }
    },
    {
      "timestamp": "2026-02-01T10:31:42Z",
      "action": "COMMAND_EXECUTED",
      "command": "logs tail 100",
      "resultSize": 15234
    },
    {
      "timestamp": "2026-02-01T10:35:18Z",
      "action": "COMMAND_EXECUTED",
      "command": "diagnostics run",
      "resultSize": 8421
    },
    {
      "timestamp": "2026-02-01T12:15:00Z",
      "action": "TUNNEL_CLOSED",
      "details": { "reason": "Issue resolved" }
    }
  ]
}
```

---

### Managed Services Tiers {#managed-services-tiers}

Choose your level of vendor involvement:

| Tier | Management | Monitoring | Updates | Support Access | Price |
|------|-----------|-----------|---------|----------------|-------|
| **Customer-Managed** | 100% customer | Optional telemetry | Manual | On-request only | **1.0x** |
| **Vendor-Monitored** | Customer manages, vendor watches | Required telemetry | Manual + alerts | Read-only | **1.2x** |
| **Vendor-Managed Updates** | Vendor handles updates | Required telemetry | Auto (customer approves) | Limited write | **1.5x** |
| **Fully Managed** | Vendor manages all ops | Required telemetry | Automated | Full access (audited) | **2.0x** |

#### Tier Details

**Tier 1: Customer-Managed** (100% control)
```yaml
management:
  telemetry: optional
  updates: customer installs manually
  support: create tunnel on request
  
best_for:
  - High-security environments
  - Full control requirements
  - Experienced DevOps teams
```

**Tier 2: Vendor-Monitored** (Proactive alerts)
```yaml
management:
  telemetry: required (health only)
  updates: customer installs, vendor alerts when available
  support: read-only access via tunnels
  
benefits:
  - Proactive health alerts (disk full, high CPU)
  - Security vulnerability notifications
  - Performance recommendations
  
best_for:
  - Teams wanting alerts without giving up control
  - Compliance requirements (customer controls changes)
```

**Tier 3: Vendor-Managed Updates** (Automated patches)
```yaml
management:
  telemetry: required
  updates: automated (customer approves in dashboard)
  support: limited write access for updates only
  
features:
  - Automatic security patches (customer approval required)
  - Maintenance windows (customer sets schedule)
  - Automatic rollback on health check failure
  
best_for:
  - Teams wanting security without manual update work
  - Guaranteed patch SLA (7 days for critical CVEs)
```

**Tier 4: Fully Managed** (Vendor operates)
```yaml
management:
  telemetry: required
  updates: fully automated
  support: full access (all actions audited)
  
features:
  - 24/7 vendor monitoring and response
  - Automatic scaling and optimization
  - Proactive performance tuning
  - Vendor responsible for uptime SLA
  
best_for:
  - Teams without dedicated DevOps
  - Maximum uptime requirements (99.9% SLA)
  - Focus on business, not infrastructure
```

---

### Self-Service Portal {#self-service-portal}

Dashboard for managing licenses, health, and support:

```
┌─────────────────────────────────────────────────────────┐
│  OpenClaw Self-Hosted Portal                            │
│  https://manage.openclaw.ai                             │
└─────────────────────────────────────────────────────────┘

╔═══════════════════════════════════════════════════════════╗
║  Instance: production-us-east                             ║
║  Customer: Acme Corp                                      ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────┬─────────────────┬─────────────────────┐
│ ✅ Health        │ 📊 License      │ 🔄 Version          │
│ Healthy         │ 450/500 seats   │ 2024.1.1            │
│                 │ Expires: 342d   │ Update: 2024.1.2 ⬆️  │
└─────────────────┴─────────────────┴─────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ System Metrics (Last 24h)                                 │
├───────────────────────────────────────────────────────────┤
│  CPU:  ▓▓▓▓▓░░░░░ 45%                                    │
│  RAM:  ▓▓▓▓▓▓▓░░░ 62%                                    │
│  Disk: ▓▓▓▓░░░░░░ 38%                                    │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ Quick Actions                                              │
├───────────────────────────────────────────────────────────┤
│  [🔄 Upgrade to 2024.1.2]    [📋 View Release Notes]     │
│  [💾 Download Backup]         [🎫 Request Support]        │
│  [📜 Renew License]           [➕ Add Seats]              │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ Recent Alerts                                              │
├───────────────────────────────────────────────────────────┤
│  ⚠️  Jan 28: Approaching seat limit (90% used)            │
│  ℹ️  Jan 25: Security update available (2024.1.2)         │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ Support Tunnel History                                     │
├───────────────────────────────────────────────────────────┤
│  📋 Jan 20 | Tunnel #abc123 | john@openclaw.ai            │
│             Duration: 2h 15m | 12 commands                 │
│             [View Full Audit Log]                          │
└───────────────────────────────────────────────────────────┘
```

#### Portal Features

**License Management**:
- View current seats used vs available
- Add seats (purchase more licenses)
- Renew before expiration
- Download license key
- View feature flags

**Health Monitoring**:
- Real-time system metrics
- Service status (gateway, DB, Redis)
- Error rates and trends
- Performance recommendations

**Updates**:
- View available updates
- Read release notes
- Schedule maintenance windows
- One-click upgrade (Tier 3+)
- Rollback if needed

**Support**:
- Create support tunnels
- View tunnel audit logs
- Submit support tickets
- Access documentation
- View support tier and SLA

**Billing**:
- View invoices
- Download usage reports
- Update payment method
- Estimate costs for seat additions

---

### Operations Summary {#operations-summary}

**Three Pillars of Self-Hosted Support**:

| Pillar | Customer Benefit | Vendor Benefit |
|--------|-----------------|----------------|
| **Monitoring** | Proactive alerts, avoid downtime | Early issue detection, fewer support tickets |
| **Licensing** | Fair pricing, clear limits | Revenue protection, usage visibility |
| **Support Access** | Fast issue resolution | Efficient troubleshooting, complete audit trail |

**Privacy Guarantees**:
- ❌ No user data or messages collected
- ❌ No agent configurations or prompts
- ❌ No session content or credentials
- ✅ Only system metrics and aggregates
- ✅ Customer can disable telemetry completely
- ✅ Full audit trail of all vendor access

**Licensing Enforcement**:
- Seat limits enforced (with 90% warning threshold)
- Grace periods (30 days) before hard stops
- Feature flags (SSO, audit logs, etc.) controlled by license
- Tamper-proof (RSA signature verification)
- Remote updates (seat increases, feature unlocks)

**Support Model**:
- Customer initiates all access
- Time-limited tunnels (max 8 hours)
- Permission-based (granular control)
- Fully audited (immutable logs)
- Customer can revoke anytime

**Management Options**:
- **Customer-Managed**: Full control (1x price)
- **Vendor-Monitored**: Alerts only (1.2x price)
- **Vendor-Managed Updates**: Auto-patches (1.5x price)
- **Fully Managed**: Complete vendor ops (2x price)

**Next Steps**:
1. Choose management tier based on team size and expertise
2. Configure telemetry settings (`TELEMETRY_ENABLED`, `AIRGAP_MODE`)
3. Install license key (`OPENCLAW_LICENSE_KEY`)
4. Set up monitoring dashboard access
5. Review support tunnel procedures with team

---

## Self-Hosted vs. Multi-Tenant Architecture

### Deployment Comparison

OpenClaw supports **two distinct deployment models** with different management UIs and user experiences:

| Aspect | **Self-Hosted (On-Prem)** | **Multi-Tenant SaaS** |
|--------|--------------------------|----------------------|
| **Infrastructure** | Customer-owned (AWS/GCP/on-prem) | OpenClaw-managed cloud |
| **Database** | Customer's PostgreSQL | Shared DB with RLS isolation |
| **Agents** | Customer creates/manages | Customer creates/manages |
| **Users** | Customer's employees/team | Customer's employees/team |
| **Management UI** | Self-Service Portal (manage.openclaw.ai) | Tenant Admin Portal ({tenant}.openclaw.ai/admin) |
| **End Users** | Messaging apps (Telegram/Discord/Slack) | Web chat + messaging apps |
| **Updates** | Manual or vendor-managed | Automatic |
| **Billing** | Annual license (seat-based) | Monthly subscription (usage + seats) |
| **Data Location** | Customer-controlled | Multi-region (customer chooses) |
| **Customization** | Full control (can modify code) | Limited to tenant settings |
| **Support** | Support tunnels (time-limited) | 24/7 managed support |

---

### Self-Hosted Architecture

```mermaid
graph TB
    subgraph Customer Data Center
        LB[Load Balancer]
        GW1[Gateway Instance 1]
        GW2[Gateway Instance 2]
        PG[(PostgreSQL)]
        Redis[(Redis)]
        
        LB --> GW1
        LB --> GW2
        GW1 --> PG
        GW1 --> Redis
        GW2 --> PG
        GW2 --> Redis
    end
    
    subgraph External Channels
        TG[Telegram]
        DC[Discord]
        SL[Slack]
    end
    
    subgraph Customer Team
        Admin[IT Admins]
        Dev[Developers]
        Users[End Users]
    end
    
    subgraph OpenClaw Vendor
        Portal[Self-Service Portal<br/>manage.openclaw.ai]
        Support[Support Team]
        License[License Server]
    end
    
    TG <--> GW1
    DC <--> GW1
    SL <--> GW2
    
    Users --> TG
    Users --> DC
    Users --> SL
    
    Admin --> Portal
    Dev --> GW1
    Dev --> GW2
    
    GW1 -.Telemetry.-> Portal
    GW2 -.Telemetry.-> Portal
    GW1 -.License Check.-> License
    
    Support -.Support Tunnel.-> GW1
    
    style Portal fill:#e1f5ff
    style License fill:#fff3e0
    style Support fill:#f3e5f5
```

**Self-Hosted UIs**:

1. **Self-Service Portal** (manage.openclaw.ai)
   - Target: IT admins managing the instance
   - Features: License management, health monitoring, updates, support tunnel creation
   - Access: Authenticated via customer SSO

2. **Admin Interface** (REUSE Multi-Tenant Admin UI locally)
   - Target: Developers/operators managing agents
   - Features: User management, agent creation, channel bindings, logs
   - Access: Local deployment at `https://openclaw.acme.internal/admin`
   - **Note**: Self-hosted deployments run the SAME admin UI as SaaS, just locally hosted

3. **End User Experience**: Messaging apps only (Telegram, Discord, Slack)
   - No web chat interface in self-hosted (can be added as optional module)

---

### Multi-Tenant SaaS Architecture

```mermaid
graph TB
    subgraph OpenClaw Cloud
        CloudLB[Cloud Load Balancer]
        GW1[Gateway 1 - us-east]
        GW2[Gateway 2 - us-west]
        GW3[Gateway 3 - eu-west]
        
        PG[(PostgreSQL<br/>with RLS)]
        Redis[(Redis<br/>Session Store)]
        
        CloudLB --> GW1
        CloudLB --> GW2
        CloudLB --> GW3
        
        GW1 --> PG
        GW2 --> PG
        GW3 --> PG
        
        GW1 --> Redis
        GW2 --> Redis
        GW3 --> Redis
    end
    
    subgraph Tenant: Acme Corp
        AcmeAdmins[Acme Admins]
        AcmeDevs[Acme Developers]
        AcmeUsers[Acme Employees]
        
        AcmeAdmins --> AdminUI[Admin Portal<br/>acme.openclaw.ai/admin]
        AcmeDevs --> AdminUI
        AcmeUsers --> WebUI[Web Chat<br/>acme.openclaw.ai/chat]
        AcmeUsers --> TG[Telegram]
    end
    
    subgraph Tenant: Beta Inc
        BetaAdmins[Beta Admins]
        BetaUsers[Beta Users]
        
        BetaAdmins --> BetaAdminUI[Admin Portal<br/>beta.openclaw.ai/admin]
        BetaUsers --> BetaWebUI[Web Chat<br/>beta.openclaw.ai/chat]
    end
    
    AdminUI --> CloudLB
    WebUI --> CloudLB
    TG <--> GW1
    
    BetaAdminUI --> CloudLB
    BetaWebUI --> CloudLB
    
    style PG fill:#e8f5e9
    style AdminUI fill:#e1f5ff
    style WebUI fill:#fff3e0
```

**Multi-Tenant SaaS UIs**:

1. **Tenant Admin Portal** ({tenant}.openclaw.ai/admin)
   - Target: Tenant administrators, team leads, developers
   - Features: User management, agent management, channel bindings, usage/billing, settings
   - Access: SSO or email/password per tenant

2. **End User Web Chat** ({tenant}.openclaw.ai/chat)
   - Target: End users (employees, customers)
   - Features: Agent directory, chat interface, conversation history, voice input
   - Access: SSO or email/password per tenant

3. **Developer Console** ({tenant}.openclaw.ai/admin/dev)
   - Target: Agent developers debugging issues
   - Features: Agent debugger, API playground, log viewer, skill tester, performance profiler
   - Access: Requires `agent_developer` or `tenant_admin` role

4. **Observability Dashboard** ({tenant}.openclaw.ai/admin/observe)
   - Target: Operations teams monitoring production
   - Features: System health, service metrics, distributed tracing, alerts, custom dashboards
   - Access: Requires `agent_operator` or higher role

---

### UI Matrix: Who Uses What?

| User Type | Self-Hosted | Multi-Tenant SaaS |
|-----------|-------------|-------------------|
| **IT Admin** | Self-Service Portal (manage.openclaw.ai)<br/>Local Admin UI (openclaw.internal/admin) | Tenant Admin Portal (acme.openclaw.ai/admin) |
| **Agent Developer** | Local Admin UI + Dev Console | Tenant Admin Portal + Developer Console |
| **Operations/SRE** | Local Admin UI + Logs | Observability Dashboard |
| **End User** | Telegram/Discord/Slack ONLY | Web Chat + Telegram/Discord/Slack |
| **Billing Contact** | Self-Service Portal (invoices) | Tenant Admin Portal (usage/billing) |

---

### Data Isolation

**Self-Hosted**: Complete isolation (separate database per customer)
- Each customer has their own PostgreSQL database
- No shared resources with other customers
- Full control over data location and retention

**Multi-Tenant SaaS**: Row-Level Security (RLS) isolation
- Shared PostgreSQL database with RLS policies
- `tenant_id` column on all tables
- RLS enforces `app.current_tenant_id` context
- See "Request Flow with Tenant Isolation" diagram below for details

---

### Hybrid Deployment (Optional)

Some enterprises want a **hybrid model**:

```
┌────────────────────────────────────────────────┐
│ Customer VPC (AWS/GCP)                         │
│ ┌────────────────────────────────────────────┐ │
│ │ Self-Hosted Gateway + Agents               │ │
│ │ (runs in customer's VPC)                   │ │
│ └────────────────────────────────────────────┘ │
│                  ↓ HTTPS                       │
└──────────────────┼─────────────────────────────┘
                   │
                   ↓
┌────────────────────────────────────────────────┐
│ OpenClaw SaaS Control Plane                    │
│ • Multi-Tenant Admin Portal                    │
│ • User Management (SSO)                        │
│ • Billing & Usage Tracking                     │
│ • Observability (metrics aggregation)          │
└────────────────────────────────────────────────┘
```

**Benefits**:
- Data stays in customer VPC (compliance)
- Management UI hosted by vendor (convenience)
- Centralized billing and monitoring across customers

**Implementation**: API gateway forwards control-plane requests to SaaS, data-plane stays local

---

## Multi-Tenant SaaS Admin Interface

### Overview

The **Tenant Admin Portal** provides a web-based interface for tenant administrators to manage their OpenClaw workspace, users, agents, and integrations without requiring CLI access or technical expertise.

**Access**: `https://{tenant-slug}.openclaw.ai/admin` or `https://app.openclaw.ai/admin` (with tenant switching)

**Target Users**:
- Tenant administrators (company IT admins)
- Team leads managing agents
- Operations teams monitoring usage
- Billing contacts reviewing invoices

---

### User Roles & Permissions

```typescript
type TenantRole = 
  | 'tenant_owner'      // Full access, billing, delete tenant
  | 'tenant_admin'      // Manage users, agents, settings (no billing)
  | 'agent_developer'   // Create/edit agents, skills, bindings
  | 'agent_operator'    // Run agents, view logs (no config changes)
  | 'viewer';           // Read-only access to everything

interface RolePermissions {
  users: {
    invite: boolean;
    remove: boolean;
    changeRoles: boolean;
  };
  agents: {
    create: boolean;
    edit: boolean;
    delete: boolean;
    viewLogs: boolean;
    installSkills: boolean;
  };
  bindings: {
    create: boolean;
    edit: boolean;
    delete: boolean;
  };
  billing: {
    viewUsage: boolean;
    viewInvoices: boolean;
    updatePayment: boolean;
    changeplan: boolean;
  };
  settings: {
    sso: boolean;
    branding: boolean;
    webhooks: boolean;
  };
}
```

**Permission Matrix**:

| Action | Owner | Admin | Developer | Operator | Viewer |
|--------|-------|-------|-----------|----------|--------|
| Invite users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Remove users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create agents | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit agent config | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete agents | ✅ | ✅ | ⚠️ Own only | ❌ | ❌ |
| Install skills | ✅ | ✅ | ✅ | ❌ | ❌ |
| View agent logs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create bindings | ✅ | ✅ | ✅ | ❌ | ❌ |
| View usage stats | ✅ | ✅ | ✅ | ✅ | ✅ |
| View invoices | ✅ | ⚠️ Read-only | ❌ | ❌ | ❌ |
| Update billing | ✅ | ❌ | ❌ | ❌ | ❌ |
| Configure SSO | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete tenant | ✅ | ❌ | ❌ | ❌ | ❌ |

---

### Admin Portal Interface

#### Dashboard (Home Screen)

```
╔═══════════════════════════════════════════════════════════╗
║  OpenClaw Admin - Acme Corp                               ║
║  john@acme.com (Owner) | Logout                           ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ 📊 Overview                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┬──────────────┬──────────────┬──────────┐  │
│  │ Users        │ Agents       │ Messages     │ Tokens   │  │
│  │ 45/50 seats  │ 12 active    │ 45.2K today  │ 2.1M     │  │
│  └──────────────┴──────────────┴──────────────┴──────────┘  │
│                                                              │
│  Plan: Enterprise | Billing: $4,250/month                   │
│  Renews: Mar 15, 2026 (43 days) [Upgrade Plan]              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ 🔥 Active Agents (Last 24h)                                 │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐     │
│  │ support-bot    | 12.3K msgs | 456K tokens | ✅     │     │
│  │ dev-assistant  | 3.2K msgs  | 234K tokens | ✅     │     │
│  │ sales-ai       | 1.8K msgs  | 123K tokens | ✅     │     │
│  │ hr-helper      | 245 msgs   | 34K tokens  | ✅     │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ Alerts                                                    │
├─────────────────────────────────────────────────────────────┤
│  • Approaching seat limit: 45/50 users (90%)                │
│  • Telegram binding 'support-bot' rate limited (429)        │
│  • Agent 'dev-assistant' error rate: 2.3% (threshold: 5%)   │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Navigation:
[Dashboard] [Users] [Agents] [Bindings] [Usage] [Settings]
```

---

#### Users Management

```
╔═══════════════════════════════════════════════════════════╗
║  Users & Access                                           ║
╚═══════════════════════════════════════════════════════════╝

Seats Used: 45/50  [+ Invite User]

┌─────────────────────────────────────────────────────────────┐
│ Search: [_______________________]  Filter: [All Roles ▼]    │
├──────┬────────────────────┬──────────────┬────────┬─────────┤
│ Name │ Email              │ Role         │ Status │ Actions │
├──────┼────────────────────┼──────────────┼────────┼─────────┤
│ John │ john@acme.com      │ Owner        │ Active │ [Edit]  │
│ Jane │ jane@acme.com      │ Admin        │ Active │ [Edit]  │
│ Bob  │ bob@acme.com       │ Developer    │ Active │ [Edit]  │
│ Alice│ alice@acme.com     │ Operator     │ Active │ [Edit]  │
│ Dave │ dave@acme.com      │ Viewer       │ Invited│ [Resend]│
└──────┴────────────────────┴──────────────┴────────┴─────────┘

Invite User Modal:
┌───────────────────────────────────────┐
│ Invite Team Member                    │
├───────────────────────────────────────┤
│ Email: [___________________________]  │
│ Role:  [Developer          ▼]        │
│                                       │
│ Permissions Preview:                  │
│ ✅ Create/edit agents                 │
│ ✅ Install skills                     │
│ ✅ View logs                          │
│ ❌ Manage users                       │
│ ❌ Access billing                     │
│                                       │
│        [Cancel]  [Send Invitation]    │
└───────────────────────────────────────┘
```

---

#### Agent Management

```
╔═══════════════════════════════════════════════════════════╗
║  Agents                                                   ║
╚═══════════════════════════════════════════════════════════╝

[+ Create Agent]  [Import from Template]

┌─────────────────────────────────────────────────────────────┐
│ Agent: support-bot                                    [Edit]│
├─────────────────────────────────────────────────────────────┤
│ Status: ✅ Running | Created: Jan 15, 2026 by john@acme.com│
│                                                              │
│ Configuration:                                               │
│ • Model: claude-3-5-sonnet                                  │
│ • Temperature: 0.7                                          │
│ • Max Tokens: 4096                                          │
│ • System Prompt: You are a helpful customer support agent...│
│                                                              │
│ Bindings (3):                                               │
│ • telegram:@acme_support_bot → dm                           │
│ • discord:guild123 → #support                               │
│ • slack:team456 → #help-desk                                │
│                                                              │
│ Skills Installed (5):                                        │
│ • 1password - Retrieve secrets                              │
│ • github - Search issues, create PRs                        │
│ • jira - Query tickets, update status                       │
│ • slack-notify - Send notifications                         │
│ • zendesk - Fetch customer info                             │
│                                                              │
│ Usage (Last 30 days):                                       │
│ • Messages: 45,234                                          │
│ • Tokens: 2.1M (input: 1.2M, output: 900K)                 │
│ • Errors: 34 (0.08%)                                        │
│ • Avg Response Time: 1.2s                                   │
│                                                              │
│ [View Logs] [Test Agent] [Clone] [Delete]                  │
└─────────────────────────────────────────────────────────────┘
```

**Create Agent Form**:

```
┌───────────────────────────────────────────────────────┐
│ Create New Agent                                      │
├───────────────────────────────────────────────────────┤
│ Basic Info:                                           │
│ Name:        [support-bot_________________]           │
│ Description: [Customer support assistant__]           │
│                                                       │
│ Model Configuration:                                  │
│ Provider:    [Anthropic           ▼]                 │
│ Model:       [claude-3-5-sonnet   ▼]                 │
│ Temperature: [0.7] ━━━━━━━━●━━ (0.0 - 2.0)          │
│ Max Tokens:  [4096_____________]                      │
│                                                       │
│ System Prompt:                                        │
│ ┌─────────────────────────────────────────────────┐   │
│ │You are a helpful customer support agent for     │   │
│ │Acme Corp. Be friendly, professional, and solve  │   │
│ │customer issues efficiently.                     │   │
│ │                                                 │   │
│ └─────────────────────────────────────────────────┘   │
│                                                       │
│ Skills (Optional):                                    │
│ [+ Add Skill]                                         │
│ ☑ 1password                                           │
│ ☑ github                                              │
│ ☐ jira                                                │
│ ☐ slack-notify                                        │
│                                                       │
│        [Cancel]  [Create Agent]                       │
└───────────────────────────────────────────────────────┘
```

---

#### Channel Bindings

```
╔═══════════════════════════════════════════════════════════╗
║  Channel Bindings                                         ║
╚═══════════════════════════════════════════════════════════╝

[+ Create Binding]

Connected Channels:
┌─────────────────────────────────────────────────────────────┐
│ Telegram                                              [Test]│
├─────────────────────────────────────────────────────────────┤
│ @acme_support_bot (Bot Token: ***************xyz)           │
│ Status: ✅ Connected | Last message: 2 minutes ago          │
│                                                              │
│ Bindings:                                                    │
│ • Agent: support-bot → DM messages                          │
│ • Agent: sales-ai → Group @acme_sales                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Discord                                               [Test]│
├─────────────────────────────────────────────────────────────┤
│ Server: Acme Engineering (ID: 123456789)                    │
│ Status: ✅ Connected | Last message: 5 minutes ago          │
│                                                              │
│ Bindings:                                                    │
│ • Agent: dev-assistant → #engineering                       │
│ • Agent: support-bot → #support                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Slack                                                 [Test]│
├─────────────────────────────────────────────────────────────┤
│ Workspace: Acme Corp (ID: T123ABC)                          │
│ Status: ⚠️ Token expires in 15 days [Refresh Token]        │
│                                                              │
│ Bindings:                                                    │
│ • Agent: hr-helper → #hr                                    │
│ • Agent: sales-ai → #sales                                  │
└─────────────────────────────────────────────────────────────┘

[+ Connect New Channel]
```

---

#### Usage & Billing

```
╔═══════════════════════════════════════════════════════════╗
║  Usage & Billing                                          ║
╚═══════════════════════════════════════════════════════════╝

Current Period: Feb 1 - Feb 28, 2026

┌─────────────────────────────────────────────────────────────┐
│ Plan: Enterprise                                             │
│ Base: $3,000/month (50 seats included)                      │
│ Add-ons:                                                     │
│ • +5 seats × $50 = $250                                     │
│ • Advanced RBAC = $500                                      │
│ • SOC 2 compliance = $500                                   │
│                                                              │
│ Total: $4,250/month                                         │
│ Next billing: Mar 1, 2026                                   │
│                                                              │
│ [Change Plan] [Update Payment Method]                       │
└─────────────────────────────────────────────────────────────┘

Token Usage (February 2026):
┌─────────────────────────────────────────────────────────────┐
│  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░ 2.1M / 10M tokens (21%)             │
│                                                              │
│ By Agent:                                                    │
│ • support-bot:    1.2M tokens (57%)                         │
│ • dev-assistant:  650K tokens (31%)                         │
│ • sales-ai:       180K tokens (9%)                          │
│ • hr-helper:       70K tokens (3%)                          │
│                                                              │
│ Trend: +15% vs last month                                   │
│                                                              │
│ [Download CSV] [View Detailed Report]                       │
└─────────────────────────────────────────────────────────────┘

Recent Invoices:
┌───────┬────────────┬──────────┬────────┬──────────────┐
│ Date  │ Period     │ Amount   │ Status │ Actions      │
├───────┼────────────┼──────────┼────────┼──────────────┤
│ Feb 1 │ Jan 2026   │ $4,250   │ Paid   │ [PDF] [View] │
│ Jan 1 │ Dec 2025   │ $4,250   │ Paid   │ [PDF] [View] │
│ Dec 1 │ Nov 2025   │ $3,750   │ Paid   │ [PDF] [View] │
└───────┴────────────┴──────────┴────────┴──────────────┘
```

---

#### Settings

```
╔═══════════════════════════════════════════════════════════╗
║  Tenant Settings                                          ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ General                                                      │
├─────────────────────────────────────────────────────────────┤
│ Tenant Name:  [Acme Corp________________]                   │
│ Subdomain:    [acme].openclaw.ai (cannot be changed)        │
│ Timezone:     [America/New_York    ▼]                      │
│ Language:     [English             ▼]                      │
│                                                              │
│ [Save Changes]                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Single Sign-On (SSO)                             [Enterprise]│
├─────────────────────────────────────────────────────────────┤
│ Status: ✅ Enabled                                           │
│                                                              │
│ Provider: [Okta            ▼]                               │
│ SAML Entity ID: acme.openclaw.ai                            │
│ ACS URL: https://acme.openclaw.ai/auth/saml/acs             │
│ Certificate: ✅ Valid until: Dec 31, 2026                    │
│                                                              │
│ [Test SSO] [Upload New Certificate] [Disable SSO]           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Security                                                     │
├─────────────────────────────────────────────────────────────┤
│ ☑ Require MFA for all users                                 │
│ ☑ Enforce strong passwords (12+ chars, symbols)             │
│ ☑ Auto-logout after 30 minutes of inactivity                │
│ ☑ IP whitelist (Optional)                                   │
│   Allowed IPs: [203.0.113.0/24________] [+ Add]            │
│                                                              │
│ Session Timeout: [30] minutes                               │
│ Password Rotation: [90] days                                │
│                                                              │
│ [Save Security Settings]                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Custom Branding                                  [Enterprise]│
├─────────────────────────────────────────────────────────────┤
│ Logo: [Upload Logo] (Current: Acme_logo.png)                │
│ Primary Color: [#FF6B35] ████                               │
│ Secondary Color: [#004E89] ████                             │
│                                                              │
│ Preview:                                                     │
│ ┌─────────────────────────────────┐                         │
│ │ 🔶 Acme Corp AI Assistant       │                         │
│ │ ────────────────────────────    │                         │
│ └─────────────────────────────────┘                         │
│                                                              │
│ [Save Branding]                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Webhooks                                         [Enterprise]│
├─────────────────────────────────────────────────────────────┤
│ [+ Add Webhook]                                              │
│                                                              │
│ 1. Slack Notifications                            [Edit] [×] │
│    URL: https://hooks.slack.com/services/T123/B456/xyz      │
│    Events: agent.error, usage.threshold                     │
│    Status: ✅ Last fired: 2 hours ago                        │
│                                                              │
│ 2. Internal Audit System                          [Edit] [×] │
│    URL: https://audit.acme.com/openclaw/webhook             │
│    Events: user.invited, agent.created, binding.deleted     │
│    Status: ✅ Last fired: 1 day ago                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Danger Zone                                                  │
├─────────────────────────────────────────────────────────────┤
│ Export Data:                                                 │
│ Download all tenant data (users, agents, sessions, logs)    │
│ [Request Data Export]                                        │
│                                                              │
│ Delete Tenant:                                               │
│ ⚠️ Permanently delete this tenant and all associated data.   │
│ This action cannot be undone.                                │
│ [Delete Tenant...]                                           │
└─────────────────────────────────────────────────────────────┘
```

---

### Technical Implementation

#### Frontend Stack

```typescript
// Tech stack for admin portal
{
  framework: 'React 18 + TypeScript',
  router: 'TanStack Router',
  state: 'Zustand + React Query',
  ui: 'Tailwind CSS + Radix UI',
  forms: 'React Hook Form + Zod',
  charts: 'Recharts',
  tables: 'TanStack Table',
  auth: 'JWT + SAML (enterprise)',
}
```

#### API Endpoints

```typescript
// Admin API routes
GET    /api/admin/dashboard              // Overview stats
GET    /api/admin/users                  // List users
POST   /api/admin/users/invite           // Invite user
PATCH  /api/admin/users/:id/role         // Change role
DELETE /api/admin/users/:id              // Remove user

GET    /api/admin/agents                 // List agents
POST   /api/admin/agents                 // Create agent
GET    /api/admin/agents/:id             // Get agent details
PATCH  /api/admin/agents/:id             // Update agent
DELETE /api/admin/agents/:id             // Delete agent
POST   /api/admin/agents/:id/test        // Test agent

GET    /api/admin/bindings               // List bindings
POST   /api/admin/bindings               // Create binding
PATCH  /api/admin/bindings/:id           // Update binding
DELETE /api/admin/bindings/:id           // Delete binding
POST   /api/admin/bindings/:id/test      // Test binding

GET    /api/admin/usage                  // Usage stats
GET    /api/admin/billing/invoices       // List invoices
GET    /api/admin/billing/invoices/:id   // Download PDF
POST   /api/admin/billing/payment        // Update payment

GET    /api/admin/settings                // Get settings
PATCH  /api/admin/settings                // Update settings
POST   /api/admin/webhooks                // Create webhook
DELETE /api/admin/webhooks/:id            // Delete webhook

POST   /api/admin/export                  // Export data
DELETE /api/admin/tenant                  // Delete tenant
```

#### Authorization Middleware

```typescript
// src/api/middleware/rbac.ts
import { Request, Response, NextFunction } from 'express';

type Permission = 
  | 'users:invite'
  | 'users:remove'
  | 'agents:create'
  | 'agents:edit'
  | 'agents:delete'
  | 'billing:view'
  | 'billing:update'
  | 'settings:sso'
  | 'tenant:delete';

const rolePermissions: Record<TenantRole, Permission[]> = {
  tenant_owner: ['*'], // All permissions
  tenant_admin: [
    'users:invite', 'users:remove',
    'agents:create', 'agents:edit', 'agents:delete',
    'settings:sso'
  ],
  agent_developer: [
    'agents:create', 'agents:edit'
  ],
  agent_operator: [],
  viewer: []
};

export function requirePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const tenantRole = await getUserTenantRole(user.id, req.tenantId);
    
    const allowed = rolePermissions[tenantRole].includes(permission) ||
                   rolePermissions[tenantRole].includes('*');
    
    if (!allowed) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `${tenantRole} role does not have ${permission} permission`
      });
    }
    
    next();
  };
}

// Usage:
app.post('/api/admin/users/invite',
  requirePermission('users:invite'),
  handleInviteUser
);
```

---

### Mobile-Responsive Design

Admin portal is fully responsive for mobile/tablet access:

```
Mobile View (375px):
┌─────────────────┐
│ ☰ Menu          │
├─────────────────┤
│ Dashboard       │
├─────────────────┤
│ Users: 45/50    │
│ Agents: 12      │
│ Messages: 45.2K │
├─────────────────┤
│ Quick Actions:  │
│ [+ Agent]       │
│ [+ User]        │
└─────────────────┘

Tablet View (768px):
┌───────────────────────────┐
│ ☰ Dashboard | john@acme  │
├───────────────────────────┤
│ ┌───────┬───────┬───────┐ │
│ │ Users │Agents │Messages│
│ │ 45/50 │  12   │ 45.2K │ │
│ └───────┴───────┴───────┘ │
├───────────────────────────┤
│ Active Agents             │
│ • support-bot    12.3K    │
│ • dev-assistant   3.2K    │
└───────────────────────────┘
```

---

### Integration with Enterprise Features

Admin portal integrates with enterprise security:

- **SSO**: SAML/OIDC authentication
- **RBAC**: Role-based UI rendering (hide unauthorized actions)
- **Audit Logs**: All admin actions logged to audit table
- **Session Management**: JWT tokens with 30-min expiry
- **MFA**: Optional 2FA for sensitive actions (delete tenant, change billing)

---

### Next Steps

1. **Phase 1**: Core UI (Users, Agents, Bindings) - 4 weeks
2. **Phase 2**: Usage & Billing - 2 weeks
3. **Phase 3**: Settings & SSO - 3 weeks
4. **Phase 4**: Mobile optimization - 1 week
5. **Phase 5**: Advanced features (Webhooks, Custom branding) - 2 weeks

**Total**: ~12 weeks (3 months) with 2 frontend engineers

---

## End User Web Interface

### Overview

The **End User Web Interface** provides a consumer-facing chat experience for users to interact with agents without requiring Telegram, Discord, or Slack accounts.

**Access**: `https://{tenant-slug}.openclaw.ai` or `https://{tenant-slug}.openclaw.ai/chat`

**Target Users**:
- End users (employees, customers, support seekers)
- Non-technical users who prefer web over messaging apps
- Users needing conversation history/search
- Mobile users (responsive web UI)

---

### Key Features

#### 1. Agent Directory

```
╔═══════════════════════════════════════════════════════════╗
║  Acme Corp AI Assistants                                  ║
║  alice@acme.com | Settings | Logout                       ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ 🔍 Search agents...                          [+ Request Bot]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 📌 Pinned Agents                                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🤖 Support Bot                              [Chat →]  │   │
│  │ Get help with technical issues                       │   │
│  │ 4.8 ★ | 12.3K chats this month                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 💼 HR Assistant                             [Chat →]  │   │
│  │ Benefits, PTO, policies, onboarding                  │   │
│  │ 4.9 ★ | 1.2K chats this month                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ 🏢 All Agents                                                │
├─────────────────────────────────────────────────────────────┤
│  Categories: [All] [Support] [HR] [Engineering] [Sales]     │
│                                                              │
│  ┌─────────┬─────────┬─────────┬─────────┐                  │
│  │ 🛠️ Dev  │ 💰 Sales│ 📊 Data │ 🎨 Mktg │                 │
│  │ Helper  │ AI      │ Analyst │ Copy    │                  │
│  │ 3.2K ↗  │ 1.8K ↗  │ 890 ↗   │ 456 ↗   │                 │
│  └─────────┴─────────┴─────────┴─────────┘                  │
└─────────────────────────────────────────────────────────────┘

Recent Conversations:
┌──────┬────────────────────────────────────────┬──────────┐
│ Agent│ Last Message                           │ Time     │
├──────┼────────────────────────────────────────┼──────────┤
│ 🤖   │ Your password reset link has been sent │ 5 min ago│
│ 💼   │ You have 12 PTO days remaining         │ 2 hrs ago│
│ 🛠️   │ Deployment to staging complete ✅      │ Yesterday│
└──────┴────────────────────────────────────────┴──────────┘
```

---

#### 2. Chat Interface

```
╔═══════════════════════════════════════════════════════════╗
║  🤖 Support Bot                              ← Back | ⋮    ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  🤖 Support Bot                                    10:45 AM  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Hi Alice! I'm here to help with technical issues.   │   │
│  │ What can I assist you with today?                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│                         You                        10:46 AM  │
│                     ┌────────────────────────────────────┐   │
│                     │ I can't log into the VPN           │   │
│                     └────────────────────────────────────┘   │
│                                                              │
│  🤖 Support Bot                                    10:46 AM  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ I can help with that. Let me check a few things:    │   │
│  │                                                      │   │
│  │ 🔍 Checking VPN status...                           │   │
│  │ ✅ VPN server is operational                         │   │
│  │ ✅ Your account is active                            │   │
│  │ ⚠️  Last failed login: 2 min ago (wrong password)   │   │
│  │                                                      │   │
│  │ Would you like me to:                               │   │
│  │ [Reset Password] [Check Network] [Contact IT]       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│                         You                        10:47 AM  │
│                     ┌────────────────────────────────────┐   │
│                     │ [Reset Password] ← clicked         │   │
│                     └────────────────────────────────────┘   │
│                                                              │
│  🤖 Support Bot                            ⏳ Typing...      │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ 📎 [Attach File]     Type a message...      [Send] [🎤]     │
└─────────────────────────────────────────────────────────────┘

Sidebar:
┌─────────────────────┐
│ Conversation Info   │
├─────────────────────┤
│ Started: Today      │
│ Messages: 4         │
│ Agent: Support Bot  │
│                     │
│ Quick Actions:      │
│ [📄 Transcript]     │
│ [⭐ Pin Chat]       │
│ [🔕 Mute]          │
│ [🗑️ Delete]         │
│                     │
│ Suggested Skills:   │
│ • 1password         │
│ • network-tools     │
│ • it-support        │
└─────────────────────┘
```

---

#### 3. Conversation History

```
╔═══════════════════════════════════════════════════════════╗
║  Conversation History                                      ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ 🔍 Search: [password reset____________]  📅 [Last 30 days ▼]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Filters: [Agent: All ▼] [Starred Only ☐] [Has Attachments ☐]│
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Today                                                        │
├─────────────────────────────────────────────────────────────┤
│ ⭐ 🤖 Support Bot - "VPN password reset"      10:45 AM      │
│    You: I can't log into the VPN                            │
│    Bot: I can help with that. Let me check...               │
│    [View Full Chat]                                          │
│                                                              │
│ 💼 HR Assistant - "PTO balance inquiry"        9:30 AM      │
│    You: How many PTO days do I have left?                   │
│    Bot: You have 12 PTO days remaining...                   │
│    [View Full Chat]                                          │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Yesterday                                                    │
├─────────────────────────────────────────────────────────────┤
│ 🛠️ Dev Helper - "Deploy to staging"           4:15 PM       │
│    You: Can you deploy the main branch?                     │
│    Bot: Deployment to staging complete ✅                    │
│    [View Full Chat]                                          │
│                                                              │
│ 💰 Sales AI - "Q4 pipeline review"            2:00 PM       │
│    You: Show me the Q4 pipeline                             │
│    Bot: Here's the breakdown... (12 messages)               │
│    [View Full Chat]                                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Export Options:
[Download All] [Download Filtered] [Delete Selected]
```

---

#### 4. User Profile & Preferences

```
╔═══════════════════════════════════════════════════════════╗
║  User Settings - alice@acme.com                            ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Profile                                                      │
├─────────────────────────────────────────────────────────────┤
│ Name:         [Alice Johnson___________]                    │
│ Email:        alice@acme.com (verified ✅)                   │
│ Role:         Developer                                      │
│ Department:   Engineering                                    │
│ Joined:       Jan 15, 2025                                   │
│                                                              │
│ [Change Password] [Enable MFA]                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Preferences                                                  │
├─────────────────────────────────────────────────────────────┤
│ Theme:               [Auto ▼] (Light/Dark/Auto)             │
│ Language:            [English ▼]                             │
│ Timezone:            [America/New_York ▼]                    │
│ Date Format:         [MM/DD/YYYY ▼]                          │
│                                                              │
│ Notifications:                                               │
│ ☑ Email me when agents mention me                           │
│ ☑ Desktop notifications for new messages                    │
│ ☐ Daily digest of activity                                  │
│                                                              │
│ Privacy:                                                     │
│ ☑ Allow conversation analytics (anonymized)                 │
│ ☐ Show me in "Active Users" list                            │
│ Data Retention: [90 days ▼] (after last message)            │
│                                                              │
│ [Save Preferences]                                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ API Access                                                   │
├─────────────────────────────────────────────────────────────┤
│ Personal API Key: ******************xyz [Copy] [Regenerate] │
│ Rate Limit: 1000 requests/hour                              │
│                                                              │
│ Documentation: [View API Docs →]                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Data Export                                                  │
├─────────────────────────────────────────────────────────────┤
│ Request your data:                                           │
│ [Download Conversations] [Download Profile Data]            │
│                                                              │
│ Last export: Never                                           │
└─────────────────────────────────────────────────────────────┘
```

---

### Mobile-First Design

#### Mobile Chat View (375px)

```
┌─────────────────┐
│ ← 🤖 Support Bot│
├─────────────────┤
│                 │
│  🤖             │
│  Hi Alice! How  │
│  can I help?    │
│  10:45 AM       │
│                 │
│          You 👤 │
│  I can't log    │
│  into VPN       │
│       10:46 AM  │
│                 │
│  🤖 ⏳ Typing... │
│                 │
├─────────────────┤
│ [📎] Message... │
│           [Send]│
└─────────────────┘
```

---

### Technical Implementation

#### Frontend Stack

```typescript
{
  framework: 'React 18 + TypeScript',
  router: 'TanStack Router',
  state: 'Zustand + React Query',
  ui: 'Tailwind CSS + shadcn/ui',
  realtime: 'WebSocket (Socket.io)',
  markdown: 'react-markdown + rehype plugins',
  codeHighlight: 'Prism.js',
  fileUpload: 'react-dropzone',
  voice: 'Web Speech API',
}
```

#### WebSocket Protocol

```typescript
// src/web/websocket-protocol.ts

// Client → Server
type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; agentId: string }
  | { type: 'message'; content: string; agentId: string }
  | { type: 'typing'; agentId: string }
  | { type: 'read'; messageId: string };

// Server → Client
type ServerMessage =
  | { type: 'authenticated'; userId: string }
  | { type: 'message'; id: string; agentId: string; content: string; timestamp: number }
  | { type: 'typing'; agentId: string; isTyping: boolean }
  | { type: 'error'; code: string; message: string }
  | { type: 'agent_status'; agentId: string; status: 'online' | 'offline' | 'busy' };

// Connection flow
const socket = io('wss://acme.openclaw.ai', {
  auth: { token: userJWT }
});

socket.on('connect', () => {
  socket.emit('subscribe', { agentId: 'support-bot' });
});

socket.on('message', (msg: ServerMessage) => {
  if (msg.type === 'message') {
    appendToChat(msg);
  }
});
```

#### API Endpoints

```typescript
// Chat API
GET    /api/web/agents                    // List available agents
GET    /api/web/agents/:id                // Get agent details
GET    /api/web/conversations             // List user's conversations
GET    /api/web/conversations/:id         // Get conversation history
POST   /api/web/conversations             // Start new conversation
POST   /api/web/conversations/:id/message // Send message
DELETE /api/web/conversations/:id         // Delete conversation
POST   /api/web/conversations/:id/star    // Star/unstar conversation

// User API
GET    /api/web/profile                   // Get user profile
PATCH  /api/web/profile                   // Update profile
POST   /api/web/profile/avatar            // Upload avatar
GET    /api/web/export                    // Export user data

// Search API
GET    /api/web/search?q=...&agent=...    // Search conversations
```

#### Authentication Flow

```typescript
// src/web/auth.ts

// SSO Integration (SAML/OIDC)
app.get('/auth/sso', (req, res) => {
  const tenant = getTenantFromSubdomain(req.hostname);
  const samlProvider = tenant.ssoConfig;
  redirectToSAML(samlProvider, res);
});

// JWT token after SSO
app.post('/auth/sso/callback', async (req, res) => {
  const user = await validateSAML(req.body);
  const jwt = generateJWT(user, { expiresIn: '8h' });
  res.cookie('auth_token', jwt, { httpOnly: true, secure: true });
  res.redirect('/chat');
});

// API auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies.auth_token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const user = verifyJWT(token);
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

---

### Progressive Enhancement

#### Voice Input/Output

```typescript
// Web Speech API integration
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  sendMessage(transcript);
};

// Start listening
function startVoiceInput() {
  recognition.start();
}

// Text-to-speech for responses
function speakResponse(text: string) {
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
}
```

#### Offline Support (PWA)

```typescript
// service-worker.ts
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Cache conversation history for offline viewing
async function cacheConversation(conversationId: string) {
  const cache = await caches.open('openclaw-v1');
  const response = await fetch(`/api/web/conversations/${conversationId}`);
  await cache.put(`/conversations/${conversationId}`, response);
}
```

---

### Accessibility Features

```typescript
// WCAG 2.1 AA Compliance
const a11yFeatures = {
  keyboardNavigation: true,     // Tab, Enter, Esc support
  screenReaderLabels: true,     // ARIA labels on all interactive elements
  highContrastMode: true,       // System preference detection
  focusIndicators: true,        // Visible focus states
  altText: true,                // Images and icons
  semanticHTML: true,           // Proper heading hierarchy
  liveRegions: true,            // Announce new messages
  reducedMotion: true,          // Respect prefers-reduced-motion
};

// Example: Announce new messages to screen readers
<div role="log" aria-live="polite" aria-atomic="false">
  {messages.map(msg => (
    <div key={msg.id} role="article" aria-label={`Message from ${msg.sender}`}>
      {msg.content}
    </div>
  ))}
</div>
```

---

### Security Features

```typescript
// CSP headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', `
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    connect-src 'self' wss://*.openclaw.ai;
    frame-ancestors 'none';
  `);
  next();
});

// XSS prevention
import DOMPurify from 'isomorphic-dompurify';

function sanitizeMessage(content: string): string {
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel']
  });
}

// Rate limiting (per user)
import rateLimit from 'express-rate-limit';

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages per minute
  message: 'Too many messages, please slow down.'
});

app.post('/api/web/conversations/:id/message', chatLimiter, handleMessage);
```

---

### Analytics & Monitoring

```typescript
// src/web/analytics.ts

interface ChatAnalytics {
  userId: string;
  agentId: string;
  messageCount: number;
  avgResponseTime: number;
  satisfactionRating?: number;
  skillsUsed: string[];
  timestamp: number;
}

// Track engagement
async function trackChatSession(session: ChatAnalytics) {
  await db.insert('chat_analytics', {
    ...session,
    tenant_id: getTenantId(session.userId)
  });
}

// Dashboard metrics
async function getChatMetrics(tenantId: string) {
  return {
    totalChats: await countChats(tenantId),
    activeUsers: await countActiveUsers(tenantId, '24h'),
    avgSessionLength: await avgSessionLength(tenantId),
    topAgents: await getTopAgents(tenantId, 10),
    satisfactionScore: await avgSatisfaction(tenantId)
  };
}
```

---

### Performance Optimizations

```typescript
// Virtual scrolling for long conversations
import { useVirtualizer } from '@tanstack/react-virtual';

function ChatMessages({ messages }) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      {rowVirtualizer.getVirtualItems().map(virtualRow => (
        <div key={virtualRow.index}>
          <Message message={messages[virtualRow.index]} />
        </div>
      ))}
    </div>
  );
}

// Lazy load conversation history
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ['conversation', conversationId],
  queryFn: ({ pageParam = 0 }) => 
    fetch(`/api/web/conversations/${conversationId}?offset=${pageParam}`),
  getNextPageParam: (lastPage) => lastPage.nextOffset,
});
```

---

### Next Steps

1. **Phase 1**: Core chat interface + WebSocket backend - 6 weeks
2. **Phase 2**: Agent directory + conversation history - 3 weeks
3. **Phase 3**: User profiles + settings - 2 weeks
4. **Phase 4**: Mobile optimization (PWA) - 2 weeks
5. **Phase 5**: Voice input/output - 1 week
6. **Phase 6**: Accessibility audit - 1 week

**Total**: ~15 weeks (4 months) with 2 frontend engineers + 1 backend engineer

---

## Developer Console

### Overview

The **Developer Console** provides advanced debugging, testing, and monitoring tools for developers building and maintaining agents, skills, and integrations.

**Access**: `https://{tenant-slug}.openclaw.ai/admin/dev` (requires `agent_developer` or `tenant_admin` role)

**Target Users**:
- Agent developers creating/debugging agents
- Skill developers testing custom skills
- DevOps engineers troubleshooting production issues
- QA engineers validating agent behavior

---

### Key Features

#### 1. Agent Debugger

```
╔═══════════════════════════════════════════════════════════╗
║  Developer Console - Agent Debugger                        ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Agent: support-bot                              [Stop Debug]│
├─────────────────────────────────────────────────────────────┤
│ Debug Session: #4521                     Status: ⏸️ Paused   │
│                                                              │
│ Breakpoints:                                                 │
│ ☑ Before tool execution                                     │
│ ☑ After LLM response                                        │
│ ☐ On skill activation                                       │
│ ☐ On error                                                  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Current State (Message #12)                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ User Input:                                                  │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ "Reset my VPN password"                              │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ → Routing Decision:                                         │
│   ✅ Matched binding: telegram:dm:user123 → support-bot     │
│   Priority: peer-level (score: 100)                         │
│                                                              │
│ → LLM Request (claude-3-5-sonnet):                          │
│   System Prompt: "You are a helpful support agent..."       │
│   Temperature: 0.7                                           │
│   Max Tokens: 4096                                           │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ Tools Available:                                     │  │
│   │ • exec (1password, tmux, network-tools)              │  │
│   │ • github (search issues, create PR)                  │  │
│   │ • jira (query tickets)                               │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│ ⏸️ PAUSED: About to call tool "exec"                        │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ {                                                    │  │
│   │   "command": "op item get 'VPN Password' --reveal", │  │
│   │   "env": { "OP_SESSION": "***" }                    │  │
│   │ }                                                    │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│   [▶️ Continue] [⏭️ Step Over] [🛑 Stop] [📋 Inspect Args]  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Call Stack                                                   │
├─────────────────────────────────────────────────────────────┤
│ 1. handleIncomingMessage(telegram, user123, "Reset...")     │
│ 2. routeToAgent("support-bot")                              │
│ 3. agent.processMessage("Reset my VPN password")            │
│ 4. llm.chat([system, user])                                 │
│ 5. → executeToolCall("exec", {...})  ← YOU ARE HERE         │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Variables                                                    │
├─────────────────────────────────────────────────────────────┤
│ agentId: "support-bot"                                       │
│ sessionKey: "agent:support-bot:telegram:default:dm:user123" │
│ messageCount: 12                                             │
│ conversationContext: [...]  [Expand JSON]                   │
│ activeSkills: ["1password", "github", "jira"]               │
│ tokenUsage: { input: 1245, output: 432, total: 1677 }      │
└─────────────────────────────────────────────────────────────┘

Timeline:
┌────────────────────────────────────────────────────────────┐
│ 10:45:12.345  Message received                            │
│ 10:45:12.367  Routing completed (22ms)                    │
│ 10:45:12.389  Session loaded (22ms)                       │
│ 10:45:12.401  System prompt generated (12ms)              │
│ 10:45:13.234  LLM response received (833ms)               │
│ 10:45:13.245  Tool call detected: exec                    │
│ 10:45:13.246  ⏸️ BREAKPOINT HIT                           │
└────────────────────────────────────────────────────────────┘
```

---

#### 2. API Playground

```
╔═══════════════════════════════════════════════════════════╗
║  API Playground                                            ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Request Builder                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Method: [POST ▼]  Endpoint: [/api/agents_______________]    │
│                                                              │
│ Headers:                                                     │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ Content-Type: application/json                       │    │
│ │ Authorization: Bearer eyJ0eXAiOiJKV1QiLC...        │    │
│ └──────────────────────────────────────────────────────┘    │
│ [+ Add Header]                                               │
│                                                              │
│ Body: [JSON ▼]                                              │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ {                                                    │    │
│ │   "name": "test-agent",                              │    │
│ │   "model": "claude-3-5-sonnet",                      │    │
│ │   "systemPrompt": "You are a helpful assistant",     │    │
│ │   "temperature": 0.7,                                │    │
│ │   "maxTokens": 4096                                  │    │
│ │ }                                                    │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ [Send Request] [Save] [Load Example]                        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Response                                            200 OK   │
├─────────────────────────────────────────────────────────────┤
│ Status: 200 OK (125ms)                                       │
│                                                              │
│ Headers:                                                     │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ Content-Type: application/json                       │    │
│ │ X-Request-Id: req_abc123                             │    │
│ │ X-RateLimit-Remaining: 998                           │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ Body:                                                        │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ {                                                    │    │
│ │   "id": "agent_xyz789",                              │    │
│ │   "name": "test-agent",                              │    │
│ │   "model": "claude-3-5-sonnet",                      │    │
│ │   "createdAt": "2026-02-01T18:45:13.246Z",           │    │
│ │   "status": "active"                                 │    │
│ │ }                                                    │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ [Copy cURL] [Copy Response] [View Documentation]            │
└─────────────────────────────────────────────────────────────┘

Saved Requests:
• POST /api/agents - Create agent
• GET /api/agents/:id - Get agent
• POST /api/conversations - Start conversation
• POST /api/conversations/:id/message - Send message
```

---

#### 3. Log Viewer

```
╔═══════════════════════════════════════════════════════════╗
║  Log Viewer                                                ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Filters:                                                     │
│ Agent: [support-bot ▼]  Level: [All ▼]  Time: [Last Hour ▼]│
│ Search: [error VPN________________]  [🔍 Search] [Clear]    │
│                                                              │
│ ☑ Info  ☑ Warning  ☑ Error  ☐ Debug  ☐ Trace              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 📊 Summary (Last Hour)                                       │
│ Total: 1,234 | Info: 1,100 | Warning: 120 | Error: 14      │
│                                                              │
│ Top Errors:                                                  │
│ • "exec command failed" (8)                                 │
│ • "Rate limit exceeded" (4)                                 │
│ • "Session not found" (2)                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Logs (Auto-refresh: ON)                    [Export] [Pause] │
├──────────┬───────┬──────────┬───────────────────────────────┤
│ Time     │ Level │ Agent    │ Message                       │
├──────────┼───────┼──────────┼───────────────────────────────┤
│ 18:45:13 │ ERROR │ support  │ exec command failed: timeout  │
│          │       │ -bot     │ sessionId: sess_abc123        │
│          │       │          │ command: op item get '...'    │
│          │       │          │ [View Full Log]               │
├──────────┼───────┼──────────┼───────────────────────────────┤
│ 18:44:32 │ WARN  │ support  │ Rate limit warning: 95%       │
│          │       │ -bot     │ user: alice@acme.com          │
│          │       │          │ [View Full Log]               │
├──────────┼───────┼──────────┼───────────────────────────────┤
│ 18:43:21 │ INFO  │ support  │ Message processed             │
│          │       │ -bot     │ duration: 1.2s, tokens: 456   │
│          │       │          │ [View Full Log]               │
└──────────┴───────┴──────────┴───────────────────────────────┘

Log Detail (sess_abc123):
┌───────────────────────────────────────────────────────────┐
│ Timestamp: 2026-02-01T18:45:13.246Z                       │
│ Level: ERROR                                              │
│ Agent: support-bot                                        │
│ Session: sess_abc123                                      │
│ User: alice@acme.com                                      │
│                                                           │
│ Message:                                                  │
│ exec command failed: timeout after 5000ms                 │
│                                                           │
│ Stack Trace:                                              │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Error: Command timeout                              │   │
│ │   at execTool (src/skills/exec.ts:45:11)            │   │
│ │   at toolExecutor (src/agent/tools.ts:123:23)       │   │
│ │   at Agent.process (src/agent/index.ts:89:18)       │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                           │
│ Context:                                                  │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ {                                                   │   │
│ │   "command": "op item get 'VPN Password' --reveal", │   │
│ │   "timeout": 5000,                                  │   │
│ │   "env": { "OP_SESSION": "***" }                    │   │
│ │ }                                                   │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                           │
│ [Download] [Copy] [Report Bug]                           │
└───────────────────────────────────────────────────────────┘
```

---

#### 4. Skill Tester

```
╔═══════════════════════════════════════════════════════════╗
║  Skill Tester                                              ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Select Skill: [1password ▼]                   [Reload Skills]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Skill Metadata:                                              │
│ Name: 1password                                              │
│ Version: 1.2.0                                               │
│ Description: Retrieve secrets from 1Password                 │
│ Permissions: exec (op command)                               │
│                                                              │
│ Test Input:                                                  │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ User Message:                                        │    │
│ │ "Get my GitHub password from 1Password"              │    │
│ │                                                      │    │
│ │ Context (Optional):                                  │    │
│ │ {                                                    │    │
│ │   "sessionKey": "agent:test:...",                    │    │
│ │   "userId": "alice@acme.com",                        │    │
│ │   "conversationHistory": []                          │    │
│ │ }                                                    │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ [Run Test] [Run in Sandbox] [Load Test Case]                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Test Results                                     ✅ PASSED   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Activation Check: ✅                                         │
│ Skill matched user message (confidence: 95%)                │
│                                                              │
│ Tool Calls:                                                  │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ 1. exec("op item get 'GitHub' --reveal")            │    │
│ │    Duration: 234ms                                   │    │
│ │    Exit Code: 0                                      │    │
│ │    Output: "password: ghp_abc123..."                 │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ LLM Response:                                                │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ "I've retrieved your GitHub password from           │    │
│ │ 1Password: ghp_abc123..."                            │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ Performance:                                                 │
│ • Total Duration: 1.2s                                      │
│ • Token Usage: 456 (input: 234, output: 222)               │
│ • Skill Overhead: 12ms                                      │
│                                                              │
│ Security Checks: ✅                                          │
│ • Command in allowlist: ✅                                   │
│ • No credential leakage: ✅                                  │
│ • Sandbox restrictions: ✅                                   │
│                                                              │
│ [Run Again] [Edit Test] [Save Test Case]                    │
└─────────────────────────────────────────────────────────────┘

Test Cases (Saved):
• "Get GitHub password" (last run: 2 min ago) ✅
• "Get AWS credentials" (last run: 1 hour ago) ✅
• "Invalid item name" (last run: yesterday) ❌ Expected
```

---

#### 5. Performance Profiler

```
╔═══════════════════════════════════════════════════════════╗
║  Performance Profiler                                      ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Agent: [support-bot ▼]  Time Range: [Last 24h ▼]  [Refresh]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Summary Metrics:                                             │
│ ┌──────────────┬──────────────┬──────────────┬──────────┐   │
│ │ Avg Latency  │ p95 Latency  │ p99 Latency  │ Errors   │   │
│ │ 1.2s         │ 3.4s         │ 5.6s         │ 2.3%     │   │
│ └──────────────┴──────────────┴──────────────┴──────────┘   │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Latency Breakdown                                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Routing:            45ms   ▓░░░░░░░░░░░░ (3.8%)            │
│ Session Load:       120ms  ▓▓▓░░░░░░░░░░ (10%)             │
│ LLM Request:        890ms  ▓▓▓▓▓▓▓▓▓▓░░░ (74%)             │
│ Tool Execution:     123ms  ▓▓░░░░░░░░░░░ (10%)             │
│ Response Format:    22ms   ▓░░░░░░░░░░░░ (1.8%)            │
│ ────────────────────────────────────────                    │
│ Total:              1,200ms                                  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Token Usage (Last 24h)                                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Total: 2.1M tokens ($42.00)                                 │
│ Input:  1.2M tokens ($12.00 @ $0.01/1K)                     │
│ Output: 900K tokens ($30.00 @ $0.03/1K)                     │
│                                                              │
│ By Agent:                                                    │
│ • support-bot:    1.2M (57%)  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░            │
│ • dev-assistant:  650K (31%)  ▓▓▓▓▓▓▓▓░░░░░░░░░            │
│ • sales-ai:       180K (9%)   ▓▓░░░░░░░░░░░░░░░            │
│ • hr-helper:      70K  (3%)   ▓░░░░░░░░░░░░░░░░            │
│                                                              │
│ Cost Optimization Suggestions:                               │
│ ⚠️ support-bot is using 74% time on LLM calls               │
│    → Consider caching common responses                      │
│ ⚠️ Session load taking 120ms average                        │
│    → Consider session store migration to Redis              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Slowest Requests (Last Hour)                                 │
├──────────┬────────┬──────────────────────────────────────────┤
│ Time     │ Dur.   │ Operation                               │
├──────────┼────────┼──────────────────────────────────────────┤
│ 18:45:13 │ 8.2s   │ support-bot: exec timeout (retried 3x)  │
│ 18:32:45 │ 6.1s   │ dev-assistant: GitHub API rate limited  │
│ 18:21:12 │ 5.9s   │ support-bot: Large context (5K tokens)  │
└──────────┴────────┴──────────────────────────────────────────┘

[Export CSV] [View Flame Graph] [Download Trace]
```

---

#### 6. WebSocket Monitor

```
╔═══════════════════════════════════════════════════════════╗
║  WebSocket Monitor                                         ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Active Connections: 45                      [Auto-refresh ☑]│
├──────────┬────────────────┬─────────┬────────┬──────────────┤
│ User     │ Connection ID  │ Agents  │ Uptime │ Messages     │
├──────────┼────────────────┼─────────┼────────┼──────────────┤
│ alice@   │ conn_abc123    │ 2       │ 1h 23m │ Sent: 45     │
│ acme.com │                │         │        │ Recv: 67     │
│          │                │         │        │ [Inspect]    │
├──────────┼────────────────┼─────────┼────────┼──────────────┤
│ bob@     │ conn_def456    │ 1       │ 12m    │ Sent: 3      │
│ acme.com │                │         │        │ Recv: 8      │
│          │                │         │        │ [Inspect]    │
└──────────┴────────────────┴─────────┴────────┴──────────────┘

Connection Details (conn_abc123):
┌───────────────────────────────────────────────────────────┐
│ User: alice@acme.com                                      │
│ Connection ID: conn_abc123                                │
│ Connected: 2026-02-01T17:22:15.123Z (1h 23m ago)          │
│ Client IP: 203.0.113.45                                   │
│ User Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X...)    │
│                                                           │
│ Subscribed Agents:                                        │
│ • support-bot                                             │
│ • dev-assistant                                           │
│                                                           │
│ Message Log (Last 10):                                    │
│ ┌─────────┬──────┬───────────────────────────────────┐    │
│ │ Time    │ Dir  │ Message                           │    │
│ ├─────────┼──────┼───────────────────────────────────┤    │
│ │ 18:45:13│ →    │ {"type":"message","content":"..."} │    │
│ │ 18:45:14│ ←    │ {"type":"message","id":"msg_123"} │    │
│ │ 18:44:32│ →    │ {"type":"typing","agentId":"..."} │    │
│ └─────────┴──────┴───────────────────────────────────┘    │
│                                                           │
│ [Disconnect] [Send Test Message] [Export Log]            │
└───────────────────────────────────────────────────────────┘
```

---

### Technical Implementation

#### Backend Services

```typescript
// src/dev-console/debugger.ts

class AgentDebugger {
  private breakpoints: Set<BreakpointType>;
  private pausedSessions: Map<string, DebugSession>;
  
  async attachToAgent(agentId: string) {
    const agent = await getAgent(agentId);
    agent.setDebugMode(true);
    
    agent.on('beforeToolCall', async (tool, args) => {
      if (this.breakpoints.has('before-tool')) {
        await this.pause(agentId, { tool, args });
      }
    });
    
    agent.on('afterLLMResponse', async (response) => {
      if (this.breakpoints.has('after-llm')) {
        await this.pause(agentId, { response });
      }
    });
  }
  
  async pause(agentId: string, state: any) {
    const session: DebugSession = {
      agentId,
      state,
      stack: this.captureCallStack(),
      variables: this.captureVariables(agentId),
      timestamp: Date.now()
    };
    
    this.pausedSessions.set(agentId, session);
    
    // Notify dev console via WebSocket
    this.broadcastToDevConsole({
      type: 'debug:paused',
      session
    });
    
    // Wait for continue/step command
    return this.waitForCommand(agentId);
  }
}
```

#### Frontend Components

```typescript
// src/dev-console/components/LogViewer.tsx

import { useQuery } from '@tanstack/react-query';
import { LogLevel } from '../types';

export function LogViewer() {
  const [filters, setFilters] = useState({
    agent: 'all',
    level: 'all',
    search: '',
    timeRange: '1h'
  });
  
  const { data: logs, isLoading } = useQuery({
    queryKey: ['logs', filters],
    queryFn: () => fetchLogs(filters),
    refetchInterval: filters.autoRefresh ? 2000 : false
  });
  
  return (
    <div className="log-viewer">
      <LogFilters filters={filters} onChange={setFilters} />
      <LogSummary logs={logs} />
      <LogTable logs={logs} onSelect={setSelectedLog} />
      {selectedLog && <LogDetail log={selectedLog} />}
    </div>
  );
}
```

---

### Security Considerations

```typescript
// Only allow developers to access debug features
app.use('/api/dev', requireRole(['agent_developer', 'tenant_admin']));

// Redact sensitive data in logs
function redactSensitiveData(log: LogEntry): LogEntry {
  const redacted = { ...log };
  const sensitivePatterns = [
    /api[_-]?key/i,
    /token/i,
    /password/i,
    /secret/i
  ];
  
  if (typeof redacted.message === 'string') {
    redacted.message = redacted.message.replace(
      /([a-zA-Z_]+[kK]ey|[tT]oken|[pP]assword)\s*[:=]\s*["']?([^"'\s]+)/g,
      '$1: ***'
    );
  }
  
  return redacted;
}

// Rate limit API playground
const playgroundLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 requests per minute
  message: 'API playground rate limit exceeded'
});
```

---

### Next Steps

1. **Phase 1**: Agent debugger + log viewer - 4 weeks
2. **Phase 2**: API playground + skill tester - 3 weeks
3. **Phase 3**: Performance profiler - 2 weeks
4. **Phase 4**: WebSocket monitor - 1 week
5. **Phase 5**: Integration testing - 1 week

**Total**: ~11 weeks (3 months) with 2 backend engineers

---

## Observability Dashboard

### Overview

The **Observability Dashboard** provides real-time monitoring, alerting, and troubleshooting capabilities for production OpenClaw deployments.

**Access**: `https://{tenant-slug}.openclaw.ai/admin/observe` (requires `agent_operator` or higher role)

**Target Users**:
- Operations teams monitoring system health
- SREs troubleshooting production issues
- DevOps engineers managing infrastructure
- Tenant admins tracking usage/costs

---

### Key Features

#### 1. System Overview Dashboard

```
╔═══════════════════════════════════════════════════════════╗
║  Observability - Production                                ║
║  Last updated: 2 seconds ago                  [Auto ☑]     ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ 🟢 System Status: Healthy                   SLA: 99.97%     │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────────┬──────────────┬──────────────┬──────────┐   │
│ │ Uptime       │ Requests/min │ Latency (p95)│ Errors   │   │
│ │ 45d 12h      │ 1,234        │ 450ms        │ 0.3%     │   │
│ └──────────────┴──────────────┴──────────────┴──────────┘   │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ 📊 Request Volume (Last 24h)                                │
├─────────────────────────────────────────────────────────────┤
│  1.5K │                                    ▄▄▄              │
│       │                              ▄▄▄▄▄███              │
│  1.0K │                        ▄▄▄▄▄▄███████              │
│       │                  ▄▄▄▄▄▄█████████████              │
│  0.5K │            ▄▄▄▄▄█████████████████████             │
│       │      ▄▄▄▄▄███████████████████████████             │
│     0 └────────────────────────────────────────           │
│       00:00   06:00   12:00   18:00   00:00              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ 🔥 Active Services                                           │
├─────────────────────────────────────────────────────────────┤
│ ✅ Gateway (3 instances)        CPU: 45%  RAM: 2.1/4GB     │
│ ✅ PostgreSQL (primary)         CPU: 32%  Disk: 45/100GB   │
│ ✅ Redis (session store)        CPU: 12%  Mem: 890MB/2GB   │
│ ✅ Telegram Bot                 Connected | 234 users       │
│ ✅ Discord Bot                  Connected | 156 users       │
│ ✅ Slack Bot                    Connected | 89 users        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ Active Alerts (2)                                         │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ HIGH: support-bot error rate 4.2% (threshold: 5%)       │
│    Duration: 12 minutes | Last fired: 2 min ago             │
│    [View Details] [Acknowledge] [Mute 1h]                   │
│                                                              │
│ ⚠️ MED: PostgreSQL disk usage 85% (threshold: 80%)         │
│    Duration: 3 days | Last fired: 5 min ago                 │
│    [View Details] [Acknowledge] [Expand Storage]            │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Navigation:
[Overview] [Services] [Agents] [Traces] [Metrics] [Alerts]
```

---

#### 2. Service Health Monitor

```
╔═══════════════════════════════════════════════════════════╗
║  Service Health                                            ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Gateway Instances                                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ gateway-1 (us-east-1a)                        ✅ Healthy│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Uptime: 15d 8h                                         │  │
│ │ CPU: ▓▓▓▓▓░░░░░ 45% (2 cores)                         │  │
│ │ RAM: ▓▓▓▓▓▓▓░░░ 2.1/4GB (52%)                         │  │
│ │ Disk: ▓▓░░░░░░░░ 12/50GB (24%)                        │  │
│ │ Network: ↓ 2.3 MB/s  ↑ 1.1 MB/s                       │  │
│ │                                                        │  │
│ │ Active Connections: 234                                │  │
│ │ Requests/min: 456                                      │  │
│ │ Latency (p95): 320ms                                   │  │
│ │ Error Rate: 0.2%                                       │  │
│ │                                                        │  │
│ │ [Logs] [Metrics] [Restart] [Scale Down]               │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ gateway-2 (us-east-1b)                        ✅ Healthy│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Uptime: 15d 8h                                         │  │
│ │ CPU: ▓▓▓▓░░░░░░ 38%  RAM: ▓▓▓▓▓▓░░░░ 1.8/4GB         │  │
│ │ Active: 189 | Req/min: 378 | p95: 280ms | Err: 0.1%  │  │
│ │ [Logs] [Metrics] [Restart] [Scale Down]               │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ gateway-3 (us-east-1c)                        ✅ Healthy│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Uptime: 2d 4h (recently scaled)                        │  │
│ │ CPU: ▓▓▓░░░░░░░ 32%  RAM: ▓▓▓▓▓░░░░░ 1.5/4GB         │  │
│ │ Active: 145 | Req/min: 289 | p95: 310ms | Err: 0.4%  │  │
│ │ [Logs] [Metrics] [Restart] [Scale Down]               │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ [+ Scale Up] [Load Balancer Config] [Auto-scaling Rules]    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Database                                                     │
├─────────────────────────────────────────────────────────────┤
│ PostgreSQL 15.3 (Primary)                         ✅ Healthy │
│ Host: db.openclaw.internal:5432                              │
│ Uptime: 45d 12h                                              │
│                                                              │
│ Performance:                                                 │
│ • Connections: 45/100 (45%)                                 │
│ • Queries/sec: 234                                          │
│ • Cache Hit Rate: 98.7%                                     │
│ • Replication Lag: 0ms                                      │
│                                                              │
│ Storage:                                                     │
│ • Disk Usage: ▓▓▓▓▓▓▓▓▓░░ 85% (85/100GB) ⚠️                 │
│ • WAL Archive: 12GB                                         │
│ • Backup Age: 6 hours ago                                   │
│                                                              │
│ Top Queries (by time):                                       │
│ 1. SELECT * FROM sessions WHERE ... (avg: 45ms, count: 1.2K)│
│ 2. INSERT INTO audit_log ... (avg: 12ms, count: 890)        │
│ 3. SELECT * FROM agents WHERE ... (avg: 8ms, count: 2.3K)   │
│                                                              │
│ [Query Analyzer] [Slow Queries] [Vacuum Status] [Backup Now]│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Redis (Session Store)                             ✅ Healthy │
├─────────────────────────────────────────────────────────────┤
│ Version: 7.2.0                                               │
│ Memory: ▓▓▓▓▓░░░░░ 890MB/2GB (44%)                         │
│ Keys: 12,345                                                 │
│ Hit Rate: 99.2%                                              │
│ Ops/sec: 1,234                                               │
│ [Flush DB] [Monitor] [Config]                               │
└─────────────────────────────────────────────────────────────┘
```

---

#### 3. Agent Performance Metrics

```
╔═══════════════════════════════════════════════════════════╗
║  Agent Metrics                                             ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Time Range: [Last 24h ▼]  Group by: [Agent ▼]  [Export CSV]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ support-bot                               ⚠️ Degraded   │  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Status: Active | Users: 234 | Messages: 12.3K         │  │
│ │                                                        │  │
│ │ Latency:                                               │  │
│ │ • p50: 850ms  • p95: 2.1s  • p99: 4.5s                │  │
│ │                                                        │  │
│ │ Error Rate: ▓▓░░░░░░░░ 4.2% ⚠️ (threshold: 5%)        │  │
│ │ Last 100 requests: ✅✅✅❌✅✅✅✅✅❌✅...                    │  │
│ │                                                        │  │
│ │ Token Usage:                                           │  │
│ │ • Input: 1.2M tokens ($12.00)                          │  │
│ │ • Output: 900K tokens ($27.00)                         │  │
│ │ • Total: $39.00 (budget: $100/day) ✅                  │  │
│ │                                                        │  │
│ │ Top Errors (Last hour):                                │  │
│ │ • "exec timeout" (8 occurrences)                       │  │
│ │ • "Rate limit exceeded" (4 occurrences)                │  │
│ │                                                        │  │
│ │ [View Logs] [Debug] [Restart] [Edit Config]           │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ dev-assistant                                 ✅ Healthy│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Status: Active | Users: 89 | Messages: 3.2K           │  │
│ │ Latency: p50: 720ms  p95: 1.8s  p99: 3.2s             │  │
│ │ Error Rate: 0.8% ✅                                    │  │
│ │ Token Usage: $18.50/day (budget: $50/day) ✅           │  │
│ │ [View Logs] [Debug] [Restart] [Edit Config]           │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Latency Heatmap (support-bot, Last 24h):
┌────────────────────────────────────────────────────────────┐
│        00  02  04  06  08  10  12  14  16  18  20  22     │
│ <500ms ░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░                     │
│ <1s    ░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░                     │
│ <2s    ░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░                     │
│ <5s    ░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓░░░░░░░░                     │
│ >5s    ░░░░░░░░░░░░░░░░▓▓▓▓░░░░░░░░░░                     │
│                                                            │
│ Legend: ░ Low  ▓ High                                      │
└────────────────────────────────────────────────────────────┘
Peak hours: 12pm-6pm EST (error rate spikes during peak)
```

---

#### 4. Distributed Tracing

```
╔═══════════════════════════════════════════════════════════╗
║  Distributed Traces                                        ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Search: [session:sess_abc123__]  Status: [All ▼]  [Search] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Recent Traces (Last 100):                                    │
│ ┌────────┬─────────┬────────┬──────────────────────────┐    │
│ │ Time   │ TraceID │ Dur.   │ Operation                │    │
│ ├────────┼─────────┼────────┼──────────────────────────┤    │
│ │ 18:45  │ abc123  │ 5.2s❌ │ support-bot: VPN reset   │    │
│ │ 18:44  │ def456  │ 1.1s✅ │ hr-helper: PTO query     │    │
│ │ 18:43  │ ghi789  │ 2.3s✅ │ dev-assistant: Deploy    │    │
│ └────────┴─────────┴────────┴──────────────────────────┘    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Trace Detail (abc123) - 5.2s total                    ❌ Error│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Timeline:                                                    │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ telegram.receiveMessage         45ms ▓░░░░░░░░░░░░░░ │    │
│ │ ├─ gateway.route                 23ms ░░░░░░░░░░░░░░ │    │
│ │ └─ session.load                  22ms ░░░░░░░░░░░░░░ │    │
│ │                                                      │    │
│ │ agent.processMessage          4.1s ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░ │    │
│ │ ├─ llm.chat                    890ms ▓▓▓░░░░░░░░░░░ │    │
│ │ └─ skill.exec                  3.2s ▓▓▓▓▓▓▓▓▓▓▓░░░ ❌│    │
│ │    └─ 1password.get "VPN..."  3.2s ▓▓▓▓▓▓▓▓▓▓▓░░░ ❌│    │
│ │       Error: Command timeout after 3000ms            │    │
│ │                                                      │    │
│ │ session.save                    120ms ▓░░░░░░░░░░░░░ │    │
│ │ telegram.sendMessage             45ms ▓░░░░░░░░░░░░░ │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ Span Details (skill.exec):                                   │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ Span ID: span_xyz123                                 │    │
│ │ Duration: 3.2s                                       │    │
│ │ Status: ERROR                                        │    │
│ │                                                      │    │
│ │ Tags:                                                │    │
│ │ • skill: "1password"                                 │    │
│ │ • command: "op item get 'VPN Password' --reveal"     │    │
│ │ • timeout: 3000                                      │    │
│ │                                                      │    │
│ │ Logs:                                                │    │
│ │ • 18:45:10.123 - Executing command                   │    │
│ │ • 18:45:13.345 - Timeout reached                     │    │
│ │ • 18:45:13.346 - Killing process (SIGTERM)           │    │
│ │ • 18:45:13.456 - Error: Command timeout              │    │
│ │                                                      │    │
│ │ Error:                                               │    │
│ │ ┌──────────────────────────────────────────────┐     │    │
│ │ │ Error: Command timeout after 3000ms          │     │    │
│ │ │   at execTool (src/skills/exec.ts:45:11)     │     │    │
│ │ │   at toolExecutor (src/agent/tools.ts:123)   │     │    │
│ │ │   at Agent.process (src/agent/index.ts:89)   │     │    │
│ │ └──────────────────────────────────────────────┘     │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                              │
│ [Export Trace] [View Related] [Create Alert]                │
└─────────────────────────────────────────────────────────────┘
```

---

#### 5. Alerts Configuration

```
╔═══════════════════════════════════════════════════════════╗
║  Alert Rules                                               ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ [+ Create Alert Rule]                        [Import Rules] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Active Rules (12):                                           │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ ⚠️ HIGH: Agent Error Rate                      [Edit] [×]│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Condition: error_rate > 5% for 5 minutes               │  │
│ │ Scope: All agents                                      │  │
│ │ Actions:                                               │  │
│ │ • PagerDuty: oncall-team                               │  │
│ │ • Slack: #alerts                                       │  │
│ │ • Email: ops@acme.com                                  │  │
│ │                                                        │  │
│ │ Status: ✅ OK (last fired: 2 days ago)                 │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ ⚠️ MED: High Latency                           [Edit] [×]│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Condition: p95_latency > 3s for 10 minutes             │  │
│ │ Scope: support-bot                                     │  │
│ │ Actions: Slack: #ops                                   │  │
│ │ Status: ✅ OK                                           │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ ⚠️ CRIT: Database Disk Full                    [Edit] [×]│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Condition: disk_usage > 90%                            │  │
│ │ Scope: PostgreSQL                                      │  │
│ │ Actions: PagerDuty + Email + Slack                     │  │
│ │ Status: 🔔 FIRING (85% disk, approaching threshold)    │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ ℹ️ INFO: Daily Usage Report                    [Edit] [×]│  │
│ ├────────────────────────────────────────────────────────┤  │
│ │ Condition: daily @ 9:00 AM                             │  │
│ │ Actions: Email: team@acme.com                          │  │
│ │ Status: ✅ OK (last sent: 12 hours ago)                │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Create Alert Rule:
┌───────────────────────────────────────────────────────────┐
│ Name: [High Token Usage________________________]          │
│ Severity: [WARNING ▼]                                     │
│                                                           │
│ Condition:                                                │
│ metric: [token_usage ▼]                                   │
│ operator: [> ▼]                                           │
│ threshold: [1000000_] (tokens/day)                        │
│ duration: [15__] minutes                                  │
│                                                           │
│ Scope:                                                    │
│ ☑ All agents                                              │
│ ☐ Specific agent: [_________]                             │
│                                                           │
│ Actions:                                                  │
│ ☑ Slack notification: [#alerts_____] ▼                   │
│ ☑ Email: [ops@acme.com__________]                        │
│ ☐ PagerDuty                                               │
│ ☐ Webhook: [https://___________]                         │
│                                                           │
│ [Cancel] [Create Alert]                                   │
└───────────────────────────────────────────────────────────┘
```

---

#### 6. Custom Dashboards

```
╔═══════════════════════════════════════════════════════════╗
║  Custom Dashboard Builder                                  ║
╚═══════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────┐
│ Dashboard: Executive Summary              [Edit] [Share] [⚙]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌─────────────────────┬─────────────────────┐               │
│ │ Total Users         │ Active Conversations│               │
│ │ 489 (+12% vs y'day) │ 234 (Live)          │               │
│ └─────────────────────┴─────────────────────┘               │
│                                                              │
│ ┌───────────────────────────────────────────┐               │
│ │ Daily Token Usage Trend                   │               │
│ │ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ │               │
│ │                                           │               │
│ └───────────────────────────────────────────┘               │
│                                                              │
│ ┌──────────────────┬──────────────────────┐                 │
│ │ Top Agents       │ Cost This Month      │                 │
│ │ 1. support-bot   │ $1,234 / $5,000      │                 │
│ │ 2. dev-assist    │ ▓▓▓▓░░░░░░ 24%       │                 │
│ │ 3. sales-ai      │                      │                 │
│ └──────────────────┴──────────────────────┘                 │
│                                                              │
│ [+ Add Widget] [Rearrange] [Export PDF]                     │
└─────────────────────────────────────────────────────────────┘

Available Widgets:
• Line Chart (time series)
• Bar Chart (comparisons)
• Pie Chart (distributions)
• Gauge (single metric)
• Table (data grid)
• Heatmap (patterns)
• Counter (single number)
• Status Indicator
```

---

### Technical Implementation

#### OpenTelemetry Integration

```typescript
// src/observability/otel.ts

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

const sdk = new NodeSDK({
  traceExporter: new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT
  }),
  metricReader: new PrometheusExporter({
    port: 9090,
    endpoint: '/metrics'
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-pg': { enabled: true },
      '@opentelemetry/instrumentation-redis': { enabled: true },
    })
  ]
});

sdk.start();

// Custom spans for agent operations
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('openclaw-agent');

async function processMessage(message: string) {
  const span = tracer.startSpan('agent.processMessage', {
    attributes: {
      'agent.id': this.id,
      'message.length': message.length,
      'session.key': this.sessionKey
    }
  });
  
  try {
    const result = await this._process(message);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
```

#### Metrics Collection

```typescript
// src/observability/metrics.ts

import { Counter, Histogram, Gauge } from 'prom-client';

export const metrics = {
  // Counters
  messagesProcessed: new Counter({
    name: 'openclaw_messages_total',
    help: 'Total messages processed',
    labelNames: ['agent', 'channel', 'status']
  }),
  
  tokensUsed: new Counter({
    name: 'openclaw_tokens_total',
    help: 'Total tokens used',
    labelNames: ['agent', 'model', 'type'] // type: input/output
  }),
  
  // Histograms
  latency: new Histogram({
    name: 'openclaw_latency_seconds',
    help: 'Request latency',
    labelNames: ['agent', 'operation'],
    buckets: [0.1, 0.5, 1, 2, 5, 10]
  }),
  
  // Gauges
  activeConnections: new Gauge({
    name: 'openclaw_active_connections',
    help: 'Active WebSocket connections',
    labelNames: ['gateway']
  })
};

// Usage
metrics.messagesProcessed.inc({ agent: 'support-bot', channel: 'telegram', status: 'success' });
metrics.tokensUsed.inc({ agent: 'support-bot', model: 'claude-3-5-sonnet', type: 'input' }, 1234);
metrics.latency.observe({ agent: 'support-bot', operation: 'llm_call' }, 0.89);
```

#### Alert Manager

```typescript
// src/observability/alerts.ts

interface AlertRule {
  id: string;
  name: string;
  severity: 'info' | 'warning' | 'critical';
  condition: {
    metric: string;
    operator: '>' | '<' | '==' | '>=';
    threshold: number;
    duration: number; // seconds
  };
  actions: AlertAction[];
}

interface AlertAction {
  type: 'slack' | 'email' | 'pagerduty' | 'webhook';
  config: any;
}

class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private state: Map<string, AlertState> = new Map();
  
  async evaluateRules() {
    for (const rule of this.rules.values()) {
      const currentValue = await this.queryMetric(rule.condition.metric);
      const isTriggered = this.evaluate(currentValue, rule.condition);
      
      const state = this.state.get(rule.id) || { firing: false, since: null };
      
      if (isTriggered && !state.firing) {
        // Alert started firing
        state.firing = true;
        state.since = Date.now();
        this.state.set(rule.id, state);
      } else if (isTriggered && state.firing) {
        // Alert still firing, check duration
        const duration = (Date.now() - state.since!) / 1000;
        if (duration >= rule.condition.duration) {
          await this.fireAlert(rule);
        }
      } else if (!isTriggered && state.firing) {
        // Alert resolved
        state.firing = false;
        state.since = null;
        await this.resolveAlert(rule);
      }
    }
  }
  
  private async fireAlert(rule: AlertRule) {
    for (const action of rule.actions) {
      switch (action.type) {
        case 'slack':
          await this.sendSlackAlert(rule, action.config);
          break;
        case 'email':
          await this.sendEmailAlert(rule, action.config);
          break;
        case 'pagerduty':
          await this.sendPagerDutyAlert(rule, action.config);
          break;
      }
    }
  }
}
```

---

### Next Steps

1. **Phase 1**: OpenTelemetry integration + metrics - 3 weeks
2. **Phase 2**: System overview + service health dashboards - 2 weeks
3. **Phase 3**: Distributed tracing viewer - 2 weeks
4. **Phase 4**: Alert manager + notifications - 2 weeks
5. **Phase 5**: Custom dashboard builder - 2 weeks

**Total**: ~11 weeks (3 months) with 2 backend engineers

---

### Request Flow with Tenant Isolation

```mermaid
sequenceDiagram
    participant User as User<br/>admin@acme.com
    participant LB as Load Balancer
    participant GW as Gateway Instance
    participant Auth as Auth Service
    participant RBAC as RBAC Engine
    participant PG as PostgreSQL<br/>(with RLS)
    participant Redis as Redis<br/>(Session Store)
    participant Audit as Audit Logger
    
    User->>LB: POST /api/agents<br/>Host: acme.openclaw.ai<br/>Authorization: Bearer JWT
    LB->>GW: Route to Gateway Instance
    
    Note over GW: Extract tenant from subdomain<br/>"acme" → tenant_id
    
    GW->>Auth: Validate JWT token
    Auth-->>GW: User ID + Tenant ID
    
    Note over GW: Check tenant membership
    GW->>PG: SELECT tenant_users<br/>WHERE user_id = ? AND tenant_id = ?
    PG-->>GW: Membership confirmed
    
    GW->>RBAC: checkPermission(user, AGENT_CREATE, tenant)
    RBAC->>PG: SELECT roles FROM tenant_users
    PG-->>RBAC: roles: [tenant_admin]
    RBAC-->>GW: Permission granted
    
    Note over GW: Set RLS context
    GW->>PG: SET app.current_tenant_id = 'acme-tenant-id'
    
    GW->>PG: INSERT INTO agents<br/>(tenant_id, name, model)<br/>VALUES (?, ?, ?)
    
    Note over PG: RLS automatically enforces<br/>tenant isolation
    
    PG-->>GW: Agent created
    
    GW->>Audit: Log AGENT_CREATED event
    Audit->>PG: INSERT INTO audit_log
    
    GW->>Redis: Cache agent metadata
    
    GW-->>User: 201 Created<br/>{agent_id, name, ...}
    
    Note over Audit,PG: All queries filtered by tenant_id<br/>Cross-tenant access impossible
```

### Multi-Tenant Data Model

```mermaid
erDiagram
    TENANTS ||--o{ TENANT_USERS : "has members"
    TENANTS ||--o{ AGENTS : "owns"
    TENANTS ||--o{ SESSIONS : "owns"
    TENANTS ||--o{ AUDIT_LOG : "tracks activity"
    TENANTS ||--o{ USAGE_RECORDS : "billing"
    
    USERS ||--o{ TENANT_USERS : "belongs to"
    USERS ||--o{ SESSIONS : "creates"
    
    AGENTS ||--o{ SESSIONS : "handles"
    AGENTS ||--o{ AGENT_BINDINGS : "routes via"
    
    TENANTS {
        uuid id PK
        string name
        string slug UK "subdomain"
        string plan "free/pro/enterprise"
        jsonb settings
        timestamp created_at
    }
    
    USERS {
        uuid id PK
        string email UK
        string password_hash
        array platform_roles "platform admin only"
        timestamp created_at
    }
    
    TENANT_USERS {
        uuid tenant_id FK
        uuid user_id FK
        array roles "tenant_owner, tenant_admin, etc"
        boolean is_active
    }
    
    AGENTS {
        uuid id PK
        uuid tenant_id FK "isolation key"
        string name
        string slug
        string model
        jsonb config
    }
    
    SESSIONS {
        uuid id PK
        uuid tenant_id FK "isolation key"
        uuid agent_id FK
        uuid user_id FK
        string session_key
        timestamp last_message_at
    }
    
    AGENT_BINDINGS {
        uuid id PK
        uuid tenant_id FK "isolation key"
        uuid agent_id FK
        string channel
        string peer_id
    }
    
    AUDIT_LOG {
        uuid id PK
        uuid tenant_id FK "isolation key"
        timestamp timestamp
        string event_type
        jsonb actor
        jsonb resource
    }
    
    USAGE_RECORDS {
        uuid id PK
        uuid tenant_id FK
        string resource_type "tokens/messages"
        integer quantity
        timestamp recorded_at
    }
```

### Security & Isolation Layers

```mermaid
graph TB
    subgraph "Layer 1: Network Security"
        DDoS[DDoS Protection<br/>Cloudflare]
        WAF[Web Application Firewall<br/>OWASP Rules]
        SSL[TLS 1.3 Encryption<br/>Certificate Management]
    end
    
    subgraph "Layer 2: Authentication"
        JWT[JWT Token Validation<br/>RS256 Signature]
        SSO[SSO/SAML Integration<br/>Okta/Azure AD]
        MFA[Multi-Factor Auth<br/>TOTP/SMS]
    end
    
    subgraph "Layer 3: Authorization (RBAC)"
        TenantCheck[Tenant Membership Check<br/>tenant_users table]
        PermCheck[Permission Verification<br/>Role → Permissions]
        RateLimit[Rate Limiting<br/>Per-user/tenant/skill]
    end
    
    subgraph "Layer 4: Data Isolation"
        RLS[PostgreSQL RLS<br/>Row-Level Security]
        TenantCtx[Session Variable<br/>app.current_tenant_id]
        QueryFilter[Automatic Query Filtering<br/>WHERE tenant_id = ?]
    end
    
    subgraph "Layer 5: Encryption"
        AtRest[Encryption at Rest<br/>AES-256-GCM]
        InTransit[Encryption in Transit<br/>TLS 1.3]
        KeyMgmt[Key Management<br/>System Keychain/Vault]
    end
    
    subgraph "Layer 6: Audit & Monitoring"
        AuditLog[Immutable Audit Log<br/>All actions tracked]
        SIEM[SIEM Integration<br/>Splunk/Elasticsearch]
        Alerts[Real-time Alerts<br/>Suspicious activity]
    end
    
    DDoS --> WAF
    WAF --> SSL
    SSL --> JWT
    JWT --> SSO
    SSO --> MFA
    MFA --> TenantCheck
    TenantCheck --> PermCheck
    PermCheck --> RateLimit
    RateLimit --> RLS
    RLS --> TenantCtx
    TenantCtx --> QueryFilter
    QueryFilter --> AtRest
    AtRest --> InTransit
    InTransit --> KeyMgmt
    KeyMgmt --> AuditLog
    AuditLog --> SIEM
    SIEM --> Alerts
    
    style DDoS fill:#ff5252
    style JWT fill:#9c27b0
    style RLS fill:#4caf50
    style AtRest fill:#2196f3
    style AuditLog fill:#ff9800
```

---

## Overview

This roadmap transforms OpenClaw from a developer/team tool into an enterprise-grade platform suitable for Fortune 500 companies and regulated industries.

**Timeline**: 6 months (24 weeks)
**Team Size**: 3-4 engineers + 1 security specialist
**Estimated Cost**: $400K-$600K (salaries + infrastructure + audits)

---

## Zero Trust Security Architecture

### Core Zero Trust Principles

OpenClaw's enterprise deployment implements **Zero Trust Architecture (ZTA)** based on NIST SP 800-207:

1. **Never Trust, Always Verify**: Every request is authenticated and authorized, regardless of source
2. **Least Privilege Access**: Users/services get minimum permissions needed
3. **Assume Breach**: Design assumes attackers may already be inside the network
4. **Verify Explicitly**: Continuous validation of identity, device, and context
5. **Micro-Segmentation**: Isolate tenants and services at network + application layers

### Tenant Isolation - Defense in Depth

**Multi-Layer Isolation Strategy**:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Network Segmentation (VPC/Subnets)                 │
│  - Each tenant in logical network partition                 │
│  - Private subnets for databases                            │
│  - Security groups: deny-by-default                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Mutual TLS (mTLS) for Service Communication        │
│  - Gateway ↔ Database: client certificate required          │
│  - Gateway ↔ Redis: TLS with auth token                     │
│  - Gateway ↔ Gateway: mTLS with tenant context              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Application-Level Authentication                   │
│  - JWT token with tenant_id claim                           │
│  - Token validated on EVERY request                         │
│  - Short-lived tokens (15 min) + refresh tokens             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Tenant Membership Verification                     │
│  - Check user belongs to tenant (tenant_users table)        │
│  - Verify tenant is active (not suspended)                  │
│  - Check tenant quota not exceeded                          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: RBAC Permission Check                              │
│  - Verify user has required permission within tenant        │
│  - Role-based + attribute-based checks                      │
│  - Deny by default, explicit grants only                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 6: PostgreSQL Row-Level Security (RLS)                │
│  - Database enforces tenant_id filtering                    │
│  - Automatic query rewriting                                │
│  - Impossible to bypass (enforced at kernel level)          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 7: Encryption (Data at Rest + In Transit)             │
│  - TLS 1.3 for all network traffic                          │
│  - AES-256-GCM for stored credentials                       │
│  - Database encryption (transparent data encryption)        │
└─────────────────────────────────────────────────────────────┘
```

### Tenant-to-Tenant Communication: **PROHIBITED**

**Zero Trust Principle**: Tenants are **completely isolated** with no direct communication.

```typescript
// src/tenancy/isolation.ts

/**
 * Tenant isolation firewall - prevents cross-tenant access
 */
class TenantIsolationFirewall {
  /**
   * Verify no cross-tenant data access
   */
  async validateTenantBoundary(req: Request, resourceTenantId: string) {
    const requestTenantId = rbac.getCurrentTenant(req);
    
    if (resourceTenantId !== requestTenantId) {
      // Log suspicious activity
      await auditLog.log({
        type: AuditEventType.UNAUTHORIZED_ACCESS,
        actor: { userId: req.user?.id, ip: req.ip },
        resource: { type: 'tenant', id: resourceTenantId },
        action: 'cross-tenant-access-attempt',
        outcome: 'denied',
        metadata: {
          requestTenantId,
          resourceTenantId,
          severity: 'CRITICAL'
        }
      });
      
      // Alert security team
      await this.alertSecurityTeam({
        event: 'CROSS_TENANT_ACCESS_ATTEMPT',
        userId: req.user?.id,
        requestTenantId,
        resourceTenantId,
        timestamp: new Date()
      });
      
      throw new ForbiddenError('Cross-tenant access denied');
    }
  }
  
  /**
   * For rare cases where tenants need to share data (marketplace, etc.)
   * Use explicit, audited, time-limited sharing grants
   */
  async requestCrossTenantAccess(params: {
    fromTenantId: string;
    toTenantId: string;
    resourceType: string;
    resourceId: string;
    requestedBy: string;
    purpose: string;
    duration: number; // milliseconds
  }): Promise<{ grantId: string; expiresAt: Date }> {
    // Require approval from BOTH tenants
    const approval = await this.createAccessGrant({
      ...params,
      status: 'PENDING_APPROVAL',
      requiresApproval: [
        { tenantId: params.fromTenantId, role: 'tenant_owner' },
        { tenantId: params.toTenantId, role: 'tenant_owner' }
      ]
    });
    
    await auditLog.log({
      type: 'CROSS_TENANT_ACCESS_REQUESTED',
      actor: { userId: params.requestedBy },
      resource: { type: params.resourceType, id: params.resourceId },
      outcome: 'pending',
      metadata: params
    });
    
    return {
      grantId: approval.id,
      expiresAt: new Date(Date.now() + params.duration)
    };
  }
}

// Middleware: Automatic tenant boundary validation
app.use(async (req, res, next) => {
  // Set tenant context early
  const tenantId = rbac.getCurrentTenant(req);
  
  // PostgreSQL RLS context (forces tenant filtering)
  await pool.query('SET app.current_tenant_id = $1', [tenantId]);
  
  // Lock: Prevent changing tenant mid-request
  Object.defineProperty(req, 'tenantId', {
    value: tenantId,
    writable: false,
    configurable: false
  });
  
  next();
});
```

### Service-to-Service Authentication (mTLS)

**Problem**: Internal services (gateway, worker, scheduler) need secure communication

**Solution**: Mutual TLS with service identity certificates

```typescript
// src/security/mtls.ts
import { readFileSync } from 'fs';
import https from 'https';
import { Agent } from 'https';

/**
 * mTLS configuration for internal services
 */
class ServiceMesh {
  private httpsAgent: Agent;
  
  constructor(serviceId: string) {
    // Each service has its own certificate
    const certPath = `/etc/openclaw/certs/${serviceId}`;
    
    this.httpsAgent = new Agent({
      cert: readFileSync(`${certPath}/client.crt`),
      key: readFileSync(`${certPath}/client.key`),
      ca: readFileSync(`${certPath}/ca.crt`),
      rejectUnauthorized: true, // Always verify peer
      checkServerIdentity: (host, cert) => {
        // Verify service identity from certificate
        const allowedServices = [
          'openclaw-gateway',
          'openclaw-worker',
          'openclaw-scheduler'
        ];
        
        const certService = cert.subject.CN;
        if (!allowedServices.includes(certService)) {
          throw new Error(`Untrusted service: ${certService}`);
        }
      }
    });
  }
  
  /**
   * Call another service with mTLS + tenant context propagation
   */
  async callService(url: string, options: {
    method: string;
    body?: any;
    tenantId: string; // Always propagate tenant context
  }) {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': options.tenantId,       // Tenant context
        'X-Service-ID': 'openclaw-gateway',    // Caller identity
        'X-Request-ID': randomUUID(),          // Trace correlation
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      // @ts-ignore - agent for mTLS
      agent: this.httpsAgent
    });
    
    if (!response.ok) {
      throw new Error(`Service call failed: ${response.status}`);
    }
    
    return response.json();
  }
}

// Gateway → Worker communication (e.g., long-running skill execution)
const serviceMesh = new ServiceMesh('openclaw-gateway');

async function offloadSkillExecution(tenantId: string, skillName: string, params: any) {
  // Worker validates tenant context from header
  return await serviceMesh.callService('https://worker.internal:8443/execute', {
    method: 'POST',
    tenantId, // Propagate tenant context
    body: { skillName, params }
  });
}
```

### Network Segmentation (VPC Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                     Public Internet                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ DMZ / Edge Network (Public Subnet)                           │
│  - Cloudflare Tunnel / ALB                                   │
│  - WAF + DDoS Protection                                     │
│  - Rate Limiting                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Application Network (Private Subnet 10.0.10.0/24)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │Gateway 1 │  │Gateway 2 │  │Gateway 3 │                  │
│  │10.0.10.11│  │10.0.10.12│  │10.0.10.13│                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│                                                              │
│  Security Group: gateway-sg                                  │
│   - Inbound: 443 from ALB only                              │
│   - Outbound: 5432 to db-sg, 6379 to redis-sg              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Data Network (Private Subnet 10.0.20.0/24)                   │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ PostgreSQL   │         │ Redis Cluster│                 │
│  │ 10.0.20.10   │         │ 10.0.20.20-22│                 │
│  └──────────────┘         └──────────────┘                 │
│                                                              │
│  Security Group: db-sg                                       │
│   - Inbound: 5432 from gateway-sg only (mTLS required)     │
│   - Outbound: DENY ALL                                      │
│                                                              │
│  Security Group: redis-sg                                    │
│   - Inbound: 6379 from gateway-sg only (TLS + password)    │
│   - Outbound: DENY ALL                                      │
└─────────────────────────────────────────────────────────────┘

Network ACLs (Defense in Depth):
- Block all cross-subnet traffic by default
- Explicit allow rules for gateway → database
- Deny tenant-to-tenant communication at network layer
```

### Continuous Verification (Runtime Checks)

```typescript
// src/security/runtime-verification.ts

/**
 * Continuous security verification during request processing
 */
class RuntimeSecurityMonitor {
  /**
   * Verify every database query respects tenant isolation
   */
  async auditQuery(sql: string, params: any[], tenantId: string) {
    // Ensure RLS is enabled
    const rlsStatus = await pool.query(`
      SELECT COUNT(*) as tables_without_rls
      FROM pg_tables t
      LEFT JOIN pg_class c ON c.relname = t.tablename
      WHERE t.schemaname = 'public'
        AND t.tablename IN ('agents', 'sessions', 'agent_bindings')
        AND NOT c.relrowsecurity
    `);
    
    if (rlsStatus.rows[0].tables_without_rls > 0) {
      throw new SecurityError('RLS not enabled on critical tables');
    }
    
    // Verify session variable is set
    const currentTenant = await pool.query('SELECT current_setting($1, true)', [
      'app.current_tenant_id'
    ]);
    
    if (!currentTenant.rows[0].current_setting) {
      throw new SecurityError('Tenant context not set');
    }
    
    if (currentTenant.rows[0].current_setting !== tenantId) {
      throw new SecurityError('Tenant context mismatch');
    }
  }
  
  /**
   * Detect anomalous behavior (potential breach)
   */
  async detectAnomalies(userId: string, tenantId: string) {
    // Check for suspicious patterns
    const recentFailures = await pool.query(`
      SELECT COUNT(*) as failures
      FROM audit_log
      WHERE actor->>'userId' = $1
        AND outcome = 'failure'
        AND timestamp > NOW() - INTERVAL '5 minutes'
    `, [userId]);
    
    if (recentFailures.rows[0].failures > 10) {
      // Lock account temporarily
      await this.lockAccount(userId, '15 minutes');
      
      await auditLog.log({
        type: AuditEventType.SUSPICIOUS_ACTIVITY,
        actor: { userId },
        resource: { type: 'user', id: userId },
        action: 'account_locked',
        outcome: 'success',
        metadata: {
          reason: 'excessive_failures',
          failureCount: recentFailures.rows[0].failures
        }
      });
      
      throw new SecurityError('Account temporarily locked due to suspicious activity');
    }
  }
}

// Apply to all requests
app.use(async (req, res, next) => {
  try {
    await runtimeMonitor.detectAnomalies(req.user?.id, req.tenantId);
    next();
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});
```

### Zero Trust Checklist

✅ **Authentication**
- [x] JWT tokens with short expiry (15 min)
- [x] Refresh tokens with rotation
- [x] MFA required for admin roles
- [x] SSO/SAML integration for enterprises
- [x] Device fingerprinting

✅ **Authorization**
- [x] RBAC with least privilege
- [x] Tenant membership verified on every request
- [x] Permission checks before any action
- [x] Deny-by-default policies
- [x] Time-based access expiration

✅ **Network Security**
- [x] mTLS for service-to-service communication
- [x] VPC segmentation (DMZ, app, data layers)
- [x] Security groups: deny-by-default
- [x] No direct internet access to databases
- [x] Private subnets for data layer

✅ **Data Isolation**
- [x] PostgreSQL Row-Level Security (RLS)
- [x] Tenant context in every query
- [x] Impossible to access cross-tenant data
- [x] Runtime verification of tenant boundaries
- [x] Audit log for all data access

✅ **Encryption**
- [x] TLS 1.3 for all external traffic
- [x] mTLS for internal services
- [x] AES-256-GCM for data at rest
- [x] Key management via system keychain / Vault
- [x] Encrypted backups

✅ **Monitoring**
- [x] Real-time anomaly detection
- [x] Account lockout on suspicious activity
- [x] Audit log for all actions
- [x] SIEM integration (Splunk/Elasticsearch)
- [x] Alerting for cross-tenant access attempts

---

## Phase 1: Security Hardening (Weeks 1-8)

### A. Encryption at Rest ✅ CRITICAL

**Problem**: Credentials and sessions currently stored in plaintext at `~/.clawdbot/`

**Solution**: AES-256-GCM encryption using system keychain

**Implementation**:
```typescript
// src/security/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

class CredentialStore {
  private async getMasterKey(): Promise<Buffer> {
    if (platform() === 'darwin') {
      // macOS Keychain
      const key = await exec('security find-generic-password -s openclaw -w');
      return Buffer.from(key, 'hex');
    } else if (platform() === 'linux') {
      // Linux libsecret/SecretService
      const { SecretService } = await import('secret-service');
      const secret = new SecretService();
      return await secret.get('openclaw', 'master-key');
    } else if (platform() === 'win32') {
      // Windows Credential Manager
      const { CredentialManager } = await import('node-credential-manager');
      const cred = await CredentialManager.getCredential('openclaw');
      return Buffer.from(cred.password, 'hex');
    }
  }

  async encryptCredential(plaintext: string): Promise<string> {
    const masterKey = await this.getMasterKey();
    const key = scryptSync(masterKey, 'salt', 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      iv: iv.toString('hex'),
      encrypted: encrypted.toString('hex'),
      authTag: authTag.toString('hex')
    });
  }

  async decryptCredential(ciphertext: string): Promise<string> {
    const { iv, encrypted, authTag } = JSON.parse(ciphertext);
    const masterKey = await this.getMasterKey();
    const key = scryptSync(masterKey, 'salt', 32);
    
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }
}

// Migration script
async function migrateCredentials() {
  const credDir = path.join(os.homedir(), '.clawdbot', 'credentials');
  const store = new CredentialStore();
  
  for (const file of await fs.readdir(credDir)) {
    const plaintext = await fs.readFile(path.join(credDir, file), 'utf8');
    const encrypted = await store.encryptCredential(plaintext);
    await fs.writeFile(path.join(credDir, file + '.enc'), encrypted);
    await fs.unlink(path.join(credDir, file)); // Delete plaintext
  }
}
```

**Testing**:
- Unit tests for encrypt/decrypt round-trip
- Test key retrieval on all platforms (macOS, Linux, Windows)
- Performance test: encrypt/decrypt 1000 credentials <100ms each
- Security review: ensure no keys logged or exposed

**Timeline**: 1-2 weeks
**Risk**: Low (standard crypto)

---

### B. Multi-Tenant Role-Based Access Control (RBAC) ✅ CRITICAL

**Problem**: No user authentication, authorization, or tenant isolation

**Solution**: Organization-scoped multi-tenant RBAC with data isolation

**Multi-Tenant Architecture**:
```
Platform Level (OpenClaw SaaS)
├── Tenant: Acme Corp
│   ├── Users (100 employees)
│   ├── Agents (support, dev, qa)
│   ├── Sessions (isolated data)
│   └── Billing/Quotas
├── Tenant: TechStartup Inc
│   ├── Users (20 employees)
│   ├── Agents (main, research)
│   ├── Sessions (isolated data)
│   └── Billing/Quotas
└── Platform Admins (OpenClaw operators)
```

**Data Model**:
```typescript
// src/rbac/types.ts

// Platform-level roles (OpenClaw operators only)
enum PlatformRole {
  PLATFORM_ADMIN = 'platform_admin',     // Full platform access
  PLATFORM_OPERATOR = 'platform_operator', // View all tenants, limited changes
  PLATFORM_SUPPORT = 'platform_support'    // Read-only access for support tickets
}

// Organization/Tenant-level roles (scoped to one company)
enum TenantRole {
  TENANT_OWNER = 'tenant_owner',         // Company owner (billing, delete tenant)
  TENANT_ADMIN = 'tenant_admin',         // Manage users, agents, settings
  AGENT_DEVELOPER = 'agent_developer',   // Create/edit agents and skills
  AGENT_OPERATOR = 'agent_operator',     // Start/stop agents, view logs
  USER = 'user',                         // Send messages to agents
  VIEWER = 'viewer'                      // Read-only access to sessions/logs
}

enum Permission {
  // Platform permissions (OpenClaw operators only)
  PLATFORM_TENANT_CREATE = 'platform:tenant:create',
  PLATFORM_TENANT_DELETE = 'platform:tenant:delete',
  PLATFORM_TENANT_VIEW_ALL = 'platform:tenant:view_all',
  PLATFORM_USER_IMPERSONATE = 'platform:user:impersonate',
  
  // Tenant-level permissions (scoped to organization)
  TENANT_SETTINGS_UPDATE = 'tenant:settings:update',
  TENANT_BILLING_VIEW = 'tenant:billing:view',
  TENANT_BILLING_UPDATE = 'tenant:billing:update',
  TENANT_DELETE = 'tenant:delete',
  
  // User management (within tenant)
  TENANT_USER_INVITE = 'tenant:user:invite',
  TENANT_USER_REMOVE = 'tenant:user:remove',
  TENANT_USER_ROLE_ASSIGN = 'tenant:user:role:assign',
  
  // Agent permissions (within tenant)
  AGENT_CREATE = 'agent:create',
  AGENT_UPDATE = 'agent:update',
  AGENT_DELETE = 'agent:delete',
  AGENT_VIEW = 'agent:view',
  AGENT_START = 'agent:start',
  AGENT_STOP = 'agent:stop',
  
  // Skill permissions (within tenant)
  SKILL_INSTALL = 'skill:install',
  SKILL_UNINSTALL = 'skill:uninstall',
  SKILL_CONFIGURE = 'skill:configure',
  
  // Session permissions (within tenant)
  SESSION_VIEW = 'session:view',
  SESSION_VIEW_ALL = 'session:view_all',      // View all tenant sessions
  SESSION_DELETE = 'session:delete',
  SESSION_EXPORT = 'session:export',
  
  // Audit permissions (within tenant)
  AUDIT_VIEW = 'audit:view'
}

const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, Permission[]> = {
  [PlatformRole.PLATFORM_ADMIN]: [
    Permission.PLATFORM_TENANT_CREATE,
    Permission.PLATFORM_TENANT_DELETE,
    Permission.PLATFORM_TENANT_VIEW_ALL,
    Permission.PLATFORM_USER_IMPERSONATE
  ],
  [PlatformRole.PLATFORM_OPERATOR]: [
    Permission.PLATFORM_TENANT_VIEW_ALL
  ],
  [PlatformRole.PLATFORM_SUPPORT]: [
    Permission.PLATFORM_TENANT_VIEW_ALL
  ]
};

const TENANT_ROLE_PERMISSIONS: Record<TenantRole, Permission[]> = {
  [TenantRole.TENANT_OWNER]: [
    // Full tenant control
    Permission.TENANT_SETTINGS_UPDATE,
    Permission.TENANT_BILLING_VIEW,
    Permission.TENANT_BILLING_UPDATE,
    Permission.TENANT_DELETE,
    Permission.TENANT_USER_INVITE,
    Permission.TENANT_USER_REMOVE,
    Permission.TENANT_USER_ROLE_ASSIGN,
    Permission.AGENT_CREATE,
    Permission.AGENT_UPDATE,
    Permission.AGENT_DELETE,
    Permission.AGENT_VIEW,
    Permission.AGENT_START,
    Permission.AGENT_STOP,
    Permission.SKILL_INSTALL,
    Permission.SKILL_UNINSTALL,
    Permission.SKILL_CONFIGURE,
    Permission.SESSION_VIEW_ALL,
    Permission.SESSION_DELETE,
    Permission.SESSION_EXPORT,
    Permission.AUDIT_VIEW
  ],
  [TenantRole.TENANT_ADMIN]: [
    // User and agent management
    Permission.TENANT_USER_INVITE,
    Permission.TENANT_USER_REMOVE,
    Permission.TENANT_USER_ROLE_ASSIGN,
    Permission.AGENT_CREATE,
    Permission.AGENT_UPDATE,
    Permission.AGENT_DELETE,
    Permission.AGENT_VIEW,
    Permission.AGENT_START,
    Permission.AGENT_STOP,
    Permission.SKILL_INSTALL,
    Permission.SKILL_CONFIGURE,
    Permission.SESSION_VIEW_ALL,
    Permission.AUDIT_VIEW
  ],
  [TenantRole.AGENT_DEVELOPER]: [
    // Agent and skill development
    Permission.AGENT_CREATE,
    Permission.AGENT_UPDATE,
    Permission.AGENT_VIEW,
    Permission.SKILL_INSTALL,
    Permission.SKILL_CONFIGURE,
    Permission.SESSION_VIEW
  ],
  [TenantRole.AGENT_OPERATOR]: [
    // Operations only
    Permission.AGENT_VIEW,
    Permission.AGENT_START,
    Permission.AGENT_STOP,
    Permission.SESSION_VIEW_ALL,
    Permission.AUDIT_VIEW
  ],
  [TenantRole.USER]: [
    // Just send messages
    Permission.SESSION_VIEW  // Can only view own sessions
  ],
  [TenantRole.VIEWER]: [
    // Read-only
    Permission.AGENT_VIEW,
    Permission.SESSION_VIEW
  ]
};
```

**Implementation**:
```typescript
// src/rbac/rbac.ts
class RBACService {
  /**
   * Check if user has permission within their tenant context
   */
  async checkPermission(
    userId: string,
    permission: Permission,
    tenantId?: string  // Required for tenant-scoped permissions
  ): Promise<boolean> {
    const user = await this.getUser(userId);
    
    // Check platform-level permissions first
    if (user.platformRoles?.length) {
      for (const role of user.platformRoles) {
        const permissions = PLATFORM_ROLE_PERMISSIONS[role];
        if (permissions.includes(permission)) {
          return true;
        }
      }
    }
    
    // Check tenant-level permissions
    if (tenantId) {
      const tenantRoles = await this.getUserTenantRoles(userId, tenantId);
      
      for (const role of tenantRoles) {
        const permissions = TENANT_ROLE_PERMISSIONS[role];
        if (permissions.includes(permission)) {
          return true;
        }
      }
    }
    
    // Log denied access
    await auditLog.log({
      type: AuditEventType.PERMISSION_DENIED,
      actor: { userId },
      resource: { type: 'permission', id: permission },
      action: 'check',
      outcome: 'denied',
      metadata: { tenantId }
    });
    
    return false;
  }
  
  /**
   * Ensure user belongs to tenant before allowing action
   */
  async checkTenantMembership(userId: string, tenantId: string): Promise<boolean> {
    const membership = await this.db.query(
      'SELECT 1 FROM tenant_users WHERE user_id = $1 AND tenant_id = $2 AND is_active = true',
      [userId, tenantId]
    );
    return membership.rows.length > 0;
  }
  
  /**
   * Get user's effective tenant from context (API request, session, etc.)
   */
  getCurrentTenant(req: Request): string {
    // From subdomain: acme.openclaw.ai -> tenant_id
    if (req.hostname !== 'openclaw.ai') {
      const subdomain = req.hostname.split('.')[0];
      return this.getTenantBySubdomain(subdomain);
    }
    
    // From JWT token claim
    if (req.user?.tenantId) {
      return req.user.tenantId;
    }
    
    // From header (for multi-tenant UIs)
    if (req.headers['x-tenant-id']) {
      return req.headers['x-tenant-id'] as string;
    }
    
    throw new Error('No tenant context available');
  }
  
  // Decorator for protecting tenant-scoped endpoints
  requireTenantPermission(permission: Permission) {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
      const originalMethod = descriptor.value;
      
      descriptor.value = async function(req: Request, res: Response, ...args: any[]) {
        const userId = req.user?.id;
        const tenantId = rbac.getCurrentTenant(req);
        
        // Verify tenant membership
        if (!await rbac.checkTenantMembership(userId, tenantId)) {
          throw new ForbiddenError('Not a member of this organization');
        }
        
        // Check permission
        if (!await rbac.checkPermission(userId, permission, tenantId)) {
          throw new ForbiddenError(`Missing permission: ${permission}`);
        }
        
        return originalMethod.apply(this, [req, res, ...args]);
      };
    };
  }
}

// Usage in gateway endpoints
class GatewayAPI {
  @requireTenantPermission(Permission.AGENT_CREATE)
  async createAgent(req: Request, res: Response) {
    const tenantId = rbac.getCurrentTenant(req);
    
    // Agent is automatically scoped to tenant
    const agent = await this.agentService.create({
      ...req.body,
      tenantId  // Force tenant ownership
    });
    
    res.json(agent);
  }
  
  @requireTenantPermission(Permission.TENANT_USER_INVITE)
  async inviteUser(req: Request, res: Response) {
    const tenantId = rbac.getCurrentTenant(req);
    
    // Send invite email with tenant context
    await this.userService.invite({
      email: req.body.email,
      tenantId,
      role: req.body.role,
      invitedBy: req.user.id
    });
    
    res.json({ success: true });
  }
  
  @requireTenantPermission(Permission.SESSION_VIEW_ALL)
  async listSessions(req: Request, res: Response) {
    const tenantId = rbac.getCurrentTenant(req);
    
    // Only return sessions belonging to this tenant
    const sessions = await this.sessionService.list({
      tenantId,
      ...req.query
    });
    
    res.json(sessions);
  }
}
```

**Database Schema**:
```sql
-- migrations/001_multi_tenant_rbac.sql

-- Tenants/Organizations
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,  -- For subdomain: acme.openclaw.ai
  plan VARCHAR(50) DEFAULT 'free',     -- free, pro, enterprise
  status VARCHAR(20) DEFAULT 'active', -- active, suspended, cancelled
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Platform-level users (can belong to multiple tenants)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  mfa_secret VARCHAR(255),
  platform_roles VARCHAR(50)[], -- For OpenClaw operators only
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- Tenant membership (user belongs to tenant)
CREATE TABLE tenant_users (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  roles VARCHAR(50)[] NOT NULL,  -- tenant_owner, tenant_admin, etc.
  invited_by UUID REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  PRIMARY KEY (tenant_id, user_id)
);

-- Agents (scoped to tenant)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,  -- Unique within tenant
  workspace_path TEXT,
  model VARCHAR(100),
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

-- Sessions (scoped to tenant)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  session_key VARCHAR(500) NOT NULL,
  channel VARCHAR(50),
  user_id UUID REFERENCES users(id),  -- Which tenant user owns this session
  created_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, session_key)
);

-- Agent bindings (scoped to tenant)
CREATE TABLE agent_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL,
  account_id VARCHAR(255),
  peer_kind VARCHAR(20),
  peer_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, channel, account_id, peer_kind, peer_id)
);

-- Roles (tenant-specific custom roles, optional)
CREATE TABLE tenant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  permissions VARCHAR(100)[] NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- Indexes for tenant isolation
CREATE INDEX idx_agents_tenant ON agents(tenant_id);
CREATE INDEX idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX idx_bindings_tenant ON agent_bindings(tenant_id);
CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_user ON tenant_users(user_id);
CREATE INDEX idx_tenants_slug ON tenants(slug);

-- Row-Level Security (PostgreSQL RLS for defense in depth)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_bindings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access data from their tenant
CREATE POLICY tenant_isolation_agents ON agents
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_sessions ON sessions
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_bindings ON agent_bindings
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Seed default roles (optional if using enum-based roles)
-- Or use this for custom per-tenant roles

-- Example: Create a tenant and assign owner
INSERT INTO tenants (name, slug, plan) VALUES ('Acme Corp', 'acme', 'enterprise') RETURNING id;
-- Assume tenant_id = '123e4567-e89b-12d3-a456-426614174000'

INSERT INTO users (email, password_hash) VALUES ('admin@acme.com', 'hashed_password') RETURNING id;
-- Assume user_id = '223e4567-e89b-12d3-a456-426614174000'

INSERT INTO tenant_users (tenant_id, user_id, roles)
VALUES ('123e4567-e89b-12d3-a456-426614174000', '223e4567-e89b-12d3-a456-426614174000', ARRAY['tenant_owner']);
```

**Timeline**: 3-4 weeks
**Dependencies**: PostgreSQL
**Risk**: Medium (requires careful testing)

**Tenant Isolation Examples**:
```typescript
// src/tenancy/middleware.ts
class TenantContextMiddleware {
  async setTenantContext(req: Request, res: Response, next: NextFunction) {
    const tenantId = rbac.getCurrentTenant(req);
    
    // Set PostgreSQL session variable for RLS
    await pool.query('SET app.current_tenant_id = $1', [tenantId]);
    
    // Attach to request for easy access
    req.tenantId = tenantId;
    
    next();
  }
}

// All queries automatically filtered by tenant via RLS
app.use(tenantContext.setTenantContext);

// Example: Create agent (automatically scoped to tenant)
app.post('/api/agents', requireTenantPermission(Permission.AGENT_CREATE), async (req, res) => {
  // tenantId already set in RLS context
  const agent = await db.query(
    'INSERT INTO agents (tenant_id, name, model) VALUES ($1, $2, $3) RETURNING *',
    [req.tenantId, req.body.name, req.body.model]
  );
  res.json(agent.rows[0]);
});

// Example: List sessions (only shows sessions from current tenant due to RLS)
app.get('/api/sessions', requireTenantPermission(Permission.SESSION_VIEW_ALL), async (req, res) => {
  // RLS automatically filters to current tenant
  const sessions = await db.query('SELECT * FROM sessions ORDER BY last_message_at DESC');
  res.json(sessions.rows);
});
```

**Tenant Onboarding Flow**:
```typescript
// src/tenancy/onboarding.ts
class TenantOnboardingService {
  async createTenant(data: {
    companyName: string;
    ownerEmail: string;
    ownerPassword: string;
    plan: 'free' | 'pro' | 'enterprise';
  }) {
    // Create tenant
    const tenant = await db.query(
      `INSERT INTO tenants (name, slug, plan, settings)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        data.companyName,
        this.slugify(data.companyName),
        data.plan,
        JSON.stringify({
          maxAgents: data.plan === 'free' ? 2 : data.plan === 'pro' ? 10 : 100,
          maxUsers: data.plan === 'free' ? 5 : data.plan === 'pro' ? 50 : 1000,
          features: {
            customBranding: data.plan === 'enterprise',
            sso: data.plan === 'enterprise',
            auditLogs: data.plan !== 'free'
          }
        })
      ]
    );
    
    // Create owner user
    const user = await db.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2) RETURNING *`,
      [data.ownerEmail, await this.hashPassword(data.ownerPassword)]
    );
    
    // Assign tenant_owner role
    await db.query(
      `INSERT INTO tenant_users (tenant_id, user_id, roles)
       VALUES ($1, $2, $3)`,
      [tenant.rows[0].id, user.rows[0].id, ['tenant_owner']]
    );
    
    // Create default agent
    await db.query(
      `INSERT INTO agents (tenant_id, name, slug, model, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenant.rows[0].id, 'Main Agent', 'main', 'claude-3-5-sonnet', user.rows[0].id]
    );
    
    // Send welcome email
    await this.sendWelcomeEmail(user.rows[0].email, tenant.rows[0]);
    
    return { tenant: tenant.rows[0], user: user.rows[0] };
  }
}
```

**Multi-Tenant Billing**:
```typescript
// src/billing/usage-tracking.ts
class UsageTrackingService {
  async trackTokenUsage(tenantId: string, agentId: string, tokens: number) {
    // Record usage
    await db.query(
      `INSERT INTO usage_records (tenant_id, agent_id, resource_type, quantity, recorded_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tenantId, agentId, 'tokens', tokens]
    );
    
    // Check if tenant exceeded quota
    const quota = await this.getTenantQuota(tenantId);
    const usage = await this.getMonthlyUsage(tenantId);
    
    if (usage.tokens >= quota.tokens) {
      // Suspend tenant or throttle
      await this.notifyQuotaExceeded(tenantId);
      throw new QuotaExceededError('Monthly token quota exceeded');
    }
  }
  
  async generateInvoice(tenantId: string, month: string) {
    const usage = await db.query(
      `SELECT 
         resource_type,
         SUM(quantity) as total
       FROM usage_records
       WHERE tenant_id = $1
         AND DATE_TRUNC('month', recorded_at) = $2
       GROUP BY resource_type`,
      [tenantId, month]
    );
    
    // Calculate charges based on plan
    const tenant = await this.getTenant(tenantId);
    const charges = this.calculateCharges(tenant.plan, usage.rows);
    
    return {
      tenantId,
      month,
      usage: usage.rows,
      charges,
      total: charges.reduce((sum, c) => sum + c.amount, 0)
    };
  }
}
```

---

### C. Comprehensive Audit Logging ✅ CRITICAL

**Problem**: No tamper-proof audit trail for compliance

**Solution**: Write-once audit log with SIEM integration

**Audit Event Schema**:
```typescript
// src/audit/types.ts
enum AuditEventType {
  // Authentication
  AUTH_LOGIN = 'auth.login',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_FAILED = 'auth.failed',
  AUTH_MFA_ENABLED = 'auth.mfa.enabled',
  
  // Agent lifecycle
  AGENT_CREATED = 'agent.created',
  AGENT_UPDATED = 'agent.updated',
  AGENT_DELETED = 'agent.deleted',
  AGENT_STARTED = 'agent.started',
  AGENT_STOPPED = 'agent.stopped',
  
  // Skills
  SKILL_INSTALLED = 'skill.installed',
  SKILL_UNINSTALLED = 'skill.uninstalled',
  SKILL_EXECUTED = 'skill.executed',
  
  // Credentials
  CREDENTIAL_CREATED = 'credential.created',
  CREDENTIAL_ACCESSED = 'credential.accessed',
  CREDENTIAL_UPDATED = 'credential.updated',
  CREDENTIAL_DELETED = 'credential.deleted',
  
  // Sessions
  SESSION_CREATED = 'session.created',
  SESSION_DELETED = 'session.deleted',
  SESSION_EXPORTED = 'session.exported',
  
  // Configuration
  CONFIG_UPDATED = 'config.updated',
  BINDING_CREATED = 'binding.created',
  BINDING_UPDATED = 'binding.updated',
  BINDING_DELETED = 'binding.deleted',
  
  // Security events
  PERMISSION_DENIED = 'security.permission_denied',
  RATE_LIMIT_EXCEEDED = 'security.rate_limit',
  SUSPICIOUS_ACTIVITY = 'security.suspicious',
  UNAUTHORIZED_ACCESS = 'security.unauthorized'
}

interface AuditEvent {
  id: string;
  timestamp: Date;
  type: AuditEventType;
  actor: {
    userId?: string;
    email?: string;
    ip: string;
    userAgent?: string;
  };
  resource: {
    type: string;      // 'agent', 'skill', 'session', etc.
    id: string;
    name?: string;
  };
  action: string;      // 'create', 'update', 'delete', 'access'
  outcome: 'success' | 'failure' | 'denied';
  metadata?: Record<string, any>;
  changeset?: {        // For update events
    before: any;
    after: any;
  };
}
```

**Implementation**:
```typescript
// src/audit/audit-logger.ts
class AuditLogger {
  private db: Database;
  private queue: AuditEvent[] = [];
  private flushInterval = 5000; // Flush every 5 seconds
  
  constructor() {
    this.startBatchFlush();
  }
  
  async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: AuditEvent = {
      id: randomUUID(),
      timestamp: new Date(),
      ...event
    };
    
    // Queue for batch insert (performance)
    this.queue.push(fullEvent);
    
    // Stdout for log aggregation
    console.log(JSON.stringify({
      ...fullEvent,
      '@type': 'audit',
      '@version': '1.0'
    }));
    
    // Async: send to external SIEM
    this.sendToSIEM(fullEvent).catch(err => 
      console.error('Failed to send to SIEM:', err)
    );
  }
  
  private async startBatchFlush() {
    setInterval(async () => {
      if (this.queue.length === 0) return;
      
      const batch = this.queue.splice(0, this.queue.length);
      
      await this.db.query(
        `INSERT INTO audit_log (id, timestamp, type, actor, resource, action, outcome, metadata, changeset)
         VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        batch.flatMap(e => [
          e.id, e.timestamp, e.type,
          JSON.stringify(e.actor),
          JSON.stringify(e.resource),
          e.action, e.outcome,
          JSON.stringify(e.metadata || {}),
          JSON.stringify(e.changeset || null)
        ])
      );
    }, this.flushInterval);
  }
  
  private async sendToSIEM(event: AuditEvent) {
    const siemConfig = config.get('security.siem');
    if (!siemConfig?.enabled) return;
    
    // Splunk HEC
    if (siemConfig.type === 'splunk') {
      await fetch(siemConfig.url, {
        method: 'POST',
        headers: {
          'Authorization': `Splunk ${siemConfig.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event,
          source: 'openclaw',
          sourcetype: 'openclaw:audit'
        })
      });
    }
    
    // Elasticsearch
    if (siemConfig.type === 'elasticsearch') {
      await fetch(`${siemConfig.url}/openclaw-audit/_doc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `ApiKey ${siemConfig.apiKey}`
        },
        body: JSON.stringify(event)
      });
    }
  }
}

// Global singleton
export const auditLog = new AuditLogger();
```

**Usage Examples**:
```typescript
// Credential access
async getCredential(userId: string, credentialId: string) {
  const credential = await this.db.getCredential(credentialId);
  
  await auditLog.log({
    type: AuditEventType.CREDENTIAL_ACCESSED,
    actor: { userId, ip: this.getIP() },
    resource: { type: 'credential', id: credentialId, name: credential.name },
    action: 'access',
    outcome: 'success',
    metadata: { provider: credential.provider }
  });
  
  return credential;
}

// Agent update with changeset
async updateAgent(userId: string, agentId: string, updates: Partial<Agent>) {
  const before = await this.db.getAgent(agentId);
  const after = { ...before, ...updates };
  
  await this.db.updateAgent(agentId, updates);
  
  await auditLog.log({
    type: AuditEventType.AGENT_UPDATED,
    actor: { userId, ip: this.getIP() },
    resource: { type: 'agent', id: agentId, name: before.name },
    action: 'update',
    outcome: 'success',
    changeset: {
      before: { model: before.model, workspace: before.workspace },
      after: { model: after.model, workspace: after.workspace }
    }
  });
}

// Failed login
async login(email: string, password: string, ip: string) {
  const user = await this.getUserByEmail(email);
  
  if (!user || !await this.verifyPassword(password, user.password_hash)) {
    await auditLog.log({
      type: AuditEventType.AUTH_FAILED,
      actor: { email, ip },
      resource: { type: 'user', id: user?.id || 'unknown' },
      action: 'login',
      outcome: 'failure'
    });
    throw new AuthError('Invalid credentials');
  }
  
  await auditLog.log({
    type: AuditEventType.AUTH_LOGIN,
    actor: { userId: user.id, email, ip },
    resource: { type: 'user', id: user.id },
    action: 'login',
    outcome: 'success'
  });
  
  return this.createSession(user);
}
```

**Audit Query API**:
```typescript
// src/audit/query.ts
class AuditQueryService {
  @requirePermission(Permission.AUDIT_VIEW)
  async query(filters: {
    userId?: string;
    type?: AuditEventType;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
    outcome?: 'success' | 'failure' | 'denied';
  }, pagination: { page: number; limit: number }) {
    const query = `
      SELECT * FROM audit_log
      WHERE 1=1
        ${filters.userId ? 'AND actor->>"userId" = ?' : ''}
        ${filters.type ? 'AND type = ?' : ''}
        ${filters.resourceType ? 'AND resource->>"type" = ?' : ''}
        ${filters.startDate ? 'AND timestamp >= ?' : ''}
        ${filters.endDate ? 'AND timestamp <= ?' : ''}
        ${filters.outcome ? 'AND outcome = ?' : ''}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    
    const params = [
      filters.userId,
      filters.type,
      filters.resourceType,
      filters.startDate,
      filters.endDate,
      filters.outcome,
      pagination.limit,
      (pagination.page - 1) * pagination.limit
    ].filter(p => p !== undefined);
    
    return await this.db.query(query, params);
  }
  
  // Export for compliance audits
  async exportAudit(startDate: Date, endDate: Date): Promise<Buffer> {
    const events = await this.query({ startDate, endDate }, { page: 1, limit: 1000000 });
    
    // CSV format for auditors
    const csv = [
      'Timestamp,Type,Actor,Resource,Action,Outcome',
      ...events.map(e => 
        `${e.timestamp},${e.type},${e.actor.email || e.actor.userId},${e.resource.type}:${e.resource.id},${e.action},${e.outcome}`
      )
    ].join('\n');
    
    return Buffer.from(csv, 'utf8');
  }
}
```

**Database Schema**:
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  type VARCHAR(100) NOT NULL,
  actor JSONB NOT NULL,
  resource JSONB NOT NULL,
  action VARCHAR(50) NOT NULL,
  outcome VARCHAR(20) NOT NULL,
  metadata JSONB,
  changeset JSONB,
  -- No UPDATE or DELETE allowed (write-once)
  CONSTRAINT no_updates CHECK (false)
);

-- Revoke UPDATE/DELETE privileges
REVOKE UPDATE, DELETE ON audit_log FROM openclaw_app_user;

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_type ON audit_log(type);
CREATE INDEX idx_audit_actor_user ON audit_log((actor->>'userId'));
CREATE INDEX idx_audit_resource_type ON audit_log((resource->>'type'));
CREATE INDEX idx_audit_outcome ON audit_log(outcome);

-- Partition by month for performance
CREATE TABLE audit_log_2026_02 PARTITION OF audit_log
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_log_2026_03 PARTITION OF audit_log
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

**Timeline**: 2-3 weeks
**Dependencies**: PostgreSQL
**Risk**: Low

---

## Phase 2: Distributed Tracing & Observability (Weeks 9-12)

### A. OpenTelemetry Integration

**Problem**: No distributed tracing for debugging multi-component interactions

**Solution**: Full OpenTelemetry instrumentation with Jaeger backend

**Implementation**:
```typescript
// src/telemetry/setup.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'openclaw-gateway',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces'
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingPaths: ['/health', '/metrics']
      }
    })
  ]
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
```

**Custom Spans**:
```typescript
// src/telemetry/tracing.ts
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('openclaw', '1.0.0');

export function traceAsync<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      span.setAttributes(attributes);
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

// Usage in routing
async function resolveAgentRoute(input: ResolveAgentRouteInput) {
  return traceAsync(
    'routing.resolve',
    {
      'channel': input.channel,
      'peer.id': input.peer?.id || 'none',
      'guild.id': input.guildId || 'none'
    },
    async () => {
      const bindings = await traceAsync(
        'routing.loadBindings',
        { 'channel': input.channel },
        () => loadBindings(input.channel)
      );
      
      const route = await traceAsync(
        'routing.matchBinding',
        { 'bindings.count': bindings.length },
        () => matchBinding(bindings, input)
      );
      
      return route;
    }
  );
}
```

**Trace Context Propagation**:
```typescript
// src/telemetry/context.ts
import { propagation, context } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

propagation.setGlobalPropagator(new W3CTraceContextPropagator());

// Inject trace context into WebSocket messages
function sendMessage(ws: WebSocket, message: any) {
  const carrier = {};
  propagation.inject(context.active(), carrier);
  
  ws.send(JSON.stringify({
    ...message,
    trace: carrier // Include traceparent/tracestate
  }));
}

// Extract trace context from incoming messages
function handleMessage(data: any) {
  const extractedContext = propagation.extract(context.active(), data.trace || {});
  
  context.with(extractedContext, () => {
    // All spans created here will be part of the distributed trace
    processMessage(data);
  });
}
```

**Timeline**: 1-2 weeks
**Dependencies**: Jaeger or Grafana Tempo
**Risk**: Low

---

### B. Centralized Logging (ELK Stack)

**Problem**: Logs scattered across instances, hard to search

**Solution**: Structured logging with Elasticsearch backend

**Implementation**:
```typescript
// src/logging/logger.ts
import pino from 'pino';
import { trace } from '@opentelemetry/api';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: 'openclaw-gateway'
    })
  },
  mixin() {
    const span = trace.getActiveSpan();
    if (span) {
      const spanContext = span.spanContext();
      return {
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
        trace_flags: spanContext.traceFlags
      };
    }
    return {};
  },
  transport: process.env.NODE_ENV === 'production' ? {
    target: 'pino-elasticsearch',
    options: {
      node: process.env.ELASTICSEARCH_URL,
      index: 'openclaw-logs',
      consistency: 'one',
      'es-version': 8,
      'flush-bytes': 1000
    }
  } : {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

export { logger };
```

**Usage**:
```typescript
import { logger } from './logging/logger';

// Structured logging with trace context
logger.info({
  msg: 'Agent started',
  agentId: 'main',
  workspace: '/path/to/workspace',
  model: 'claude-3-5-sonnet'
});

logger.error({
  msg: 'Skill execution failed',
  err: error,
  skillName: '1password',
  agentId: 'main'
});

logger.warn({
  msg: 'Rate limit approaching',
  userId: 'user123',
  currentRate: 95,
  limit: 100
});
```

**Timeline**: 1 week
**Dependencies**: Elasticsearch, Kibana
**Risk**: Low

---

### C. Prometheus Metrics

**Problem**: No real-time metrics for monitoring

**Solution**: Prometheus-compatible metrics endpoint

**Implementation**:
```typescript
// src/telemetry/metrics.ts
import { register, Counter, Histogram, Gauge } from 'prom-client';

// Request counters
const messageCounter = new Counter({
  name: 'openclaw_messages_total',
  help: 'Total messages processed',
  labelNames: ['channel', 'agent', 'outcome']
});

// Request duration
const requestDuration = new Histogram({
  name: 'openclaw_request_duration_seconds',
  help: 'Request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

// Active gauges
const activeAgents = new Gauge({
  name: 'openclaw_active_agents',
  help: 'Number of active agents'
});

const activeSessions = new Gauge({
  name: 'openclaw_active_sessions',
  help: 'Number of active sessions'
});

// Skill execution metrics
const skillExecutions = new Counter({
  name: 'openclaw_skill_executions_total',
  help: 'Total skill executions',
  labelNames: ['skill', 'agent', 'outcome']
});

const skillDuration = new Histogram({
  name: 'openclaw_skill_duration_seconds',
  help: 'Skill execution duration',
  labelNames: ['skill', 'agent'],
  buckets: [1, 5, 10, 30, 60, 120]
});

// Expose metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(register.metrics());
});

// Usage
messageCounter.inc({ channel: 'telegram', agent: 'main', outcome: 'success' });
skillExecutions.inc({ skill: '1password', agent: 'main', outcome: 'success' });
activeAgents.set(getActiveAgentCount());
```

**Grafana Dashboard JSON**:
```json
{
  "dashboard": {
    "title": "OpenClaw Production Metrics",
    "panels": [
      {
        "title": "Messages Per Second",
        "targets": [
          {
            "expr": "rate(openclaw_messages_total[5m])"
          }
        ]
      },
      {
        "title": "Request Latency (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(openclaw_request_duration_seconds_bucket[5m]))"
          }
        ]
      },
      {
        "title": "Active Agents",
        "targets": [
          {
            "expr": "openclaw_active_agents"
          }
        ]
      }
    ]
  }
}
```

**Timeline**: 1 week
**Dependencies**: Prometheus, Grafana
**Risk**: Low

---

## Phase 3: High Availability & Stability (Weeks 13-20)

### A. PostgreSQL Migration

**Problem**: JSONL files don't support multi-instance deployments

**Solution**: Migrate to PostgreSQL with proper schema

**Schema Design**:
```sql
-- Database: openclaw_production

-- Agents
CREATE TABLE agents (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  workspace_path TEXT NOT NULL,
  model VARCHAR(100) NOT NULL,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- Sessions (replaces JSONL files)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key VARCHAR(500) UNIQUE NOT NULL,
  agent_id VARCHAR(100) REFERENCES agents(id),
  channel VARCHAR(50) NOT NULL,
  account_id VARCHAR(255),
  peer_id VARCHAR(255),
  peer_kind VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'
);

-- Session turns (individual messages)
CREATE TABLE session_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  tool_calls JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(session_id, turn_number)
);

-- Agent bindings
CREATE TABLE agent_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(100) REFERENCES agents(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL,
  account_id VARCHAR(255),
  peer_kind VARCHAR(20),
  peer_id VARCHAR(255),
  guild_id VARCHAR(255),
  team_id VARCHAR(255),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(channel, account_id, peer_kind, peer_id, guild_id, team_id)
);

-- Indexes
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_key ON sessions(session_key);
CREATE INDEX idx_sessions_last_message ON sessions(last_message_at DESC);
CREATE INDEX idx_sessions_channel_peer ON sessions(channel, peer_id);
CREATE INDEX idx_turns_session ON session_turns(session_id, turn_number);
CREATE INDEX idx_turns_created ON session_turns(created_at DESC);
CREATE INDEX idx_bindings_channel ON agent_bindings(channel);
CREATE INDEX idx_bindings_agent ON agent_bindings(agent_id);
CREATE INDEX idx_bindings_priority ON agent_bindings(priority DESC);

-- Partitioning for session_turns (by month)
CREATE TABLE session_turns_2026_02 PARTITION OF session_turns
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE session_turns_2026_03 PARTITION OF session_turns
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- Add partitions via cron job

-- PostgreSQL-specific optimizations
ALTER TABLE session_turns SET (autovacuum_vacuum_scale_factor = 0.01);
ALTER TABLE audit_log SET (autovacuum_vacuum_scale_factor = 0.01);
```

**Migration Script**:
```typescript
// scripts/migrate-jsonl-to-postgres.ts
import { Pool } from 'pg';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

async function migrateFromJSONL() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sessionsDir = path.join(os.homedir(), '.clawdbot', 'sessions');
  
  let totalSessions = 0;
  let totalTurns = 0;
  
  for (const agentDir of await readdir(sessionsDir)) {
    const agentId = agentDir;
    const agentSessionsDir = path.join(sessionsDir, agentDir, 'sessions');
    
    if (!await exists(agentSessionsDir)) continue;
    
    for (const file of await readdir(agentSessionsDir)) {
      if (!file.endsWith('.jsonl')) continue;
      
      const sessionKey = file.replace('.jsonl', '');
      const content = await readFile(path.join(agentSessionsDir, file), 'utf8');
      const turns = content.split('\n').filter(Boolean).map(JSON.parse);
      
      if (turns.length === 0) continue;
      
      // Parse session key to extract channel/peer
      const { channel, peerId, peerKind } = parseSessionKey(sessionKey);
      
      // Insert session
      const { rows: [session] } = await pool.query(
        `INSERT INTO sessions (session_key, agent_id, channel, peer_id, peer_kind, created_at, last_message_at, message_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (session_key) DO NOTHING
         RETURNING id`,
        [
          sessionKey,
          agentId,
          channel,
          peerId,
          peerKind,
          turns[0]?.timestamp || new Date(),
          turns[turns.length - 1]?.timestamp || new Date(),
          turns.length
        ]
      );
      
      if (!session) {
        console.log(`Skipping duplicate session: ${sessionKey}`);
        continue;
      }
      
      // Batch insert turns
      if (turns.length > 0) {
        const values = turns.flatMap((turn, i) => [
          session.id,
          i + 1,
          turn.role,
          JSON.stringify(turn),
          JSON.stringify(turn.metadata || {}),
          turn.timestamp || new Date()
        ]);
        
        const placeholders = turns.map((_, i) => {
          const base = i * 6;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
        }).join(', ');
        
        await pool.query(
          `INSERT INTO session_turns (session_id, turn_number, role, content, metadata, created_at)
           VALUES ${placeholders}`,
          values
        );
      }
      
      totalSessions++;
      totalTurns += turns.length;
      
      if (totalSessions % 100 === 0) {
        console.log(`Migrated ${totalSessions} sessions, ${totalTurns} turns...`);
      }
    }
  }
  
  await pool.end();
  console.log(`Migration complete: ${totalSessions} sessions, ${totalTurns} turns`);
}
```

**Timeline**: 2-3 weeks
**Dependencies**: PostgreSQL 14+
**Risk**: Medium (data migration, thorough testing required)

---

### B. Multi-Instance Gateway with Redis

**Problem**: Single gateway instance is a single point of failure

**Solution**: Load-balanced multi-instance deployment with Redis for session affinity

**Architecture**:
```
                    Internet
                       │
                ┌──────▼──────┐
                │  HAProxy LB  │ (SSL termination, routing)
                └──────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
   │Gateway 1│   │Gateway 2│   │Gateway 3│  (Auto-scaling)
   │  :18789 │   │  :18789 │   │  :18789 │
   └────┬────┘   └────┬────┘   └────┬────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
   ┌────▼────┐                   ┌───▼────┐
   │  Redis  │                   │Postgres│
   │ Cluster │                   │ Primary│
   │(3 nodes)│                   │   +    │
   └─────────┘                   │Replicas│
                                 └────────┘
```

**Redis Session Store**:
```typescript
// src/gateway/redis-sessions.ts
import { createClient } from 'redis';

class RedisSessionStore {
  private client: ReturnType<typeof createClient>;
  private pubsub: ReturnType<typeof createClient>;
  
  async init() {
    this.client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
      }
    });
    
    this.pubsub = this.client.duplicate();
    
    await this.client.connect();
    await this.pubsub.connect();
    
    // Subscribe to session updates from other gateways
    await this.pubsub.subscribe('session:updates', (message) => {
      const { sessionKey, event } = JSON.parse(message);
      this.handleSessionUpdate(sessionKey, event);
    });
  }
  
  async getActiveGateway(sessionKey: string): Promise<string | null> {
    // Check which gateway instance is handling this session
    return await this.client.get(`session:gateway:${sessionKey}`);
  }
  
  async claimSession(sessionKey: string, gatewayId: string): Promise<boolean> {
    // Atomic claim with 5-minute TTL (renewed on each message)
    const result = await this.client.set(
      `session:gateway:${sessionKey}`,
      gatewayId,
      { NX: true, EX: 300 }
    );
    return result === 'OK';
  }
  
  async renewSession(sessionKey: string): Promise<void> {
    // Extend TTL on activity
    await this.client.expire(`session:gateway:${sessionKey}`, 300);
  }
  
  async releaseSession(sessionKey: string): Promise<void> {
    await this.client.del(`session:gateway:${sessionKey}`);
  }
  
  async publishSessionUpdate(sessionKey: string, event: any) {
    // Notify other gateways of session changes
    await this.pubsub.publish('session:updates', JSON.stringify({
      sessionKey,
      event,
      gatewayId: process.env.GATEWAY_ID,
      timestamp: new Date()
    }));
  }
  
  private async handleSessionUpdate(sessionKey: string, event: any) {
    // Other gateway claimed/released session
    if (event.type === 'claimed' && event.gatewayId !== process.env.GATEWAY_ID) {
      // Another gateway took over this session
      this.localSessions.delete(sessionKey);
    }
  }
}
```

**HAProxy Configuration**:
```haproxy
# /etc/haproxy/haproxy.cfg
global
    daemon
    maxconn 4096
    ssl-default-bind-ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    ssl-default-bind-options ssl-min-ver TLSv1.2
    
defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms
    option http-server-close
    option forwardfor
    
frontend openclaw_frontend
    bind *:443 ssl crt /etc/ssl/certs/openclaw.pem
    bind *:80
    redirect scheme https code 301 if !{ ssl_fc }
    
    default_backend openclaw_gateways
    
    # Security headers
    http-response set-header Strict-Transport-Security max-age=31536000
    http-response set-header X-Frame-Options DENY
    http-response set-header X-Content-Type-Options nosniff
    
backend openclaw_gateways
    balance leastconn
    option httpchk GET /health
    
    # Sticky sessions based on session key cookie
    cookie OPENCLAW_SESSION insert indirect nocache httponly secure
    
    # Alternative: stick table for WebSocket session affinity
    stick-table type string len 500 size 1m expire 24h
    stick on hdr(X-Session-Key)
    
    server gateway1 10.0.1.10:18789 check cookie gw1
    server gateway2 10.0.1.11:18789 check cookie gw2
    server gateway3 10.0.1.12:18789 check cookie gw3 backup
```

**Timeline**: 3-4 weeks
**Dependencies**: Redis Cluster, PostgreSQL, HAProxy
**Risk**: High (complex distributed system, needs thorough load testing)

---

### C. Health Checks & Readiness Probes

**Implementation**:
```typescript
// src/gateway/health.ts
import { Pool } from 'pg';
import { RedisClientType } from 'redis';
import { diskusage } from 'diskusage';
import os from 'os';

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail';
  details?: any;
  duration?: number;
}

class HealthService {
  async checkDatabase(pool: Pool): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      return {
        name: 'database',
        status: 'pass',
        duration: Date.now() - start
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'fail',
        details: error.message,
        duration: Date.now() - start
      };
    }
  }
  
  async checkRedis(redis: RedisClientType): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await redis.ping();
      return {
        name: 'redis',
        status: 'pass',
        duration: Date.now() - start
      };
    } catch (error) {
      return {
        name: 'redis',
        status: 'fail',
        details: error.message,
        duration: Date.now() - start
      };
    }
  }
  
  async checkDiskSpace(): Promise<HealthCheck> {
    try {
      const { available, total } = await diskusage('/');
      const percentFree = (available / total) * 100;
      
      return {
        name: 'disk',
        status: percentFree > 10 ? 'pass' : 'fail',
        details: {
          availableGB: (available / 1024 ** 3).toFixed(2),
          totalGB: (total / 1024 ** 3).toFixed(2),
          percentFree: percentFree.toFixed(2)
        }
      };
    } catch (error) {
      return { name: 'disk', status: 'fail', details: error.message };
    }
  }
  
  async checkMemory(): Promise<HealthCheck> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const percentFree = (freeMem / totalMem) * 100;
    
    return {
      name: 'memory',
      status: percentFree > 5 ? 'pass' : 'fail',
      details: {
        freeGB: (freeMem / 1024 ** 3).toFixed(2),
        totalGB: (totalMem / 1024 ** 3).toFixed(2),
        percentFree: percentFree.toFixed(2)
      }
    };
  }
}

// Health endpoint (always responds, even if unhealthy)
app.get('/health', async (req, res) => {
  const healthService = new HealthService();
  
  const checks = await Promise.allSettled([
    healthService.checkDatabase(pool),
    healthService.checkRedis(redis),
    healthService.checkDiskSpace(),
    healthService.checkMemory()
  ]);
  
  const results: HealthCheck[] = checks.map((c, i) => 
    c.status === 'fulfilled' ? c.value : {
      name: ['database', 'redis', 'disk', 'memory'][i],
      status: 'fail',
      details: c.reason
    }
  );
  
  const healthy = results.every(c => c.status === 'pass');
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    checks: results,
    uptime: process.uptime(),
    version: process.env.APP_VERSION,
    timestamp: new Date().toISOString()
  });
});

// Readiness probe (only ready when fully initialized)
app.get('/ready', async (req, res) => {
  const ready = (
    gatewayInitialized &&
    await pool.query('SELECT 1').then(() => true).catch(() => false) &&
    await redis.ping().then(() => true).catch(() => false)
  );
  
  res.status(ready ? 200 : 503).json({ ready });
});

// Liveness probe (process is alive)
app.get('/live', (req, res) => {
  res.status(200).json({ alive: true });
});
```

**Timeline**: 1 week
**Risk**: Low

---

## Phase 4: Production Hardening (Weeks 21-24)

### A. Rate Limiting

```typescript
// src/security/rate-limiter.ts
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { createClient } from 'redis';

class RateLimitService {
  private perUserLimiter: RateLimiterRedis;
  private perAgentLimiter: RateLimiterRedis;
  private perSkillLimiter: RateLimiterRedis;
  
  async init() {
    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    
    // Per-user message rate limit
    this.perUserLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:user',
      points: 100,          // 100 requests
      duration: 60,         // per 60 seconds
      blockDuration: 300    // block for 5 minutes if exceeded
    });
    
    // Per-agent token limit
    this.perAgentLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:agent:tokens',
      points: 1000000,      // 1M tokens
      duration: 86400       // per day
    });
    
    // Per-skill execution limit
    this.perSkillLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:skill',
      points: 50,           // 50 executions
      duration: 3600        // per hour
    });
  }
  
  async checkUserLimit(userId: string): Promise<void> {
    try {
      await this.perUserLimiter.consume(userId);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        await auditLog.log({
          type: AuditEventType.RATE_LIMIT_EXCEEDED,
          actor: { userId },
          resource: { type: 'rate_limit', id: 'user' },
          action: 'message',
          outcome: 'denied',
          metadata: {
            remainingPoints: error.remainingPoints,
            msBeforeNext: error.msBeforeNext
          }
        });
        
        throw new RateLimitError(
          `Too many requests. Try again in ${Math.ceil(error.msBeforeNext / 1000)} seconds.`
        );
      }
      throw error;
    }
  }
  
  async consumeAgentTokens(agentId: string, tokens: number): Promise<void> {
    try {
      await this.perAgentLimiter.consume(agentId, tokens);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        throw new RateLimitError(
          `Agent ${agentId} has exceeded daily token limit. Resets in ${Math.ceil(error.msBeforeNext / 1000 / 3600)} hours.`
        );
      }
      throw error;
    }
  }
  
  async checkSkillLimit(agentId: string, skillName: string): Promise<void> {
    const key = `${agentId}:${skillName}`;
    try {
      await this.perSkillLimiter.consume(key);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        throw new RateLimitError(
          `Skill ${skillName} has been executed too many times. Try again in ${Math.ceil(error.msBeforeNext / 1000 / 60)} minutes.`
        );
      }
      throw error;
    }
  }
}

// Middleware
app.use(async (req, res, next) => {
  const userId = req.user?.id || req.ip;
  
  try {
    await rateLimiter.checkUserLimit(userId);
    next();
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: error.message });
    } else {
      next(error);
    }
  }
});
```

**Timeline**: 1 week
**Dependencies**: Redis
**Risk**: Low

---

### B. Backup & Disaster Recovery

**Automated Backups**:
```bash
#!/bin/bash
# scripts/backup-postgres.sh

set -euo pipefail

BACKUP_DIR="/var/backups/openclaw"
S3_BUCKET="s3://openclaw-backups"
RETENTION_DAYS=30

# Create backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="openclaw_${TIMESTAMP}.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

# Upload to S3
aws s3 cp "${BACKUP_DIR}/${BACKUP_FILE}" "${S3_BUCKET}/"

# Verify backup
aws s3 ls "${S3_BUCKET}/${BACKUP_FILE}"

# Delete old backups
find "${BACKUP_DIR}" -name "openclaw_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
aws s3 ls "${S3_BUCKET}/" | while read -r line; do
  createDate=$(echo "$line" | awk '{print $1" "$2}')
  createDate=$(date -d "$createDate" +%s)
  olderThan=$(date -d "${RETENTION_DAYS} days ago" +%s)
  if [[ $createDate -lt $olderThan ]]; then
    fileName=$(echo "$line" | awk '{print $4}')
    aws s3 rm "${S3_BUCKET}/${fileName}"
  fi
done

echo "Backup complete: ${BACKUP_FILE}"
```

**Cron Schedule**:
```cron
# /etc/cron.d/openclaw-backups
# Daily backup at 2 AM
0 2 * * * /opt/openclaw/scripts/backup-postgres.sh >> /var/log/openclaw-backup.log 2>&1
```

**Recovery Procedure**:
```bash
#!/bin/bash
# scripts/restore-postgres.sh

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup-file>"
  exit 1
fi

BACKUP_FILE=$1

# Download from S3 if needed
if [[ $BACKUP_FILE == s3://* ]]; then
  LOCAL_FILE="/tmp/$(basename "$BACKUP_FILE")"
  aws s3 cp "$BACKUP_FILE" "$LOCAL_FILE"
  BACKUP_FILE="$LOCAL_FILE"
fi

# Stop gateway
systemctl stop openclaw-gateway

# Drop and recreate database
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS openclaw_production;"
psql "$DATABASE_URL" -c "CREATE DATABASE openclaw_production;"

# Restore
gunzip < "$BACKUP_FILE" | psql "$DATABASE_URL"

# Start gateway
systemctl start openclaw-gateway

echo "Recovery complete"
```

**Timeline**: 1 week
**Risk**: Low

---

## Timeline & Resource Summary

| Phase | Duration | Team | Key Deliverables | Cost Estimate |
|-------|----------|------|------------------|---------------|
| **Phase 1: Security** | 8 weeks | 2 engineers | Encryption, RBAC, Audit logging | $120K |
| **Phase 2: Observability** | 4 weeks | 1 engineer | OpenTelemetry, ELK, Prometheus | $40K |
| **Phase 3: High Availability** | 8 weeks | 3 engineers | PostgreSQL, Multi-instance, Redis | $180K |
| **Phase 4: Hardening** | 4 weeks | 2 engineers | Rate limiting, Backups, Monitoring | $60K |
| **SOC 2 Audit Prep** | 8 weeks | 1 security eng | Policies, controls, documentation | $80K |
| **SOC 2 Audit** | 12 weeks | External auditor | Compliance certification | $50K + audit fees |

**Total: 32 weeks (8 months)**
**Total Team: 3-4 engineers + 1 security specialist**
**Total Cost: $530K - $650K (salaries + infrastructure + audit fees)**

---

## Success Criteria

### Phase 1 Complete
- ✅ All credentials encrypted with system keychain
- ✅ RBAC enforced on all API endpoints
- ✅ Audit log capturing 100% of security events
- ✅ Penetration test completed with no critical findings

### Phase 2 Complete
- ✅ Distributed traces for all request flows
- ✅ Centralized logging with 30-day retention
- ✅ Prometheus metrics exposed and scraped
- ✅ Grafana dashboards operational

### Phase 3 Complete
- ✅ All sessions/data migrated to PostgreSQL
- ✅ 3+ gateway instances running
- ✅ 99.9% uptime achieved for 30 days
- ✅ Load testing: 1000 concurrent users, <2s p95 latency

### Phase 4 Complete
- ✅ Rate limiting active and tested
- ✅ Daily automated backups with tested recovery
- ✅ Health checks integrated with monitoring
- ✅ Runbooks documented for all operational scenarios

### SOC 2 Ready
- ✅ All controls implemented and tested
- ✅ Audit evidence collected for 3+ months
- ✅ Security policies documented and reviewed
- ✅ Third-party audit scheduled

---

## Infrastructure Requirements

### Development/Staging
- **Compute**: 3x t3.medium EC2 instances ($100/mo)
- **Database**: RDS PostgreSQL db.t3.medium ($150/mo)
- **Redis**: ElastiCache t3.micro ($30/mo)
- **Monitoring**: Grafana Cloud free tier
- **Total**: ~$280/mo

### Production (Initial)
- **Compute**: 3x c6i.2xlarge EC2 instances ($600/mo)
- **Database**: RDS PostgreSQL db.r6i.2xlarge Multi-AZ ($1200/mo)
- **Redis**: ElastiCache r6g.large cluster ($400/mo)
- **Load Balancer**: ALB ($30/mo)
- **S3 Backups**: 500GB ($12/mo)
- **Observability**: Grafana Cloud Pro ($300/mo), Elasticsearch ($500/mo)
- **Total**: ~$3,042/mo

### Production (Scaled)
- **Compute**: 10x c6i.4xlarge auto-scaling ($4000/mo)
- **Database**: RDS PostgreSQL db.r6i.4xlarge Multi-AZ ($2400/mo)
- **Redis**: ElastiCache r6g.xlarge cluster ($800/mo)
- **Total**: ~$8,000/mo+ (scales with usage)

---

## Conclusion

This roadmap provides **concrete, actionable steps** to transform OpenClaw into an enterprise-grade platform with:

✅ **Security**: Encryption, RBAC, audit logging, rate limiting
✅ **Observability**: Distributed tracing, centralized logging, metrics
✅ **Stability**: High availability, disaster recovery, health monitoring

**6-8 months of focused work will make OpenClaw ready for enterprise deployments.**
