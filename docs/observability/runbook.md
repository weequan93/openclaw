# OpenClaw Operational Runbook

This runbook provides step-by-step procedures for responding to common alerts and incidents.

## Table of Contents

- [High Error Rate](#high-error-rate)
- [High Latency](#high-latency)
- [Service Down](#service-down)
- [Database Issues](#database-issues)
- [Resource Exhaustion](#resource-exhaustion)
- [Agent Failures](#agent-failures)
- [Quota Exceeded](#quota-exceeded)

---

## High Error Rate

**Alert**: `HighHTTPErrorRate`  
**Severity**: Critical  
**Threshold**: >5% error rate for 5 minutes

### Symptoms
- Increased 5xx status codes
- User-reported errors
- Failed requests in logs

### Investigation Steps

1. **Check recent deployments**:
   ```bash
   kubectl rollout history deployment/openclaw-gateway -n openclaw
   ```

2. **View error logs**:
   ```bash
   kubectl logs -f deployment/openclaw-gateway -n openclaw | grep ERROR
   ```

3. **Check Grafana dashboard**:
   - Navigate to Gateway Dashboard
   - Review "Error Timeline" panel
   - Identify affected endpoints

4. **Query Elasticsearch**:
   ```
   status:5* AND @timestamp:[now-15m TO now]
   ```

### Resolution Steps

**If caused by recent deployment**:
```bash
# Rollback to previous version
kubectl rollout undo deployment/openclaw-gateway -n openclaw

# Verify rollback
kubectl rollout status deployment/openclaw-gateway -n openclaw
```

**If caused by database issues**:
- See [Database Issues](#database-issues)

**If caused by external service**:
- Check external service status
- Enable circuit breaker
- Add retry logic

### Escalation
- **After 15 minutes**: Page on-call engineer
- **After 30 minutes**: Escalate to engineering lead
- **After 1 hour**: Initiate incident response

---

## High Latency

**Alert**: `HighRequestLatency`  
**Severity**: Warning  
**Threshold**: P95 >1s for 5 minutes

### Symptoms
- Slow page loads
- Timeouts
- User complaints

### Investigation Steps

1. **Check resource usage**:
   ```bash
   kubectl top pods -n openclaw
   ```

2. **Review slow queries**:
   ```bash
   # Check database slow query log
   kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
     psql -U openclaw -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
   ```

3. **Check Jaeger traces**:
   - Navigate to Jaeger UI
   - Search for slow traces (>1s)
   - Identify bottleneck spans

4. **Review metrics**:
   - Database query duration
   - Agent execution time
   - External API calls

### Resolution Steps

**If database is slow**:
```bash
# Check active connections
kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
  psql -U openclaw -c "SELECT count(*) FROM pg_stat_activity;"

# Check for long-running queries
kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
  psql -U openclaw -c "SELECT pid, now() - query_start as duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC;"

# Kill long-running query if needed
kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
  psql -U openclaw -c "SELECT pg_terminate_backend(<pid>);"
```

**If resource constrained**:
```bash
# Scale up replicas
kubectl scale deployment/openclaw-gateway --replicas=5 -n openclaw

# Or increase resource limits
kubectl edit deployment/openclaw-gateway -n openclaw
```

**If agent execution is slow**:
- Review agent code for inefficiencies
- Add caching where appropriate
- Optimize database queries

### Prevention
- Add database indexes
- Implement caching (Redis)
- Optimize slow queries
- Add connection pooling

---

## Service Down

**Alert**: `ServiceDown`  
**Severity**: Critical  
**Threshold**: Service unreachable for 1 minute

### Symptoms
- 503 Service Unavailable
- Connection refused
- Health check failures

### Investigation Steps

1. **Check pod status**:
   ```bash
   kubectl get pods -n openclaw
   kubectl describe pod <pod-name> -n openclaw
   ```

2. **Check logs**:
   ```bash
   kubectl logs <pod-name> -n openclaw --previous
   ```

3. **Check events**:
   ```bash
   kubectl get events -n openclaw --sort-by='.lastTimestamp'
   ```

4. **Check node status**:
   ```bash
   kubectl get nodes
   kubectl describe node <node-name>
   ```

### Resolution Steps

**If pod is CrashLooping**:
```bash
# Check logs for error
kubectl logs <pod-name> -n openclaw

# If configuration issue, fix and restart
kubectl rollout restart deployment/openclaw-gateway -n openclaw
```

**If node is down**:
```bash
# Cordon node
kubectl cordon <node-name>

# Drain node
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Pods will reschedule to healthy nodes
```

**If out of resources**:
```bash
# Check resource usage
kubectl top nodes
kubectl top pods -n openclaw

# Scale down other workloads or add nodes
```

### Escalation
- **Immediately**: Page on-call engineer
- **After 5 minutes**: Escalate to infrastructure team
- **After 15 minutes**: Initiate major incident response

---

## Database Issues

**Alert**: `DatabaseConnectionErrors` or `DatabaseUnreachable`  
**Severity**: Critical

### Symptoms
- Connection timeouts
- "Too many connections" errors
- Slow queries

### Investigation Steps

1. **Check database status**:
   ```bash
   kubectl get pods -l app=postgresql -n openclaw
   kubectl logs -f postgresql-0 -n openclaw
   ```

2. **Check connections**:
   ```bash
   kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
     psql -U openclaw -c "SELECT count(*) FROM pg_stat_activity;"
   ```

3. **Check disk space**:
   ```bash
   kubectl exec -it openclaw-postgresql-0 -n openclaw -- df -h
   ```

### Resolution Steps

**If connection pool exhausted**:
```bash
# Increase max connections (requires restart)
kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
  psql -U openclaw -c "ALTER SYSTEM SET max_connections = 200;"

# Restart PostgreSQL
kubectl delete pod openclaw-postgresql-0 -n openclaw
```

**If disk full**:
```bash
# Expand PVC
kubectl edit pvc data-openclaw-postgresql-0 -n openclaw

# Or clean up old data
kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
  psql -U openclaw -c "VACUUM FULL;"
```

**If database is down**:
```bash
# Check pod status
kubectl describe pod openclaw-postgresql-0 -n openclaw

# Restart if needed
kubectl delete pod openclaw-postgresql-0 -n openclaw
```

### Prevention
- Monitor connection pool usage
- Set up automated backups
- Configure disk space alerts
- Implement connection pooling

---

## Resource Exhaustion

**Alert**: `HighCPUUsage` or `HighMemoryUsage`  
**Severity**: Warning

### Symptoms
- Slow performance
- OOMKilled pods
- High CPU usage

### Investigation Steps

1. **Check resource usage**:
   ```bash
   kubectl top pods -n openclaw
   kubectl top nodes
   ```

2. **Check resource limits**:
   ```bash
   kubectl describe pod <pod-name> -n openclaw | grep -A 5 "Limits"
   ```

3. **Check for memory leaks**:
   - Review heap dumps
   - Check for unclosed connections
   - Monitor memory growth over time

### Resolution Steps

**If CPU constrained**:
```bash
# Increase CPU limits
kubectl edit deployment/openclaw-gateway -n openclaw

# Or scale horizontally
kubectl scale deployment/openclaw-gateway --replicas=5 -n openclaw
```

**If memory constrained**:
```bash
# Increase memory limits
kubectl edit deployment/openclaw-gateway -n openclaw

# Or restart pods to clear memory
kubectl rollout restart deployment/openclaw-gateway -n openclaw
```

**If node resources exhausted**:
```bash
# Add more nodes to cluster
# Or move workloads to different nodes
kubectl drain <node-name> --ignore-daemonsets
```

### Prevention
- Set appropriate resource requests/limits
- Enable Horizontal Pod Autoscaler
- Monitor resource trends
- Optimize code for efficiency

---

## Agent Failures

**Alert**: `HighAgentFailureRate`  
**Severity**: Warning  
**Threshold**: >10% failure rate for 5 minutes

### Symptoms
- Agent execution errors
- Timeout errors
- Failed tasks

### Investigation Steps

1. **Check agent logs**:
   ```bash
   kubectl logs -f deployment/openclaw-gateway -n openclaw | grep "agent_id"
   ```

2. **Check Grafana**:
   - Navigate to Agent Dashboard
   - Review "Error Count by Agent"
   - Identify failing agents

3. **Check Jaeger traces**:
   - Search for failed agent executions
   - Review error messages
   - Identify root cause

### Resolution Steps

**If agent code issue**:
- Review agent implementation
- Fix bugs
- Deploy updated agent

**If external service issue**:
- Check external service status
- Add retry logic
- Implement circuit breaker

**If resource issue**:
- Increase agent timeout
- Optimize agent code
- Add caching

### Prevention
- Add comprehensive error handling
- Implement retries with exponential backoff
- Add circuit breakers
- Monitor agent performance

---

## Quota Exceeded

**Alert**: `TenantApproachingUserLimit` or similar  
**Severity**: Warning  
**Threshold**: >90% of quota

### Symptoms
- User creation failures
- "Quota exceeded" errors
- Tenant complaints

### Investigation Steps

1. **Check quota usage**:
   ```bash
   # Query database
   kubectl exec -it openclaw-postgresql-0 -n openclaw -- \
     psql -U openclaw -c "SELECT tenant_id, COUNT(*) FROM users GROUP BY tenant_id;"
   ```

2. **Check Grafana**:
   - Navigate to Tenant Dashboard
   - Review "Quota Usage" panels
   - Identify affected tenants

### Resolution Steps

**If legitimate growth**:
- Contact tenant to upgrade plan
- Increase quota limits
- Update license

**If abuse detected**:
- Investigate usage patterns
- Contact tenant
- Implement rate limiting

**If bug causing over-counting**:
- Fix quota calculation
- Recalculate quotas
- Update database

### Prevention
- Set up quota alerts at 80%, 90%, 95%
- Implement soft limits with warnings
- Add quota dashboard for tenants
- Regular quota audits

---

## General Troubleshooting Tips

### Useful Commands

```bash
# View all pods
kubectl get pods -n openclaw

# View pod logs
kubectl logs -f <pod-name> -n openclaw

# Execute command in pod
kubectl exec -it <pod-name> -n openclaw -- /bin/sh

# Port forward for local access
kubectl port-forward svc/openclaw-gateway 3000:80 -n openclaw

# View events
kubectl get events -n openclaw --sort-by='.lastTimestamp'

# Describe resource
kubectl describe <resource-type> <resource-name> -n openclaw
```

### Log Queries (Elasticsearch/Kibana)

```
# Errors in last 15 minutes
level:ERROR AND @timestamp:[now-15m TO now]

# Slow requests
duration:>1000 AND @timestamp:[now-1h TO now]

# Specific tenant
tenant_id:"abc123" AND @timestamp:[now-1h TO now]

# Failed agent executions
status:error AND component:agent AND @timestamp:[now-1h TO now]
```

### Metrics Queries (Prometheus)

```promql
# Error rate
rate(http_requests_total{status=~"5.."}[5m])

# P95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Active connections
database_connections_active

# Memory usage
process_resident_memory_bytes / 1024 / 1024
```

---

## Contact Information

- **On-Call Engineer**: PagerDuty rotation
- **Engineering Lead**: engineering-lead@openclaw.com
- **Infrastructure Team**: infra@openclaw.com
- **Support**: support@openclaw.com

## Additional Resources

- [Architecture Documentation](https://docs.openclaw.com/architecture)
- [API Documentation](https://docs.openclaw.com/api)
- [Deployment Guide](https://docs.openclaw.com/deployment)
- [Monitoring Guide](https://docs.openclaw.com/monitoring)
