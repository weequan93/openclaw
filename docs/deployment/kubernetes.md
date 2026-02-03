# Kubernetes Deployment Guide

This guide explains how to deploy OpenClaw to a Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (1.20+)
- kubectl configured
- Helm 3.x (optional, but recommended)
- PostgreSQL database (managed or self-hosted)
- Domain name with DNS configured

## Quick Start with Helm

### 1. Install with Helm

```bash
# Add Helm repository (if published)
helm repo add openclaw https://charts.openclaw.com
helm repo update

# Install OpenClaw
helm install openclaw openclaw/openclaw \
  --namespace openclaw \
  --create-namespace \
  --values values-production.yaml
```

### 2. Create values-production.yaml

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
    host: your-postgres-host.rds.amazonaws.com
    port: 5432
    database: openclaw

secrets:
  postgres:
    password: YOUR_SECURE_PASSWORD
  jwt:
    secret: YOUR_JWT_SECRET
```

### 3. Verify Deployment

```bash
# Check pods
kubectl get pods -n openclaw

# Check services
kubectl get svc -n openclaw

# Check ingress
kubectl get ingress -n openclaw

# View logs
kubectl logs -f deployment/openclaw -n openclaw
```

## Manual Deployment with kubectl

### 1. Create Namespace

```bash
kubectl create namespace openclaw
```

### 2. Create Secrets

```bash
# Create PostgreSQL secret
kubectl create secret generic openclaw-secrets \
  --from-literal=postgres.user=openclaw \
  --from-literal=postgres.password=YOUR_PASSWORD \
  --from-literal=jwt.secret=YOUR_JWT_SECRET \
  -n openclaw
```

### 3. Apply Manifests

```bash
# Apply in order
kubectl apply -f k8s/configmap.yaml -n openclaw
kubectl apply -f k8s/secret.yaml -n openclaw
kubectl apply -f k8s/deployment.yaml -n openclaw
kubectl apply -f k8s/service.yaml -n openclaw
kubectl apply -f k8s/ingress.yaml -n openclaw
```

### 4. Wait for Deployment

```bash
kubectl rollout status deployment/openclaw-gateway -n openclaw
```

## Configuration

### Environment Variables

All configuration is managed through ConfigMap and Secrets:

**ConfigMap** (`k8s/configmap.yaml`):
- Database connection (host, port, database)
- SSO configuration
- Feature flags
- Observability settings

**Secret** (`k8s/secret.yaml`):
- Database credentials
- JWT secrets
- SSO credentials
- API keys

### Update Configuration

```bash
# Edit ConfigMap
kubectl edit configmap openclaw-config -n openclaw

# Edit Secret
kubectl edit secret openclaw-secrets -n openclaw

# Restart pods to apply changes
kubectl rollout restart deployment/openclaw-gateway -n openclaw
```

## SSL/TLS Setup

### Using cert-manager

1. Install cert-manager:

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

2. Create ClusterIssuer:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
```

3. Apply:

```bash
kubectl apply -f cluster-issuer.yaml
```

The Ingress will automatically request a certificate.

## Scaling

### Manual Scaling

```bash
kubectl scale deployment/openclaw-gateway --replicas=5 -n openclaw
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: openclaw-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: openclaw-gateway
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 80
```

## Monitoring

### Prometheus Integration

OpenClaw exposes metrics on port 9090:

```yaml
apiVersion: v1
kind: ServiceMonitor
metadata:
  name: openclaw
spec:
  selector:
    matchLabels:
      app: openclaw
  endpoints:
  - port: metrics
    interval: 30s
```

### Health Checks

- **Liveness**: `GET /health/live` - Returns 200 if app is running
- **Readiness**: `GET /health/ready` - Returns 200 if app can serve traffic
- **Health**: `GET /health` - Returns detailed health status

## Backup and Restore

### Database Backup

```bash
# Backup PostgreSQL
kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
  pg_dump -U openclaw openclaw > backup.sql

# Restore
kubectl exec -i openclaw-postgresql-0 -n openclaw -- \
  psql -U openclaw openclaw < backup.sql
```

### Persistent Volume Backup

```bash
# List PVCs
kubectl get pvc -n openclaw

# Backup using velero
velero backup create openclaw-backup \
  --include-namespaces openclaw
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl describe pod <pod-name> -n openclaw

# Check logs
kubectl logs <pod-name> -n openclaw

# Check events
kubectl get events -n openclaw --sort-by='.lastTimestamp'
```

### Database Connection Issues

```bash
# Test database connection
kubectl run -it --rm debug --image=postgres:15 --restart=Never -- \
  psql -h <host> -U openclaw -d openclaw
```

### Ingress Not Working

```bash
# Check ingress
kubectl describe ingress openclaw-gateway -n openclaw

# Check nginx controller logs
kubectl logs -f deployment/ingress-nginx-controller -n ingress-nginx
```

## Upgrading

### Helm Upgrade

```bash
helm upgrade openclaw openclaw/openclaw \
  --namespace openclaw \
  --values values-production.yaml
```

### kubectl Upgrade

```bash
# Update image
kubectl set image deployment/openclaw-gateway \
  gateway=openclaw/openclaw:1.1.0 \
  -n openclaw

# Monitor rollout
kubectl rollout status deployment/openclaw-gateway -n openclaw
```

## Uninstall

### Helm

```bash
helm uninstall openclaw -n openclaw
kubectl delete namespace openclaw
```

### kubectl

```bash
kubectl delete -f k8s/ -n openclaw
kubectl delete namespace openclaw
```

## Production Checklist

- [ ] Use external managed PostgreSQL (RDS, Cloud SQL)
- [ ] Configure SSL/TLS with cert-manager
- [ ] Set up monitoring (Prometheus, Grafana)
- [ ] Configure log aggregation (ELK, Loki)
- [ ] Set up backups (Velero, database backups)
- [ ] Configure resource limits and requests
- [ ] Enable pod disruption budgets
- [ ] Set up network policies
- [ ] Configure RBAC
- [ ] Use secrets management (External Secrets, Vault)
- [ ] Set up alerting (Alertmanager)
- [ ] Configure autoscaling (HPA)
- [ ] Test disaster recovery
- [ ] Document runbooks

## Support

For issues and questions:
- GitHub: https://github.com/openclaw/openclaw/issues
- Documentation: https://docs.openclaw.com
- Email: support@openclaw.com
