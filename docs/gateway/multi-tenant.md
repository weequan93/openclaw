---
summary: "Current baseline, key gaps, and phased blueprint for single instance multi user isolation"
read_when:
  - Designing a single OpenClaw deployment for multiple users
  - Planning user isolation for sessions memory skills nodes and agents
title: "Multi user roadmap"
---

# Multi user roadmap

This document captures the current baseline for running one OpenClaw gateway for multiple users, the key gaps, and a phased implementation blueprint.

Baseline timestamp: February 11, 2026.

Implementation status update: February 13, 2026.

- Admin-only gateway policy bundle methods are implemented:
  - `config.policyBundles.list`
  - `config.policyBundle.resolve`
  - `config.policyBundle.apply`
- Safe presets are available: `single_user`, `multi_user_isolated`, `strict_admin_control`.
- Security admin UI includes policy bundle controls to list, preview, and apply a selected bundle.
  - Bundle apply uses `config.policyBundle.apply` (with fallback to `config.patch`) and requires config base hash.
- Gateway tests now cover policy bundle apply flow end-to-end via `config.policyBundle.apply` and `config.patch`.
- CI sensitive-gateway merge gate now covers additional authz and ownership control points (`call`, shared gateway handlers, config and ownership methods, and session utility paths) and requires related test updates when these change.
- Skill visibility now enforces owner-aware filtering in runtime prompt construction and slash-skill discovery paths.
  - `shared` skills remain visible to all users.
  - `user_private` skills are hidden from non-owners in strict mode, with compat-mode fallback behavior.
  - Skill secret env injection now applies the same visibility checks so non-owner runs do not receive private skill credentials.
  - `skills.bins` now applies the same visibility filter so private skill dependency metadata is not exposed to non-owners.
  - `skills.status` and `skills.bins` now enforce agent ownership checks so non-admin users cannot query skill metadata for agents they do not own.
- Control-plane scope hardening now marks user-facing control-plane mutation RPCs (`voicewake.set`, `tts.enable`, `tts.disable`, `tts.setProvider`, `talk.mode`, `wake`) and system-control mutation RPCs (`set-heartbeats`, `system-event`, `channels.logout`) as admin-only, so `operator.write` user sessions cannot mutate gateway runtime controls or settings.
- Gateway authz unit coverage now includes explicit scope-class checks for pairing (`operator.pairing`) and approvals (`operator.approvals`) paths, plus node-role-only method handling for node emitters.
- Strict-mode auth/connect e2e coverage now verifies mapped non-admin principals must present dedicated scopes for pairing and approvals flows:
  - `node.pair.list` denies without `operator.pairing` (including admin-without-pairing scope combos) and allows with `operator.pairing`.
  - `exec.approval.resolve` denies without `operator.approvals` (including admin-without-approvals scope combos) and proceeds to handler validation when `operator.approvals` is granted.
  - `device.pair.*` and `device.token.*` methods deny without `operator.pairing` (including admin-without-pairing scope combos) and proceed to handler-level validation when `operator.pairing` is granted.
- Built-in `gateway` agent tool now enforces admin-only control-plane actions for owner-bound runs when multi-user mode is enabled.
  - The tool is hidden from non-admin owner-bound tool lists in multi-user mode.
  - Non-admin owner-bound runs are denied for gateway restart, config, and update actions.
  - Owner context is now propagated through embedded runner and inline tool-dispatch paths so this guard applies to normal user chat flows.
- Built-in `cron` agent tool now follows the same owner-bound admin control-plane policy in multi-user mode.
  - The tool is hidden from non-admin owner-bound tool lists in multi-user mode.
  - Non-admin owner-bound direct tool execution is denied by default.
- Internal gateway calls from owner-aware agent tools now propagate owner identity (`userId`, `principalId`, optional `alias`) into gateway connect context.
  - Applies to gateway, cron, browser, canvas, nodes, and sessions tool flows routed through `callGateway` or `callGatewayTool`.
  - Identity payload emission is conditional so legacy call paths remain shape-compatible when no owner context exists.
- Gateway method classification now includes `sessions.resolve` as a read operation, removing admin-scope fallback for common session lookup flows.
- Session tools now propagate owner identity for session discovery and history retrieval paths (`sessions.list`, `sessions.resolve`, `chat.history`) including shared helper resolution and agent-to-agent announce-target lookup.
- Subagent lifecycle follow-up RPCs now preserve owner identity (wait, announce, patch, cleanup delete, and persisted registry resume paths) so spawned-run completion handling remains owner-scoped.
- `/subagents` command runtime calls (`chat.history`, `agent`, `agent.wait`) now execute with the resolved owner identity, preventing unscoped follow-up access in owner-bound sessions.
- `/approve` control command now includes resolved owner identity on approval resolution RPCs for consistent actor attribution and policy evaluation.
- `/ptt` command handler gateway calls now carry resolved owner identity (`node.list`, `node.pair.list`, `node.invoke`) to keep node-control lookups owner-scoped if the command is enabled.
  - In owner-bound mode, `/ptt` no longer falls back to pairing-list RPCs (`node.pair.list`), avoiding higher-scope control-plane fallback in user flows.
