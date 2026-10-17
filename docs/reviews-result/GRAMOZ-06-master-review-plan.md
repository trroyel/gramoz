# GRAMOZ-06: Master Production Review & Comprehensive Testing Plan

**Project:** Gramoz E-Commerce Platform  
**Authors:** Principal Software Engineer, Staff QA Architect & Production Reliability Engineer  
**Scope:** Complete Production Remediation & Verification Roadmap (34 Detailed Tasks)  
**Date:** October 2026  
**Status:** ACTIVE PRODUCTION ROADMAP  

---

## 1. Executive Strategy & Master Plan Overview

This Master Review Plan synthesizes the architectural discovery (`GRAMOZ-01` to `GRAMOZ-05`), testing architecture (`GRAMOZ-09`), and comprehensive test matrices (`GRAMOZ-10`, `GRAMOZ-11`, `GRAMOZ-12`).

It details **34 atomic, independently verifiable tasks**:
- **Phase 1: Critical Pre-Production Blockers & Core Fixtures (Tasks 01–04)**: Immediate database migration fix, backend test suite compile repair, order cancellation inventory restock, and production secret boot validation.
- **Phase 2: Security Hardening & Concurrency Protection (Tasks 05–10)**: Edge proxy admin role verification, cart atomic upsert, auth route rate limiting, dynamic proxy rewrites, JWT Redis caching, and transaction scope decoupling.
- **Phase 3: Database & Infrastructure Optimizations (Tasks 11–13)**: Reviews rating denormalization, outbox partial index, and frontend Vitest testing harness setup.
- **Phase 4: Dedicated Backend Automated Test Suites (Tasks 16–25)**: Exhaustive unit, integration, API contract, and concurrency test suites for all 19 NestJS backend modules.
- **Phase 5: Dedicated Frontend Automated Test Suites (Tasks 26–31)**: Component, store, and page tests across all 40 Next.js routes, 29 components, and 3 Zustand stores.
- **Phase 6: Full-Stack E2E Browser & Adversarial Security Suites (Tasks 14, 32–34)**: Playwright customer journeys, payment sandboxes, and adversarial security tests.
- **Phase 7: CI/CD Quality Gates & Release Automation (Task 15)**: Automated GitHub Actions pipeline enforcing all quality gates on every Pull Request.

---

## 2. Master Review & Testing Tasks (Tasks 01–34)

### Phase 1: Critical Pre-Production Blockers (P0)

