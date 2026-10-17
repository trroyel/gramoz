# GRAMOZ-07: Executive Production Readiness Plan & Roadmap

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Staff Software Engineer, Software Architect & Production Readiness Auditor  
**Scope:** Final Executive Assessment, Readiness Scorecard, Critical Risk Register, and Phased Roadmap  
**Date:** October 2026  
**Status:** Complete Audit  

---

## 1. Production Readiness Scorecard

```
========================================================================================
                      GRAMOZ PRODUCTION READINESS SCORECARD
========================================================================================
Dimension                              Score     Status          Assessment
----------------------------------------------------------------------------------------
1. System Architecture & Topology      82 / 100  PASS            Strong modular monolith; robust outbox.
2. Backend Services & Concurrency      80 / 100  CONDITIONAL     Atomic stock; inventory leak on cancel.
3. Frontend & Client Security          68 / 100  BLOCKED         Edge middleware file naming flaw.
4. Database & Schema Integrity         78 / 100  CONDITIONAL     0013 migration bug; missing outbox index.
5. Security & Threat Posture           76 / 100  CONDITIONAL     Strong crypto; insecure secret defaults.
6. Testing & Quality Assurance         20 / 100  BLOCKED         Tests fail to compile; <4% coverage.
7. DevOps & Operational Reliability    60 / 100  CONDITIONAL     No CI/CD pipeline; basic Docker compose.
----------------------------------------------------------------------------------------
OVERALL PRODUCTION READINESS SCORE:    66 / 100  STATUS: BLOCKED FROM PRODUCTION LAUNCH
========================================================================================
```

### Executive Verdict:
Gramoz possesses a **high-quality, modern architectural foundation** (NestJS Fastify, Drizzle ORM, Next.js 16 App Router, Argon2, Transactional Outbox pattern with `FOR UPDATE SKIP LOCKED`). However, it cannot be safely deployed to live production for real customer financial transactions until the **four P0 Blockers** are resolved.

---

## 2. Consolidated Risk Register (P0 & P1)

| ID | Severity | Category | Risk Description | Business Impact | Remediation Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R-01** | **P1 (Reclassified)** | Security | Edge proxy lacks role-level claims verification for `/admin` (Audited: `proxy.ts` is confirmed Next.js 16 standard, not dead code). | Authenticated non-admin customers pass edge proxy into `/admin`; client store spoofable. | Enhance `web/src/proxy.ts` with edge role claims validation (TASK-05). |
| **R-02** | **P0** | Consistency | Deducted inventory is never returned when orders are cancelled or payments abandoned. | Inventory permanently leaks; products show sold out while unsold. | Add restock routine on `cancelled` status and create 30-min unpaid order auto-expiry cron. |
| **R-03** | **P0** | Database | Migration `0013` executes `DROP INDEX` on a foreign key unique constraint. | Fresh database migrations fail on clean deployment (`drizzle-kit migrate` crash). | Replace `DROP INDEX` with `ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS`. |
| **R-04** | **P0** | Quality | Backend test suite (`npm test`) fails compilation due to outdated DI providers. | Zero test verification on deployments; high risk of production regressions. | Update `orders.service.spec.ts` and `payments.service.spec.ts` with real providers. |
| **R-05** | **P0 (Upgraded)** | Security | Fallback secrets (`'secret'`, `'testpass'`) present in configuration service. | Token forgery and gateway spoofing if environment variables are omitted. | Add startup assertion failing server boot if default secrets are detected. |
| **R-06** | **P1** | Security | `POST /auth/login` and `POST /auth/forgot-password` lack strict rate limiting. | Vulnerable to credential stuffing and automated brute force attacks. | Add `@Throttle({ default: { ttl: 60_000, limit: 5 } })` to authentication endpoints. |
| **R-07** | **P2 (Reclassified)** | Database | Optimization: Add partial index on `outbox_events` (Audited: composite index `(status, created_at)` already exists in migration 0008). | Prevents index bloat over millions of historical events. | Add partial B-tree index `WHERE status = 'pending' AND attempts < 3` (TASK-12). |
| **R-08** | **P1** | Concurrency | Cart item addition lacks database-level unique constraint and atomic upsert. | Concurrent clicks create duplicate cart rows for identical products. | Add composite unique index and implement `ON CONFLICT DO UPDATE`. |
| **R-09** | **P1** | Performance | JWT strategy executes database SELECT query on every authenticated request. | Excessive database load (>1,000 queries/sec for modest traffic). | Cache user lookup in Redis with 60s TTL. |
| **R-10** | **P1** | Deployment | Next.js rewrites hardcode destination to `http://localhost:5000`. | Frontend fails to connect to backend when deployed in containerized staging/production. | Use `process.env.INTERNAL_API_URL` in `next.config.ts`. |

