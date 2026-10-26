# Gramoz Operational Incident Response & Triage Runbook

**Document Version:** 2.0.0 (TASK-27F Operational Remediation)  
**Target Architecture:** NestJS 11 + Fastify, Next.js 16, PostgreSQL 16, Redis 7.4  
**Severity Levels:** P0 (Outage/Data Loss), P1 (Degraded Business Flow), P2 (Non-Critical Warning)

---

## 1. Quick Incident Triage Matrix

| Symptom | Probable Cause | Immediate Containment | Diagnostic Command | Recovery Action |
| :--- | :--- | :--- | :--- | :--- |
| **API returning 502 / 504 Bad Gateway** | Backend container crash or unhandled error loop | Check container status; inspect error log | `docker compose -f docker-compose.prod.yml logs --tail=100 backend` | Restart backend; verify DB/Redis reachability |
| **Memory Spike / Process OOM Kill** | Heap bloat or large payload processing | Inspect RSS and heap metrics | `curl -s -H "x-metrics-token: $METRICS_TOKEN" https://gramoz.com/metrics \| grep nodejs_memory` | Review payload size limits; restart container |
| **Outbox Processing Backlog (> 100)** | External carrier/payment provider latency or crash | Worker lease timeout | `curl -s -H "x-metrics-token: $METRICS_TOKEN" https://gramoz.com/metrics \| grep outbox` | Resolve provider issue; recover stuck leases |
| **Redis Outage / Unreachable** | Redis service stopped or maxmemory rejected writes | Sessions degrade to re-login; DB takes reads | `docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" ping` | Restart Redis; inspect `info memory` |
| **Database Disk Full (> 90%)** | WAL generation or backup files accumulated | Prune old backups | `df -h /var/lib/postgresql/data` | Run `find /opt/gramoz/infra/backups -mtime +7 -delete` |
| **Payment IPN Verification Failure** | Gateway webhook secret mismatch or gateway IP change | Check SSLCommerz webhook logs | `docker compose -f docker-compose.prod.yml logs backend \| grep SSLCommerz` | Validate gateway credentials in settings |

---

## 2. Incident Scenarios & Standard Operating Procedures

### Scenario A: Outbox Backlog & Courier Reconciliation Storm
- **Detection:** Metric `outbox_pending_events > 50` or `courier_reconciliation_backlog > 10`.
- **Containment:** Verify Steadfast portal status.
- **Diagnostic:**
  ```bash
  # Check pending and failed events in outbox safely using environment credentials
  docker compose -f docker-compose.prod.yml exec -e PGPASSWORD="$PLATFORM_DB_PASSWORD" postgres \
    psql -U platform_user -d platform_db -c "
      SELECT id, type, status, attempts, left(last_error, 50) 
      FROM outbox_events 
      WHERE status IN ('pending', 'failed') 
      ORDER BY created_at DESC LIMIT 10;
    "
  ```
- **Recovery:** Follow `docs/operations/courier-reconciliation-runbook.md` to resolve events.

### Scenario B: Redis Memory Pressure & Cache Invalidation
- **Detection:** Metric `redis_evicted_keys_total` incrementing rapidly or `redis_used_memory_bytes > 45MB`.
- **Containment:**
  Redis automatically evicts the oldest keys with TTL under `volatile-lru`.
  If memory usage approaches the 48MB limit:
  ```bash
  docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" info memory
  ```
- **Recovery (Safe Non-Blocking Invalidation):**
  > [!WARNING]
  > Never execute `redis.call('keys', ...)` in production. An unbounded `KEYS` scan blocks the Redis single-threaded engine and causes severe latency spikes or process crashes.
  
  Use safe, non-blocking asynchronous `SCAN` iteration to unlink cached keys:
  ```bash
  docker compose -f docker-compose.prod.yml exec redis bash -c '
    redis-cli -a "$REDIS_PASSWORD" --scan --pattern "product:*" | xargs -L 100 redis-cli -a "$REDIS_PASSWORD" UNLINK
  '
  ```

### Scenario C: Emergency Platform Shutdown
If an ongoing security breach, database corruption, or financial ledger anomaly is detected:
```bash
# 1. Immediately drop external ingress
docker compose -f docker-compose.prod.yml stop nginx

# 2. Stop backend workers to halt financial / courier mutations
docker compose -f docker-compose.prod.yml stop backend

# 3. Create forensic snapshot of database
/opt/gramoz/infra/scripts/backup.sh

# 4. Notify incident response lead and stakeholders
```

### Scenario D: Secret Rotation Runbook (JWT & Cookie Secrets)
To rotate `JWT_SECRET` and `COOKIE_SECRET`:
1. Generate new 64-character random secrets:
   ```bash
   openssl rand -hex 32
   ```
2. Update `.env.production` using strict file permissions (`chmod 600 .env.production`).
3. Restart backend container:
   ```bash
   docker compose -f docker-compose.prod.yml restart backend
   ```
4. Note: Existing user access tokens and refresh tokens will be invalidated; users will be required to re-authenticate. Active cart sessions and order history are completely preserved.
