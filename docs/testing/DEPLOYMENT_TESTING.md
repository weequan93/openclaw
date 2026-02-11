# OpenClaw Deployment Testing Guide

This guide walks through testing **all deployment methods** to ensure OpenClaw works correctly in every scenario.

---

## Test Checklist

- [ ] **Method 1**: Docker Compose (Development)
- [ ] **Method 2**: Local Kubernetes with kind
- [ ] **Method 3**: Local Kubernetes with minikube
- [ ] **Method 4**: Helm with embedded PostgreSQL
- [ ] **Method 5**: Helm with external PostgreSQL
- [ ] **Method 6**: Direct kubectl deployment
- [ ] **Method 7**: Local development (npm/pnpm)

---

## Method 1: Docker Compose (Development)

**Purpose**: Quick local development and testing

### Prerequisites
```bash
# Check Docker is installed
docker --version
docker-compose --version
```

### Steps

1. **Create environment file**:
```bash
cd /Users/super/Documents/ai/openclaw

cat > .env << 'EOF'
# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=openclaw
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=changeme_dev_only

# JWT
JWT_SECRET=dev-secret-key-min-32-characters-long

# Application
NODE_ENV=development
LOG_LEVEL=debug
PORT=3000
EOF
```

2. **Start services**:
```bash
docker-compose -f docker-compose.test.yml up -d

3. **Check logs**:
```bash
# View all logs
docker-compose -f docker-compose.test.yml logs -f

# View specific service
docker-compose -f docker-compose.test.yml logs -f openclaw-gateway

4. **Test health endpoint**:
```bash
# Wait for services to start (30 seconds)
sleep 30

# Test health
curl http://localhost:3000/health

# Expected: {"status":"healthy",...}
```

5. **Test metrics endpoint**:
```bash
curl http://localhost:3000/metrics | head -20
```

6. **Test web interface**:
```bash
open http://localhost:3000
```

7. **Cleanup**:
```bash
docker-compose down
docker-compose down -v  # Remove volumes too
```

### ✅ Success Criteria
- [ ] Services start without errors
- [ ] Health endpoint returns `{"status":"healthy"}`
- [ ] Metrics endpoint returns Prometheus metrics
- [ ] Web interface loads in browser
- [ ] Database connection works

---

## Method 2: Local Kubernetes with kind

**Purpose**: Test Kubernetes deployment locally

### Prerequisites
```bash
# Install kind
brew install kind

# Or on Linux
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
```

### Steps

1. **Create kind cluster**:
```bash
kind create cluster --name openclaw-test

# Verify cluster
kubectl cluster-info --context kind-openclaw-test
kubectl get nodes
```

2. **Deploy with Helm**:
```bash
cd /Users/super/Documents/ai/openclaw

helm install openclaw ./helm/openclaw \
  --namespace openclaw \
  --create-namespace \
  --set postgresql.enabled=true \
  --set replicaCount=1
```

3. **Wait for pods to be ready**:
```bash
kubectl wait --for=condition=ready pod \
  -l app=openclaw \
  -n openclaw \
  --timeout=300s
```

4. **Check pod status**:
```bash
kubectl get pods -n openclaw
kubectl get svc -n openclaw
```

5. **View logs**:
```bash
kubectl logs -f deployment/openclaw-gateway -n openclaw
```

6. **Port forward to access**:
```bash
kubectl port-forward svc/openclaw-gateway 3000:80 -n openclaw &
```

7. **Test endpoints**:
```bash
# Health check
curl http://localhost:3000/health

# Metrics
curl http://localhost:3000/metrics | head -20

# Web UI
open http://localhost:3000
```

8. **Test scaling**:
```bash
# Scale up
kubectl scale deployment/openclaw-gateway --replicas=3 -n openclaw

# Check pods
kubectl get pods -n openclaw

# Scale down
kubectl scale deployment/openclaw-gateway --replicas=1 -n openclaw
```

9. **Cleanup**:
```bash
# Stop port forward
pkill -f "port-forward.*openclaw"

# Delete deployment
helm uninstall openclaw -n openclaw

# Delete cluster
kind delete cluster --name openclaw-test
```

### ✅ Success Criteria
- [ ] Cluster creates successfully
- [ ] Pods reach Running state
- [ ] Health endpoint accessible via port-forward
- [ ] Scaling works (1 → 3 → 1 replicas)
- [ ] No errors in pod logs

---

## Method 3: Local Kubernetes with minikube

**Purpose**: Alternative local Kubernetes testing

### Prerequisites
```bash
# Install minikube
brew install minikube

# Or on Linux
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
```

### Steps

1. **Start minikube**:
```bash
minikube start --cpus=4 --memory=8192 --driver=docker

# Verify
kubectl get nodes
```

2. **Enable addons**:
```bash
minikube addons enable ingress
minikube addons enable metrics-server
```

