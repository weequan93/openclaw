# Tasks: OpenClaw Enterprise Enhancements

**Input**: Design documents from `.specify/memory/` (spec.md, plan.md, constitution.md)
**Prerequisites**: plan.md (required), spec.md (required)

**Tests**: Tests are included for enterprise features requiring compliance validation

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US8)
- Include exact file paths in descriptions

## Path Conventions

- TypeScript source: `src/` at repository root
- Tests: Colocated `*.test.ts` files
- Documentation: `docs/`
- Configuration: Root directory

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for enterprise features

- [x] T001 Review existing OpenClaw architecture in docs/architecture/OVERVIEW.md
- [x] T002 [P] Create enterprise feature branch from main (Using dev branch + feature flags)
- [x] T003 [P] Update package.json with PostgreSQL dependencies (pg, @types/pg)
- [x] T004 [P] Update package.json with observability dependencies (OpenTelemetry, Jaeger client)
- [x] T005 [P] Update package.json with SSO dependencies (passport, passport-saml)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create PostgreSQL schema design document in docs/architecture/database-schema.md
- [x] T007 [P] Design Row-Level Security (RLS) policies in docs/architecture/rls-policies.md
- [x] T008 [P] Design RBAC permission matrix in docs/architecture/rbac-matrix.md
- [x] T009 Create database migration framework in src/infra/migrations/
- [x] T010 [P] Implement database connection pool in src/infra/database/pool.ts
- [x] T011 [P] Implement tenant context middleware in src/infra/database/tenant-context.ts
- [x] T012 Create OpenTelemetry configuration in src/infra/observability/telemetry.ts
- [x] T013 [P] Implement distributed tracing spans in src/infra/observability/tracing.ts
- [x] T014 [P] Implement Prometheus metrics exporter in src/infra/observability/metrics.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 5 - Enterprise Multi-Tenant SaaS (Priority: P2) 🎯 MVP

**Goal**: Host OpenClaw for multiple organizations with complete data isolation, per-tenant billing, and centralized management

**Independent Test**: Create two tenants, have each create agents and sessions, verify neither tenant can access the other's data via SQL queries or API calls

### Implementation for User Story 5

- [ ] T015 [P] [US5] Create Tenant model in src/models/tenant.ts
- [ ] T016 [P] [US5] Create User model with tenant_id in src/models/user.ts
- [ ] T017 [P] [US5] Create Agent model with tenant_id in src/models/agent.ts
- [ ] T018 [P] [US5] Create Session model with tenant_id in src/models/session.ts
- [ ] T019 [P] [US5] Create AuditLog model in src/models/audit-log.ts
- [ ] T020 [US5] Create PostgreSQL migration 001_create_tenants_table in src/infra/migrations/001_create_tenants.sql
- [ ] T021 [US5] Create PostgreSQL migration 002_create_users_table in src/infra/migrations/002_create_users.sql
- [ ] T022 [US5] Create PostgreSQL migration 003_create_agents_table in src/infra/migrations/003_create_agents.sql
- [ ] T023 [US5] Create PostgreSQL migration 004_create_sessions_table in src/infra/migrations/004_create_sessions.sql
- [ ] T024 [US5] Create PostgreSQL migration 005_create_audit_logs_table in src/infra/migrations/005_create_audit_logs.sql
- [ ] T025 [US5] Implement Row-Level Security policies in src/infra/migrations/006_enable_rls.sql
- [ ] T026 [US5] Implement TenantService in src/services/tenant-service.ts
- [ ] T027 [US5] Implement UserService with RBAC in src/services/user-service.ts
- [ ] T028 [US5] Implement AgentService with tenant isolation in src/services/agent-service.ts
- [ ] T029 [US5] Implement SessionService with PostgreSQL backend in src/sessions/postgres-session-manager.ts
- [ ] T030 [US5] Implement AuditLogService in src/services/audit-log-service.ts
- [ ] T031 [US5] Implement ResourceQuotaService in src/services/resource-quota-service.ts
- [ ] T032 [US5] Add tenant context to Gateway routing in src/gateway/server.ts
- [ ] T033 [US5] Implement tenant admin API endpoints in src/api/tenant-admin.ts
- [ ] T034 [US5] Implement billing integration hooks in src/services/billing-service.ts
- [ ] T035 [US5] Add tenant isolation validation tests in src/services/tenant-service.test.ts
- [ ] T036 [US5] Add RLS penetration tests in tests/security/rls-penetration.test.ts

