# Gramoz E-Commerce Platform — Production Deployment Runbook

**Target Architecture:** Multi-container deployment on Linux (Docker Compose / OCI Containers)  
**Host Boundary:** Enforced 1 vCPU / 1 GB RAM resource boundary  
**Document Version:** 2.0.0 (TASK-27F Operational Remediation)  
**Deployment SLA:** Controlled Maintenance Window (Expected brief downtime: 5–15 seconds per service restart)

---

## 1. System Topology & Resource Allocations

Gramoz employs a 5-tier isolated container topology:

| Container | Image | Resource Limit | Ports (Host) | Network | Responsibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `gramoz-prod-nginx` | `nginx:1.27-alpine` | 0.05 CPU / 64MB RAM | `80:80`, `443:443` | `edge-net` | TLS termination, HTTP-to-HTTPS redirect, rate limiting, static asset proxying |
| `gramoz-prod-backend` | `gramoz-backend:latest` | 0.40 CPU / 384MB RAM | None (Internal: 5000) | `edge-net`, `internal-net` | NestJS 11 + Fastify REST API, transaction outbox worker, payment/courier webhooks |
| `gramoz-prod-frontend` | `gramoz-frontend:latest` | 0.30 CPU / 256MB RAM | None (Internal: 3000) | `edge-net` | Next.js 16 (App Router + Turbopack SSR), storefront UI |
| `gramoz-prod-postgres` | `postgres:16-alpine` | 0.20 CPU / 256MB RAM | None (Internal: 5432) | `internal-net` | System of record, ACID financial ledger, Drizzle migrations, vector search |
| `gramoz-prod-redis` | `redis:7.4-alpine` | 0.05 CPU / 64MB RAM | None (Internal: 6379) | `internal-net` | 48MB `volatile-lru` cache, session rotation, OTP counters |
| **TOTAL** | | **1.00 vCPU / 1024MB RAM** | | | Strict adherence to deployment boundary |

> [!IMPORTANT]
> **Single-Instance Topology Notice:**  
> Under the strict 1 vCPU / 1 GB RAM hosting budget, only a single backend container and a single frontend container are provisioned. A restart of the container causes a brief 5–15 second window where incoming HTTP requests receive HTTP 502 Bad Gateway from Nginx. Gramoz **DOES NOT** provide zero-downtime rolling upgrades in this single-node topology. All production upgrades must be scheduled during low-traffic maintenance windows.

---

## 2. Pre-Deployment Secret & Configuration Validation

Before initiating deployment, verify all required production secrets in `.env.production`:

```bash
# Verify non-empty secrets without printing values
test -n "${JWT_SECRET}" || { echo "ERROR: JWT_SECRET missing"; exit 1; }
test -n "${COOKIE_SECRET}" || { echo "ERROR: COOKIE_SECRET missing"; exit 1; }
test -n "${PLATFORM_DB_PASSWORD}" || { echo "ERROR: DB password missing"; exit 1; }
test -n "${REDIS_PASSWORD}" || { echo "ERROR: REDIS_PASSWORD missing"; exit 1; }
test -n "${R2_ACCESS_KEY_ID}" || { echo "ERROR: Cloudflare R2 credentials missing"; exit 1; }
test -n "${METRICS_TOKEN}" || { echo "WARN: METRICS_TOKEN missing; /metrics will allow only local loopback"; }
```

### Critical Production Rules:
1. `NODE_ENV=production` must be set in both backend and frontend.
2. `POSTGRES_USER` superuser credentials must not be used by the application runtime; runtime connects via `platform_user`.
3. Redis persistence is disabled (`--save "" --appendonly no`) to eliminate I/O disk thrashing under 1 GB RAM.
4. Database pool limits must not exceed `DB_POOL_MAX=10` per backend instance to prevent PostgreSQL connection exhaustion.

---

## 3. Initial Deployment Procedure