- Command-side owner identity resolution is centralized in shared reply-command helper logic to keep `/approve`, `/subagents`, and `/ptt` behavior consistent.
  - Gateway owner alias now propagates through this identity helper (`identity.alias`) for owner-aware command RPCs and audit attribution.
- Strict-mode provisioning safeguards now require explicit ownership metadata for newly created resources:
  - `agents.create` requires `ownerUserId` when `gateway.multiUser.mode` is explicitly set to `strict`.
  - `agents.update` now denies ownerless-agent updates in explicit `strict` mode unless an owner is already set or provided.
  - `node.pair.approve` requires `ownerUserId` when `gateway.multiUser.mode` is explicitly set to `strict`.
  - Browser profile creation requires `ownerUserId` for non-shared profiles when `gateway.multiUser.mode` is explicitly set to `strict`.
- Browser extension relay profile access is now restricted for non-admin users:
  - Non-admin access requires explicit owner binding (`ownerUserId`) on the selected extension relay profile.
  - Compat mode no longer allows fallback access to unowned extension relay profiles.
- Command-plane authorization denials now emit authz deny events for admin security visibility:
  - `/config` and `/debug` denials are recorded with reason codes (`UNKNOWN_SENDER` or `ROLE_FORBIDDEN`) under `command.config`/`command.debug`.
  - `/allowlist` denials are recorded with reason codes (`UNKNOWN_SENDER` or `ROLE_FORBIDDEN`) under `command.allowlist`.
  - `/approve` denials are recorded with reason codes (`UNKNOWN_SENDER`, `SCOPE_MISSING`, or `ROLE_FORBIDDEN`) under `command.approve`.
  - `/approve` now requires admin principal role when using `operator.admin` scope; mapped non-admin principals with admin scope are denied.
  - In strict or compat modes, `/approve` with `operator.admin` now also denies when principal role is missing (admin role must be explicitly resolved); approvals scope (`operator.approvals`) remains valid for approval operators.
  - Command-side admin paths (`/config`, `/debug`, `/allowlist`, and `/tts` settings mutation) now require both `operator.admin` scope and resolved principal role `admin` in gateway multi-user modes.
  - Real gateway chat command-path e2e coverage now verifies mapped non-admin principals with requested `operator.admin` scope receive `ROLE_FORBIDDEN` deny events for `/config`, `/debug`, `/allowlist`, `/tts on`, and `/approve`.
  - Real gateway chat command-path e2e now also verifies mapped principals without an explicit role are treated as non-admin for admin-only command checks.
  - Admin security panel quick filters now include `ROLE_FORBIDDEN` to triage blocked privilege-escalation attempts quickly.
  - Unauthorized sender denials for `/bash`, `/ptt`, and `/subagents` are recorded under `command.bash`, `command.ptt`, and `command.subagents`.
  - Unauthorized sender denials for session control commands (`/activation`, `/send`, `/usage`, `/restart`, `/stop`) are recorded under `command.activation`, `command.send`, `command.usage`, `command.restart`, and `command.stop`.
  - Unauthorized sender denials for additional command paths (`/reset`, `/compact`, `/tts`, `/help`, `/commands`, `/status`, `/context`, `/whoami`) are recorded under `command.reset`, `command.compact`, `command.tts`, `command.help`, `command.commands`, `command.status`, `command.context`, and `command.whoami`.
  - Unauthorized sender denials for `/models` and auth-required plugin commands are recorded under `command.models` and `command.plugin`.
  - Owner alias is now propagated into command deny events (`userAlias`) so admin security feeds can display alias while ownership enforcement stays UUID-based.
  - Command deny audit events now include gateway client attribution (`clientId`, `clientMode`) and source IP when available.
  - Real gateway chat command authz e2e now verifies deny-event source IP attribution through trusted-proxy forwarding headers.
  - Command deny audit role attribution no longer infers `admin` from scope alone when principal role is unresolved.
  - Gateway connect owner-role resolution now treats mapped principals without explicit role as non-admin even when `operator.admin` scope is requested.
    - Legacy non-mapped principals keep admin-scope role inference for backward compatibility.
  - Security admin UI gating now prefers resolved `principalRole` from hello metadata over scope-only checks, so mapped non-admin principals with requested admin scope do not get admin controls.
  - `/tts` setting mutations (`on`/`off` and changing provider/limit/summary) are now admin-only in gateway multi-user mode; non-admin denials are logged under `command.tts` while `/tts status` and `/tts audio` remain available to users.