**Checkpoint**: At this point, User Story 5 should be fully functional and testable independently

---

## Phase 4: User Story 6 - Self-Hosted Enterprise Deployment (Priority: P2)

**Goal**: Deploy OpenClaw in private cloud with SSO integration, audit logging, and license management

**Independent Test**: Deploy OpenClaw in Kubernetes cluster, configure SSO with Okta, verify users can authenticate and all actions are audit logged

### Implementation for User Story 6

- [ ] T037 [P] [US6] Create Dockerfile for Gateway in Dockerfile
- [ ] T038 [P] [US6] Create Kubernetes Deployment manifest in k8s/deployment.yaml
- [ ] T039 [P] [US6] Create Kubernetes Service manifest in k8s/service.yaml
- [ ] T040 [P] [US6] Create Kubernetes Ingress manifest in k8s/ingress.yaml
- [ ] T041 [P] [US6] Create Kubernetes ConfigMap manifest in k8s/configmap.yaml
- [ ] T042 [P] [US6] Create Kubernetes Secret manifest in k8s/secret.yaml
- [ ] T043 [US6] Create Helm chart structure in helm/openclaw/
- [ ] T044 [US6] Implement Helm values.yaml with configurable parameters in helm/openclaw/values.yaml
- [ ] T045 [US6] Implement Helm templates in helm/openclaw/templates/
- [ ] T046 [P] [US6] Implement SSO/SAML authentication in src/auth/saml-auth.ts
- [ ] T047 [P] [US6] Implement OAuth2/OIDC authentication in src/auth/oauth-auth.ts
- [ ] T048 [P] [US6] Implement JWT token issuance in src/auth/jwt-service.ts
- [ ] T049 [P] [US6] Implement MFA support in src/auth/mfa-service.ts
- [ ] T050 [US6] Implement license validation service in src/services/license-service.ts
- [ ] T051 [US6] Implement seat limit enforcement in src/services/license-service.ts
- [ ] T052 [US6] Add health check endpoint /health in src/gateway/health.ts
- [ ] T053 [US6] Add readiness check endpoint /ready in src/gateway/health.ts
- [ ] T054 [US6] Implement graceful shutdown in src/gateway/server.ts
- [ ] T055 [US6] Add Kubernetes deployment documentation in docs/deployment/kubernetes.md
- [ ] T056 [US6] Add SSO configuration guide in docs/deployment/sso-setup.md
- [ ] T057 [US6] Add integration tests for Okta SSO in tests/integration/okta-sso.e2e.test.ts
- [ ] T058 [US6] Add integration tests for Azure AD SSO in tests/integration/azure-ad-sso.e2e.test.ts

**Checkpoint**: At this point, User Stories 5 AND 6 should both work independently

---

## Phase 5: User Story 8 - Developer Console & Debugging (Priority: P3)

**Goal**: Debug agent behavior with distributed tracing, log viewing, and session inspection tools

**Independent Test**: Trigger an error, view the trace in Jaeger, verify the full request path is visible

### Implementation for User Story 8

- [ ] T059 [P] [US8] Implement OpenTelemetry tracing in Gateway in src/gateway/server.ts
- [ ] T060 [P] [US8] Implement OpenTelemetry tracing in routing in src/routing/resolve-route.ts
- [ ] T061 [P] [US8] Implement OpenTelemetry tracing in agents in src/agents/pi-embedded-runner/run.ts
- [ ] T062 [P] [US8] Implement OpenTelemetry tracing in skills in src/agents/skills/workspace.ts
- [ ] T063 [US8] Implement Jaeger exporter configuration in src/infra/observability/jaeger.ts
- [ ] T064 [P] [US8] Implement Prometheus metrics for gateway uptime in src/infra/observability/metrics.ts
- [ ] T065 [P] [US8] Implement Prometheus metrics for message processing in src/infra/observability/metrics.ts
- [ ] T066 [P] [US8] Implement Prometheus metrics for agent queue depth in src/infra/observability/metrics.ts
- [ ] T067 [P] [US8] Implement Prometheus metrics for error rates in src/infra/observability/metrics.ts
- [ ] T068 [US8] Create Grafana dashboard JSON for system health in grafana/dashboards/system-health.json
- [ ] T069 [US8] Create Grafana dashboard JSON for distributed tracing in grafana/dashboards/tracing.json
- [ ] T070 [US8] Implement log aggregation to Elasticsearch in src/logging/elasticsearch.ts
- [ ] T071 [US8] Enhance session inspection CLI command in src/cli/commands/sessions-inspect.ts
- [ ] T072 [US8] Add distributed tracing documentation in docs/observability/tracing.md
- [ ] T073 [US8] Add Grafana dashboard setup guide in docs/observability/grafana-setup.md
- [ ] T074 [US8] Add integration tests for distributed tracing in tests/integration/tracing.e2e.test.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 7 - Web Chat Interface (Priority: P3)