#### [TASK-01] Database Migration `0013` Syntax Conflict Fix
- **Scope:** Database / Migrations
- **Priority:** **P0 — Critical Blocker**
- **Evidence:** [`0013_flaky_puppet_master.sql:1`](file:///home/trroyel/gramoz/server/drizzle/migrations/0013_flaky_puppet_master.sql#L1) executes `DROP INDEX "uq_cart_items_user_product"`. In `0005`, `uq_cart_items_user_product` was created as a unique table constraint. PostgreSQL aborts with `cannot drop index ... because constraint requires it`. Fresh database migrations crash.
- **Dependencies:** None.
- **Implementation Objective:** Replace `DROP INDEX` with:
  ```sql
  ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "uq_cart_items_user_product";
  DROP INDEX IF EXISTS "uq_cart_items_user_product";
  ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "variant_id" uuid;
  ```
- **Required Verification Tests:**
  - *Backend Integration Test:* Run `npm --prefix server run db:migrate` on a clean PostgreSQL instance.
  - *Regression Test:* Verify all 20 database tables and constraints are created without error.
- **Acceptance Criteria:** Clean execution of all migrations with exit code 0.

#### [TASK-02] Repair Backend Jest Unit Test Fixtures
- **Scope:** Backend / Testing Infrastructure
- **Priority:** **P0 — Critical Blocker**
- **Evidence:** `npm --prefix server test` exits with code 1. [`orders.service.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.spec.ts) fails on invalid import `../auth/mail.service` and missing providers (`OrdersStore`, `PromosService`, `LoyaltyService`, `SettingsService`, `CourierService`). [`payments.service.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.spec.ts) misses `PaymentsStore`.
- **Dependencies:** None.
- **Implementation Objective:** Update test module factories in both spec files to mock all constructor dependencies and fix import paths.
- **Required Verification Tests:**
  - *Backend Unit Test:* Run `npm --prefix server test`.
- **Acceptance Criteria:** Both spec files compile without TypeScript errors; 100% of defined tests pass.

#### [TASK-03] Inventory Restock on Order Cancellation & Stale Checkout Expiry
- **Scope:** Backend / Orders & Inventory
- **Priority:** **P0 — Critical Blocker**
- **Evidence:** [`orders.service.ts:304-338`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts#L304-L338) updates order status to `'cancelled'` without restocking inventory, decrementing promo usage, or refunding loyalty points.
- **Dependencies:** `TASK-02`.
- **Implementation Objective:**
  1. Implement `restockOrder(orderId, tx)` in `orders.store.ts` atomically incrementing product/variant stock, logging `inventory_transactions` (`type: 'in'`), decrementing promo usage, and refunding loyalty points.
  2. Call `restockOrder` in `OrdersService.updateOrderStatus` on `'cancelled'`.
  3. Implement cron job auto-cancelling pending orders with `paymentStatus = 'unpaid'` older than 30 minutes.
- **Required Verification Tests:**
  - *Backend Unit Test:* Mocked cancellation restock verification in `orders.service.spec.ts`.
  - *Backend Integration Test:* Database transaction test verifying stock increases and audit records logged.
  - *Concurrency Test:* Verify parallel cancellations don't double-restock.
- **Acceptance Criteria:** Stock matches pre-order levels upon cancellation; promo quota decremented; loyalty balance restored.

#### [TASK-04] Enforce Production Environment Secrets & Fatal Boot Assertions
- **Scope:** Backend / Security
- **Priority:** **P0 — Critical Blocker**
- **Evidence:** [`config.service.ts:78`](file:///home/trroyel/gramoz/server/src/config/config.service.ts#L78) has `'secret'` fallback for `AUTH_JWT_SECRET`. [`payments.service.ts:25`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts#L25) has `'testpass'` fallback for `SSLCOMMERZ_STORE_SECRET`.
- **Dependencies:** `TASK-02`.
- **Implementation Objective:** Add startup assertion in `main.ts` or `ConfigService` throwing fatal error if `NODE_ENV === 'production'` and fallback/weak secrets are detected.
- **Required Verification Tests:**
  - *Backend Unit Test:* Verify startup error thrown when secret equals default.
  - *API Contract Test:* Health check passes with strong production secrets.
- **Acceptance Criteria:** Server immediately terminates with exit code 1 if default secrets are used in production.

---

### Phase 2: Security Hardening & Concurrency Protection (P1)

#### [TASK-05] Edge Proxy Admin Role Authorization & Client Store Security
- **Scope:** Frontend / Security & Auth
- **Priority:** **P1 — High Priority**
- **Evidence:** [`web/src/proxy.ts:22-30`](file:///home/trroyel/gramoz/web/src/proxy.ts#L22-L30) only checks token presence. Authenticated customers with role `customer` pass edge proxy into `/admin`.
- **Dependencies:** None.
- **Implementation Objective:** Enhance `web/src/proxy.ts` to decode JWT token payload for `/admin/:path*` and redirect non-platform users to `/` with HTTP 307.
- **Required Verification Tests:**
  - *Frontend Unit Test:* Test `proxy.ts` with unauthenticated, customer, and admin tokens.
  - *API / Edge Contract Test:* `curl -I /admin` with customer cookie returns 307 to `/`.
- **Acceptance Criteria:** Non-admin authenticated users cannot download admin bundles or view admin layouts.

#### [TASK-06] Cart Concurrency Control & Atomic Upsert
- **Scope:** Backend / Cart
- **Priority:** **P1 — High Priority**
- **Evidence:** [`cart.service.ts:64-83`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.service.ts#L64-L83) executes check-then-insert without a composite unique constraint, causing duplicate cart rows.
- **Dependencies:** `TASK-01`, `TASK-02`.
- **Implementation Objective:** Add composite unique index on `cart_items (user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))` and implement atomic upsert (`ON CONFLICT DO UPDATE`).
- **Required Verification Tests:**
  - *Backend Integration Test:* Run parallel inserts for same user and product variant.
  - *Concurrency Test:* 10 concurrent requests result in exactly 1 row with aggregated quantity.
- **Acceptance Criteria:** Zero duplicate cart rows created.

#### [TASK-07] Anti-Hammering Route Throttling on Authentication Endpoints
- **Scope:** Backend / Security
- **Priority:** **P1 — High Priority**
- **Evidence:** [`auth.controller.ts:47`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.controller.ts#L47) lacks route-level throttling on `POST /auth/login` and `POST /auth/forgot-password`.
- **Dependencies:** `TASK-02`.
- **Implementation Objective:** Apply `@Throttle({ default: { ttl: 60_000, limit: 5 } })` on auth endpoints.
- **Required Verification Tests:**
  - *API Contract Test:* 6 consecutive login attempts within 60s return HTTP 429.
- **Acceptance Criteria:** Rate limit enforced on sensitive auth routes.

#### [TASK-08] Dynamic Next.js Rewrite Configuration & Remote Image Patterns
- **Scope:** Frontend / DevOps
- **Priority:** **P1 — High Priority**
- **Evidence:** [`web/next.config.ts:22,26`](file:///home/trroyel/gramoz/web/next.config.ts#L22-L26) hardcodes `http://localhost:5000`. Cloudflare R2 domain missing from `remotePatterns`.
- **Dependencies:** None.
- **Implementation Objective:** Use `process.env.INTERNAL_API_URL` for rewrites and add media CDN domains to `images.remotePatterns`.
- **Required Verification Tests:**
  - *Frontend Build Test:* `npm --prefix web run build`.
- **Acceptance Criteria:** Builds cleanly; rewrites point to dynamic environment URL.

#### [TASK-09] JWT User Session Lookup Caching in Redis
- **Scope:** Backend / Performance
- **Priority:** **P1 — High Priority**
- **Evidence:** [`jwt.strategy.ts:43`](file:///home/trroyel/gramoz/server/src/modules/auth/strategies/jwt.strategy.ts#L43) executes DB SELECT on every authenticated request.
- **Dependencies:** `TASK-02`.
- **Implementation Objective:** Cache user lookup in Redis (`user:cache:<subKey>`) with 60s TTL; invalidate on role/status changes.
- **Required Verification Tests:**
  - *Backend Unit Test:* Validate cache hit bypasses DB query.
  - *Backend Integration Test:* Validate cache invalidation on user update.
- **Acceptance Criteria:** Subsequent authenticated requests served from Redis cache.

#### [TASK-10] Order Placement Transaction Scope Decoupling
- **Scope:** Backend / Performance
- **Priority:** **P1 — High Priority**
- **Evidence:** [`orders.service.ts:120-125`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts#L120-L125) calls `courierService.calculateCharge` inside `ordersStore.runTransaction`.
- **Dependencies:** `TASK-02`, `TASK-03`.
- **Implementation Objective:** Pre-compute delivery charge and promo discounts *prior* to opening write transaction.
- **Required Verification Tests:**
  - *Backend Unit Test:* Verify transaction execution time and pre-calculation order.
- **Acceptance Criteria:** Pre-calculations executed outside write transaction; order creation remains atomic.

---

### Phase 3: Database & Infrastructure Optimizations (P2)

#### [TASK-11] Reviews Rating Denormalization & Index Optimization
- **Scope:** Database / Performance
- **Priority:** **P2 — Medium Priority**
- **Evidence:** Correlated subquery on `reviews` during catalog browse in `products.service.ts:178`.
- **Dependencies:** `TASK-01`, `TASK-02`.
- **Implementation Objective:** Add composite index `idx_reviews_product_approved_rating` on `reviews(product_id, rating) WHERE status = 'approved'` and denormalize `rating_avg` / `rating_count` on `products` table.
- **Required Verification Tests:**
  - *Backend Integration Test:* Average rating recalculation on review approval.
- **Acceptance Criteria:** Catalog queries read rating directly from `products` without subqueries.

#### [TASK-12] Outbox Processor Partial Index Optimization
- **Scope:** Database / Performance
- **Priority:** **P2 — Medium Priority**
- **Evidence:** Long-term table bloat management for outbox worker polling.
- **Dependencies:** `TASK-01`.
- **Implementation Objective:** Create partial index `idx_outbox_events_pending_claim ON outbox_events (created_at ASC) WHERE status = 'pending' AND attempts < 3`.
- **Required Verification Tests:**
  - *Database Test:* Verify query plan uses partial index.
- **Acceptance Criteria:** Migration runs cleanly; index created.

#### [TASK-13] Web Application Automated Testing Harness Setup
- **Scope:** Frontend / QA Infrastructure
- **Priority:** **P2 — Medium Priority**
- **Evidence:** `web/package.json` has 0 test scripts and 0 test dependencies.
- **Dependencies:** None.
- **Implementation Objective:** Configure Vitest, `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` in `web/`.
- **Required Verification Tests:**
  - *Frontend Test:* `npm --prefix web test` executes cleanly.
- **Acceptance Criteria:** Test runner operational with sample component test.

---

### Phase 4: Dedicated Backend Automated Test Suites (Tasks 16–25)

#### [TASK-16] Dedicated Backend Test Suite: Authentication & Identity
- **Scope:** `AuthModule`, `UsersModule`
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-02`, `TASK-04`, `TASK-07`.
- **Coverage Target:** Scenarios `B-AUTH-01` through `B-AUTH-13`.
- **Verification:** Unit tests for Argon2, tokens, Redis OTP attempts; API contract tests for registration, login, logout, refresh.
- **Acceptance Criteria:** ≥ 85% statement coverage on `auth.service.ts` and `jwt.strategy.ts`.

#### [TASK-17] Dedicated Backend Test Suite: Orders & Checkout Concurrency
- **Scope:** `OrdersModule`, `InvoicesService`, `OrdersStore`
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-02`, `TASK-03`, `TASK-10`.
- **Coverage Target:** Scenarios `B-ORD-01` through `B-ORD-09`, `CONC-01`.
- **Verification:** Atomic stock deduction, cancellation restock, unpaid order auto-expiry cron, phone verification check, invoice PDF generation.
- **Acceptance Criteria:** ≥ 85% statement coverage on `orders.service.ts` and `orders.store.ts`; stock race passes with zero overselling.

#### [TASK-18] Dedicated Backend Test Suite: Payments & IPN Security
- **Scope:** `PaymentsModule`, `PaymentsStore`
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-02`, `TASK-04`.
- **Coverage Target:** Scenarios `B-PAY-01` through `B-PAY-08`, `SEC-02`.
- **Verification:** SSLCommerz session initiation, dual HMAC signature check, amount mismatch rejection, duplicate webhook replay idempotency.
- **Acceptance Criteria:** ≥ 85% statement coverage on `payments.service.ts`.

#### [TASK-19] Dedicated Backend Test Suite: Cart & Abandonment Worker
- **Scope:** `CartModule`, `AbandonedCartProcessor`
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-02`, `TASK-06`.
- **Coverage Target:** Scenarios `B-CRT-01` through `B-CRT-04`, `CONC-02`.
- **Verification:** Cart item additions, atomic upsert concurrency, item deletion, hourly abandoned cart processor alert.
- **Acceptance Criteria:** ≥ 80% statement coverage on `cart.service.ts`.

#### [TASK-20] Dedicated Backend Test Suite: Product Catalog & Redis Caching
- **Scope:** `ProductsModule`, `CategoriesModule`
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-02`.
- **Coverage Target:** Scenarios `B-PRD-01` through `B-PRD-05`.
- **Verification:** Multi-variant product CRUD, soft delete archival, category tree hierarchy, Redis cache hits and invalidation.
- **Acceptance Criteria:** ≥ 80% statement coverage on `products.service.ts`.

#### [TASK-21] Dedicated Backend Test Suite: Promos & Loyalty Rewards
- **Scope:** `PromosModule`, `LoyaltyModule`
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-02`.
- **Coverage Target:** Scenarios `B-PRM-01` through `B-PRM-04`, `B-LOY-01`, `B-LOY-02`, `CONC-03`.
- **Verification:** Discount math, spend thresholds, expiration, atomic promo quota concurrency, loyalty points conversion and debit/refund.
- **Acceptance Criteria:** ≥ 85% statement coverage on `promos.service.ts` and `loyalty.service.ts`.

#### [TASK-22] Dedicated Backend Test Suite: Refunds & Reverse Logistics
- **Scope:** `RefundsModule`
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-02`, `TASK-03`.
- **Coverage Target:** Scenarios `B-REF-01`, `B-REF-02`, `CONC-05`.
- **Verification:** Delivered-order refund validation, duplicate request block, admin approval atomic restock and payment refund synchronization.
- **Acceptance Criteria:** ≥ 85% statement coverage on `refunds.service.ts`.

#### [TASK-23] Dedicated Backend Test Suite: Reviews, Wishlists & Customer Feedback
- **Scope:** `ReviewsModule`, `WishlistsModule`
- **Priority:** **P2 — Medium**
- **Dependencies:** `TASK-02`, `TASK-11`.
- **Coverage Target:** Scenarios `B-REV-01`, `B-REV-02`, `B-WSH-01`.
- **Verification:** Verified purchase check, one-review-per-order uniqueness, admin review moderation, wishlist deduplication.
- **Acceptance Criteria:** ≥ 80% statement coverage on `reviews.service.ts`.

#### [TASK-24] Dedicated Backend Test Suite: Courier Logistics & Notifications
- **Scope:** `CourierModule`, `NotificationsModule`, `StorageModule`
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-02`.
- **Coverage Target:** Scenarios `B-COU-01`, `B-COU-02`, `B-NOT-01`, `B-NOT-02`, `B-STR-01`.
- **Verification:** Delivery charge calculation, Steadfast courier consignment creation, BulkSMSBD integration, Resend mail, R2 upload.
- **Acceptance Criteria:** ≥ 80% statement coverage on `courier.service.ts` and notification services.

#### [TASK-25] Dedicated Backend Test Suite: Outbox Processor & Schema Migrations
- **Scope:** Infrastructure, Outbox Worker, Drizzle Schema
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-01`, `TASK-02`, `TASK-12`.
- **Coverage Target:** Scenarios `B-DB-01` through `B-DB-04`, `B-CFG-01`, `CONC-04`.
- **Verification:** Clean migration execution from baseline, outbox lock contention (`FOR UPDATE SKIP LOCKED`), max attempt retry dead-lettering, fatal boot assertions.
- **Acceptance Criteria:** 100% migrations pass; outbox worker concurrency executes with zero duplicate claims.

---

### Phase 5: Dedicated Frontend Automated Test Suites (Tasks 26–31)

#### [TASK-26] Dedicated Frontend Test Suite: Client Stores & HTTP Resiliency
- **Scope:** `cart-store`, `auth-store`, `wishlist-store`, `http-clients.ts`
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-13`.
- **Coverage Target:** Scenarios `F-STR-01` through `F-STR-06`, `F-NET-01` through `F-NET-03`.
- **Verification:** Subtotal math, promo deduction, quantity adjustments, localStorage hydration, concurrent 401 refresh subscriber queues.
- **Acceptance Criteria:** ≥ 85% statement coverage on client stores and `http-clients.ts`.

#### [TASK-27] Dedicated Frontend Test Suite: Forms & Interactive Modals
- **Scope:** Auth forms, Product form, Refund modal, Review modal, Phone verification modal
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-13`.
- **Coverage Target:** Scenarios `F-FRM-01` through `F-FRM-06`.
- **Verification:** Form validation, error display, OTP countdown timer, variant dynamic matrix, disabled button states during submission.
- **Acceptance Criteria:** All form components render errors properly and submit valid payloads.

#### [TASK-28] Dedicated Frontend Test Suite: Catalog, Product Detail & Cart Pages
- **Scope:** Storefront, Catalog filters, Product detail, Cart page
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-13`.
- **Coverage Target:** Scenarios `F-CAT-01` through `F-CAT-03`.
- **Verification:** Catalog filtering, variant selection updating price/stock, empty cart state, cart summary calculation.
- **Acceptance Criteria:** Core shopping views render and respond to user interactions accurately.

#### [TASK-29] Dedicated Frontend Test Suite: Multi-Step Checkout & Payment Callbacks
- **Scope:** Checkout page, Success/Fail/Cancel callback routes
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-13`.
- **Coverage Target:** Scenarios `F-CHK-01` through `F-CHK-06`.
- **Verification:** Address toggle, real-time delivery calculation on zone selection, loyalty toggle deduction, payment method selection, phone verification interceptor.
- **Acceptance Criteria:** Complete checkout UI state machine tested deterministically with mock APIs.

#### [TASK-30] Dedicated Frontend Test Suite: Dashboard, Order History & Shipment Tracking
- **Scope:** Customer dashboard, Order detail, Invoice download, `/track` Leaflet map
- **Priority:** **P2 — Medium**
- **Dependencies:** `TASK-13`.
- **Coverage Target:** Scenarios `F-DSH-01`, `F-DSH-02`, `F-TRK-01`.
- **Verification:** Order history status badges, invoice download trigger, shipment tracking milestones.
- **Acceptance Criteria:** Dashboard pages render data and handle user download actions cleanly.

#### [TASK-31] Dedicated Frontend Test Suite: Admin Backoffice Portal & Edge Proxy
- **Scope:** Admin layout, Admin orders/products/refunds, `web/src/proxy.ts`
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-05`, `TASK-13`.
- **Coverage Target:** Scenarios `F-ADM-01` through `F-ADM-05`, `F-PRX-01` through `F-PRX-03`.
- **Verification:** Edge proxy unauthenticated and role-based redirects, admin layout access control, order status changes, refund processing.
- **Acceptance Criteria:** Edge proxy and admin layouts strictly enforce role authorization.

---

### Phase 6: Full-Stack E2E Browser & Adversarial Security Suites (Tasks 14, 32–34)

#### [TASK-14] Playwright End-to-End Test Harness & Framework Setup
- **Scope:** Full-Stack QA Infrastructure
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-01` through `TASK-08`.
- **Implementation Objective:** Install and configure Playwright in `web/` or project root; setup browser fixtures, authentication helpers, and test database reset scripts.
- **Acceptance Criteria:** Playwright runs headless Chromium against live dev servers with exit code 0.

#### [TASK-32] Playwright E2E Suite: Customer Authentication & Catalog Journeys
- **Scope:** E2E Journeys 1 & 2
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-14`, `TASK-16`, `TASK-20`.
- **Coverage Target:** Scenarios `E2E-JRN-01`, `E2E-JRN-02`.
- **Verification:** Registration -> SMS OTP verification -> Profile update; Catalog search -> Category filter -> Variant selection -> Cart persistence across F5.
- **Acceptance Criteria:** Headless browser executes journeys 1 and 2 end-to-end without errors.

#### [TASK-33] Playwright E2E Suite: Checkout, SSLCommerz & COD Fulfillment Journeys
- **Scope:** E2E Journeys 3, 4 & 5
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-14`, `TASK-17`, `TASK-18`, `TASK-24`.
- **Coverage Target:** Scenarios `E2E-JRN-03`, `E2E-JRN-04`, `E2E-JRN-05`.
- **Verification:** Online checkout with coupon & loyalty -> SSLCommerz sandbox redirect & return -> Order confirmed; COD checkout with phone verification gate; Admin status transition to `shipped` -> Courier tracking map rendering.
- **Acceptance Criteria:** Complete financial checkout and fulfillment journeys pass automated verification.

#### [TASK-34] Playwright E2E Suite: Reverse Logistics & Security Enforcement
- **Scope:** E2E Journey 6 & Adversarial Security Scenarios
- **Priority:** **P0 — Critical**
- **Dependencies:** `TASK-14`, `TASK-22`, `TASK-31`.
- **Coverage Target:** Scenarios `E2E-JRN-06`, `SEC-01` through `SEC-05`.
- **Verification:** Delivered order refund request -> Admin approval -> Stock restocked; LocalStorage role spoofing defense; IPN amount tampering defense; IDOR cross-account invoice protection; Credential stuffing rate limit defense.
- **Acceptance Criteria:** All adversarial security tests and refund lifecycle tests pass.

---

### Phase 7: CI/CD Quality Pipeline & Gate Automation (Task 15)

#### [TASK-15] Automated CI/CD Quality Pipeline Implementation
- **Scope:** DevOps / Production Reliability
- **Priority:** **P1 — High**
- **Dependencies:** `TASK-01`, `TASK-02`, `TASK-13`, `TASK-14`.
- **Implementation Objective:** Create `.github/workflows/ci.yml` defining multi-stage pipeline:
  1. Static analysis & linting (`npm run lint` for server and web).
  2. Database migration validation on ephemeral PostgreSQL 16 service container.
  3. Backend test execution (`npm test -- --coverage`) enforcing 80% coverage threshold.
  4. Frontend test execution (`npm --prefix web test`).
  5. Playwright E2E regression suite execution on PRs.
  6. Production build verification (`npm run build` for server and web).
- **Acceptance Criteria:** Pull requests to `main` and `develop` automatically blocked if any lint, migration, test, or coverage threshold fails.