- Cross-user runtime denial observability is covered in e2e tests:
  - Owner-mismatch denials for `chat.history`/`chat.send`/`chat.abort`, `sessions.delete`/`sessions.compact`, `node.invoke`/`node.describe`, and `browser.request` are asserted in `authz.denied.list` responses with owner alias metadata.
- Runtime event fanout isolation is covered in e2e tests:
  - Owner-scoped `agent`/`chat` runtime events are asserted to deliver to owner-authorized clients while non-admin cross-user clients do not receive those run events.
- Chat run ownership now registers consistently for strict-mode `agent.wait` checks:
  - `chat.send` registers run owner mapping for both client run ids and agent-start run ids so owner-bound callers can use `agent.wait` without false owner-mismatch denials.
- Admin-managed identity mappings are now supported under `gateway.multiUser.identities`:
  - Connect owner resolution can map inbound principals (`device:*`, `client:*`, and explicit principal ids) to canonical `userId`, `principalId`, alias, and group ids.
  - `hello-ok` auth metadata now includes resolved `principalRole` for mapped owner context so admin UI gating can distinguish real admin principals from scope-only requests.
  - Config validation now warns when mapped identities omit explicit `role` in effective multi-user enforcement mode, so admins can fix mappings before runtime authorization denials.
  - `openclaw security audit` now warns when mapped identities omit explicit role while multi-user mode enforcement is active.
  - Admin UI now surfaces current config validation warnings in both Security and Config views, including missing identity-role mapping warnings from `config.get`.
  - Security admin UI now includes a dedicated "Identity Mapping Role Gaps" view to list principals missing explicit identity role mapping.
  - Control UI now treats admin settings surfaces as admin-only in multi-user mode (`Security`, `Config`, `Debug`, and `Logs`): non-admin principals do not see those tabs and direct-route refresh paths are blocked.
  - Control UI non-admin usage paths (`Overview`, `Channels`, and `Nodes`) now skip admin-oriented config/debug/exec-approval reads so user views stay usage-only.
  - Control UI now keeps `Channels` and `Nodes` mutation controls admin-only in multi-user mode: non-admin principals get read-only usage views, and client-side mutation callbacks are no-op unless admin authorization is resolved.
  - Strict-mode authz deny feeds now reflect mapped alias and principal metadata for mapped users.
  - `operator.admin` access now requires resolved principal role `admin`; mapped `user` principals cannot elevate by requesting admin scope in the connect payload, including system-control methods (`set-heartbeats`, `system-event`, `channels.logout`).
  - Strict-mode shared-auth connect bypass for unknown sender identity is now limited to admin-scoped clients; non-admin shared-auth connections without sender identity are denied.
  - Strict mode now ignores self-asserted connect identity from untrusted non-admin shared-auth callers, preventing shared-token impersonation via raw `identity.userId` or `identity.principalId`; trusted local device-backed internal clients remain able to carry explicit owner context.
- Skill visibility now supports `group_shared` in addition to `shared` and `user_private`:
  - `group_shared` visibility is enforced in `skills.status`, `skills.bins`, runtime prompt construction, and skill env-secret injection paths.
  - `skills.update` enforces `groupIds` for `group_shared` and `ownerUserId` for `user_private`.
- Node-role skill bin discovery is now owner-scoped in multi-user mode:
  - `skills.bins` resolves paired node owner metadata and applies that owner as the visibility and agent-ownership viewer.
  - Strict mode denies node callers without resolved node ownership metadata (`OWNER_MISMATCH`) instead of returning broad skill dependency metadata.