**Goal**: Chat with AI assistant through web browser without installing messaging apps

**Independent Test**: Open web UI, send messages, verify responses appear with full conversation history

### Implementation for User Story 7

- [ ] T075 [P] [US7] Create React frontend structure in ui/src/
- [ ] T076 [P] [US7] Implement WebSocket client in ui/src/services/websocket.ts
- [ ] T077 [P] [US7] Implement chat message component in ui/src/components/ChatMessage.tsx
- [ ] T078 [P] [US7] Implement chat input component in ui/src/components/ChatInput.tsx
- [ ] T079 [P] [US7] Implement conversation history component in ui/src/components/ConversationHistory.tsx
- [ ] T080 [US7] Implement chat page in ui/src/pages/ChatPage.tsx
- [ ] T081 [US7] Implement session sync with backend in ui/src/services/session-sync.ts
- [ ] T082 [US7] Implement image upload handling in ui/src/services/media-upload.ts
- [ ] T083 [US7] Add web chat API endpoints in src/web/chat-api.ts
- [ ] T084 [US7] Add authentication for web chat in src/web/auth.ts
- [ ] T085 [US7] Add web UI build to production bundle in scripts/ui.js
- [ ] T086 [US7] Add web chat documentation in docs/channels/web-chat.md
- [ ] T087 [US7] Add E2E tests for web chat in tests/integration/web-chat.e2e.test.ts

**Checkpoint**: Web chat interface should be fully functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T088 [P] Update architecture documentation in docs/architecture/OVERVIEW.md
- [ ] T089 [P] Update enterprise roadmap in docs/architecture/ENTERPRISE-ROADMAP.md
- [ ] T090 [P] Add multi-tenant deployment guide in docs/deployment/multi-tenant.md
- [ ] T091 [P] Add security hardening guide in docs/security/hardening.md
- [ ] T092 [P] Add compliance checklist (SOC 2) in docs/compliance/soc2-checklist.md
- [ ] T093 Code cleanup and refactoring across enterprise features
- [ ] T094 Performance optimization for PostgreSQL queries
- [ ] T095 Security audit of RLS policies and tenant isolation
- [ ] T096 Load testing with 1000 concurrent users
- [ ] T097 Penetration testing for cross-tenant isolation
- [ ] T098 Update CHANGELOG.md with enterprise features
- [ ] T099 Update README.md with enterprise deployment options
- [ ] T100 Run full test suite (pnpm build && pnpm check && pnpm test)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (US5 → US6 → US8 → US7)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 6 (P2)**: Can start after Foundational (Phase 2) - Integrates with US5 for tenant management
- **User Story 8 (P3)**: Can start after Foundational (Phase 2) - Independent observability infrastructure
- **User Story 7 (P3)**: Can start after Foundational (Phase 2) - Uses existing Gateway/Session infrastructure

### Within Each User Story

- Models before services
- Services before API endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 5

```bash
# Launch all models for User Story 5 together:
Task: "Create Tenant model in src/models/tenant.ts"
Task: "Create User model with tenant_id in src/models/user.ts"
Task: "Create Agent model with tenant_id in src/models/agent.ts"
Task: "Create Session model with tenant_id in src/models/session.ts"
Task: "Create AuditLog model in src/models/audit-log.ts"
```

---

## Implementation Strategy

### MVP First (User Story 5 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 5 (Multi-Tenant SaaS)
4. **STOP and VALIDATE**: Test User Story 5 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 5 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 6 → Test independently → Deploy/Demo
4. Add User Story 8 → Test independently → Deploy/Demo
5. Add User Story 7 → Test independently → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 5 (Multi-Tenant)
   - Developer B: User Story 6 (Self-Hosted)
   - Developer C: User Story 8 (Observability)
   - Developer D: User Story 7 (Web Chat)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Enterprise features require PostgreSQL, Kubernetes, and observability infrastructure
- Security testing (penetration, RLS validation) is critical for multi-tenant compliance
