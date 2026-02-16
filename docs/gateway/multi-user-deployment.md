---
summary: "Command only rollout checklist for enabling multi user isolation on one OpenClaw gateway"
read_when:
  - Rolling out compat and strict multi user modes on an existing gateway
  - Running ownership gap checks and ownership backfill before strict enforcement
title: "Multi user deployment checklist"
---

# Multi user deployment checklist

Related docs:

- [Multi user roadmap](/gateway/multi-tenant)
- [Multi user architecture](/gateway/multi-user-architecture)

## 0 set variables

```bash
export OWNER_USER_ID="<user-uuid>"
export OWNER_PRINCIPAL_ID="<principal-id>"
export BACKUP_DIR="$HOME/.openclaw-backup-$(date +%Y%m%d-%H%M%S)"
```

## 1 backup config and runtime state

```bash
mkdir -p "$BACKUP_DIR"
cp -av "$HOME/.openclaw/openclaw.json" "$BACKUP_DIR/openclaw.json"
cp -av "$HOME/.openclaw" "$BACKUP_DIR/openclaw-state"
```

## 2 check ownership gaps

```bash
openclaw gateway ownership-gaps --limit 200
```

## 3 backfill ownership dry run

```bash
openclaw gateway ownership-backfill \
  --owner-user "$OWNER_USER_ID" \
  --owner-principal "$OWNER_PRINCIPAL_ID" \
  --dry-run
```

## 4 apply ownership backfill

```bash
openclaw gateway ownership-backfill \
  --owner-user "$OWNER_USER_ID" \
  --owner-principal "$OWNER_PRINCIPAL_ID"
```

## 5 recheck ownership gaps

```bash
openclaw gateway ownership-gaps --limit 200
```

## 6 enable compat mode

```bash
openclaw config set gateway.multiUser.mode compat
```

## 7 validate compat mode test set

```bash
pnpm exec vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts src/gateway/server.roles-allowlist-update.e2e.test.ts src/gateway/server.chat.command-authz.e2e.test.ts src/gateway/server.chat.gateway-server-chat.e2e.test.ts src/gateway/server.sessions.gateway-server-sessions-a.e2e.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts src/gateway/server.agent.gateway-server-agent-a.e2e.test.ts src/gateway/server.agent.gateway-server-agent-b.e2e.test.ts src/gateway/server.plugins-http.e2e.test.ts src/gateway/server.hooks.e2e.test.ts src/gateway/server.canvas-auth.e2e.test.ts src/gateway/openai-http.e2e.test.ts src/gateway/openresponses-http.e2e.test.ts
```

## 8 enable strict mode

```bash
openclaw config set gateway.multiUser.mode strict
```

## 9 validate strict mode test set

```bash
pnpm exec vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts src/gateway/server.roles-allowlist-update.e2e.test.ts src/gateway/server.chat.command-authz.e2e.test.ts src/gateway/server.chat.gateway-server-chat.e2e.test.ts src/gateway/server.sessions.gateway-server-sessions-a.e2e.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts src/gateway/server.agent.gateway-server-agent-a.e2e.test.ts src/gateway/server.agent.gateway-server-agent-b.e2e.test.ts src/gateway/server.plugins-http.e2e.test.ts src/gateway/server.hooks.e2e.test.ts src/gateway/server.canvas-auth.e2e.test.ts src/gateway/openai-http.e2e.test.ts src/gateway/openresponses-http.e2e.test.ts
```

## 10 rollback to compat mode

```bash
openclaw config set gateway.multiUser.mode compat
```
