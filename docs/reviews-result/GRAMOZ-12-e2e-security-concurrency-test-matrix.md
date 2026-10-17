# GRAMOZ-12: End-to-End, Security & Concurrency Test Matrix

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Principal Software Engineer, Staff QA Architect & Security Auditor  
**Scope:** Browser-Level E2E Journeys (Playwright), Threat Modeling & Security Verifications, Concurrency & High-Contention Race Scenarios  
**Date:** October 2026  
**Status:** AUDITED MASTER INVENTORY  

---

## 1. Scope & Execution Principles

Cross-layer testing bridges the gap between isolated unit tests and full system behavior. This matrix formalizes:
1. **6 Release-Critical E-Commerce Journeys:** Exercised end-to-end via headless Chromium with Playwright, tracking state across the entire stack:
   $$\text{Browser UI} \longrightarrow \text{Next.js App} \longrightarrow \text{Fastify API} \longrightarrow \text{PostgreSQL 16 / Redis 7} \longrightarrow \text{Outbox / Gateways}$$
2. **6 Critical Security & Abuse Scenarios:** Adversarial testing validating that frontend assertions cannot be bypassed by direct API calls, forged payloads, or client-side storage manipulation.
3. **5 Concurrency & High-Contention Race Conditions:** Automated parallel stress tests ensuring data integrity under simultaneous database operations.

---

## 2. Release-Critical E2E Browser Test Matrix (Playwright)

- **Test Runner:** `@playwright/test`
- **Base URL:** `http://localhost:3000`
- **Backend API:** `http://localhost:5000`
- **Existing Test Files:** `None`

| Journey ID | Customer / Admin Journey | Steps & Boundary Flow | Expected Observable Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **E2E-JRN-01** | **Customer Registration & SMS Phone Verification** | 1. Navigate to `/register`.<br>2. Submit name, email, password.<br>3. Redirect to `/login`; enter credentials.<br>4. Profile shows `Phone Unverified`.<br>5. Click "Verify Phone"; enter phone number.<br>6. Simulated SMS OTP code entered in modal.<br>7. Submit code. | User receives confirmation toast; profile badge transitions to `Verified`; session cookie stored; dashboard loads personal details. | `npx playwright test tests/e2e/auth-journey.spec.ts` | Complete flow executes in browser without console errors; database reflects `is_phone_verified = true`. | `NOT_STARTED` |
| **E2E-JRN-02** | **Catalog Search, Variant Selection & Cart Persistence** | 1. Navigate to `/products`.<br>2. Filter by category "Men's Apparel" and search "Polo".<br>3. Click product detail `/products/[id]`.<br>4. Select Size "L", Color "Navy".<br>5. Click "Add to Cart".<br>6. Navigate to `/cart`.<br>7. Refresh browser page (F5). | Selected variant attributes appear in cart; subtotal calculates accurately; cart items persist across page reload from database/localStorage. | `npx playwright test tests/e2e/cart-journey.spec.ts` | Variant attributes match selection; quantity adjustments update total dynamically; item survives browser reload. | `NOT_STARTED` |
| **E2E-JRN-03** | **Full Online Checkout with Coupon & SSLCommerz Sandbox** | 1. From `/cart`, click "Proceed to Checkout".<br>2. Fill shipping address or select default.<br>3. Select Division "Dhaka", District "Dhaka", Zone "Gulshan".<br>4. Apply promo code "RAMADAN20" (20% off).<br>5. Toggle Loyalty slider (redeem 500 points).<br>6. Select "bKash / Cards (SSLCommerz)".<br>7. Click "Complete Order".<br>8. Browser redirects to SSLCommerz sandbox.<br>9. Complete test payment.<br>10. Gateway redirects to `/checkout/success`. | Order total reflects dynamic delivery fee, coupon deduction, and points discount; SSLCommerz initiates payment; webhook confirms payment; `/checkout/success` displays Order # and download invoice button. | `npx playwright test tests/e2e/checkout-online.spec.ts` | Order created in DB with status `'confirmed'`, `paymentStatus = 'paid'`; stock decremented; cart cleared; invoice downloadable. | `NOT_STARTED` |
| **E2E-JRN-04** | **Cash on Delivery (COD) Checkout with Phone Gate** | 1. Cart contains items.<br>2. Proceed to `/checkout`.<br>3. If phone unverified, modal intercepts flow.<br>4. Complete SMS OTP verification in modal.<br>5. Select payment method "Cash on Delivery".<br>6. Click "Complete Order". | Order immediately placed without external gateway redirect; browser redirects to `/checkout/success`; order status `'confirmed'`, `paymentStatus = 'unpaid'`. | `npx playwright test tests/e2e/checkout-cod.spec.ts` | Order confirmed; stock decremented; no gateway redirect triggered. | `NOT_STARTED` |
| **E2E-JRN-05** | **Admin Order Fulfillment, Shipped Status & Tracking Map** | 1. Log in as `admin`.<br>2. Navigate to `/admin/orders`.<br>3. Open confirmed order.<br>4. Transition status from `confirmed` to `shipped`.<br>5. Background outbox worker dispatches Steadfast consignment.<br>6. Open `/track?code=<consignmentId>` in customer session. | Admin UI shows order status `shipped`; consignment code generated; customer tracking page renders Leaflet map with simulated delivery route and milestones. | `npx playwright test tests/e2e/admin-fulfillment.spec.ts` | Outbox event `CREATE_CONSIGNMENT` processed; order tracking code populated; map renders waypoints. | `NOT_STARTED` |
| **E2E-JRN-06** | **Delivered Order, Customer Refund Request & Admin Restock** | 1. Order marked `delivered`.<br>2. Customer opens `/dashboard/orders/[id]`.<br>3. Clicks "Request Refund"; selects reason and attaches comment.<br>4. Admin opens `/admin/refunds`.<br>5. Admin clicks "Approve Refund".<br>6. Verify database stock levels. | Refund request created; admin approval transitions refund to `processed`, payment to `refunded`, order to `refunded`; product stock atomically restored. | `npx playwright test tests/e2e/refund-lifecycle.spec.ts` | Stock count increases by returned quantity; `inventory_transactions` logs `type: 'in'`; customer sees refunded badge. | `NOT_STARTED` |

