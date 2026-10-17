# GRAMOZ-02: Backend Services, Domain Logic & API Review

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Staff Software Engineer & Principal API Architect  
**Scope:** NestJS Backend (19 Modules), Business Logic, Transaction Boundaries, Concurrency, and API Contracts  
**Date:** October 2026  
**Status:** Complete Audit  

---

## 1. Backend Architecture Overview

The Gramoz backend is built on **NestJS v11** utilizing the **Fastify** HTTP engine (`@nestjs/platform-fastify`). The service layer communicates with PostgreSQL via **Drizzle ORM** (`node-postgres`), with Redis providing ephemeral caching, OTP verification, and session state.

The application contains **19 functional modules** orchestrated in [`server/src/app.module.ts`](file:///home/trroyel/gramoz/server/src/app.module.ts):
- **Core Domain:** `AuthModule`, `UsersModule`, `AdminUsersModule`, `ProductsModule`, `CategoriesModule`, `CartModule`, `OrdersModule`, `PaymentsModule`, `RefundsModule`, `PromosModule`, `LoyaltyModule`, `ReviewsModule`, `WishlistsModule`.
- **Infrastructure & Operations:** `DatabaseModule`, `RedisModule`, `NotificationsModule`, `CourierModule`, `StorageModule`, `SettingsModule`, `ShippingZonesModule`, `AnalyticsModule`, `HealthModule`.

---

## 2. Comprehensive Module-by-Module Audit

### 2.1 Authentication & Session Management (`AuthModule`)
- **Key Files:** [`auth.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.controller.ts), [`auth.service.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.service.ts), [`jwt.strategy.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/strategies/jwt.strategy.ts)
- **Mechanics:**
  - Standard email/password registration with Argon2 password hashing.
  - Stateless dual-JWT architecture (15-minute access token, 7-day refresh token) delivered via `httpOnly`, `SameSite=Lax` cookies.
  - Email verification codes and password reset codes generated with cryptographic security (`crypto.randomInt(100000, 999999)`), stored in Redis with TTL.
  - Brute-force protection: [`verifyEmail`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.service.ts#L139-L190) and [`verifyPhoneOtp`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.service.ts#L245-L287) increment Redis attempt counters *before* comparing codes; exceeding 5 attempts invalidates the code permanently.
  - Google and Facebook OAuth flows implement signed HMAC-SHA256 CSRF state cookies (`oauth_state`) with 10-minute expiry to defeat OAuth login-CSRF attacks.
- **Architectural Findings & Risks:**
  - **P1 - High:** In [`jwt.strategy.ts:43`](file:///home/trroyel/gramoz/server/src/modules/auth/strategies/jwt.strategy.ts#L43), `this.usersStore.findById(payload.sub)` executes a database SELECT query on every authenticated request. Under 500 req/sec, this creates an unnecessary query bottleneck. **Remediation:** Cache user status and role in Redis under `user:cache:<id>` with a 60-second TTL, invalidated whenever user status or role changes.
  - **P2 - Medium:** Role is omitted from the JWT payload (`payload = { sub: user.id, email: user.email }`). While this ensures immediate revocation upon role demotion, adding `role` to the payload could enable fast-path checks for non-critical endpoints.

### 2.2 Product Catalog & Inventory (`ProductsModule` & `CategoriesModule`)
- **Key Files:** [`products.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/products/products.controller.ts), [`products.service.ts`](file:///home/trroyel/gramoz/server/src/modules/products/products.service.ts)
- **Mechanics:**
  - Product creation supports multi-variant attributes (SKU, price, stock, color/size JSON), units, categories, and images.
  - Soft-delete semantics: `DELETE /products/:id` sets `deletedAt = NOW()` and `status = 'archived'`. Preserves historical order references and avoids foreign key constraint failures.
  - Redis caching: Individual product lookups (`GET /products/:id`) cache the combined product and variant data for 300 seconds (`product:<id>`), invalidated on update and delete.
- **Architectural Findings & Risks:**
  - **P2 - Medium:** Product search query in [`products.service.ts:178`](file:///home/trroyel/gramoz/server/src/modules/products/products.service.ts#L178) runs a correlated subquery on the `reviews` table for `averageRating` (`COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = products.id AND status = 'approved'), 0)`). This is executed for every row matching the filter. On catalogs with >10,000 products and >100,000 reviews, this will cause significant CPU degradation. **Remediation:** Denormalize `rating_avg` (decimal) and `rating_count` (integer) into the `products` table and update them atomically upon review approval.
  - **P3 - Low:** In [`products.controller.ts:38-60`](file:///home/trroyel/gramoz/server/src/modules/products/products.controller.ts#L38-L60), multipart form data parsing bypasses NestJS `ValidationPipe` and relies on manual validation checks.

### 2.3 Cart & Cart Abandonment (`CartModule`)
- **Key Files:** [`cart.service.ts`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.service.ts), [`abandoned-cart.processor.ts`](file:///home/trroyel/gramoz/server/src/modules/cart/abandoned-cart.processor.ts)
- **Mechanics:**
  - Supports both standard products and variant-specific cart additions.
  - Background cron job [`AbandonedCartProcessor`](file:///home/trroyel/gramoz/server/src/modules/cart/abandoned-cart.processor.ts) runs hourly, scanning for cart items unmodified for `idleHours` (configurable in store settings), aggregating items per user, and triggering reminder emails via `MailService`.
- **Architectural Findings & Risks:**
  - **P1 - High:** In [`cart.service.ts:64-83`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.service.ts#L64-L83), `addItem` performs a non-atomic "check-then-insert":
    ```typescript
    const existing = await this.cartStore.findCartItemByProduct(userId, dto.productId, dto.variantId);
    if (existing) {
      return await this.cartStore.updateCartItemQuantity(existing.id, newQty);
    }
    return await this.cartStore.createCartItem(...);
    ```
    Because this is executed outside a database transaction and there is no unique constraint on `(user_id, product_id, variant_id)` in PostgreSQL, concurrent requests (e.g., user double-clicking "Add to Cart") will both see `existing === null` and insert duplicate rows. **Remediation:** Add a composite unique index on `(user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))` and use PostgreSQL `ON CONFLICT DO UPDATE`.

### 2.4 Checkout & Order Processing (`OrdersModule`)
- **Key Files:** [`orders.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.controller.ts), [`orders.service.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts), [`orders.store.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.store.ts), [`outbox.processor.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/outbox.processor.ts)
- **Mechanics:**
  - Checkout strictly requires verified phone numbers ([`orders.controller.ts:39`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.controller.ts#L39)) to combat fake orders in the Bangladeshi COD ecosystem.
  - Price calculation aggregates variant or base product prices in cents (`Math.round(price * 100)`), applies validated promo codes, deducts loyalty points, and computes zone-based delivery fees.
  - Transaction boundary: Lines 90–232 in [`orders.service.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts#L90-L232) wrap address creation, order insertion, item creation, atomic stock deduction, cart clearing, promo usage increment, and outbox event creation into a single atomic database transaction (`ordersStore.runTransaction`).
  - Stock deduction is strictly atomic using SQL predicates:
    ```sql
    UPDATE products SET stock = stock - :qty, updated_at = NOW()
    WHERE id = :id AND stock >= :qty
    RETURNING stock;
    ```
    If any item cannot be deducted, the transaction throws `InsufficientStockError` and rolls back entirely.
- **Architectural Findings & Risks:**
  - **P0 - CRITICAL: Inventory Leak on Unpaid / Cancelled Orders:**
    - When an order is placed, stock is immediately deducted from the warehouse inventory and the order is marked `status = 'pending'`, `paymentStatus = 'unpaid'`.
    - If the user closes their browser at the SSLCommerz gateway, or payment fails, or the order is subsequently marked `cancelled` via `updateOrderStatus`, **the system NEVER returns the deducted stock to inventory.**
    - Only `RefundsService.processRefund` contains restock logic (lines 192–211). Order cancellation in [`orders.service.ts:304-338`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts#L304-L338) only updates the order status column without restocking products or releasing promo usage or refunding spent loyalty points!
    - **Impact:** Abandoned checkout attempts and cancellations permanently deplete inventory and lock promo codes.
    - **Remediation:**
      1. Create a restock routine in `ordersStore` that atomically increments product/variant stock and logs `inventory_transactions` with `type = 'in'`.
      2. Call this routine in `updateOrderStatus` whenever transition to `cancelled` occurs.
      3. Implement an automated background cleaner (cron) that cancels and restocks pending online orders whose payment has remained uninitiated or pending for more than 30 minutes.

### 2.5 Payments & Gateway Integration (`PaymentsModule`)
- **Key Files:** [`payments.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.controller.ts), [`payments.service.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts)
- **Mechanics:**
  - Supports SSLCommerz (Credit Cards, Mobile Banking - bKash, Nagad) and Cash on Delivery (COD).
  - Webhook/IPN validation implements dual signature checking (SHA256 with `verify_sign_sha2` and MD5 with `verify_sign`).
  - Gateway amount verification: [`payments.service.ts:281`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts#L281) asserts that the amount returned by SSLCommerz matches the recorded order amount within 0.01 BDT (`Math.abs(gatewayAmount - expectedAmount) <= 0.01`).
  - Stale payment detection: If a customer attempts to initiate payment on an order already marked `initiated`, stale pending payments are auto-failed to unblock retries.
- **Architectural Findings & Risks:**
  - **P1 - High:** In [`payments.service.ts:234-237`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts#L234-L237), when an IPN signature fails verification, the code falls back to query the SSLCommerz Validation API if `val_id` is present:
    ```typescript
    if (!isValid) {
      if (val_id && status === 'VALID') {
        this.logger.warn(`IPN signature mismatch, but val_id is present. Proceeding to Validation API as fallback.`);
      }
    ```
    While server-to-server validation against SSLCommerz is secure because the `store_passwd` is transmitted over HTTPS, signature verification failures should trigger an immediate security alert in monitoring, as signature mismatches often indicate spoofing attempts or compromised gateway secret configs.

### 2.6 Logistics & Tracking (`CourierModule`)
- **Key Files:** [`courier.service.ts`](file:///home/trroyel/gramoz/server/src/modules/courier/courier.service.ts)
- **Mechanics:**
  - Integrated with Steadfast Courier Bangladesh via REST API (`/create_order`, `/status_by_invoice`).
  - Decoupled from checkout via the Transactional Outbox: when an admin sets order status to `shipped`, an outbox event `CREATE_CONSIGNMENT` is created. The worker handles courier dispatch asynchronously, storing the `consignmentId` and `trackingUrl`.
  - Realistic mock fallback: when in `mock` mode, generates simulated live tracking coordinates using the customer's actual shipping address latitude/longitude, allowing map visualization during development and testing.

### 2.7 Refunds & Reverse Logistics (`RefundsModule`)
- **Key Files:** [`refunds.service.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.ts)
- **Mechanics:**
  - Only delivered orders are eligible for customer refund requests (`order.status === 'delivered'`).
  - One refund per order policy enforces deduplication.
  - Admin approval workflow: when admin marks status as `processed`, a database transaction atomically updates the refund record, updates the payment record to `refunded`, sets order payment status to `refunded`, increments variant/product stock, and creates restock audit records in `inventory_transactions`.

### 2.8 Loyalty & Promotions (`LoyaltyModule` & `PromosModule`)
- **Key Files:** [`loyalty.service.ts`](file:///home/trroyel/gramoz/server/src/modules/loyalty/loyalty.service.ts), [`promos.service.ts`](file:///home/trroyel/gramoz/server/src/modules/promos/promos.service.ts)
- **Mechanics:**
  - Loyalty points earned automatically upon order delivery.
  - Points converted to currency discounts during checkout using a configurable ratio (`pointsToCurrencyRatio`).
  - Promo codes support percentage and fixed discounts, minimum spend thresholds, expiration dates, and maximum usage quotas.
  - Concurrency control: [`incrementPromoUsage`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.store.ts#L153-L167) atomically validates `(max_uses IS NULL OR current_uses < max_uses)` in the SQL UPDATE predicate.

---

## 3. Concurrency, Locking & Data Integrity Analysis

```
Order Placement Concurrency Matrix:
[User Cart] ----(Checkout Request)----> [OrdersService.createOrderFromCart]
                                                      |
                                          (Drizzle DB Transaction)
                                                      |
                                 +--------------------+--------------------+
                                 |                                         |
                       [Atomic Stock Decrement]                 [Atomic Promo Check]
                     WHERE stock >= :quantity                 WHERE current_uses < max_uses
                                 |                                         |
                           (Sufficient?)                             (Valid Quota?)
                            /         \                               /         \
                         YES           NO                           YES          NO
                          |             \                            |            \
                   [Proceed Order]   [Rollback: Insufficient] [Create Outbox] [Rollback: Invalid]
```

### Concurrency Highlights:
1. **Stock Decrement:** Protected by atomic SQL predicates. Zero chance of overselling even under heavy concurrency.
2. **Promo Quota:** Protected by atomic SQL predicates. Zero chance of exceeding max quota.
3. **Outbox Polling:** Protected by `FOR UPDATE SKIP LOCKED`. Multiple server pods can safely process background outbox jobs without duplicate processing or thread contention.
4. **Weakness:** Cart item insertion lacks database-level concurrency locks. Simultaneous "Add to Cart" actions can create duplicate records for identical products.

---

## 4. API Design & Contract Standards

- **REST Adherence:** All endpoints adhere to standard REST conventions using proper HTTP verbs (GET, POST, PUT, PATCH, DELETE).
- **Validation:** Global `ValidationPipe` configured with `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true`.
- **Response Format Consistency:** Endpoints wrap data in standard `{ success: true, message: string, data: T }` envelopes.
- **Route Authorization:** Endpoints are guarded with `@UseGuards(JwtAuthGuard, RolesGuard)` and role metadata `@Roles(...)`.

---

## 5. Remediation Priority Plan (Backend)

| Priority | Issue | Affected File(s) | Remediation |
| :--- | :--- | :--- | :--- |
| **P0** | Inventory leak on order cancellation / abandonment | `orders.service.ts`, `orders.store.ts` | Implement restock logic on `cancelled` status and build automated pending order expiry cron. |
| **P1** | Database SELECT query on every request in JWT strategy | `jwt.strategy.ts` | Implement Redis cache for user lookups with 60s TTL. |
| **P1** | Cart item duplicate race condition | `cart.service.ts`, `cart.store.ts`, `cart.ts` (schema) | Add composite unique index and use atomic upsert (`ON CONFLICT DO UPDATE`). |
| **P2** | Correlated subquery for average ratings on catalog | `products.service.ts` | Denormalize `rating_avg` and `rating_count` on `products` table. |
| **P2** | Multipart body validation bypasses DTO pipes | `products.controller.ts` | Refactor file upload handling to use validated DTOs. |