- Cross-owner delegation policy is now available under `gateway.multiUser.delegation` and disabled by default:
  - Delegation rules can explicitly allow specific users to access another user's `agents`, `nodes`, `sessions`, and `browser` resources.
  - Agent, node, session, and browser ownership checks now honor delegation rules when enabled by admins.
  - `browser.request` now honors browser delegation in node-owner checks, and e2e coverage verifies delegated browser proxy access end-to-end.
  - `browser.request` now enforces profile-owner and node-owner alignment for non-admin node-proxy calls, preventing cross-owner profile and node mixing in a single request.
  - E2E coverage verifies delegated browser access is still denied when profile owner and node owner differ.
  - `sessions.usage`, `sessions.usage.timeseries`, and `sessions.usage.logs` now honor `sessions` delegation rules for owner-mismatch reads.
  - `sessions.resolve` now honors `sessions` delegation rules for key, sessionId, and label lookups.
  - `sessions.list` now includes delegated owner sessions when a matching `sessions` delegation rule exists.
  - `chat.history`, `chat.send`, and `chat.abort` now have e2e coverage for delegated session access.
  - `send` now enforces session ownership for both explicit `sessionKey` mirroring and derived target-session mirroring, denying cross-owner keys with `OWNER_MISMATCH` in owner-restricted mode.
  - `send` mirroring now applies ownership stamping for both explicit and derived session routes in owner-restricted mode, preserving existing owner bindings during delegated access.
  - E2E coverage now verifies delegated `send` access does not transfer session ownership away from the original owner.
  - E2E coverage now verifies direct `send` calls are denied when a non-admin caller targets another user’s session by explicit key or derived route.
  - `agent.wait` now honors `agents` delegation rules for cross-owner run wait access.
  - `agents.list` now includes delegated owner agents when a matching `agents` delegation rule exists.
  - Owner-scoped runtime event fanout (`chat` and `agent`) now supports explicit delegated session access while preserving admin visibility and deny-by-default for unresolved owners.
  - Session ownership stamping now preserves existing owner bindings during delegated access, preventing ownership takeover on delegated `sessions.patch`/`sessions.reset` paths.
  - Shared session listing helper filters (`listSessionsFromStore` with `ownerUserId`) now honor `sessions` delegation rules for consistent behavior across callers.
- Ownership migration surfaces now include memory checks:
  - `ownership.gaps` and `ownership.backfill` support `memory` resource scanning for QMD ownership partition readiness.
  - Memory backfill safely templates `memory.qmd.sessions.exportDir` with `{ownerUserId}` and reports unresolved custom QMD path ownership entries for admin review.
  - Admin security panel ownership views and backfill controls now include `memory` as a first-class resource target.
- Sandbox ownership defaults are hardened for multi-user modes:
  - `agents.defaults.sandbox.scope=shared` is auto-coerced to `agent` scope when multi-user mode is `compat` or `strict` to avoid cross-user sandbox mixing.

Scope decision:

- One OpenClaw instance supports multiple users.
- Different tenants or organizations should run separate instances.

## Current baseline

- Session routing and isolation primitives already exist.
  - Agent routing supports bindings by channel, account, peer, guild, and team, and resolves canonical agent session keys.
  - Direct message isolation modes exist through `session.dmScope` (`main`, `per-peer`, `per-channel-peer`, `per-account-channel-peer`).
- Gateway access control already has roles and scopes.
  - WebSocket clients present `role` and `scopes`.
  - Gateway methods are gated by `operator.read`, `operator.write`, `operator.admin`, `operator.approvals`, and `operator.pairing`.
- Agent and skills scoping primitives already exist.
  - Agents can have isolated workspaces and per-agent skill filters.
  - Skills load from layered locations and are filtered per agent.
- Node controls already exist.
  - Node pairing exists with device tokens and scopes.
  - Node command invocation is checked against command allowlists.
- Admin configuration surfaces already exist.
  - Gateway supports `config.apply` and `config.patch`.
  - In channel flows, `/config` and `/allowlist` commands exist for authorized senders when enabled.

## Key gaps to close

1. No first class user identity through the full stack.
   There is no mandatory `userId` in auth context, session records, memory records, skill visibility, or node and agent ownership.
2. Role and scope model is not user ownership aware.
   Current roles are `operator` and `node`. A missing scope list can default an operator connection to admin scope, which is unsafe for untrusted multi-user usage.
3. Session and chat APIs are not owner filtered.
   Session listing can aggregate across agents and stores. Chat and agent events are generally broadcast by role and scope, not user ownership.
4. Memory isolation is policy based, not hard user namespacing.
   Current memory scoping is based on channel, chat type, and key prefix policies. It does not enforce a required user partition key.
5. Skills do not have shared versus private user visibility.
   Skills can be filtered per agent, but there is no central visibility model such as shared by all users and private per user.
6. Nodes and agents are not owner bound to a user principal.
   Node invocation is command allowlist based, but there is no built in ownership enforcement between caller, agent, and node.
7. User configuration pathways can still mutate runtime behavior.
   Config mutation can be exposed to non-admin user paths if command toggles are enabled, while the requirement is admin-only control plane and user-only usage plane.
8. Security controls need explicit anti bypass guarantees.
   The platform needs deny-by-default resource authorization checks, user-tagged audit logs, and policy tests that prove no cross-user reads or writes.

## Implementation blueprint

### Phase 1 user identity model

1. Introduce principal model.
   Add required `userId` and `principalId` to runtime auth context. Keep actor `type` explicit: `admin`, `user`, `node`, `service`.
   - `userId`: immutable UUID used as the internal ownership key.
   - `alias`: human friendly name used in user-facing responses and admin views.