```bash
# 1. Clone repository to deployment directory
git clone https://github.com/gramoz/gramoz.git /opt/gramoz
cd /opt/gramoz

# 2. Provision TLS Certificates (Let's Encrypt or corporate CA)
mkdir -p infra/nginx/certs
chmod 600 infra/nginx/certs/gramoz.key

# 3. Pull base images and build production containers
docker compose -f docker-compose.prod.yml build --no-cache

# 4. Bootstrap Database and Execute Migrations
docker compose -f docker-compose.prod.yml up -d postgres redis
# Wait for healthchecks
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U platform_user -d platform_db

# 5. Run Drizzle Migrations
docker compose -f docker-compose.prod.yml run --rm backend npm run db:migrate

# 6. Launch Backend, Frontend, and Nginx Reverse Proxy
docker compose -f docker-compose.prod.yml up -d

# 7. Verify Health Status
docker compose -f docker-compose.prod.yml ps
curl -f https://gramoz.com/health
curl -f -H "x-metrics-token: ${METRICS_TOKEN}" https://gramoz.com/metrics
```

---

## 4. Controlled Maintenance Deployment (Disruption-Minimized Strategy)

For planned application releases and updates:

### Phase A: Pre-Flight Safety Checks
1. **Drain Transactional Outbox:**
   Check that no outbox events are stranded in `processing` status:
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U platform_user -d platform_db \
     -c "SELECT count(*) FROM outbox_events WHERE status = 'processing';"
   ```
   If count > 0, wait 30 seconds for the worker cycle to complete.
2. **Execute Pre-Deployment Backup:**
   ```bash
   /opt/gramoz/infra/scripts/backup.sh
   ```
   Ensures an immediate point-in-time recovery point exists.

### Phase B: Build and Tag New Images
```bash
# Tag existing running image as previous for instant rollback
docker tag gramoz-backend:latest gramoz-backend:previous
docker tag gramoz-frontend:latest gramoz-frontend:previous

# Build new release images
docker compose -f docker-compose.prod.yml build backend frontend
```

### Phase C: Forward-Compatible Database Migration
All Drizzle schema migrations MUST follow the **Expand-and-Contract** pattern:
- Additive changes only (new nullable columns, new tables).
- No destructive column drops in the same release as code changes.
- Existing running code must function seamlessly with new columns.

```bash
docker compose -f docker-compose.prod.yml run --rm backend npm run db:migrate
```

### Phase D: Service Restart & Container Swap
```bash
# Restart backend and frontend with new images
docker compose -f docker-compose.prod.yml up -d --no-deps backend frontend
```
*Note: This induces approximately 5–15 seconds of service unavailability while NestJS initializes.*

### Phase E: Post-Deployment Verification
```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Verify health and readiness endpoints
curl -f https://gramoz.com/health
curl -f https://gramoz.com/api/v1/health

# Verify metrics endpoint access control
curl -I https://gramoz.com/metrics
# Should return 403 Forbidden for public scraper without token
curl -I -H "x-metrics-token: ${METRICS_TOKEN}" https://gramoz.com/metrics
# Should return 200 OK
```

---

## 5. Emergency Rollback Procedure

If the new release experiences fatal crash loops, high error rates, or unhandled exceptions:

### 1. Application Container Rollback (< 30 seconds)
Because schema migrations are strictly forward-compatible, revert container images immediately:
```bash
docker compose -f docker-compose.prod.yml stop backend frontend
docker tag gramoz-backend:previous gramoz-backend:latest
docker tag gramoz-frontend:previous gramoz-frontend:latest
docker compose -f docker-compose.prod.yml up -d backend frontend
```

### 2. Post-Rollback Smoke Test
```bash
curl -f https://gramoz.com/health
docker compose -f docker-compose.prod.yml logs --tail 50 backend
```

> [!CAUTION]
> **Database Rollback Policy:**  
> Do NOT execute full database restoration (`restore.sh`) unless catastrophic data corruption has occurred. Restoring a pre-deployment database backup permanently overwrites all genuine orders, payments, and customer accounts created since the backup was taken.
