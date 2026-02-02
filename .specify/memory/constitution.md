&lt;!--
SYNC IMPACT REPORT
==================
Version Change: NONE → 1.0.0
Ratification: 2026-02-02 (initial adoption)
Last Amended: 2026-02-02

Modified Principles: N/A (initial version)
Added Sections:
  - 10 Core Principles (I-X)
  - Development Workflow
  - Technology Constraints
  - Security Requirements
  - Compliance & Governance

Removed Sections: N/A

Templates Requiring Updates:
  ✅ .specify/templates/plan-template.md - Constitution Check section aligns with principles
  ✅ .specify/templates/spec-template.md - Requirements align with functional constraints
  ✅ .specify/templates/tasks-template.md - Task categorization reflects principle-driven types
  ✅ .specify/templates/commands/*.md - No agent-specific references found

Follow-up TODOs: None
--&gt;

# OpenClaw Project Constitution

## Core Principles

### I. Gateway-Centric Architecture (NON-NEGOTIABLE)

All agent interactions MUST flow through the central Gateway. The Gateway is the single control plane for:

- WebSocket server (port 18789 by default)
- Message routing to appropriate agents
- Persistent session management
- Authentication (tokens/passwords)
- HTTP/WebSocket APIs

**Rationale**: This ensures consistent security, observability, and state management across all channels and agents. Bypassing the Gateway breaks session persistence, audit trails, and multi-tenant isolation.

### II. Multi-Agent Isolation

Each agent MUST be completely isolated with:

- Separate workspace directories
- Independent agent directories for state (`~/.openclaw/agents/{agentId}/`)
- Isolated session histories
- Distinct configurations (model, identity, tools)
- No cross-agent data access without explicit session tools

**Rationale**: Enables security boundaries, specialized skills per domain, separate conversation contexts, and flexible per-agent configurations. Prevents privilege escalation and data leakage between agents.

### III. Skill-Based Extensibility

Agent capabilities MUST be extended through the Skills system:

- Skills are self-contained directories with `SKILL.md` (required)
- Three-tier loading: metadata (always) → SKILL.md body (when selected) → references (as needed)
- Skills filtered by OS, required binaries, and environment
- AI-driven skill selection based on conversation context
- No hardcoded capabilities in agent core

**Rationale**: Enables community contributions, modular capability management, platform-specific features, and clear separation between framework and functionality.

### IV. Multi-Channel Support

All messaging platforms MUST be treated as first-class citizens:

- Core channels: Telegram, Discord, Slack, Signal, iMessage, WhatsApp
- Extension channels: Matrix, MS Teams, Zalo, BlueBubbles, etc.
- Consistent routing, allowlists, pairing, and command gating across all channels
- Channel-specific implementations isolated in plugins
- Shared logic lives in `src/routing/` and `src/channels/`

**Rationale**: OpenClaw's value proposition is universal access. Favoring one channel over others breaks the user experience and limits adoption.

### V. Session Persistence & State Management

Conversation state MUST be persisted across interactions:

- Session keys follow hierarchical format: `agent:{agentId}:{channel}:{accountId}:{peerType}:{peerId}:{context}`
- Sessions stored as JSONL files in `~/.openclaw/agents/{agentId}/sessions/`
- Each session entry contains: messages, tool calls, model usage, timestamps
- Session scoping configurable via `dmScope` (main, per-peer, per-channel-peer, per-account-channel-peer)

**Rationale**: Enables continuous conversations, context retention, debugging, and audit trails. JSONL format allows incremental writes and easy parsing.

### VI. Security by Default

Security MUST be enforced at multiple layers:

- **DM Pairing**: Unknown senders require pairing approval (default `dmPolicy="pairing"`)
- **Credential Encryption**: All credentials encrypted at rest (system keychain)
- **Sandbox Execution**: Non-main sessions run in Docker sandboxes
- **Audit Logging**: WHO did WHAT WHEN for all sensitive operations
- **Row-Level Security (RLS)**: Multi-tenant data isolation in PostgreSQL
- **Zero Trust**: Verify every request, no implicit trust

**Rationale**: OpenClaw connects to real messaging surfaces and executes code. Security failures expose user data, credentials, and systems.

### VII. Enterprise-Ready Multi-Tenancy

SaaS deployments MUST support complete tenant isolation:

- 4-layer isolation: Application filtering + PostgreSQL RLS + Session locks + Foreign key cascades
- RBAC with 5 roles: Owner, Admin, Developer, Operator, Viewer
- Per-tenant resource quotas (CPU, memory, disk, tokens)
- Comprehensive audit logging (immutable, append-only)
- SSO/SAML integration (Okta, Azure AD, Google Workspace)

**Rationale**: Enterprises require provable isolation, compliance (SOC 2, GDPR, ISO 27001), and centralized management. Logical partitioning enables cost-effective scaling to 10,000+ tenants.

### VIII. Observability & Debugging

All system behavior MUST be observable:

- Distributed tracing (OpenTelemetry + Jaeger) across gateway → agent → skill → provider
- Centralized logging (Elasticsearch) with structured JSON
- Metrics export (Prometheus) for uptime, latency, error rates
- Health checks (`/health`, `/ready`) for orchestration
- Session inspection tools (`openclaw sessions inspect <key>`)

**Rationale**: Production systems require visibility into failures, performance bottlenecks, and security events. Debugging opaque systems wastes engineering time.

### IX. TypeScript & Modern Tooling

Codebase MUST maintain high code quality:

- Language: TypeScript (ESM), strict typing, avoid `any`
- Formatting/linting: Oxlint and Oxfmt (run `pnpm check`)
- Testing: Vitest with 70% coverage thresholds (lines/branches/functions/statements)
- Runtime: Node 22+ (Bun supported for dev/scripts)
- Build: `pnpm build` produces `dist/` for production

**Rationale**: TypeScript prevents runtime errors, tooling catches bugs early, tests prevent regressions, and modern runtimes improve performance.

### X. Documentation & Developer Experience

All features MUST be documented:

- Architecture docs in `docs/architecture/` (OVERVIEW.md, IMPROVEMENTS.md, ENTERPRISE-ROADMAP.md)
- Channel docs in `docs/channels/`
- API docs generated from code
- Internal links: root-relative, no `.md` extension (Mintlify format)
- External links: full `https://docs.openclaw.ai/...` URLs
- No personal device names/paths in docs (use placeholders)

**Rationale**: Undocumented features are unusable. Good docs reduce support burden, enable community contributions, and accelerate onboarding.

## Development Workflow

### Code Review & Pull Requests

- **Commits**: Use `scripts/committer "<msg>" <file...>` to scope staging
- **Commit messages**: Concise, action-oriented (e.g., "CLI: add verbose flag to send")
- **PR scope**: Summarize changes, note testing, mention user-facing impacts
- **PR review**: Use `gh pr view`/`gh pr diff`, do NOT switch branches during review
- **PR merge**: Prefer rebase for clean history, squash for messy commits
- **Changelog**: Add entry with PR # and thank contributor
- **Testing**: Run `pnpm build && pnpm check && pnpm test` before final commit
- **Contributor recognition**: Add new contributors to README avatar list

### Testing Requirements

- **Unit tests**: Colocated `*.test.ts` files
- **Integration tests**: `*.e2e.test.ts` for cross-component flows
- **Live tests**: `CLAWDBOT_LIVE_TEST=1 pnpm test:live` (requires real API keys)
- **Coverage**: 70% minimum (lines/branches/functions/statements)
- **Mobile**: Prefer real devices over simulators when available
- **Pure test additions**: Generally no changelog entry unless behavior changes

### Release Process

- **Channels**: stable (tagged releases), beta (prereleases), dev (main branch)
- **Versioning**: `vYYYY.M.D` for stable, `vYYYY.M.D-beta.N` for beta
- **Changelog**: Keep latest version at top, bump after publishing
- **macOS app**: Follow `docs/platforms/mac/release.md`
- **npm publish**: Use 1Password skill for OTP, verify with `npm view <pkg> version`
- **Version locations**: Update `package.json`, iOS/Android/macOS Info.plist, docs

### Multi-Agent Safety

- **No stash**: Do NOT create/apply/drop `git stash` entries unless requested
- **No worktree**: Do NOT create/remove/modify `git worktree` checkouts
- **No branch switching**: Stay on current branch unless explicitly requested
- **Scoped commits**: Commit only your changes, not unrelated WIP
- **Pull before push**: `git pull --rebase` to integrate others' work
- **Lint auto-resolve**: Auto-stage formatting-only changes, ask for semantic changes

## Technology Constraints

### Runtime & Dependencies

- **Node.js**: 22+ required (Bun supported for dev)
- **Package manager**: pnpm (primary), Bun (supported)
- **TypeScript**: ESM modules, strict mode
- **Database**: PostgreSQL (multi-tenant with RLS) or JSONL (single-user)
- **Session store**: Redis (multi-gateway) or in-memory (single-gateway)
- **Observability**: OpenTelemetry, Jaeger, Prometheus, Grafana

### File Structure

- **Source**: `src/` (CLI in `src/cli`, commands in `src/commands`)
- **Tests**: Colocated `*.test.ts`
- **Docs**: `docs/` (Mintlify-hosted at docs.openclaw.ai)
- **Plugins**: `extensions/*` (workspace packages)
- **Build output**: `dist/`
- **Skills**: `~/.openclaw/workspace/skills/` (user-installed)

### Code Style

- **File size**: Aim for <700 LOC (guideline, not hard limit)
- **Comments**: Brief explanations for tricky logic
- **Naming**: OpenClaw (product), openclaw (CLI/package/paths)
- **Colors**: Use shared palette in `src/terminal/palette.ts`
- **Tool schemas**: No `Type.Union`, use `stringEnum` for enums, `Type.Optional` not `| null`

## Security Requirements

### Authentication & Authorization

- **Gateway auth**: Token or password (configurable via `gateway.auth.mode`)
- **DM pairing**: Require approval for unknown senders (default)
- **RBAC**: 5 roles with granular permissions (Owner, Admin, Developer, Operator, Viewer)
- **SSO/SAML**: Support Okta, Azure AD, Google Workspace
- **MFA**: Multi-factor authentication for gateway access

### Data Protection

- **Encryption at rest**: All credentials, sessions, PII encrypted (system keychain)
- **Encryption in transit**: TLS/SSL for all network communication
- **Secrets management**: Integrate with HashiCorp Vault or AWS Secrets Manager
- **Audit logging**: Immutable, append-only logs for all sensitive operations
- **Data retention**: Configurable policies, support right-to-erasure (GDPR)

### Sandbox & Isolation

- **Docker sandbox**: Non-main sessions run in isolated containers
- **Resource limits**: CPU, memory, disk quotas per tenant/agent
- **Network isolation**: Restrict egress to allowlisted domains
- **Filesystem isolation**: Read-only root, writable workspace/tmp only
- **Seccomp profiles**: Block dangerous syscalls (ptrace, mount, etc.)

## Compliance & Governance

### Regulatory Compliance

- **SOC 2 Type II**: Annual audit from Big 4 firm (6-month prep after implementation)
- **GDPR**: Data retention policies, right-to-erasure, data processing agreements
- **ISO 27001**: Information Security Management System (ISMS) framework
- **HIPAA**: Business Associate Agreement (BAA), additional encryption (if required)
- **PCI DSS**: Payment Card Industry Data Security Standard (if handling payments)

### Amendment Process

- **Proposal**: Document proposed changes in GitHub Discussion or Issue
- **Review**: Maintainers review for alignment with project vision
- **Approval**: Requires approval from Benevolent Dictator (Peter Steinberger)
- **Migration plan**: Document breaking changes, provide migration guide
- **Version bump**: MAJOR (breaking), MINOR (new principle), PATCH (clarification)
- **Communication**: Announce in Discord, update docs, add changelog entry

### Enforcement

- **PR reviews**: All PRs must verify compliance with constitution
- **CI/CD gates**: Automated checks for code style, tests, security
- **Complexity justification**: Non-obvious complexity requires explanation
- **Maintainer discretion**: Maintainers may grant exceptions for good reason
- **Community feedback**: Open to suggestions, but final decision with maintainers

## Governance

This constitution supersedes all other practices and guidelines. All pull requests, code reviews, and architectural decisions must verify compliance with these principles. Complexity and deviations must be explicitly justified and approved by maintainers.

For runtime development guidance, refer to `AGENTS.md`. For release procedures, see `docs/reference/RELEASING.md` and `docs/platforms/mac/release.md`.

**Amendments** require:

1. Documented proposal with rationale
2. Maintainer review and approval
3. Migration plan for breaking changes
4. Version bump (MAJOR for breaking, MINOR for additions, PATCH for clarifications)
5. Communication to community (Discord, docs, changelog)

**Version**: 1.0.0 | **Ratified**: 2026-02-02 | **Last Amended**: 2026-02-02
