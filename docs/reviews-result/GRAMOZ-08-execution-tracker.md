# GRAMOZ-08: Execution Tracker & Master Implementation Roadmap

**Project:** Gramoz E-Commerce Platform  
**Auditors & Authors:** Principal Software Engineer, Staff QA Architect, Production Reliability Engineer  
**Document Purpose:** Audited Findings Record, Verification Baseline, Execution Protocol, and Master 34-Task Review Tracker  
**Date:** October 2026  
**Status:** ACTIVE EXECUTION BASELINE  

---

## 1. Executive Evaluation & Audit Credibility Assessment

Following comprehensive verification of review reports `GRAMOZ-01` through `GRAMOZ-07` against the active codebase, runtime environments, and Next.js 16/PostgreSQL 16 specifications:

- **Overall Credibility of Reports:** **HIGH (88% Verified)**. The original discovery successfully isolated the core production failure modes (inventory leakage on order cancellation, migration syntax failure in 0013, completely broken unit test fixtures, and insecure fallback secrets).
- **Critical Corrections Identified:**
  1. **Next.js 16 Edge Proxy Convention (False Positive on Filename):** The previous reports claimed that `web/src/proxy.ts` was dead code ignored by Next.js and required renaming to `middleware.ts`. In Next.js 16+, `middleware.ts` has been deprecated and officially replaced by `proxy.ts` exporting `proxy`. Live runtime testing verified that Next.js 16.2.3 actively executes `proxy.ts` and returns `HTTP 307 Temporary Redirect` for unauthenticated requests. However, `proxy.ts` currently lacks role-level claims verification for authenticated non-admin users, which is retained as a P1 authorization task (TASK-05).
  2. **Outbox Polling Index (Partial Inaccuracy on Table Scan):** Previous reports claimed `outbox_events` had no index, causing a full table scan every 30 seconds. In fact, migration `0008_true_oracle.sql` already created a composite B-tree index on `("status", "created_at")`. While adding a partial filtered index (`WHERE status = 'pending' AND attempts < 3`) remains a beneficial optimization for long-term table bloat, it is not an unindexed P1 blocker today.

---

## 2. Audited Findings Register (Ground Truth vs Previous Reports)

