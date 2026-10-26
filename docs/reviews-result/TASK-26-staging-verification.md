# GRAMOZ — TASK-26: Staging Dry-Run & Production Readiness Verification

**Staging Review & SRE Team:**
- Senior DevOps / SRE Engineer
- Principal Quality Assurance Architect
- Production Reliability Engineer
- Staff Infrastructure Security Specialist

**Date:** October 25, 2026  
**Execution Target:** Realistic Production Staging Dry-Run  
**Deliverable Document:** `docs/reviews-result/TASK-26-staging-verification.md`

---

## 1. Staging Dry-Run Scope & Categorization Methodology

In accordance with strict production-readiness principles, this document provides an honest, evidence-based assessment of all operational and architectural capabilities of the Gramoz platform.

Checks are strictly categorized into:
- **`[VERIFIED]`**: Executed and verified directly against real running engines (PostgreSQL 16, Redis 7.4, Fastify HTTP server, Next.js Turbopack runtime, and Playwright Chromium browser).
- **`[SIMULATED]`**: Tested using stubbed external gateways, mocked third-party HTTP endpoints, cloned database templates, or synthetic network conditions.
- **`[UNEXECUTED]`**: Not provisioned or executed in the current local staging environment; represents a required pre-launch operational prerequisite.

---

## 2. Dry-Run Verification Matrix

### 2.1 Environment Configuration & Secret Management
| Check Item | Categorization | Evidence & Observability |
| :--- | :---: | :--- |
| **Fail-Closed Env Validation** | **`[VERIFIED]`** | Tested `validateEnvironment()` with `NODE_ENV=production`. Successfully threw `ConfigurationError` and blocked boot when default secrets or missing database credentials were supplied. |
| **Secret Boot Length & Strength** | **`[VERIFIED]`** | `AUTH_JWT_SECRET` and `COOKIE_SECRET` enforce 32-character minimum and reject common dictionary passwords. |
| **Dedicated Cloud Secret Vault** | **`[UNEXECUTED]`** | AWS Secrets Manager / HashiCorp Vault integration is not provisioned; environment relies on local `.env` files. |

### 2.2 Database Bootstrap, Upgrade & Disaster Recovery
| Check Item | Categorization | Evidence & Observability |
| :--- | :---: | :--- |
| **Clean Database Bootstrap** | **`[VERIFIED]`** | Executed real Drizzle ORM migrator on fresh PostgreSQL database (`BOOT-25-A`, `MIG-26-B`). Successfully applied all 31 migrations (`0000_...` through `0030_...`) without errors. |
| **Journal Monotonicity** | **`[VERIFIED]`** | Verified `_journal.json` contains 31 contiguous entries with past timestamps (`MIG-26-A`). Dev DB `platform_db` timestamps corrected to match. |
| **Database Backup (`pg_dump`)** | **`[VERIFIED]`** | Dumped `platform_db` via Docker CLI to `scratch/staging_backup.sql` (1.3 MB). |
| **Database Restore (`pg_restore`)** | **`[VERIFIED]`** | Created fresh database `test_t26_restore`, restored SQL dump, and verified 100% row counts (85 users, 31 migrations, all tables and schemas). |
| **Automated Backup Cron & S3 Offsite** | **`[UNEXECUTED]`** | Automated scheduled backup daemon with offsite retention to AWS S3/GCS is not yet implemented. |

### 2.3 Software Packaging & Compilation
| Check Item | Categorization | Evidence & Observability |
| :--- | :---: | :--- |
| **Backend TypeScript Typing** | **`[VERIFIED]`** | Executed `tsc --noEmit` in `server/`: 0 errors. |
| **NestJS Fastify Production Build** | **`[VERIFIED]`** | Executed `npm run build` (`nest build`) in `server/`: compiled clean output to `dist/`. |
| **Next.js Turbopack Build** | **`[VERIFIED]`** | Executed `next build` in `web/`: compiled 40 static and dynamic routes successfully in 15.8s. |
| **Production Containerization** | **`[UNEXECUTED]`** | Production Dockerfiles for backend and web were not executed with `--cpus=1 --memory=1g` resource limits. |

