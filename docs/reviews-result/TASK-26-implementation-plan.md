# GRAMOZ — TASK-26: Production Staging Dry-Run & Implementation Plan

**Engineering Roles:**
- Principal Software Architect
- Staff NestJS / Fastify Engineer
- PostgreSQL Database Architect
- Senior DevOps / SRE Engineer
- Application Security Engineer
- Distributed Systems Engineer
- Senior QA Automation Engineer

**Date:** October 25, 2026  
**Target Architecture:** 1 vCPU / 1 GB RAM Deployment Constraint (PostgreSQL 16, Redis 7.4, NestJS 11 + Fastify, Next.js 16 Turbopack)  
**Deliverable Document:** `docs/reviews-result/TASK-26-implementation-plan.md`

---

## 1. Overview & Objectives

TASK-26 represents the final production-readiness review, critical defect remediation, performance characterization, and realistic staging dry-run of the Gramoz e-commerce platform.

While TASK-25 reported a `VERIFIED` baseline (858 backend tests, 126 frontend tests, 37 Playwright E2E tests), an independent, skeptical deep-dive identified critical P0/P1 release-blocking defects in:
1. **Outbox Worker Interleaving & Lease-Ownership Fencing:** Prior monotonicity checks allowed stale workers to execute side effects before verifying claim ownership.
2. **Steadfast Courier Dispatch Ambiguity & Tracking Code Extraction:** Incomplete classification of provider responses, payload shape mismatch (`consignment.tracking_code` vs `data.data`), and risk of duplicate physical shipments upon timeout.
3. **Migration Journal Timestamp Future-Dating:** Drizzle ORM skips migrations if `journalEntry.when <= last_applied.created_at`. Future-dated timestamps in `_journal.json` (1792745600000..1793264000000) would cause future migrations (0031+) to be silently skipped.
4. **Canonical Purchase Identity Mismatch:** Disagreement between runtime review submission (unordered query + `find()`) and migration 0029 (lowest order item ID).
5. **Payment Gateway IPN Timing Leaks & Unauthenticated State Mutation:** Non-constant-time signature comparison, sensitive hash logging, and potential payment state mutations on spoofed IPNs.
6. **Application Process Signal Lifecycle:** Missing NestJS shutdown hooks (`enableShutdownHooks()`), risking abrupt socket termination and connection leaks.

---

## 2. Architecture & Production Constraints

| Component | Technology | Target Constraint | Deployment Configuration |
| :--- | :--- | :--- | :--- |
| **Backend API** | NestJS 11 + Fastify | 1 vCPU / 1 GB RAM | Fastify HTTP adapter, `trustProxy: 1`, Helmet, Cookies |
| **Frontend Web** | Next.js 16 (App Router) | Shared with host / edge | Turbopack build, Server-Side Middleware / Edge Proxy |
| **Database** | PostgreSQL 16 + Drizzle ORM | Bounded pool | Dedicated schema, B-tree & partial indexes, max pool 20 |
| **Cache & Sessions** | Redis 7.4 Alpine | Bounded memory | 48 MB `maxmemory`, `volatile-lru` eviction, no AOF/RDB |
| **Outbox Engine** | Transactional Outbox | Single/Multi-worker | FOR UPDATE SKIP LOCKED, atomic claim, 5-min lease |
| **External APIs** | SSLCommerz, Steadfast, BulkSMSBD, Resend | Mock / Sandbox | Timeout abort signals, fail-closed validation |

---

## 3. Remediation & Implementation Workstreams

### Workstream A: Outbox Worker Lease-Ownership Fencing & Attempt Equality
- **Root Cause:** A worker claiming an event whose execution was delayed (e.g. queue backlog or GC pause) would execute external HTTP calls (SMS, Email, Courier, Refund) even if its 5-minute lease expired and the recovery cron re-queued it for another worker. Furthermore, completion updates without attempt fencing could overwrite newer attempts.
- **Remediation Strategy:**
  1. Add an exported `NonRetryableOutboxError` class that directly dead-letters unrecoverable events.
  2. Implement an **atomic lease-ownership verification query** at the beginning of `processEvent()`:
     ```sql
     UPDATE outbox_events 
     SET updated_at = NOW() 
     WHERE id = $id AND status = 'processing' AND attempts = $event.attempts 
     RETURNING id
     ```
     If 0 rows are returned, the worker immediately logs a warning and exits with `false`, performing zero external side effects.
  3. Enforce **attempt-equality fencing** on terminal completion:
     ```sql
     UPDATE outbox_events 
     SET status = 'completed', updated_at = NOW() 
     WHERE id = $id AND attempts = $event.attempts
     ```
  4. Enforce `status = 'processing' AND attempts = $event.attempts` on retry resets to ensure stale failures do not downgrade active claims.