---

## 3. Phased Implementation Roadmap

```
PHASE 1: Launch Blockers (P0)        PHASE 2: Hardening (P1)           PHASE 3: Scale & Monitoring
[Estimated: 1-2 Days]               [Estimated: 2-3 Days]             [Estimated: 3-5 Days]
* Fix Next.js middleware name       * Cart unique index & upsert      * Denormalize product ratings
* Fix inventory cancellation leak   * Outbox partial index            * PgBouncer connection pooling
* Fix migration 0013 DROP INDEX     * Redis cache for JWT lookup      * Structured JSON logging (Pino)
* Fix broken Jest test fixtures     * Login route rate limiting       * Prometheus metrics exporter
* Fail boot on default secrets      * Dynamic Next.js rewrite URL     * Playwright E2E checkout suite
```

### Phase 1: Pre-Production Blockers (Immediate Execution Required)
1. **Frontend Edge Protection:**
   - Rename `web/src/proxy.ts` to `web/src/middleware.ts`.
   - Ensure the exported function is named `middleware`.
   - Verify that unauthenticated requests to `/admin` or `/dashboard` immediately redirect to `/login` with 307 Temporary Redirect at the HTTP edge before any page assets stream.
2. **Inventory Cancellation & Abandonment Restock:**
   - In `OrdersStore`, create `restockOrderItems(orderId, tx)` which:
     - Fetches all `order_items` for the given order.
     - Atomically increments `stock` on `products` and `product_variants`.
     - Inserts corresponding audit records into `inventory_transactions` with `type = 'in'`.
     - Decrements promo code `current_uses` if a promo was attached.
     - Refunds spent loyalty points to customer balance.
   - In `OrdersService.updateOrderStatus`, trigger `restockOrderItems` within a transaction whenever transitioning from non-cancelled to `cancelled`.
   - Create a background cron job in `OrdersModule` running every 15 minutes that auto-cancels pending online orders older than 30 minutes with unpaid status.
3. **Database Migration Fix:**
   - Update `server/drizzle/migrations/0013_flaky_puppet_master.sql`:
     ```sql
     ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "uq_cart_items_user_product";
     DROP INDEX IF EXISTS "uq_cart_items_user_product";
     ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "variant_id" uuid;
     ```
4. **Repair Automated Test Compilation:**
   - Update `server/src/modules/orders/orders.service.spec.ts` with correct mocks for `OrdersStore`, `PromosService`, `LoyaltyService`, `SettingsService`, and `CourierService`.
   - Update `server/src/modules/payments/payments.service.spec.ts` by adding `PaymentsStore` to the `providers` array.
   - Validate that `npm test` runs with 100% green suites.
5. **Enforce Startup Configuration Integrity:**
   - In `server/src/main.ts` or `ConfigService`, assert that `AUTH_JWT_SECRET` is defined and does not equal `'secret'`. If invalid, terminate process with exit code 1.

---

### Phase 2: Production Hardening (Pre-Launch Sprints)
1. **Cart Concurrency & Deduplication:**
   - Create migration adding composite unique index on `cart_items (user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))`.
   - Refactor `CartStore.createCartItem` to use PostgreSQL `ON CONFLICT (user_id, product_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`.
2. **Outbox Processor Indexing:**
   - Add partial B-tree index `CREATE INDEX idx_outbox_events_pending_claim ON outbox_events (created_at ASC) WHERE status = 'pending' AND attempts < 3;`.
3. **JWT Database Query Caching:**
   - In `JwtStrategy.validate(payload)`, check Redis `user:cache:<subKey>`. If hit, return user immediately. If miss, query database and cache for 60 seconds.
4. **Route Throttling on Authentication:**
   - Apply `@Throttle({ default: { ttl: 60_000, limit: 5 } })` to `POST /auth/login` and `POST /auth/forgot-password`.