### 2.4 End-to-End User Journeys (Playwright & Vitest)
| Check Item | Categorization | Evidence & Observability |
| :--- | :---: | :--- |
| **Playwright Full Suite** | **`[VERIFIED]`** | Executed `npx playwright test` in `web/` against production server builds (:5000 and :3000). All **37 / 37** tests passed across 7 core user journeys. |
| **Frontend Unit & Store Suite** | **`[VERIFIED]`** | Executed `npm test` (`vitest run`) in `web/`: All **126 / 126** tests passed across 13 files in 1.49s. |
| **Backend Full Test Suite** | **`[VERIFIED]`** | Executed `npx jest --runInBand --forceExit` in `server/`: All **882 / 882** tests passed across 61 suites in 52.8s. |

### 2.5 Payment Gateway (SSLCommerz)
| Check Item | Categorization | Evidence & Observability |
| :--- | :---: | :--- |
| **IPN Signature Constant-Time Verification** | **`[VERIFIED]`** | Timing-safe byte buffer comparison verified (`safeEqual`). Secret hashes omitted from log output. |
| **Unauthenticated Callback Rejection** | **`[VERIFIED]`** | Spoofed IPNs with `status=FAILED` or negative gateway response rejected without state mutation (`SEC-18-7`, `SEC-18-8`). |
| **Live SSLCommerz Sandbox Redirect** | **`[SIMULATED]`** | Gateway communications executed via stubbed `global.fetch` and synthetic SSLCommerz IPN data. |
| **Production Payment Settlement** | **`[UNEXECUTED]`** | Live financial transaction processing with genuine Bangladesh bank cards or mobile wallets. |

### 2.6 Courier & Logistics (Steadfast)
| Check Item | Categorization | Evidence & Observability |
| :--- | :---: | :--- |
| **Lease-Ownership Fencing** | **`[VERIFIED]`** | Stale workers lose lease ownership and cannot trigger duplicate courier dispatches (`FENCE-26-A..G`). |
| **Ambiguity Retention & Dead-Lettering** | **`[VERIFIED]`** | Timeout or HTTP 5xx retains `PENDING_DISPATCH`; retry provider 404 dead-letters for manual reconciliation (`COU-26-A..D`). |
| **Live Carrier Sandbox Dispatch** | **`[SIMULATED]`** | Steadfast API interactions executed via stubbed network calls. |
| **Admin Manual Courier Reconciliation UI** | **`[UNEXECUTED]`** | An admin dashboard view to inspect and resolve `RECONCILIATION_REQUIRED` outbox shipments is absent. |

### 2.7 Infrastructure & Production Operations
| Check Item | Categorization | Evidence & Observability |
| :--- | :---: | :--- |
| **Graceful Process Shutdown** | **`[VERIFIED]`** | Added `app.enableShutdownHooks()` in `server/src/main.ts` ensuring SIGTERM/SIGINT drains connections. |
| **Fastify Proxy Trust** | **`[VERIFIED]`** | Configured `trustProxy: 1` in `main.ts` for upstream reverse proxy IP resolution. |
| **Reverse Proxy & TLS 1.3 Termination** | **`[UNEXECUTED]`** | Nginx / Caddy / Cloudflare reverse proxy with valid TLS certificate was not configured. |
| **Prometheus / Grafana Monitoring & Sentry** | **`[UNEXECUTED]`** | Real-time metrics scraping, outbox failure alerting, and APM error tracking are not integrated. |

---

## 3. Staging Dry-Run Conclusion

The core software components of the Gramoz platform (code logic, database schema, transactional outbox engine, and user interface) demonstrate exceptional architectural integrity and stability.

However, because external payment sandboxes, live carrier dispatches, production reverse proxies, and operational monitoring dashboards have not been provisioned, the staging dry-run concludes with **`CONDITIONALLY READY`**.
