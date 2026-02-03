# OpenClaw Enterprise - Quick Start Guide

Get OpenClaw running in **under 5 minutes**! ⚡

---

## Prerequisites

- **Kubernetes cluster** (1.28+)
  - Local: [kind](https://kind.sigs.k8s.io/), [minikube](https://minikube.sigs.k8s.io/), [k3s](https://k3s.io/)
  - Cloud: AWS EKS, Google GKE, Azure AKS
- **kubectl** configured
- **Helm 3** installed
- **PostgreSQL** (managed or self-hosted)

---

## Option 1: Quick Start (Local Development)

### Step 1: Create Local Cluster

```bash
# Using kind
kind create cluster --name openclaw

# Or using minikube
minikube start --cpus=4 --memory=8192
```

### Step 2: Install OpenClaw

```bash
# Clone repository
git clone https://github.com/openclaw/openclaw.git
cd openclaw

# Install with Helm (includes PostgreSQL)
helm install openclaw ./helm/openclaw \
  --namespace openclaw \
  --create-namespace \
  --set postgresql.enabled=true
```

### Step 3: Access the Platform

```bash
# Port forward to access locally
kubectl port-forward svc/openclaw-gateway 3000:80 -n openclaw

# Open in browser
open http://localhost:3000
```

**Done!** 🎉 OpenClaw is running locally.

---

## Option 2: Production Deployment

### Step 1: Prepare Configuration

Create `values-production.yaml`:

```yaml
replicaCount: 3

image:
  repository: openclaw/openclaw
  tag: "1.0.0"

ingress:
  enabled: true
  hosts:
    - host: openclaw.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: openclaw-tls
      hosts:
        - openclaw.yourdomain.com

postgresql:
  enabled: false  # Use external database

config:
  postgres:
    host: your-postgres.rds.amazonaws.com
    port: 5432
    database: openclaw

secrets:
  postgres:
    password: YOUR_SECURE_PASSWORD
  jwt:
    secret: YOUR_JWT_SECRET_32_CHARS_MIN
```

### Step 2: Create Secrets

```bash
# Create namespace
kubectl create namespace openclaw

# Create database secret
kubectl create secret generic openclaw-secrets \
  --from-literal=postgres.password=YOUR_PASSWORD \
  --from-literal=jwt.secret=YOUR_JWT_SECRET \
  -n openclaw
```

### Step 3: Install with Helm

```bash
helm install openclaw ./helm/openclaw \
  --namespace openclaw \
  --values values-production.yaml
```

### Step 4: Verify Deployment

```bash
# Check pods
kubectl get pods -n openclaw

# Check services
kubectl get svc -n openclaw

# Check ingress
kubectl get ingress -n openclaw

# View logs
kubectl logs -f deployment/openclaw-gateway -n openclaw
```

### Step 5: Configure DNS

Point your domain to the LoadBalancer IP:

```bash
# Get external IP
kubectl get svc openclaw-gateway-external -n openclaw

# Add DNS A record
# openclaw.yourdomain.com → <EXTERNAL_IP>
```

**Done!** 🚀 OpenClaw is running in production.

---

## Option 3: Docker Compose (Development)

### Step 1: Configure Environment

Create `.env`:

```bash
# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=openclaw
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=changeme

# JWT
JWT_SECRET=your-secret-key-min-32-chars

# Application
NODE_ENV=development
LOG_LEVEL=debug
```

### Step 2: Start Services

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f openclaw-gateway

# Access at http://localhost:3000
```

### Step 3: Stop Services

```bash
docker-compose down
```

---

## Verify Installation

### Health Checks

```bash
# Health endpoint
curl http://localhost:3000/health

# Expected response:
{
  "status": "healthy",
  "checks": {
    "database": {"status": "healthy", "latency": 5},
    "disk": {"status": "healthy"},
    "memory": {"status": "healthy"}
  },
  "uptime": 123.45,
  "version": "1.0.0"
}
```

### Metrics

```bash
# Prometheus metrics
curl http://localhost:3000/metrics

# Should see metrics like:
# http_requests_total
# http_request_duration_seconds
# database_connections_active
```

### Web Interface

Open browser to `http://localhost:3000`:
- Login page should appear
- Create first user account
- Access chat interface

---

## Next Steps

### 1. Configure SSO (Optional)

See [SSO Setup Guide](docs/deployment/sso-setup.md) for:
- SAML 2.0 (Okta, Azure AD)
- OAuth2 (Auth0, Google, GitHub)

### 2. Set Up Monitoring

```bash
# Install Prometheus
helm install prometheus prometheus-community/prometheus \
  --namespace observability \
  --create-namespace

# Install Grafana
helm install grafana grafana/grafana \
  --namespace observability

# Import dashboards from grafana/dashboards/
```

### 3. Configure Alerts

```bash
# Apply alert rules
kubectl apply -f prometheus/alert-rules.yml -n observability

# Configure Alertmanager
# See docs/observability/runbook.md
```

### 4. Enable Distributed Tracing

```bash
# Install Jaeger
kubectl apply -f jaeger/jaeger-deployment.yaml

# Access Jaeger UI
kubectl port-forward svc/jaeger 16686:16686 -n observability
open http://localhost:16686
```

---

## Documentation

- **[Executive Summary](docs/EXECUTIVE_SUMMARY.md)** - Business overview, pricing, roadmap
- **[Architecture](docs/ARCHITECTURE.md)** - Technical architecture, components, data flow
- **[Kubernetes Deployment](docs/deployment/kubernetes.md)** - Production deployment guide
- **[SSO Setup](docs/deployment/sso-setup.md)** - SAML and OAuth2 configuration
- **[Runbook](docs/observability/runbook.md)** - Operational procedures
- **[SLA Monitoring](docs/observability/sla-monitoring.md)** - SLA tracking and reporting

---

## Getting Help

### Community
- **GitHub Issues**: https://github.com/openclaw/openclaw/issues
- **Documentation**: https://docs.openclaw.com
- **Slack**: https://openclaw.slack.com

### Enterprise Support
- **Email**: support@openclaw.com
- **Portal**: https://support.openclaw.com

---

**Happy building!** 🚀

*Last Updated: February 2026 | Version: 1.0.0*
