# Gramoz Production Release & Go-Live Checklist

**Document Version:** 2.0.0 (TASK-27F Operational Remediation)  
**Release Target:** Production Launch Gate  
**Approval Standard:** All Release Gates Verified or Documented

---

## 1. Release Gates & Verification Matrix

| Release Gate | Verification Method | Pass Criteria | Status | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **G1: Backend Test Suite** | `npx jest --runInBand --forceExit` | 100% suites pass, 0 regressions | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G2: Frontend Test Suite** | `npm test` in `web/` (Vitest) | 100% tests pass | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G3: End-to-End Suite** | `npx playwright test` in `web/` | 100% specs pass | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G4: Carrier Reconciliation Safety** | Integration spec `courier-reconciliation.integration.spec.ts` | 13/13 tests pass (404 ambiguity guard, affirmative evidence requirement, append-only audit table) | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G5: Operational DR & Restore** | `infra/scripts/test-dr-restore.sh` | Dump + AES-256 encrypt + decrypt + checksum + `pg_restore` verified (<5s RTO; RPO <= 6h logical) | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G6: Database Migration State** | Drizzle Journal vs `drizzle.__drizzle_migrations` | 32/32 migrations applied (0000 to 0031_courier_reconciliation_audit) | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G7: Redis Session & Pressure** | `redis-memory-pressure.integration.spec.ts` | volatile-lru eviction verified under 48MB limit, DB authoritative | **PASS** | VERIFIED UNDER RESOURCE LIMITS |
| **G8: Reverse Proxy & Upload Configuration** | `infra/nginx/conf.d/gramoz.conf` | `client_max_body_size 4M` (multipart framing headroom), Fastify 2MB payload ceiling, `/metrics` ACL | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G9: Resource Boundary Enforcement** | Container RSS under 1 vCPU / 1 GB limit | Total loaded RSS ~449MB < 1024MB | **PASS** | VERIFIED UNDER RESOURCE LIMITS |
| **G10: Metrics Access Control** | `metrics.service.spec.ts` & HTTP requests | Public anonymous access rejected with 403; internal/token access permitted | **PASS** | VERIFIED IN LOCAL ENVIRONMENT |
| **G11: Third-Party Live Sandboxes** | Direct merchant credentials | SSLCommerz, Steadfast live merchant portal sandbox testing | **PENDING** | UNEXECUTED (Awaiting live merchant credentials) |
| **G12: Production TLS & Live Ingress** | Public DNS + Certbot Let's Encrypt | Port 80/443 public ingress with valid CA-signed TLS certificate | **PENDING** | UNEXECUTED (Awaiting live VPS hosting deployment) |
| **G13: Remote Offsite Backup Storage** | S3/Cloudflare R2 Bucket Sync | Automated push of `.enc` backup archives to live remote S3 bucket | **PENDING** | UNEXECUTED (Awaiting production S3 bucket & IAM credentials) |

---

## 2. Pre-Flight Go-Live Sign-Off Steps

- [ ] **Infrastructure & Network Security**
  - [ ] Production Linux host provisioned with Docker and Docker Compose.
  - [ ] Firewall (UFW/iptables): Ports 80 and 443 open to edge; ports 5432 (Postgres) and 6379 (Redis) strictly blocked from external internet.
  - [ ] TLS certificate installed and verified at `/opt/gramoz/infra/nginx/certs/gramoz.crt`.
- [ ] **Secrets & Configuration Management**
  - [ ] High-entropy 64-char `JWT_SECRET`, `COOKIE_SECRET`, and `METRICS_TOKEN` generated and loaded via environment.
  - [ ] Dedicated unprivileged PostgreSQL role `platform_user` configured (not `postgres` superuser).
  - [ ] Strong Redis password configured with `requirepass`.
  - [ ] Production Cloudflare R2 / AWS S3 storage keys loaded.
- [ ] **Disaster Recovery & Operational Safety**
  - [ ] Automated backup cron scheduled at 02:00, 08:00, 14:00, 20:00 UTC with `flock` locking.
  - [ ] Alert webhook configured (`ALERT_WEBHOOK_URL`).
  - [ ] On-call SRE trained on `docs/operations/database-backup-recovery.md` and `docs/operations/courier-reconciliation-runbook.md`.
- [ ] **Go-Live Decision**
  - [ ] Recommendation: **CONDITIONAL GO** (Code, migrations, security, and operational runbooks fully verified; release is gated on live provider merchant sandbox credentials and production cloud storage provisioning).
