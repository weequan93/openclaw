# SLA Monitoring Guide

This guide explains how to monitor and report on Service Level Agreements (SLAs) for OpenClaw.

## Overview

OpenClaw provides enterprise-grade SLAs to ensure reliable service delivery. This document defines our SLAs, SLIs (Service Level Indicators), and SLOs (Service Level Objectives).

---

## Service Level Agreements (SLAs)

### Availability SLA

**Target**: 99.9% uptime  
**Allowed Downtime**: 43 minutes per month  
**Measurement Period**: Monthly  
**Exclusions**: Scheduled maintenance (with 7 days notice)

**Calculation**:
```
Availability = (Total Time - Downtime) / Total Time × 100%
```

**Monitoring**:
```promql
# Uptime percentage (last 30 days)
avg_over_time(up{job="openclaw-gateway"}[30d]) * 100
```

### Latency SLA

**Target**: P95 < 500ms  
**Measurement**: 95th percentile response time  
**Measurement Period**: Monthly  
**Scope**: All API endpoints

**Monitoring**:
```promql
# P95 latency (last 30 days)
histogram_quantile(0.95,
  rate(http_request_duration_seconds_bucket[30d])
)
```

### Error Rate SLA

**Target**: < 0.1% error rate  
**Measurement**: 5xx errors / total requests  
**Measurement Period**: Monthly  
**Scope**: All API endpoints

**Monitoring**:
```promql
# Error rate (last 30 days)
sum(rate(http_requests_total{status=~"5.."}[30d])) /
sum(rate(http_requests_total[30d]))
```

### Data Durability SLA

**Target**: 99.999% durability  
**Measurement**: Data loss events  
**Measurement Period**: Annually  
**Scope**: All stored data (sessions, messages, agents)

**Monitoring**:
- Automated backups every 6 hours
- Point-in-time recovery (PITR)
- Cross-region replication
- Regular restore testing

---

## Service Level Indicators (SLIs)

### 1. Availability

**Definition**: Percentage of successful health check probes

**Measurement**:
```promql
# Current availability
avg(up{job="openclaw-gateway"}) * 100
```

**Grafana Panel**:
- Type: Stat
- Query: `avg(up{job="openclaw-gateway"}) * 100`
- Thresholds: Red <99.9%, Yellow 99.9-99.95%, Green >99.95%

### 2. Request Success Rate

**Definition**: Percentage of requests returning 2xx/3xx status codes

**Measurement**:
```promql
# Success rate
sum(rate(http_requests_total{status=~"[23].."}[5m])) /
sum(rate(http_requests_total[5m]))
```

**Grafana Panel**:
- Type: Graph
- Query: Success rate over time
- Thresholds: Red <99.9%, Yellow 99.9-99.95%, Green >99.95%

### 3. Response Time

**Definition**: Time from request to response

**Measurements**:
- P50 (median)
- P95 (95th percentile)
- P99 (99th percentile)

**Queries**:
```promql
# P50
histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))

# P95
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# P99
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
```

### 4. Agent Execution Success Rate

**Definition**: Percentage of successful agent executions

**Measurement**:
```promql
# Agent success rate
sum(rate(agent_executions_total{status="success"}[5m])) /
sum(rate(agent_executions_total[5m]))
```

### 5. Database Query Performance

**Definition**: Database query latency

**Measurement**:
```promql
# P95 query latency
histogram_quantile(0.95, rate(database_query_duration_seconds_bucket[5m]))
```

---

## Service Level Objectives (SLOs)

### Critical SLOs (P0)

| SLO | Target | Current | Status |
|-----|--------|---------|--------|
| Availability | 99.9% | 99.95% | ✅ |
| P95 Latency | <500ms | 320ms | ✅ |
| Error Rate | <0.1% | 0.05% | ✅ |

### Important SLOs (P1)

| SLO | Target | Current | Status |
|-----|--------|---------|--------|
| Agent Success Rate | >99% | 99.2% | ✅ |
| Database P95 Latency | <100ms | 45ms | ✅ |
| WebSocket Uptime | >99.5% | 99.8% | ✅ |