| Finding Reference | Original Finding & Claim | Audit Classification | Verified Ground Truth & Repository Evidence | Action in Master Plan |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | Next.js middleware dead code due to `proxy.ts` filename | **INCORRECT (Naming) / PARTIAL (AuthZ)** | In Next.js 16+, `proxy.ts` exporting `proxy` is the official standard. Build logs confirm `ƒ Proxy (Middleware)`, and `curl -I http://localhost:3005/admin` returns `HTTP 307`. However, `proxy.ts` only checks if `token` exists, allowing standard customers into admin routes without role validation. | Downgraded from P0 to P1 (TASK-05); focused strictly on edge role claims check rather than renaming file. |
| **F-02** | Inventory leak on order cancellation & abandoned checkout | **CONFIRMED** | [`orders.service.ts:304-338`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts#L304-L338) updates order status to `'cancelled'` without calling restock, without logging `inventory_transactions`, without decrementing promo usage, and without refunding loyalty points. No background cleaner cancels stale pending orders. | Retained as P0 Blocker (TASK-03). |
| **F-03** | Migration `0013` `DROP INDEX` fails on foreign constraint | **CONFIRMED** | [`0005_performance_and_integrity.sql:61`](file:///home/trroyel/gramoz/server/drizzle/migrations/0005_performance_and_integrity.sql#L61) created `uq_cart_items_user_product` as a table constraint. [`0013_flaky_puppet_master.sql:1`](file:///home/trroyel/gramoz/server/drizzle/migrations/0013_flaky_puppet_master.sql#L1) runs `DROP INDEX "uq_cart_items_user_product"`, which PostgreSQL aborts with `cannot drop index ... because constraint requires it`. | Retained as P0 Blocker (TASK-01). |
| **F-04** | Backend test suite (`npm test`) fails compilation | **CONFIRMED** | `npm --prefix server test` exits with code 1. `orders.service.spec.ts` has invalid import `../auth/mail.service` and missing providers (`OrdersStore`, `PromosService`, `LoyaltyService`, `SettingsService`, `CourierService`). `payments.service.spec.ts` misses `PaymentsStore`. | Retained as P0 Blocker (TASK-02). |
| **F-05** | Insecure fallback secrets in configuration | **CONFIRMED** | [`config.service.ts:78`](file:///home/trroyel/gramoz/server/src/config/config.service.ts#L78) falls back to `'secret'` for `AUTH_JWT_SECRET`. [`payments.service.ts:25`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts#L25) falls back to `'testpass'` for `SSLCOMMERZ_STORE_SECRET`. | Retained as P0 Blocker (TASK-04). |
| **F-06** | Hardcoded proxy rewrites in Next.js config | **CONFIRMED** | [`web/next.config.ts:22,26`](file:///home/trroyel/gramoz/web/next.config.ts#L22-L26) hardcodes `http://localhost:5000/api/:path*` and `/public/:path*`. Breaks containerized deployment. | Retained as P1 (TASK-08). |
| **F-07** | Missing partial index on `outbox_events` | **PARTIAL / INCORRECT (Claim of No Index)** | Migration `0008` already created `outbox_events_status_created_at_idx` on `(status, created_at)`. Query does not perform an unindexed sequential scan. However, a partial filtered index is desirable for high-scale bloat management. | Retained as P2 Optimization (TASK-12); removed from critical blocker path. |
| **F-08** | Non-atomic cart addition race condition | **CONFIRMED** | [`cart.service.ts:64-83`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.service.ts#L64-L83) executes check-then-insert without a composite unique constraint in database, permitting duplicate rows on concurrent requests. | Retained as P1 (TASK-06). |
| **F-09** | JWT database SELECT on every request | **CONFIRMED** | [`jwt.strategy.ts:43`](file:///home/trroyel/gramoz/server/src/modules/auth/strategies/jwt.strategy.ts#L43) queries database on every request without caching in Redis. | Retained as P1 (TASK-09). |
| **F-10** | Unthrottled login / password reset endpoints | **CONFIRMED** | [`auth.controller.ts:47`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.controller.ts#L47) lacks route-level throttler annotations, allowing 100 req/min credential brute-forcing. | Retained as P1 (TASK-07). |

---

## 3. Verified Verification Baseline

Exact verification commands were executed in the environment on October 17, 2026:

| Verification Scope | Exact Command Executed | Exit Code | Observed Output / Failure Summary | Baseline Status |
| :--- | :--- | :---: | :--- | :---: |
| **Backend Build** | `npm --prefix server run build` | `0` | Compilation successful via `nest build`. Output in `server/dist/`. | **PASS** |
| **Frontend Build** | `npm --prefix web run build` | `0` | Compiled successfully in 17.5s via Turbopack. 40/40 static/dynamic routes generated. Recognized `ƒ Proxy (Middleware)`. | **PASS** |
| **Backend Unit Tests** | `npm --prefix server test` | `1` | **2 failed suites, 8 failed tests**. `orders.service.spec.ts`: TS2307 missing `../auth/mail.service`. `payments.service.spec.ts`: Nest cannot resolve dependency `PaymentsStore`. | **FAIL (BLOCKER)** |
| **Backend E2E Tests** | `npm --prefix server run test:e2e` | `1` | `No tests found, exiting with code 1`. Directory `server/test` has zero `.e2e-spec.ts` test files. | **FAIL (NO TESTS)** |
| **Backend Linting** | `npx eslint "{src,test}/**/*.ts"` (in `server/`) | `1` | **1,227 problems** (1,167 errors, 60 warnings). Majority prettier formatting and `@typescript-eslint/no-unsafe-*` rules. | **FAIL** |
| **Frontend Linting** | `npm --prefix web run lint` | `1` | **180 problems** (105 errors, 75 warnings). `@typescript-eslint/no-explicit-any`, `@next/next/no-img-element`, `react-hooks/set-state-in-effect`. | **FAIL** |
| **Frontend Tests** | `npm --prefix web test` | `1` | `Missing script: "test"`. No test framework or runner configured in `web/package.json`. | **FAIL (NO TESTS)** |
| **Docker Infrastructure** | `docker compose ps` | `0` | `postgres` (`5433:5432`) healthy; `redis` (`6379:6379`) healthy. | **PASS** |

---

## 4. Standard 10-Step Execution Protocol

For every task in the execution sequence, the engineer must adhere to this 10-step protocol:

1. **Task & Source Inspection:** Read the assigned task specification, acceptance criteria, and all referenced source files.
2. **Independent Defect Confirmation:** Reproduce the issue or confirm via isolated reproduction script or test.
3. **Minimal Correct Solution Design:** Define the smallest correct fix adhering strictly to existing project conventions and patterns.
4. **Targeted Implementation:** Apply only the changes necessary to resolve the defect. Do not perform speculative refactoring or rewrite unaffected files.
5. **Automated Test Coverage:** Add or repair automated unit/integration tests that specifically cover the defect, boundary conditions, and failure states.
6. **Robustness & Edge-Case Testing:** Validate happy paths, error handling, null/undefined inputs, and concurrency constraints where applicable.
7. **Regression Suite Execution:** Run affected project test suites to verify no existing behaviors were broken.
8. **Static Verification:** Confirm that build and typechecking commands pass with exit code 0.
9. **Evidence Recording:** Log exact command invocations, test outputs, and diff summaries in the task completion record.
10. **State Transition:** Update task status in this tracker only after all completion criteria and automated verifications pass.

---

## 5. Master 34-Task Execution Inventory & Dependency Schedule

```
========================================================================================
                          GRAMOZ MASTER EXECUTION SCHEDULE
========================================================================================
Seq   Task ID   Category / Title                                   Priority   Prereqs
----------------------------------------------------------------------------------------
 1    TASK-01   Database Migration 0013 Syntax Conflict Fix        P0         None
 2    TASK-02   Repair Backend Jest Unit Test Fixtures             P0         None
 3    TASK-04   Enforce Production Secrets & Fatal Boot            P0         TASK-02
 4    TASK-03   Inventory Restock on Order Cancellation & Expiry   P0         TASK-02
 5    TASK-05   Edge Proxy Admin Role Authorization                P1         None
 6    TASK-06   Cart Concurrency Control & Atomic Upsert           P1         TASK-01, 02
 7    TASK-07   Anti-Hammering Route Throttling on Auth Endpoints  P1         TASK-02
 8    TASK-08   Dynamic Next.js Rewrites & Storage Remote Patterns P1         None
 9    TASK-09   JWT User Session Lookup Caching in Redis           P1         TASK-02
10    TASK-10   Order Placement Transaction Scope Decoupling       P1         TASK-02, 03
11    TASK-11   Reviews Aggregation Index & Rating Denormalization P2         TASK-01, 02
12    TASK-12   Outbox Processor Partial Index Optimization        P2         TASK-01
13    TASK-13   Web Application Automated Testing Harness Setup    P2         None
14    TASK-16   Backend Test Suite: Auth & Identity                P0         TASK-02, 04, 07
15    TASK-17   Backend Test Suite: Orders & Checkout Concurrency  P0         TASK-02, 03, 10
16    TASK-18   Backend Test Suite: Payments & IPN Security        P0         TASK-02, 04
17    TASK-19   Backend Test Suite: Cart & Abandonment Worker      P1         TASK-02, 06
18    TASK-20   Backend Test Suite: Products & Redis Caching       P1         TASK-02
19    TASK-21   Backend Test Suite: Promos & Loyalty Rewards       P1         TASK-02
20    TASK-22   Backend Test Suite: Refunds & Reverse Logistics    P1         TASK-02, 03
21    TASK-23   Backend Test Suite: Reviews, Wishlists & Feedback  P2         TASK-02, 11
22    TASK-24   Backend Test Suite: Courier, SMS & Storage         P1         TASK-02
23    TASK-25   Backend Test Suite: Outbox Worker & Migrations     P0         TASK-01, 02, 12
24    TASK-26   Frontend Test Suite: Client Stores & HTTP Queue    P0         TASK-13
25    TASK-27   Frontend Test Suite: Forms & Interactive Modals    P1         TASK-13
26    TASK-28   Frontend Test Suite: Catalog & Cart Pages          P1         TASK-13
27    TASK-29   Frontend Test Suite: Multi-Step Checkout Pages     P0         TASK-13
28    TASK-30   Frontend Test Suite: Dashboard & Order Tracking    P2         TASK-13
29    TASK-31   Frontend Test Suite: Admin Portal & Edge Proxy     P0         TASK-05, 13
30    TASK-14   Playwright E2E Framework & Fixture Setup           P1         TASK-01..08
31    TASK-32   Playwright E2E: Auth & Catalog Journeys            P1         TASK-14, 16, 20
32    TASK-33   Playwright E2E: Checkout, SSLCommerz & COD         P0         TASK-14, 17, 18, 24
33    TASK-34   Playwright E2E: Refunds & Security Defense         P0         TASK-14, 22, 31
34    TASK-15   Automated CI/CD Quality Pipeline Implementation    P1         TASK-01, 02, 13, 14
========================================================================================
```

---

## 6. Comprehensive Task Status Tracking

| Task ID | Component / Area | Priority | Assigned Owner | Initial Status | Verified Completion Date | Acceptance Test Command |
| :--- | :--- | :---: | :--- | :---: | :---: | :--- |
| **TASK-01** | Database Migration 0013 Fix | **P0** | Database Architect | `NOT_STARTED` | Pending | `npm --prefix server run db:migrate` |
| **TASK-02** | Repair Backend Test Fixtures | **P0** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test` |
| **TASK-03** | Order Cancellation Restock & Expiry | **P0** | Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- -t "OrdersService"` |
| **TASK-04** | Secret Boot Assertions | **P0** | Security Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- -t "ConfigService"` |
| **TASK-05** | Edge Proxy Admin Role Check | **P1** | Frontend Architect | `NOT_STARTED` | Pending | `curl -I http://localhost:3000/admin` |
| **TASK-06** | Cart Concurrency & Upsert | **P1** | Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- -t "CartStore"` |
| **TASK-07** | Auth Route Throttling | **P1** | Security Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- -t "AuthController"` |
| **TASK-08** | Dynamic Rewrites & Storage Images | **P1** | Frontend / DevOps | `NOT_STARTED` | Pending | `npm --prefix web run build` |
| **TASK-09** | JWT User Redis Cache | **P1** | Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- -t "JwtStrategy"` |
| **TASK-10** | Order Transaction Decoupling | **P1** | Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- -t "OrdersService"` |
| **TASK-11** | Reviews Denormalization & Index | **P2** | Database Architect | `NOT_STARTED` | Pending | `npm --prefix server test -- -t "ProductsService"` |
| **TASK-12** | Outbox Partial Index | **P2** | Database Architect | `NOT_STARTED` | Pending | `npm --prefix server run db:migrate` |
| **TASK-13** | Web Vitest Testing Harness Setup | **P2** | QA Engineer | `NOT_STARTED` | Pending | `npm --prefix web test` |
| **TASK-14** | Playwright E2E Framework Setup | **P1** | QA Architect | `NOT_STARTED` | Pending | `npx playwright test --version` |
| **TASK-15** | Automated CI/CD Pipeline | **P1** | Reliability Engineer | `NOT_STARTED` | Pending | GitHub Actions validation |
| **TASK-16** | Backend Test Suite: Auth & Identity | **P0** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- auth.service.spec.ts` |
| **TASK-17** | Backend Test Suite: Orders & Checkout | **P0** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- orders.service.spec.ts` |
| **TASK-18** | Backend Test Suite: Payments & IPN | **P0** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- payments.service.spec.ts` |
| **TASK-19** | Backend Test Suite: Cart & Abandonment | **P1** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- cart.service.spec.ts` |
| **TASK-20** | Backend Test Suite: Products & Catalog | **P1** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- products.service.spec.ts` |
| **TASK-21** | Backend Test Suite: Promos & Loyalty | **P1** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- promos.service.spec.ts` |
| **TASK-22** | Backend Test Suite: Refunds & Reverse | **P1** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- refunds.service.spec.ts` |
| **TASK-23** | Backend Test Suite: Reviews & Wishlist | **P2** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- reviews.service.spec.ts` |
| **TASK-24** | Backend Test Suite: Courier & Alerts | **P1** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- courier.service.spec.ts` |
| **TASK-25** | Backend Test Suite: Outbox & Migrations | **P0** | QA / Backend Engineer | `NOT_STARTED` | Pending | `npm --prefix server test -- outbox.processor.spec.ts` |
| **TASK-26** | Frontend Test Suite: Stores & HTTP Queue | **P0** | QA / Frontend Engineer | `NOT_STARTED` | Pending | `npm --prefix web test -- stores` |
| **TASK-27** | Frontend Test Suite: Forms & Modals | **P1** | QA / Frontend Engineer | `NOT_STARTED` | Pending | `npm --prefix web test -- components` |
| **TASK-28** | Frontend Test Suite: Catalog & Cart | **P1** | QA / Frontend Engineer | `NOT_STARTED` | Pending | `npm --prefix web test -- shop` |
| **TASK-29** | Frontend Test Suite: Checkout & Callbacks | **P0** | QA / Frontend Engineer | `NOT_STARTED` | Pending | `npm --prefix web test -- checkout` |
| **TASK-30** | Frontend Test Suite: Dashboard & Track | **P2** | QA / Frontend Engineer | `NOT_STARTED` | Pending | `npm --prefix web test -- dashboard` |
| **TASK-31** | Frontend Test Suite: Admin & Edge Proxy | **P0** | QA / Frontend Engineer | `NOT_STARTED` | Pending | `npm --prefix web test -- admin` |
| **TASK-32** | Playwright E2E: Auth & Catalog | **P1** | QA Architect | `NOT_STARTED` | Pending | `npx playwright test auth-journey.spec.ts` |
| **TASK-33** | Playwright E2E: Checkout, SSLCommerz & COD | **P0** | QA Architect | `NOT_STARTED` | Pending | `npx playwright test checkout-online.spec.ts` |
| **TASK-34** | Playwright E2E: Refunds & Security | **P0** | QA Architect | `NOT_STARTED` | Pending | `npx playwright test refund-lifecycle.spec.ts` |

---

## 7. Immediate Next Action

- **Immediate Next Task:** **`TASK-01`** ([Database Migration `0013` Syntax Conflict Fix](file:///home/trroyel/gramoz/server/drizzle/migrations/0013_flaky_puppet_master.sql)).
- **Prerequisites:** **None**.
- **Execution Target:** Replace invalid `DROP INDEX "uq_cart_items_user_product"` with `ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "uq_cart_items_user_product"`. Verify with `npm --prefix server run db:migrate`.
- **Follow-up Task:** **`TASK-02`** ([Repair Backend Jest Unit Test Fixtures](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.spec.ts)) to achieve a 100% green unit test suite baseline.
