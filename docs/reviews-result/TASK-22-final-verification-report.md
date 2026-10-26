# GRAMOZ — TASK-22 Final Verification Report: Comprehensive Refunds, Returns & Reverse Logistics Verification

**Author:** Principal E-Commerce Payments Engineer, Staff NestJS Engineer, PostgreSQL Transaction Specialist, Logistics Systems Architect, Application Security Engineer, and Senior QA Automation Architect  
**Project:** Gramoz E-Commerce Platform  
**Target Architecture:** NestJS 11 (Fastify), Next.js 16, PostgreSQL 16 (Drizzle ORM), Redis 7, SSLCommerz, Steadfast Courier, PostgreSQL Transactional Outbox  
**Deployment Constraint:** 1 vCPU, 1 GB RAM (Low-resource production profile)  
**Verification Date:** 2026-10-21  
**Task Status:** `VERIFIED`

---

## 1. Executive Summary

TASK-22 performed an exhaustive, independent architectural audit, defect remediation, and verification of Gramoz's refund processing, customer return workflows, reverse logistics boundaries, provider gateway integration (SSLCommerz Refund API), PostgreSQL row locking, inventory restocking atomicity, and loyalty point restoration.

Prior to TASK-22, the refunds subsystem had critical vulnerabilities:
1. `uq_refunds_order_id` unique constraint was missing, allowing concurrent duplicate refund requests to race and succeed simultaneously.
2. `RefundsService.processRefund` unconditionally restocked items upon refund processing. If an order had been cancelled prior to refund processing (e.g. from an outbox `REFUND_REQUIRED` event), stock was already restored during cancellation, causing catastrophic double restocking.
3. `processRefund` lacked in-transaction row locking (`SELECT ... FOR UPDATE`), permitting two concurrent administrators to approve/process the same refund and restock stock twice.
4. `RefundsService.processRefund` inverted the canonical lock hierarchy by updating payments before orders, introducing `40P01` deadlock hazards.
5. Damaged item returns (`reason === 'damaged_item'`) were erroneously restocked into saleable inventory.
6. Delivered orders that redeemed loyalty points at checkout never had those spent points refunded when a return was processed.
7. `PaymentsService` lacked gateway refund initiation and inquiry methods conforming to the official SSLCommerz Refund API.
8. Customer refund requests accepted client-supplied `paymentId` without authoritative database validation.

Through migration `0025_refunds_integrity.sql`, the introduction of a dedicated `RefundsStore`, canonical 3-tier row locking (`orders` -> `payments` -> `refunds`), SSLCommerz Refund API initiation and inquiry implementation, damaged goods inventory quarantining, and loyalty point restoration idempotency, all defects have been remediated and verified under real PostgreSQL 16 concurrency testing.

---

## 2. Final Task Status

- **Status:** `VERIFIED`
- **Total Backend Tests:** **671 passing across 45 suites (100%)** (+42 new tests over TASK-21 baseline).
- **Total Frontend Vitest Tests:** **116 passing across 11 files (100%)**.
- **Total Playwright E2E Tests:** **30 passing (100%)** (+3 new E2E tests).
- **Unresolved P0/P1 Financial Integrity Defects in Refunds/Returns:** **0**.

---

## 3. Refund Architecture

The refund architecture follows a layered, decoupled design separating customer request intake, administrative inspection/approval, external payment gateway execution, and transactional side-effect persistence:

```
[Customer]
    │  POST /api/v1/refunds (only delivered orders)
    ▼
[RefundsController]
    │  Validates positive amount, cents precision, order ownership
    ▼
[RefundsService.requestRefund]
    │  Authoritatively resolves completed paymentId (ignores client tampering)
    ▼
[RefundsStore.createRefund]
    │  Enforces UNIQUE INDEX uq_refunds_order_id (atomic deduplication)
    ▼
[PostgreSQL: schema.refunds (status: 'requested')]

[Admin Portal]
    │  PATCH /api/v1/refunds/admin/:id/status
    ▼
[RefundsService.processRefund]
    ├─ If status == 'processed' && payment is online (non-COD):
    │     Calls PaymentsService.initiateRefund (SSLCommerz Gateway)
    │     - If success: sets gatewayRefundId
    │     - If timeout/abort: keeps status in 'approved'/'processing' (safe for inquiry)
    │     - If rejected: throws domain error
    │
    └─ DB Transaction (Canonical Lock Order):
          Level 1: orders (FOR UPDATE)
          Level 2: payments (FOR UPDATE)
          Level 3: refunds (FOR UPDATE)
          ├─ Restock check: wasCancelled? hasOrderBeenRestocked? hasRefundBeenRestocked?
          ├─ Reason check: damaged_item? -> Quarantine as damaged, skip saleable stock
          ├─ Variant check: variantId still exists? -> Update variant, else fallback to product
          ├─ Loyalty restoration: pointsSpent > 0 && !hasPointsBeenRefunded -> refundPoints()
          ├─ Update payments.status = 'refunded'
          ├─ Update orders.status = 'refunded', orders.paymentStatus = 'refunded'
          └─ Update refunds.status = 'processed'
```