3. **Deploy with Helm**:
```bash
cd /Users/super/Documents/ai/openclaw

helm install openclaw ./helm/openclaw \
  --namespace openclaw \
  --create-namespace \
  --set postgresql.enabled=true
```

4. **Wait for pods**:
```bash
kubectl wait --for=condition=ready pod \
  -l app=openclaw \
  -n openclaw \
  --timeout=300s
```

5. **Access via minikube service**:
```bash
# Get service URL
minikube service openclaw-gateway -n openclaw --url

# Or use port-forward
kubectl port-forward svc/openclaw-gateway 3000:80 -n openclaw
```

6. **Test endpoints**:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/metrics | head -20
open http://localhost:3000
```

7. **Test ingress** (optional):
```bash
# Get minikube IP
minikube ip

# Add to /etc/hosts
echo "$(minikube ip) openclaw.local" | sudo tee -a /etc/hosts

# Test ingress
curl http://openclaw.local
```

8. **Cleanup**:
```bash
helm uninstall openclaw -n openclaw
minikube stop
minikube delete
```

### ✅ Success Criteria
- [ ] Minikube starts successfully
- [ ] Pods reach Running state
- [ ] Service accessible via minikube service or port-forward
- [ ] Ingress works (if tested)
- [ ] Metrics-server shows resource usage

---

## Method 4: Helm with Embedded PostgreSQL

**Purpose**: Test Helm chart with bundled database

### Steps

1. **Create cluster** (use kind or minikube from above)

2. **Install with embedded PostgreSQL**:
```bash
cd /Users/super/Documents/ai/openclaw

helm install openclaw ./helm/openclaw \
  --namespace openclaw \
  --create-namespace \
  --set postgresql.enabled=true \
  --set postgresql.auth.password=test123 \
  --debug
```

3. **Verify PostgreSQL pod**:
```bash
kubectl get pods -n openclaw | grep postgres
```

4. **Test database connection**:
```bash
# Connect to PostgreSQL
kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
  psql -U openclaw -d openclaw -c "SELECT version();"
```

5. **Check gateway connects to DB**:
```bash
kubectl logs deployment/openclaw-gateway -n openclaw | grep -i postgres
```

6. **Cleanup**:
```bash
helm uninstall openclaw -n openclaw
```

### ✅ Success Criteria
- [ ] PostgreSQL pod starts
- [ ] Gateway connects to PostgreSQL
- [ ] No database connection errors in logs
- [ ] Health check shows database healthy

---

## Method 5: Helm with External PostgreSQL

**Purpose**: Test production-like setup with external database

### Steps

1. **Start external PostgreSQL** (using Docker):
```bash
docker run -d \
  --name openclaw-postgres \
  -e POSTGRES_USER=openclaw \
  -e POSTGRES_PASSWORD=external123 \
  -e POSTGRES_DB=openclaw \
  -p 5432:5432 \
  postgres:15
```

2. **Create values file**:
```bash
cat > values-external-db.yaml << 'EOF'
postgresql:
  enabled: false

config:
  postgres:
    host: host.docker.internal  # For kind/minikube
    port: 5432
    database: openclaw
    user: openclaw

secrets:
  postgres:
    password: external123
EOF
```

3. **Install with external DB**:
```bash
helm install openclaw ./helm/openclaw \
  --namespace openclaw \
  --create-namespace \
  --values values-external-db.yaml
```

4. **Verify connection**:
```bash
kubectl logs deployment/openclaw-gateway -n openclaw | grep -i postgres
```

5. **Cleanup**:
```bash
helm uninstall openclaw -n openclaw
docker stop openclaw-postgres
docker rm openclaw-postgres
```

### ✅ Success Criteria
- [ ] Gateway connects to external PostgreSQL
- [ ] No internal PostgreSQL pod created
- [ ] Database operations work correctly

---

## Method 6: Direct kubectl Deployment

**Purpose**: Test raw Kubernetes manifests without Helm

### Steps

1. **Create namespace**:
```bash
kubectl create namespace openclaw-kubectl
```

2. **Apply ConfigMap**:
```bash
kubectl apply -f k8s/configmap.yaml -n openclaw-kubectl
```

3. **Create secrets**:
```bash
kubectl create secret generic openclaw-secrets \
  --from-literal=postgres.password=kubectl123 \
  --from-literal=jwt.secret=kubectl-jwt-secret-32-chars-min \
  -n openclaw-kubectl
```

4. **Apply manifests**:
```bash
kubectl apply -f k8s/deployment.yaml -n openclaw-kubectl
kubectl apply -f k8s/service.yaml -n openclaw-kubectl
```

5. **Wait for pods**:
```bash
kubectl wait --for=condition=ready pod \
  -l app=openclaw \
  -n openclaw-kubectl \
  --timeout=300s