### Workstream B: Steadfast Courier Contract & Duplicate-Shipment Guard
- **Root Cause:** Steadfast Courier API does not provide an idempotency key. The documented response structure for `create_order` contains `consignment.tracking_code`, whereas code looked for `data.data.tracking_code`. A 404 response on `status_by_invoice` does not prove consignment absence (eventual consistency), and treating timeouts as definitive rejections resulted in clearing `PENDING_DISPATCH` and re-dispatching duplicate parcels.
- **Remediation Strategy:**
  1. Expand `ConsignmentResponse` with `exists?: boolean` and `ambiguous?: boolean`.
  2. Correct payload parsing to read `data.consignment?.tracking_code` (with fallback to `data.data`).
  3. Classify HTTP 5xx, 408, network timeouts, and 200 without tracking code as **ambiguous**.
  4. On ambiguous create outcomes, retain `PENDING_DISPATCH` and throw a retryable error.
  5. In `handleCreateConsignment`, if `attempts > 1` and `consignmentId === 'PENDING_DISPATCH'`:
     - Query `getConsignmentByInvoice(orderId)`.
     - If provider returns `exists: true`, throw `NonRetryableOutboxError` with `RECONCILIATION_REQUIRED`.
     - If provider returns 404 (`null`), throw `NonRetryableOutboxError` to dead-letter the event without issuing a second `create_order` call.
     - Only definitive HTTP 4xx rejections release `PENDING_DISPATCH` back to `null`.

### Workstream C: Drizzle Migration Journal & Database Timestamps
- **Root Cause:** Entries 24 through 30 in `server/drizzle/migrations/meta/_journal.json` contained future-dated `when` timestamps (1792745600000..1793264000000). Drizzle ORM evaluates:
  ```js
  if (lastApplied.created_at < journalEntry.when) { /* apply */ }
  ```
  Future-dated records in `drizzle.__drizzle_migrations` cause all subsequent migrations with real-time timestamps to be skipped.
- **Remediation Strategy:**
  1. Align entries 24–30 in `_journal.json` to monotonic timestamps strictly less than current wall clock (`1792662800000..1792684400000`).
  2. Execute corrective SQL on `platform_db` to update existing entries 25–31 in `drizzle.__drizzle_migrations`.
  3. Add regression tests validating strict monotonicity and non-future timestamps.

### Workstream D: Review Canonical Purchase Identity Alignment
- **Root Cause:** `reviews.service.ts` queried `ordersStore.getOrderItemsWithProducts` (which has no `ORDER BY`) and ran `.find(item => item.productId === productId)`, selecting arbitrary order item IDs when an order contained duplicate items of the same product. Migration 0029 used the lowest `order_items.id`.
- **Remediation Strategy:**
  1. Enforce canonical ordering in `reviews.service.ts`:
     ```ts
     const orderItem = orderItems
       .filter((item) => item.productId === productId)
       .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
     ```
  2. Add unit and integration tests verifying deterministic canonical item selection.

### Workstream E: Payment Gateway IPN Security Hardening
- **Root Cause:** IPN signature validation used standard `===` string comparison, vulnerable to timing analysis. Expected hash values were logged in cleartext. Unauthenticated/spoofed IPNs with negative gateway status could mutate valid payments to failed.
- **Remediation Strategy:**
  1. Implement constant-time comparison via `crypto.timingSafeEqual`:
     ```ts
     const safeEqual = (a: string, b: string): boolean => {
       const ab = Buffer.from(String(a));
       const bb = Buffer.from(String(b));
       return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
     };
     ```
  2. Remove secret hash logging.
  3. In `verifyPayment()`, reject unauthenticated IPNs (`!isValid`) immediately without calling `handleFailedPayment()`.

### Workstream F: Graceful Process Shutdown
- **Root Cause:** `server/src/main.ts` omitted `app.enableShutdownHooks()`. Container restarts or SIGTERM signals terminated the process immediately without running Fastify or NestJS cleanup hooks.
- **Remediation Strategy:**
  1. Invoke `app.enableShutdownHooks()` before `app.listen()`.
  2. Rebuild and verify clean termination.

---

## 4. Test Verification Plan

1. **Outbox Lease-Ownership Fencing & Courier Concurrency (`outbox-fencing.integration.spec.ts`):**
   - FENCE-26-A through FENCE-26-G: Stale worker lease expiration, ownership re-validation, attempt-equality fencing, and recovery resilience.
   - COU-26-A through COU-26-D: Ambiguous create retention, 404 reconciliation dead-lettering, definitive rejection release, and provider inquiry deferrals.
   - Steadfast HTTP contract mock tests: verify payload shapes, status codes, and error mappings.
2. **Database Migration Upgrade Suite (`migrations-upgrade.integration.spec.ts`):**
   - MIG-26-A: Journal `when` strictly increasing and in the past.
   - MIG-26-B: Drizzle ORM migrator bootstraps an empty database with all 31 migrations.
   - MIG-26-C: PostgreSQL UUID ordering equals JS lexicographic sorting.
   - MIG-26-D: Canonical purchase identity deduplication under duplicate order items.
3. **Payments Security Suite (`payments-security-concurrency.spec.ts`):**
   - SEC-18-7: Unsigned/spoofed IPN with `status=FAILED` rejected without state mutation.
   - SEC-18-8: Unsigned IPN with negative gateway response rejected without state mutation.
4. **Reviews Unit Suite (`reviews.service.spec.ts`):**
   - Deterministic canonical purchase item selection for loyalty award.
5. **Full Regression Execution:**
   - Backend: All 61 suites (882 tests).
   - Frontend: All 13 suites (126 tests).
   - E2E: All 7 specs (37 tests).