---

## 4. Return & Reverse-Logistics Architecture

- **Steadfast Courier Boundaries:**
  - Gramoz integrates Steadfast Courier via `CourierService` (`/create_order`, `/status_by_invoice`).
  - Steadfast Courier API standard operations provide forward delivery and tracking. Automated reverse pickup via API is unsupported in Steadfast's standard merchant protocol.
  - Reverse logistics for Gramoz are handled via customer return drop-off/parcel return and authoritative warehouse inspection before administrative approval.
  - Invariant enforced: **Courier delivery status is not refund status.** A package delivery failure does not trigger automated inventory restocking or monetary refunds. Restocking strictly requires physical warehouse receipt and non-damaged inspection confirmation.

---

## 5. API Inventory

| Method | Endpoint | Access Control | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/refunds` | `JwtAuthGuard` (Customer) | Customer submits refund request for delivered order. |
| `GET` | `/api/v1/refunds/my` | `JwtAuthGuard` (Customer) | Customer views their own refund history and statuses. |
| `GET` | `/api/v1/refunds/admin/all` | `JwtAuthGuard`, `RolesGuard(ADMIN, SUPER_ADMIN)` | Admin lists all refund requests with order/user metadata. |
| `GET` | `/api/v1/refunds/admin/:id` | `JwtAuthGuard`, `RolesGuard(ADMIN, SUPER_ADMIN)` | Admin views single refund details. |
| `PATCH` | `/api/v1/refunds/admin/:id/status` | `JwtAuthGuard`, `RolesGuard(ADMIN, SUPER_ADMIN)` | Admin approves, processes, or rejects refund request. |

---

## 6. Financial State Machines

### 6.1 State Separation Invariant
The platform strictly distinguishes independent state machines:
- **Order Status:** `pending` -> `processing` -> `shipped` -> `delivered` -> `refunded` (or `cancelled`).
- **Payment Status:** `unpaid` -> `initiated` -> `paid` -> `refunded` (or `failed`).
- **Refund Status:** `requested` -> `approved` -> `processed` (or `rejected`).
- **Inventory Status:** `reserved` -> `deducted` -> `restocked` (or `quarantined_damaged`).

### 6.2 Legal & Illegal Refund Transitions
- Legal:
  - `requested` -> `approved`
  - `requested` -> `rejected`
  - `requested` -> `processed`
  - `approved` -> `processed`
  - `approved` -> `rejected`
- Illegal:
  - `processed` -> `requested` / `approved` / `rejected` (terminal immutable state)
  - `rejected` -> `processed` / `approved` (terminal state)
  - Requesting refund on non-delivered order (customer flow)
  - Refunding payment exceeding captured payment amount

---

## 7. PostgreSQL Schema & Transaction Boundaries

### 7.1 Schema Changes (Migration `0025_refunds_integrity.sql`)
```sql
-- Replaced non-unique idx_refunds_order_id with unique index:
DROP INDEX IF EXISTS idx_refunds_order_id;
CREATE UNIQUE INDEX uq_refunds_order_id ON refunds (order_id);
CREATE INDEX idx_refunds_payment_id ON refunds (payment_id);
```

### 7.2 Canonical Lock Order
To eliminate all possible `40P01` deadlock cycles during concurrent cancellations, refunds, payments, and background worker jobs:
- **Level 1:** `orders` (`SELECT ... FOR UPDATE`)
- **Level 2:** `payments` (`SELECT ... FOR UPDATE`)
- **Level 3:** `refunds` (`SELECT ... FOR UPDATE`)
- **Level 4:** `users` (Loyalty balance row lock via `lockUserForLoyalty`)

---

## 8. Confirmed Defects & 9. Root Cause Analysis

| Defect ID | Description | Root Cause |
| :--- | :--- | :--- |
| **REF-DEF-01** | Duplicate Refund Requests Race (CONC-22-A) | Non-locked check-then-insert + missing unique constraint on `order_id`. |
| **REF-DEF-02** | Negative / Zero / NaN Refund Amounts | Missing positive numeric boundary validation and lack of 2-decimal cents rounding. |
| **REF-DEF-03** | Client-Supplied `paymentId` Tampering | Blindly trusting `dto.paymentId` from client body rather than resolving the order's completed payment. |
| **REF-DEF-04** | Duplicate Restocking on Cancelled Order Refund | Unconditional stock increment during `processRefund` without checking if stock was already restored during cancellation. |
| **REF-DEF-05** | Concurrent Admin Approval Double Restock (CONC-22-C) | Checking `refund.status` outside transaction without row-level locks (`SELECT ... FOR UPDATE`). |
| **REF-DEF-06** | Canonical Lock Order Inversion | `processRefund` updated `payments` before `orders`, violating the canonical lock hierarchy. |
| **REF-DEF-07** | Missing SSLCommerz Refund API Integration | `PaymentsService` had no refund initiation or status inquiry methods. |
| **REF-DEF-08** | Unrestored Loyalty Points on Delivered Refund | Refund processing omitted checking `getPointsSpentOnOrder` and calling `refundPoints`. |
| **REF-DEF-09** | Missing Dedicated `RefundsStore` | `RefundsService` performed raw database queries directly without repository encapsulation. |
| **REF-DEF-10** | Damaged Goods Restocked into Saleable Stock | Damaged items (`reason === 'damaged_item'`) were incrementing saleable stock. |
| **REF-DEF-11** | Variant Identity Vulnerability (from TASK-20) | Product updates delete and recreate variants; variant restocking crashed if variant ID was recreated. |

---

## 10. Implemented Fixes

1. **Migration 0025:** Added unique index `uq_refunds_order_id` on `refunds(order_id)` and index on `payment_id`.
2. **Dedicated `RefundsStore`:** Created `server/src/modules/refunds/refunds.store.ts` encapsulating all refund, order, payment, item, and loyalty queries with row locking.
3. **Hardened `requestRefund`:** Added strict `amount > 0` validation, cents rounding, authoritative `paymentId` resolution from completed payments, and PostgreSQL unique constraint `23505` catch.
4. **Canonical Locking in `processRefund`:** Implemented Level 1 (`orders`) -> Level 2 (`payments`) -> Level 3 (`refunds`) row locking.
5. **Double Restocking Prevention:** Added `wasCancelled`, `hasOrderBeenRestocked`, and `hasRefundBeenRestocked` checks before modifying stock.
6. **Damaged Goods Quarantine:** Items with `reason: 'damaged_item'` are recorded in `inventoryTransactions` with a damage note and excluded from saleable inventory.
7. **Variant Fallback:** Checks `findVariantById`; if variant was deleted/recreated during product updates, restocks parent product stock with an audit log.
8. **Loyalty Restoration:** Restores spent loyalty points idempotently via `LoyaltyService.refundPoints`.
9. **SSLCommerz Gateway Methods:** Added `initiateRefund` and `queryRefundStatus` in `PaymentsService`. Cash on Delivery is detected and handled locally without external API calls. Timeout or network drops return `status: 'processing'` so funds are never marked failed prematurely.

---

## 11. Modified Files

- `server/drizzle/migrations/0025_refunds_integrity.sql` (New Migration)
- `server/src/database/schema/refunds.ts`
- `server/src/modules/payments/payments.store.ts`
- `server/src/modules/payments/payments.service.ts`
- `server/src/modules/payments/sslcommerz-refund.spec.ts` (New Protocol Suite)
- `server/src/modules/refunds/refunds.module.ts`
- `server/src/modules/refunds/refunds.store.ts` (New Store)
- `server/src/modules/refunds/refunds.service.ts`
- `server/src/modules/refunds/refunds.service.spec.ts` (New Unit Suite)
- `server/src/modules/refunds/refunds.controller.spec.ts` (New Controller Suite)
- `server/src/modules/refunds/refunds.integration.spec.ts` (New PostgreSQL Integration Suite)
- `server/src/modules/refunds/refunds-concurrency.spec.ts` (New Concurrency Suite)
- `server/src/modules/payments/payments-security-concurrency.spec.ts`
- `web/playwright.config.ts`
- `web/tests/e2e/cart.spec.ts`
- `web/tests/e2e/cart-multitab.spec.ts`
- `web/tests/e2e/checkout.spec.ts`
- `web/tests/e2e/refunds.spec.ts` (New E2E Suite)
- `docs/reviews-result/GRAMOZ-08-execution-tracker.md`
- `docs/reviews-result/GRAMOZ-10-backend-test-matrix.md`
- `docs/reviews-result/GRAMOZ-12-e2e-security-concurrency-test-matrix.md`

---

## 12. SSLCommerz Refund Verification (REF-22-A to REF-22-J)

Verified in `sslcommerz-refund.spec.ts`:
- **REF-22-A (Valid Provider Confirmation):** Returns `status: 'success'` and `refundRefId`.
- **REF-22-B (Provider Rejection):** Returns `status: 'failed'` with `errorReason`.
- **REF-22-C (Provider Timeout):** Marked `status: 'processing'` for safe inquiry reconciliation, preventing duplicate payout.
- **REF-22-D / REF-22-E (HTTP Lost / Bad Gateway):** Marked `status: 'processing'`.
- **REF-22-F (Retry Handling):** Idempotent gateway query / retry using reference ID.
- **REF-22-G (Inquiry Pending):** Status `processing`.
- **REF-22-H (Inquiry Confirmed Success):** Status `success` with authoritative `bank_tran_id`.
- **REF-22-I (Refund Exceeding Payment):** Rejected atomically.
- **REF-22-J (Refund on Ineligible Payment):** Non-completed payments rejected.
- **COD Isolation:** Cash on Delivery never calls SSLCommerz refund API.

---

## 13. Courier Return Verification

- Confirmed that Steadfast courier integration operates within forward delivery boundaries (`createConsignment`, `trackConsignment`).
- Reverse logistics are maintained under physical receipt and manual/admin inspection.
- Courier failure or return events do not automatically restock inventory or refund money without administrative verification.

---

## 14. Refund Idempotency & Concurrency (CONC-22-A to CONC-22-H)

Verified in `refunds-concurrency.spec.ts` with real PostgreSQL 16 connections:
- **CONC-22-A (10 Simultaneous Requests):** Exactly 1 succeeds, 9 fail with duplicate error. Exactly 1 row in DB.
- **CONC-22-B (Amount Ceiling):** Requests exceeding total rejected atomically.
- **CONC-22-C (Admin Approval Race):** 2 admins race; exactly 1 succeeds, other rejected. Inventory restocked exactly once.
- **CONC-22-D (Provider Replay):** 5 repeated processing requests rejected; stock preserved.
- **CONC-22-F (Cancellation vs Refund):** Concurrent cancellation and refund settle safely without deadlock. Stock incremented by exactly order quantity (never doubled).
- **CONC-22-G (Outbox Replay):** Repeated processing of `REFUND_REQUIRED` creates exactly 1 refund record.
- **CONC-22-H (Crash Before DB Update):** Reconcilable with authoritative `gatewayRefundId`.

---

## 15. Inventory Return Correctness

- Restocking occurs only on authoritative status `'processed'`.
- Saleable products/variants have stock incremented accurately in real PostgreSQL tables.
- Damaged items create inventory transaction records with damage notes and do not pollute saleable inventory.
- Variants deleted and recreated during product updates fall back gracefully to parent product stock.

---

## 16. Promotions & Loyalty Integrity

- Loyalty points spent at checkout (`type: 'spent_checkout'`) are restored via `LoyaltyService.refundPoints` on refund processing.
- Duplicate point restoration is prevented via `hasPointsBeenRefunded`.
- Net loyalty ledger reflects accurate balances.

---

## 17. Outbox Reconciliation

- `REFUND_REQUIRED` events created during cancellation of paid orders are processed idempotently by `OutboxProcessor`.
- Repeated processing of the same outbox event skips duplicate insertion via `uq_refunds_order_id` and existing refund check.
- Refund records remain actionable for administrators in `/admin/refunds`.

---

## 18. Security & Authorization

- Customer requests verify `order.userId === currentUser.id`. Unauthorized access throws `ForbiddenOperationError`.
- Customer requests for non-delivered orders throw `InvalidOperationError`.
- Admin endpoints (`/admin/all`, `/admin/:id`, `/admin/:id/status`) enforce `JwtAuthGuard` and `RolesGuard(ADMIN, SUPER_ADMIN)`. Customers cannot access admin routes.
- Client-supplied `paymentId` tampering is neutralized by resolving completed payments directly from the database.

---

## 19. Fault-Injection Results

- **Provider Timeout:** Initiator returns `status: 'processing'`. Refund record remains in `approved` state pending manual/inquiry reconciliation.
- **Local DB Crash After Provider Success:** Authoritative gateway reference ID (`gatewayRefundId`) enables inquiry reconciliation without repeating external refunds.
- **Concurrent Unique Violation:** Caught at repository level and transformed into descriptive domain errors.

---

## 20. Automated Test Results

### 20.1 Unit & Integration Suites
- `src/modules/refunds/refunds.service.spec.ts`: 16 passed
- `src/modules/refunds/refunds.controller.spec.ts`: 5 passed
- `src/modules/payments/sslcommerz-refund.spec.ts`: 9 passed
- `src/modules/refunds/refunds.integration.spec.ts`: 5 passed
- `src/modules/refunds/refunds-concurrency.spec.ts`: 7 passed

### 20.2 Backend Regression Total
- **45 suites, 671 tests passed (0 failed, 0 skipped)**
- Duration: 26.901 s

### 20.3 Frontend Vitest Total
- **11 files, 116 tests passed (0 failed, 0 skipped)**
- Duration: 1.21 s

### 20.4 Playwright E2E Total
- **30 tests passed (0 failed, 0 skipped)**
- Duration: 57.3 s

---

## 21. Frontend & Playwright Verification

- Added `web/tests/e2e/refunds.spec.ts`:
  - `Customer accesses /dashboard/refunds and views refunds dashboard`: PASSED
  - `Admin accesses /admin/refunds and views refund management dashboard`: PASSED
  - `Customer with seeded refund request sees pending status in /dashboard/refunds`: PASSED

---

## 22. Performance & Resource Measurements (1 vCPU / 1 GB RAM)

Measurements taken directly on PostgreSQL 16 (port 5433) and Node.js v26.12.0:
- **Refund Creation Latency (n=50):** P50 = **1.90 ms**, P95 = **4.10 ms**, P99 = **4.45 ms**
- **Refund Status & Order Lookup Latency (n=50):** P50 = **0.89 ms**, P95 = **1.50 ms**, P99 = **3.03 ms**
- **Canonical Row-Locked Processing Transaction (n=50):** P50 = **2.34 ms**, P95 = **3.47 ms**, P99 = **4.29 ms**
- **PostgreSQL Execution Time (EXPLAIN ANALYZE `uq_refunds_order_id`):** **0.029 ms**
- **PostgreSQL Execution Time (EXPLAIN ANALYZE `idx_refunds_status`):** **0.024 ms**
- **Node.js Memory Footprint:** HeapUsed = **8.23 MB**, RSS = **59.54 MB** (6.0% of 1 GB RAM allocation)
- **Deadlocks Encountered:** **0** across all 20-worker concurrent stress tests.

---

## 23. Full Regression Totals

| Layer | Total Tests | Passing | Failing | Execution Time |
| :--- | :--- | :--- | :--- | :--- |
| Backend Jest | 671 | 671 | 0 | 26.90 s |
| Frontend Vitest | 116 | 116 | 0 | 1.21 s |
| Playwright E2E | 30 | 30 | 0 | 57.30 s |
| TypeScript Backend | `tsc --noEmit` | Clean (0 errors) | 0 | ~8.0 s |
| TypeScript Frontend | `next build` | Clean (0 errors) | 0 | ~8.3 s |
| Production Builds | Nest + Next.js | Clean (0 errors) | 0 | ~25.0 s |

---

## 24. Outstanding P0/P1 Risks

- **Nil for TASK-22 scope.** All refund, payment, cancellation, and reverse-logistics concurrency invariants are verified.
- **Preserved Tracked Items from Prior Tasks:**
  - Variant identity recreation during product updates (TASK-20): Remediated within refund scope via fallback to parent product stock.
  - At-least-once external notification duplicates (TASK-12).

---

## 25. Acceptance Criteria & Release Decision

All 17 acceptance criteria specified for TASK-22 are met:
1. Refund eligibility is strictly validated.
2. Refund amounts cannot exceed captured payments or order totals.
3. Refund requests are idempotent via `uq_refunds_order_id`.
4. Provider-confirmed refund completion is authoritative.
5. Concurrent requests cannot duplicate refunds (CONC-22-A).
6. Provider timeouts and ambiguous outcomes are recoverable (REF-22-C).
7. Cancellation and refund races preserve financial state (CONC-22-F).
8. Reverse-logistics state transitions are correct.
9. Returned inventory is not double-restocked.
10. Product and variant relationships remain correct under variant recreation.
11. Loyalty point adjustments are accurate and idempotent.
12. Refund/outbox records remain durable and actionable.
13. Security and authorization tests pass.
14. Real PostgreSQL concurrency tests pass.
15. Existing backend, frontend, and Playwright suites pass.
16. Markdown review report created with empirical metrics.
17. No unresolved P0 financial-integrity defects remain.

**Release Decision:** **`TASK-22 APPROVED & VERIFIED`**

---

## 26. Next Eligible Task

- **Next Eligible Task from Tracker:** `TASK-23` (Backend Test Suite: Reviews & Wishlist).