```

6. **Test**:
```bash
kubectl port-forward svc/openclaw-gateway 3000:80 -n openclaw-kubectl
curl http://localhost:3000/health
```

7. **Cleanup**:
```bash
kubectl delete namespace openclaw-kubectl
```

### ✅ Success Criteria
- [ ] All manifests apply successfully
- [ ] Pods start without errors
- [ ] Services are created
- [ ] Health endpoint accessible

---

## Method 7: Local Development (npm/pnpm)

**Purpose**: Test running directly with Node.js for development

### Prerequisites
```bash
# Install Node.js 20+
node --version  # Should be v20+

# Install pnpm
npm install -g pnpm
```

### Steps

1. **Install dependencies**:
```bash
cd /Users/super/Documents/ai/openclaw
pnpm install
```

2. **Set up environment**:
```bash
cat > .env.local << 'EOF'
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openclaw
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=local123
JWT_SECRET=local-dev-secret-32-characters-min
NODE_ENV=development
LOG_LEVEL=debug
PORT=3000
EOF
```

3. **Start local PostgreSQL**:
```bash
docker run -d \
  --name openclaw-dev-db \
  -e POSTGRES_USER=openclaw \
  -e POSTGRES_PASSWORD=local123 \
  -e POSTGRES_DB=openclaw \
  -p 5432:5432 \
  postgres:15
```

4. **Run migrations** (if applicable):
```bash
pnpm migrate
```

5. **Start gateway**:
```bash
pnpm start:gateway
```

6. **In another terminal, start web chat**:
```bash
cd web-chat
pnpm install
pnpm dev
```

7. **Test**:
```bash
# Health check
curl http://localhost:3000/health

# Web UI
open http://localhost:5173
```

8. **Cleanup**:
```bash
# Stop services (Ctrl+C in terminals)
docker stop openclaw-dev-db
docker rm openclaw-dev-db
```

### ✅ Success Criteria
- [ ] Dependencies install successfully
- [ ] Gateway starts without errors
- [ ] Web chat dev server starts
- [ ] Can access both services
- [ ] Hot reload works for development

---

## Comprehensive Test Matrix

| Method | PostgreSQL | Complexity | Use Case | Status |
|--------|-----------|------------|----------|--------|
| Docker Compose | Embedded | Low | Quick dev | ⬜ |
| kind + Helm | Embedded | Medium | K8s testing | ⬜ |
| minikube + Helm | Embedded | Medium | K8s testing | ⬜ |
| Helm (embedded DB) | Embedded | Medium | Simple deploy | ⬜ |
| Helm (external DB) | External | High | Production-like | ⬜ |
| kubectl | External | High | Manual control | ⬜ |
| Local dev | External | Low | Development | ⬜ |

---

## Quick Test Script

Run all tests automatically:

```bash
#!/bin/bash
# test-all-deployments.sh

set -e

echo "🧪 Testing OpenClaw Deployment Methods"
echo "======================================"

# Test 1: Docker Compose
echo "📦 Test 1: Docker Compose"
cd /Users/super/Documents/ai/openclaw
docker-compose up -d
sleep 30
curl -f http://localhost:3000/health || echo "❌ Failed"
docker-compose down
echo "✅ Docker Compose test complete"

# Test 2: kind + Helm
echo "☸️  Test 2: kind + Helm"
kind create cluster --name test-openclaw
helm install openclaw ./helm/openclaw -n openclaw --create-namespace --set postgresql.enabled=true
kubectl wait --for=condition=ready pod -l app=openclaw -n openclaw --timeout=300s
kubectl port-forward svc/openclaw-gateway 3000:80 -n openclaw &
sleep 10
curl -f http://localhost:3000/health || echo "❌ Failed"
pkill -f "port-forward"
helm uninstall openclaw -n openclaw
kind delete cluster --name test-openclaw
echo "✅ kind + Helm test complete"

echo ""
echo "🎉 All tests complete!"
```

---

## Troubleshooting

### Common Issues

**Pods not starting**:
```bash
kubectl describe pod <pod-name> -n openclaw
kubectl logs <pod-name> -n openclaw
```

**Database connection errors**:
```bash
# Check PostgreSQL is running
kubectl get pods -n openclaw | grep postgres

# Test connection
kubectl exec -it <gateway-pod> -n openclaw -- \
  nc -zv openclaw-postgresql 5432
```

**Port already in use**:
```bash
# Find process using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

**Image pull errors**:
```bash
# Build image locally for kind
docker build -t openclaw:local .
kind load docker-image openclaw:local --name openclaw-test

# Update values to use local image
helm install openclaw ./helm/openclaw \
  --set image.repository=openclaw \
  --set image.tag=local \
  --set image.pullPolicy=Never
```

---

## Next Steps

After testing all methods:

1. **Document results** - Note which methods work best
2. **Choose primary method** - Pick one for development, one for production
3. **Automate testing** - Create CI/CD pipeline
4. **Performance test** - Load test each deployment method
5. **Security audit** - Review security for each method

---

*Last Updated: 2026-02-03*