---

## 3. Security, Authorization & Threat Test Matrix

- **Target Systems:** Authentication, Session Management, RBAC, Webhooks, IDOR
- **Existing Test Files:** `None`

| Threat ID | Threat Category / Vulnerability | Attack Vector & Input Conditions | Expected Security Defense | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **SEC-01** | Broken Access Control / Role Spoofing (CWE-284) | Attacker alters `localStorage.setItem('auth-storage', JSON.stringify({ state: { user: { role: 'super_admin' } } }))` and navigates to `/admin`. | Next.js Edge proxy and backend API inspect signed server session cookie; non-platform role receives HTTP 307 redirect or HTTP 403 Forbidden; admin data never streamed. | `npx playwright test tests/security/role-spoofing.spec.ts` | Admin layout not rendered; backend returns 403; zero customer data exposed. | `NOT_STARTED` |
| **SEC-02** | Payment Webhook Amount Tampering (CWE-472) | Attacker intercepts IPN webhook and submits valid signature with `amount = 1.00` for an order total of `5000.00 BDT`. | `PaymentsService` checks `Math.abs(gatewayAmount - orderAmount) <= 0.01`. Mismatch marks payment `failed`; order remains unpaid; security alert emitted. | `npm --prefix server test -- -t "PaymentsService IPN amount tampering"` | Transaction rejected; status remains `unpaid`; order is not marked confirmed. | `NOT_STARTED` |
| **SEC-03** | Insecure Direct Object Reference (IDOR) (CWE-639) | Customer A authenticates; attempts to call `GET /orders/:id/invoice` supplying Customer B's order UUID. | `OrdersStore` query asserts `orders.id = :orderId AND orders.user_id = :userId`. Mismatch throws `ForbiddenOperationError` / HTTP 403. | `npm --prefix server test -- -t "InvoicesService IDOR"` | HTTP 403 Forbidden returned; invoice PDF stream not generated. | `NOT_STARTED` |
| **SEC-04** | Credential Stuffing & Brute Force Hammering (CWE-307) | Attacker executes 20 rapid `POST /auth/login` requests with dictionary passwords against single email. | Rate limiter intercepts 6th attempt with HTTP 429 Too Many Requests; Redis counter temporarily locks attempts. | `npm --prefix server test -- -t "AuthController rate limiting"` | Exceeding 5 attempts per minute returns HTTP 429; email brute force thwarted. | `NOT_STARTED` |
| **SEC-05** | Unverified Phone COD Fraud Gate (CWE-862) | Attacker directly calls `POST /orders/checkout` via `curl` with `isPhoneVerified = false` in session. | Controller and service assert `user.isPhoneVerified === true`. Rejects request with HTTP 403 ("Phone number verification is required"). | `npm --prefix server test -- -t "OrdersService unverified phone"` | Order creation blocked; returns 403 Forbidden. | `NOT_STARTED` |
| **SEC-06** | Insecure Default Secret Startup Assertion (CWE-798) | System started with `NODE_ENV=production` and `AUTH_JWT_SECRET="secret"`. | Startup hook detects default secret; throws fatal error; terminates process with exit code 1. | `npm --prefix server test -- -t "ConfigService default secret"` | Server refuses to boot with insecure configuration. | `NOT_STARTED` |