2. Add identity mapping layer.
   Map inbound sender identities to `userId` and `principalId`. Support admin-managed mapping and optional identity aliasing across channels.
   - `principalId` format: namespaced source identifiers, for example `msg:telegram:default:123456789`, `node:<deviceId>`, `admin:<deviceId>`.
   - Mapping ownership: maintained centrally by admins only.
3. Define resource ownership contract.
   Every resource carries ownership metadata: sessions, memory entries, agents, nodes, skills, files, and chat runs.

### Phase 2 authorization and control plane split

1. Lock actor model for authorization.
   - Human roles: `admin`, `user`.
   - Non-human actors: `node`, `service` (internal machine actors, not interactive human roles).
2. Replace implicit scope defaults.
   Remove auto escalation to admin when scopes are omitted. Reject ambiguous roles and missing required scopes.
3. Define scope model and assignment.
   - Admin principals can be assigned scopes such as `read`, `write`, `admin`, `approvals`, and `pairing`.
   - User principals do not receive system-configuration scopes.
4. Introduce centralized authz checks.
   Add one authorization function for all gateway methods with input `(actor, action, resource, owner)` and output `(allow or deny, reason code)`.
   - Unknown senders are denied by default.
   - Any unauthorized access attempt is denied by default.
5. Split admin plane and user plane.
   - Admin plane: configuration, user mapping, pairing approvals, policy management, and other control-plane operations.
   - User plane: prompt usage and execution of granted skills within owned resources.
   - Users cannot modify system configuration.
   - Users can perform domain actions through granted skills (for example editing database data) when skill policy allows it.
6. Define method-to-scope and ownership enforcement.
   - Control-plane methods (`config.*`, identity mapping, policy and pairing administration) require admin role and matching scopes.
   - Runtime methods (`chat.*`, `sessions.*`, skill execution) require user role plus owner match checks.
   - Owner mismatch denies unless an admin uses explicit audited override.
7. Define deny response contract.
   Denied requests return explicit reason codes (`ROLE_FORBIDDEN`, `SCOPE_MISSING`, `OWNER_MISMATCH`, `POLICY_DENY`) and never silently fallback to broader access.
8. Add denied access observability.
   Every deny decision writes an audit event with timestamp, `principalId`, resolved `userId` (if any), action, resource, source channel or IP, and reason. The admin panel must expose a view for denied access events.

### Phase 3 data isolation for sessions and memory

1. User-prefixed session namespace.
   Use `userId` as the partition boundary for all session data.
   Keep current session key shape for compatibility, but persist sessions in user-partitioned storage with `ownerUserId` metadata.
2. User-scoped session stores.
   Store and query sessions by user partition. Ensure list and preview APIs only return caller-owned data unless caller is admin.
   - `sessions.*` and `chat.*` must enforce owner match by default.
   - Cross-user admin access requires explicit `ownerUserId` filter and audited access logging.
3. User-scoped memory backend.
   Add `userId` partition keys for builtin and qmd memory paths. Keep policy filters as a second layer, not the primary isolation boundary.
   - Builtin memory uses per-user namespaces or paths by default.
   - QMD memory uses per-user index partitions (prefer separate DB per user for hard isolation).
4. Identity remap behavior.
   When an inbound sender is remapped to a different `userId`, start a fresh session and memory context by default (no automatic history carryover).
5. Browser ownership split.
   Browser task execution must resolve ownership before routing to host browser, sandbox browser, or node browser proxy.
   - Server-side profile mapping defines which browser profiles a `userId` can access.
   - User-supplied `profile` is treated as a hint and denied when not owned or permitted.
   - Chrome relay profiles (for existing personal tabs) are restricted to admin-only or explicitly owner-bound profiles.
   - Node browser proxy calls require ownership match across caller, selected profile, and target node.

### Phase 4 skill visibility model

1. Add skill visibility levels.
   - `global_shared`: available to all users, admin managed.
   - `group_shared`: available only to assigned user groups, admin managed.
   - `user_private`: available only to one user or principal, admin managed.
2. Add policy enforcement on skill execution.
   Resolve available skills from `(userId, principalId, agentId)` before prompt construction and invocation. Deny direct invocation outside visibility policy.
3. Lock configuration ownership.
   Only admins can create or update skill visibility policy. Users cannot modify skill visibility.
4. Lock prompt and discovery exposure.
   Only allowed skills are injected into user prompt context and shown in user-facing skill lists. Hidden skills are not discoverable through normal user flows.
5. Scope secrets by visibility boundary.
   Skill secrets and credentials must follow skill visibility scope. `user_private` skills use user-scoped secret slots, not global fallbacks.
6. Add skill access auditing.
   Log skill allow and deny decisions with `userId`, `principalId`, `skillId`, `agentId`, action, and reason. Admin panel exposes denied skill attempts.
