---
summary: "Run the full OpenClaw stack in Docker for end-to-end testing"
read_when:
  - You want to validate the full stack in Docker
  - You want to test the gateway, Control UI, and Admin UI together
title: "Docker Full Stack Testing"
---

# Docker Full Stack Testing

This guide runs the full OpenClaw app stack in Docker using `docker-compose.test.yml`.

It covers:

- Gateway + Control UI
- Platform Admin UI
- Tenant Admin UI
- Postgres + Redis
- Basic health and CLI smoke checks

## Prerequisites

- Docker Engine or Docker Desktop
- Docker Compose v2 (`docker compose version`)
- Ports `3000`, `3001`, `3002`, `5432`, and `6379` available (adjust in the compose file if needed)

## Start the stack

1. From the repo root:

```bash
cd /path/to/openclaw
```

2. Review and update configuration if needed:

- `config/openclaw.json` for the gateway token and logging defaults
- `docker-compose.test.yml` for database credentials, JWT secret, ports, and feature flags

Keep `OPENCLAW_GATEWAY_TOKEN` and `config/openclaw.json` in sync.

3. Build and start the stack:

```bash
docker compose -f docker-compose.test.yml up -d --build
```

4. Tail logs while the services boot:

```bash
docker compose -f docker-compose.test.yml logs -f gateway
```

## Verify the stack

- Control UI (gateway):
Open `http://localhost:3000/` in a browser and paste the gateway token from
`config/openclaw.json` when prompted.

- Gateway health (HTTP readiness):

```bash
curl -fsS http://localhost:3000/health/ready
```

- Gateway health (via UI proxy, optional):

```bash
curl -fsS http://localhost:3001/api/health/ready
```

- Gateway health (WebSocket RPC via CLI, optional):

```bash
docker compose -f docker-compose.test.yml exec \
  -e OPENCLAW_GATEWAY_PORT=3000 \
  gateway \
  node openclaw.mjs health --json
```

- Platform Admin UI:
Open `http://localhost:3001/`.

Default platform admin credentials (dev-only defaults from `docker-compose.test.yml`):

- Email: `admin@openclaw.local`
- Password: `changeme_dev_only`

- Tenant Admin UI:
Open `http://localhost:3002/`.

- Create a tenant + owner (API smoke):

```bash
curl \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme","slug":"acme","ownerEmail":"owner@acme.test","ownerName":"Acme Owner"}' \
  http://localhost:3000/api/v1/platform/tenants
```

If you omit `ownerPassword`, the response includes an `ownerPassword` you can
use to sign in to the Tenant Admin UI (`tenantSlug=acme`).

- Platform admin API (gateway):

```bash
curl \
  -H "Authorization: Bearer dev-token-123" \
  http://localhost:3000/api/v1/platform/stats
```

- Platform admin API (via UI proxy):

```bash
curl \
  -H "Authorization: Bearer dev-token-123" \
  http://localhost:3001/api/v1/platform/stats
```

- Tenant admin API (token from tenant login):

```bash
curl \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"acme","email":"owner@acme.test","password":"<ownerPassword>"}' \
  http://localhost:3000/api/v1/tenant/auth/login
```

- Postgres and Redis:

```bash
docker compose -f docker-compose.test.yml exec postgres pg_isready -U openclaw
docker compose -f docker-compose.test.yml exec redis redis-cli ping
```

## CLI smoke checks

If the CLI reports auth errors, confirm the gateway token matches
`config/openclaw.json` and `OPENCLAW_GATEWAY_TOKEN` in the compose file.

## Covering channels and providers

This stack starts unconfigured. To test real channels or model providers, add
credentials through the CLI or mount your existing OpenClaw config directory.

Start here:

- [Channels](/cli/channels)
- [Models](/cli/models)
- [Docker install flow](/install/docker)

## Clean up

```bash
docker compose -f docker-compose.test.yml down -v
```

## Troubleshooting

- Seeing HTML from `curl http://localhost:3001/health` or `http://localhost:3002/health`?
  Those ports serve the Admin UI single-page apps, so non-API paths fall back
  to `index.html`. Use `http://localhost:3000/health/ready` (gateway) or an
  `/api/...` route instead.

- Check container status:

```bash
docker compose -f docker-compose.test.yml ps
```

- Inspect logs:

```bash
docker compose -f docker-compose.test.yml logs -f gateway
docker compose -f docker-compose.test.yml logs -f ui-admin
```

- Rebuild if the image is stale:

```bash
docker compose -f docker-compose.test.yml build --no-cache
```