---

## 4. Concurrency & High-Contention Race-Condition Test Matrix

- **Engine:** Multi-connection asynchronous Node.js test harness
- **Database:** PostgreSQL 16 (Local Docker container on port `5433`)
- **Existing Test Files:** `None`

| Race ID | Concurrency Scenario | Contention Mechanics | Invariant Under Test | Expected Resolution | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **CONC-01** | **Inventory Exhaustion Race** | 10 parallel connections simultaneously submit checkout for a product with exactly 1 unit in stock. | Single-unit warehouse stock must never be oversold. | Exactly 1 connection receives HTTP 201 with confirmed order; 9 connections receive `InsufficientStockError` (HTTP 400); database `stock` equals exactly 0. | `npx tsx server/test/concurrency/stock-exhaustion.race.ts` | Zero negative stock; exactly 1 order created in `orders` table; exactly 1 `'out'` transaction in `inventory_transactions`. | `NOT_STARTED` |
| **CONC-02** | **Cart Duplicate Addition Race** | User double-clicks or rapidly fires 5 simultaneous `POST /cart/items` requests for same product and variant. | A user's cart must contain only 1 row per product/variant combination. | PostgreSQL composite unique index and `ON CONFLICT DO UPDATE` atomically aggregate quantities into single row (`quantity = 5`). | `npx tsx server/test/concurrency/cart-upsert.race.ts` | Exactly 1 row in `cart_items` for `(userId, productId, variantId)`; quantity equals 5. | `NOT_STARTED` |
| **CONC-03** | **Promo Usage Quota Contention** | Coupon has `maxUses = 1`, `currentUses = 0`. 5 concurrent checkout requests apply the coupon. | Coupon quota must never be exceeded under race conditions. | SQL UPDATE predicate `WHERE current_uses < max_uses` ensures exactly 1 order receives the discount; other 4 proceed at full price or reject promo. | `npx tsx server/test/concurrency/promo-quota.race.ts` | Exactly 1 order has `promoId` attached; `current_uses` equals 1; zero quota overspending. | `NOT_STARTED` |
| **CONC-04** | **Outbox Worker Lock Contention** | 2 outbox processor instances run polling query concurrently against 5 pending outbox events. | Outbox events must be processed exactly once without thread collisions or duplicate external API dispatches. | `SELECT ... FOR UPDATE SKIP LOCKED` partitions rows cleanly between workers. Worker A claims rows 1-3; Worker B claims rows 4-5. | `npx tsx server/test/concurrency/outbox-lock.race.ts` | Zero duplicate outbox dispatches; each row processed once. | `NOT_STARTED` |
| **CONC-05** | **Double-Refund Submission Race** | Customer rapidly clicks "Request Refund" twice concurrently on same delivered order. | Only 1 active refund request per order. | Unique constraint on `order_id` in `refunds` table rejects second submission with HTTP 400 ("Refund already requested for this order"). | `npx tsx server/test/concurrency/refund-duplicate.race.ts` | Exactly 1 row in `refunds` table; second request rejected cleanly. | `NOT_STARTED` |