7. Rollout default.
   Start with `global_shared` and `user_private` in strict mode. Add `group_shared` only when group-level sharing is explicitly needed.

### Phase 5 ownership for nodes and agents

1. User-owned agents.
   Require each agent config to include `ownerUserId` (UUID). Enforce that user requests only resolve to agents they own unless delegated policy exists.
2. User-owned nodes.
   Bind paired nodes to required `ownerUserId` metadata. Enforce `node.invoke` only when caller owner matches node owner and command policy allows it.
3. Delegation policy.
   Cross-owner delegation is disabled by default. Admins can add explicit delegation rules where needed.
4. Enforcement contract.
   Runtime checks for node and agent access require both ownership match and policy allowlist pass.
5. Reassignment behavior.
   Changing node or agent ownership requires explicit admin action and audit logging. Existing active sessions for previous owners are cut off by default, or migrated only by explicit admin choice.

### Phase 6 centralized admin panel

1. Admin-only configuration UI.
   Expose config editing, user provisioning, access policy, node and agent binding, and skill visibility only in admin panel.
   - Admin-only operations include identity mapping changes, node pairing approvals, ownership reassignment, and policy updates.
2. Disable self service configuration for user channels.
   In multi user mode, disable `/config`, `/allowlist` mutation paths, and any other user-side config writes by default.
   - Users can use agents and granted skills, but cannot mutate system settings.
3. Split UI and API surfaces.
   - User-facing UI is usage-only and does not render configuration controls.
   - Control-plane RPCs require admin role plus matching scopes.
   - Runtime RPCs require owner checks and user role.
4. Add audit surfaces in admin panel.
   Admin panel must show configuration change history and denied-access events with actor, action, reason, and timestamp.
5. Add policy bundles.
   Provide safe presets such as `single_user`, `multi_user_isolated`, and `strict_admin_control`.

### Phase 7 anti bypass safeguards

1. Owner-targeted event fanout.
   Broadcast only to owner-authorized connections by default. Never send cross-user session keys or run metadata to non-admin clients.
   - Missing ownership context on an event path results in deny-by-default behavior.
2. Sandbox and tool guardrails per user.
   Enforce user-safe defaults for sandbox mode, workspace access, session tools visibility, and browser or node capabilities.
3. Endpoint policy coverage.
   Require explicit ownership and policy checks at sensitive endpoints (`sessions.*`, `chat.*`, `node.*`, `skills.*`, and control-plane mutation endpoints).
4. Audit and detection.
   Log every allow or deny decision with owner, principal, action, resource, source, timestamp, and reason. Add alerts for repeated cross-user access attempts.
   - Deny event fields are mandatory and immutable once written.
5. Admin panel security view.
   Expose denied-access feed with filters for user, principal, reason, and method, plus high-frequency alerting views.
6. Test strategy.
   Add cross-user negative tests for session read and write, chat history access, node invoke, skill invoke, browser profile access, and config mutation endpoints.
7. CI regression gates.
   New sensitive methods cannot merge without ownership and authorization test coverage.

### Phase 8 deployment model and migration

1. Add feature flag.
   Add `gateway.multiUser.mode` with values `off`, `compat`, and `strict`.
2. Compat rollout.
   Emit warnings for missing ownership metadata and auto-map existing single-user resources into a default owner.
   - Keep legacy paths operating while ownership metadata is being backfilled.
   - Track unresolved identity and ownership mappings in the admin panel.
3. Strict rollout.
   Require explicit ownership metadata and deny non-compliant requests.
   - Reject unknown-sender access immediately.
   - Reject reads or writes that do not resolve to a valid owner.
4. Staged rollout order.
   - Stage A: enable audit logging and identity mapping without enforcement.
   - Stage B: enforce ownership on read paths.
   - Stage C: enforce ownership on write paths.
   - Stage D: enable full strict deny mode.
5. Rollback policy.
   Allow emergency rollback from `strict` to `compat` while preserving all audit and deny logs.
6. Migration tooling.
   Provide admin command or UI workflows to backfill `ownerUserId` for agents, sessions, nodes, and memory indices before strict mode.
7. Instance boundary policy.
   For true tenant separation, deploy separate OpenClaw instances. Do not mix tenants in one gateway.

## Existing features to enhance for ownership split

These existing features should be treated as enhancement targets because they are not fully user-owner partitioned yet.

1. Gateway connect scope fallback.
   Missing scopes can currently resolve to admin-level scope defaults; this must be replaced with explicit deny-by-default behavior.
2. Combined session listing.
   Session listing currently supports combined store views and must be owner-filtered by default.
3. Browser request method ownership.
   `browser.request` currently routes by method and path without owner checks; add owner validation before dispatch.