### Nice-to-Have SLOs (P2)

| SLO | Target | Current | Status |
|-----|--------|---------|--------|
| P99 Latency | <1s | 850ms | ✅ |
| Message Processing | <200ms | 150ms | ✅ |
| Session Creation | <100ms | 65ms | ✅ |

---

## Error Budgets

### Concept

An error budget is the maximum amount of downtime/errors allowed while still meeting the SLA.

**Formula**:
```
Error Budget = (1 - SLA Target) × Total Time
```

### Monthly Error Budget (99.9% SLA)

**Total Time**: 30 days = 43,200 minutes  
**Error Budget**: 0.1% = 43.2 minutes  
**Per Day**: 1.44 minutes  
**Per Hour**: 0.072 minutes (4.3 seconds)

### Error Budget Tracking

```promql
# Remaining error budget (minutes)
(43.2 - (
  (1 - avg_over_time(up{job="openclaw-gateway"}[30d])) * 43200
))
```

**Grafana Panel**:
- Type: Gauge
- Query: Remaining error budget
- Thresholds: Red <10%, Yellow 10-30%, Green >30%

### Error Budget Policy

**If error budget is exhausted**:
1. Freeze feature releases
2. Focus on reliability improvements
3. Conduct incident review
4. Implement preventive measures

**If error budget is healthy (>50%)**:
1. Continue feature development
2. Experiment with new features
3. Optimize performance

---

## Monitoring Dashboards

### SLA Dashboard

Create a dedicated Grafana dashboard for SLA monitoring:

**Panels**:
1. **Availability** (Stat)
   - Current: 99.95%
   - Target: 99.9%
   - Status: ✅

2. **Error Budget** (Gauge)
   - Remaining: 38.5 minutes
   - Total: 43.2 minutes
   - Status: ✅

3. **P95 Latency** (Graph)
   - Current: 320ms
   - Target: 500ms
   - Trend: Improving

4. **Error Rate** (Graph)
   - Current: 0.05%
   - Target: 0.1%
   - Trend: Stable

5. **SLO Compliance** (Table)
   - All SLOs with current values
   - Status indicators
   - Trend arrows

### Monthly SLA Report

**Automated Report Contents**:
- Availability percentage
- Downtime incidents
- Error rate
- Latency percentiles
- SLO compliance
- Error budget consumption
- Improvement recommendations

**Generation**:
```bash
# Export Prometheus data
curl -G 'http://prometheus:9090/api/v1/query_range' \
  --data-urlencode 'query=avg_over_time(up{job="openclaw-gateway"}[30d])' \
  --data-urlencode 'start=2024-01-01T00:00:00Z' \
  --data-urlencode 'end=2024-01-31T23:59:59Z' \
  --data-urlencode 'step=1h' > sla-report.json
```

---

## Incident Impact on SLA

### Severity Levels

**P0 - Critical**:
- Complete service outage
- Data loss
- Security breach
- **SLA Impact**: High

**P1 - High**:
- Partial service degradation
- High error rate (>5%)
- Severe performance issues
- **SLA Impact**: Medium

**P2 - Medium**:
- Minor service degradation
- Elevated error rate (1-5%)
- Performance degradation
- **SLA Impact**: Low

**P3 - Low**:
- Individual feature issues
- Cosmetic bugs
- **SLA Impact**: None

### Incident Tracking

**Required Information**:
- Start time
- End time
- Duration
- Severity
- Root cause
- Impact on SLA
- Remediation steps

**Example**:
```yaml
incident:
  id: INC-2024-001
  severity: P1
  start: 2024-01-15T14:30:00Z
  end: 2024-01-15T15:45:00Z
  duration: 75 minutes
  impact:
    availability: -0.17%
    error_budget: -75 minutes
  root_cause: Database connection pool exhausted
  resolution: Increased max_connections from 100 to 200
```

---

## SLA Credits and Compensation

### Credit Calculation

If SLA is not met, customers receive service credits:

| Availability | Credit |
|--------------|--------|
| 99.0% - 99.9% | 10% |
| 95.0% - 99.0% | 25% |
| < 95.0% | 50% |