5. **Configurable Next.js Rewrites:**
   - Replace hardcoded `http://localhost:5000` in `web/next.config.ts` with `process.env.INTERNAL_API_URL || 'http://localhost:5000'`.

---

### Phase 3: Observability, Scale & Performance (Post-Launch Hardening)
1. **Denormalize Product Ratings:**
   - Add `rating_avg numeric(3,2) DEFAULT 0` and `rating_count integer DEFAULT 0` to `products` table.
   - On review approval, calculate and update average rating in a single UPDATE query.
   - Remove correlated subqueries from `ProductsService.findAll`.
2. **Connection Pooling with PgBouncer:**
   - Introduce PgBouncer container or managed service in front of PostgreSQL to handle connection multiplexing for multi-pod autoscaling.
3. **Structured Logging & APM:**
   - Configure Pino structured JSON logging in NestJS with request ID propagation.
   - Add Prometheus metrics endpoint via `@willsoto/nestjs-prometheus`.
4. **End-to-End Automated Test Suite:**
   - Implement Playwright test suite covering customer checkout and admin order dispatch.

---

## 4. Architectural Decision Records (ADRs)

### ADR-01: Adoption of Transactional Outbox Pattern for Third-Party Side Effects
- **Context:** An e-commerce platform relies on external network services (Steadfast Courier, BulkSMSBD, Resend) that may experience network timeouts or outages. Executing these API calls inside database transactions causes long locks, and executing them outside transactions causes data inconsistencies if the process crashes.
- **Decision:** All critical side effects are written to the `outbox_events` table inside the business transaction. An asynchronous cron worker polls and claims events using PostgreSQL `FOR UPDATE SKIP LOCKED`.
- **Status:** **APPROVED & MAINTAINED**.

### ADR-02: Stateless JWT in HttpOnly Cookies vs LocalStorage
- **Context:** Storing JWT tokens in browser `localStorage` exposes them to XSS attacks and third-party script theft.
- **Decision:** Access and refresh tokens are stored strictly in `httpOnly`, `SameSite=Lax`, secure cookies. Client JavaScript has zero access to raw tokens. Logout revokes the Redis session key.
- **Status:** **APPROVED & MAINTAINED**.

### ADR-03: Mandatory Edge-Level Route Guarding in Next.js
- **Context:** Relying solely on client-side React `useEffect` redirects allows unauthenticated browsers to download administrative bundles and component code before being redirected.
- **Decision:** Enforce server-side route guarding at the edge using Next.js `middleware.ts`, inspecting the `access_token` cookie and redirecting unauthorized requests before HTML streaming begins.
- **Status:** **APPROVED FOR IMMEDIATE IMPLEMENTATION**.

---

## 5. Summary of Deliverables

The 7 comprehensive review reports have been compiled and saved to the project documentation repository:
1. [`GRAMOZ-01-project-architecture.md`](file:///home/trroyel/gramoz/docs/reviews-result/GRAMOZ-01-project-architecture.md) — System Overview, Topology, and Communication Flows
2. [`GRAMOZ-02-backend-review.md`](file:///home/trroyel/gramoz/docs/reviews-result/GRAMOZ-02-backend-review.md) — 19-Module Deep Dive, Concurrency, and Transaction Boundaries
3. [`GRAMOZ-03-frontend-review.md`](file:///home/trroyel/gramoz/docs/reviews-result/GRAMOZ-03-frontend-review.md) — Next.js 16 Architecture, Client Security, and UX Evaluation
4. [`GRAMOZ-04-database-review.md`](file:///home/trroyel/gramoz/docs/reviews-result/GRAMOZ-04-database-review.md) — PostgreSQL Schema, Index Optimization, and Migration Audit
5. [`GRAMOZ-05-security-review.md`](file:///home/trroyel/gramoz/docs/reviews-result/GRAMOZ-05-security-review.md) — Threat Assessment, Cryptography, and Vulnerability Triage
6. [`GRAMOZ-06-testing-and-qa.md`](file:///home/trroyel/gramoz/docs/reviews-result/GRAMOZ-06-testing-and-qa.md) — Test Failure Root-Cause Triage, Redesign, and E2E Matrix
7. [`GRAMOZ-07-executive-summary.md`](file:///home/trroyel/gramoz/docs/reviews-result/GRAMOZ-07-executive-summary.md) — Production Readiness Scorecard, Risk Register, and Remediation Roadmap