4. Browser profile selection.
   Browser routes currently accept `profile` from query or body; enforce server-side owner-to-profile mapping.
5. Browser profile administration.
   Browser profile create and delete operations are global config mutations; keep these admin-only and owner-aware.
6. Host browser profile storage.
   Host browser data is profile-scoped under `~/.openclaw/browser/<profile>/user-data`; enforce owner assignment per profile.
7. Node ownership metadata.
   Connected and paired nodes currently need required `ownerUserId` metadata for consistent policy enforcement.
8. Event fanout granularity.
   Gateway event fanout is currently role and scope based; enforce owner-targeted fanout for runtime events.
9. Internal gateway tool caller scopes.
   Internal gateway tool calls currently use admin-level operator scopes and should move to least-privilege runtime scopes tied to owner context.
10. Sandbox scope modes.
    Sandbox `agent` and `shared` scope modes can mix contexts when ownership partitioning is not enforced; require ownership-safe defaults in multi-user mode.
11. Channel config mutation commands.
    `/config` and `/allowlist` paths must remain disabled for users in multi-user mode unless explicitly enabled for trusted admin flows.

## Prioritized implementation plan

### P0 security boundary first

1. Remove implicit admin scope fallback at connect time.
   Scope: enforce explicit role and scopes, deny when missing.
   Target files: `src/gateway/server/ws-connection/message-handler.ts`, `src/gateway/protocol/schema/frames.ts`, `src/gateway/server-methods.ts`.
   Exit criteria: no connection can get admin-equivalent access without explicit authorized scopes.
2. Enforce owner checks on session and chat runtime methods.
   Scope: owner-match checks for `sessions.*` and `chat.*` before data access.
   Target files: `src/gateway/server-methods/sessions.ts`, `src/gateway/server-methods/chat.ts`, `src/gateway/session-utils.ts`.
   Exit criteria: cross-user session read and write attempts are denied with audited reason codes.
3. Enforce browser ownership checks.
   Scope: `browser.request` and browser profile selection must validate caller owner against profile and node owner.
   Target files: `src/gateway/server-methods/browser.ts`, `src/browser/routes/utils.ts`, `src/browser/profiles-service.ts`.
   Exit criteria: user cannot access another users browser profile or browser proxy path.
4. Enforce owner-targeted event fanout.
   Scope: runtime events are delivered only to owner-authorized connections unless admin override.
   Target files: `src/gateway/server-broadcast.ts`, `src/gateway/server-chat.ts`.
   Exit criteria: no cross-user session metadata appears in non-admin event streams.
5. Lock user config mutation paths.
   Scope: disable user-side config writes in multi-user mode.
   Target files: `src/auto-reply/reply/commands-config.ts`, `src/auto-reply/reply/commands-allowlist.ts`, `src/channels/plugins/config-writes.ts`.
   Exit criteria: non-admin users cannot mutate gateway configuration through chat commands.

### P1 ownership metadata and data partition

1. Add required `ownerUserId` metadata to owned resources.
   Scope: agents, nodes, sessions, browser profiles, and ownership-aware audit payloads.
   Target files: `src/config/types.agents.ts`, `src/infra/device-pairing.ts`, `src/gateway/node-registry.ts`, `src/config/sessions.ts`.
   Exit criteria: all runtime-owned resources persist and expose `ownerUserId`.
2. Partition session storage by owner.
   Scope: owner-partitioned store access and admin explicit cross-owner filters only.
   Target files: `src/gateway/session-utils.ts`, `src/gateway/server-methods/sessions.ts`.
   Exit criteria: default session listing and preview return only caller-owned entries.
3. Partition memory by owner.
   Scope: builtin and qmd backends include required owner partitioning.
   Target files: `src/memory/backend-config.ts`, `src/memory/qmd-manager.ts`.
   Exit criteria: memory retrieval and writes are owner-isolated even when policy filters match.
4. Reduce internal gateway tool privileges.
   Scope: replace admin-level default internal calls with least-privilege owner-scoped runtime calls.
   Target files: `src/gateway/call.ts`, `src/gateway/client.ts`, `src/agents/tools/gateway.ts`.
   Exit criteria: internal tool calls no longer require blanket `operator.admin` scope for normal user operations.

### P2 migration, tooling, and hardening

1. Implement staged mode rollout.
   Scope: `off`, `compat`, `strict` behavior with progressive enforcement.
   Target files: `src/config/zod-schema.ts`, `src/config/config.ts`, `src/gateway/server-methods/config.ts`.
   Exit criteria: operators can progress through staged rollout without downtime.