**Example**:
- Monthly fee: $1,000
- Availability: 99.5%
- Credit: 10% = $100

### Credit Request Process

1. Customer submits credit request
2. Review SLA metrics
3. Calculate downtime
4. Approve/deny credit
5. Apply credit to next invoice

---

## Continuous Improvement

### Weekly Review

**Metrics to Review**:
- Availability trend
- Error rate trend
- Latency trend
- Incident count
- Error budget consumption

**Actions**:
- Identify degradation
- Plan improvements
- Adjust alerts
- Update runbooks

### Monthly Review

**Deep Dive**:
- SLA compliance
- Incident analysis
- Performance trends
- Capacity planning
- Customer feedback

**Deliverables**:
- SLA report
- Incident summary
- Improvement plan
- Capacity forecast

### Quarterly Review

**Strategic Planning**:
- SLA target review
- Infrastructure upgrades
- Process improvements
- Tool evaluation

---

## Alerting Strategy

### SLA-Related Alerts

**Error Budget Alerts**:
```yaml
- alert: ErrorBudgetBurnRateTooHigh
  expr: |
    (1 - avg_over_time(up{job="openclaw-gateway"}[1h])) * 720 > 4.32
  for: 5m
  annotations:
    summary: "Error budget burning too fast"
    description: "At current rate, monthly error budget will be exhausted"
```

**SLA Violation Alerts**:
```yaml
- alert: SLAViolation
  expr: |
    avg_over_time(up{job="openclaw-gateway"}[30d]) < 0.999
  for: 1h
  annotations:
    summary: "SLA violation detected"
    description: "30-day availability is {{ $value | humanizePercentage }}"
```

### Alert Routing

**Critical (P0)**:
- PagerDuty (immediate)
- Slack #incidents
- Email to on-call

**Warning (P1)**:
- Slack #alerts
- Email to team

**Info (P2)**:
- Slack #monitoring
- Dashboard annotation

---

## Tools and Automation

### Prometheus Recording Rules

Pre-calculate SLA metrics for faster queries:

```yaml
groups:
  - name: sla_metrics
    interval: 60s
    rules:
      - record: sla:availability:30d
        expr: avg_over_time(up{job="openclaw-gateway"}[30d])
      
      - record: sla:error_rate:30d
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[30d])) /
          sum(rate(http_requests_total[30d]))
      
      - record: sla:latency_p95:30d
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket[30d])
          )
```

### Automated Reporting

**Script**: `scripts/generate-sla-report.sh`

```bash
#!/bin/bash
# Generate monthly SLA report

MONTH=$(date -d "last month" +%Y-%m)
START="${MONTH}-01T00:00:00Z"
END="${MONTH}-$(date -d "${MONTH}-01 +1 month -1 day" +%d)T23:59:59Z"

# Query Prometheus
curl -G 'http://prometheus:9090/api/v1/query' \
  --data-urlencode "query=sla:availability:30d" \
  --data-urlencode "time=${END}" > availability.json

# Generate report
python3 scripts/sla-report.py \
  --month "${MONTH}" \
  --output "reports/sla-${MONTH}.pdf"
```

---

## Best Practices

1. **Monitor continuously**: Don't wait for incidents
2. **Set realistic targets**: Based on actual performance
3. **Track error budgets**: Balance reliability and innovation
4. **Automate reporting**: Reduce manual effort
5. **Review regularly**: Weekly, monthly, quarterly
6. **Learn from incidents**: Improve processes
7. **Communicate transparently**: Share SLA status with customers
8. **Plan capacity**: Prevent resource exhaustion
9. **Test disaster recovery**: Ensure data durability
10. **Iterate and improve**: Continuously raise the bar

---

## Resources

- [Grafana SLA Dashboard](http://grafana.openclaw.com/d/sla)
- [Prometheus Metrics](http://prometheus.openclaw.com)
- [Incident History](https://status.openclaw.com)
- [SLA Policy](https://openclaw.com/sla)

---

*Last Updated: 2026-02-03*