2. Add ownership backfill tooling.
   Scope: admin workflow to backfill owner metadata before strict mode.
   Target files: `src/cli`, `src/gateway/server-methods`, and admin UI integration points.
   Exit criteria: upgrade from legacy single-user data is scriptable and auditable.
3. Add regression tests and merge gates.
   Scope: cross-user negative tests for sessions, chat, browser, nodes, skills, and config mutation.
   Target files: `src/gateway/*.test.ts`, `src/browser/**/*.test.ts`, CI workflow checks.
   Exit criteria: sensitive API changes cannot merge without ownership and authz tests.
4. Add admin observability views.
   Scope: denied-access feed, config-change feed, and unresolved mapping feed.
   Target files: admin UI and supporting gateway query methods.
   Exit criteria: admins can detect and triage ownership or authz violations quickly.

## P0 implementation checklist and PR slices

Use this sequence to implement P0 with small, reviewable PRs.

### PR-1 strict connect auth baseline

1. Remove implicit admin fallback when scopes are missing.
2. Validate role and scope combinations with deny-by-default behavior.
3. Emit explicit deny reason codes for invalid connect auth.
   Target files: `src/gateway/server/ws-connection/message-handler.ts`, `src/gateway/protocol/schema/frames.ts`, `src/gateway/server-methods.ts`.
   Acceptance: clients without explicit authorized scopes cannot access admin methods.

### PR-2 owner context plumbing

1. Add resolved owner context (`userId`, `principalId`, role) to gateway request handling.
2. Add common authorization helper for owner match and method permission checks.
3. Add audit helper for allow and deny decisions.
   Target files: `src/gateway/server-methods/types.ts`, `src/gateway/server-methods.ts`, `src/gateway/server.impl.ts`.
   Acceptance: handlers can call a single helper to enforce owner checks and log decisions.

### PR-3 sessions and chat owner enforcement

1. Enforce owner checks on `sessions.*` read and mutation paths.
2. Enforce owner checks on `chat.*` and history access paths.
3. Add admin explicit cross-owner override path with required owner filter and audit.
   Target files: `src/gateway/server-methods/sessions.ts`, `src/gateway/server-methods/chat.ts`, `src/gateway/session-utils.ts`.
   Acceptance: cross-user session and chat access is denied for non-admin callers.

### PR-4 browser ownership enforcement

1. Enforce owner checks inside `browser.request` before route dispatch.
2. Add server-side owner-to-profile resolution and deny unowned profile access.
3. Enforce owner checks for node browser proxy path (`browser.proxy`) against node owner and profile owner.
4. Restrict chrome relay profile usage to admin-only or explicitly owner-bound profiles.
   Target files: `src/gateway/server-methods/browser.ts`, `src/browser/routes/utils.ts`, `src/browser/profiles-service.ts`, `src/gateway/server-methods/nodes.ts`.
   Acceptance: user cannot operate another users browser profile, host browser state, or browser proxy node.

### PR-5 owner-targeted event fanout

1. Add owner filtering to runtime event broadcast paths.
2. Keep admin visibility via explicit privileged subscriptions.
3. Deny event emission when owner context is missing on sensitive runtime events.
   Target files: `src/gateway/server-broadcast.ts`, `src/gateway/server-chat.ts`.
   Acceptance: non-admin websocket clients only receive their own runtime events.

### PR-6 disable user config writes in multi-user mode

1. Gate `/config` and `/allowlist` mutation commands behind admin-only checks in multi-user mode.
2. Ensure plugin channel config writes resolve to deny for user-plane callers.
3. Add clear user-facing denial message with audit logging.
   Target files: `src/auto-reply/reply/commands-config.ts`, `src/auto-reply/reply/commands-allowlist.ts`, `src/channels/plugins/config-writes.ts`.
   Acceptance: non-admin users cannot mutate gateway settings from message channels.

### PR-7 P0 tests and merge gate

1. Add negative tests for cross-user access on sessions, chat, browser, node proxy, and config mutation.
2. Add websocket event isolation tests for owner-targeted fanout.
3. Add CI guard to require ownership/authz tests for new sensitive gateway methods.
   Target files: `src/gateway/*.test.ts`, `src/browser/**/*.test.ts`, CI workflow files.
   Acceptance: P0 cannot regress without failing CI.

## Discussion order

Use this sequence so decisions can be locked one by one:

1. Principal model and user identity contract
2. Authorization model and scope changes
3. Session and memory partition design
4. Skills visibility policy
5. Node and agent ownership model
6. Admin panel control plane boundaries
7. Anti bypass test and audit requirements
8. Deployment and migration plan

## Related docs

- [Session Management](/concepts/session)
- [Security](/gateway/security)
- [Gateway Configuration](/gateway/configuration)
- [Multi Agent Routing](/concepts/multi-agent)
- [Memory](/concepts/memory)
