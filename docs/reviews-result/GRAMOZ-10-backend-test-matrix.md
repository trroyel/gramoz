# GRAMOZ-10: Backend Comprehensive Test Matrix

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Principal Software Engineer & Staff QA Architect  
**Scope:** Complete Coverage Matrix for all 19 NestJS Backend Modules, 23 Controllers, 21 Services, 9 Stores, and Background Processors  
**Date:** October 2026  
**Status:** AUDITED MASTER INVENTORY  

---

## 1. Backend Architecture Inventory Overview

The Gramoz backend comprises **19 functional modules**, **23 controllers**, **21 services**, **9 database stores**, **2 background processors**, and **92 HTTP endpoints**:

| Module Name | Controllers | Services | Stores / Processors | Total Endpoints | Existing Spec Files | Passing Tests | Missing Coverage |
| :--- | :--- | :--- | :--- | :---: | :--- | :---: | :--- |
| **1. Auth** | `AuthController` | `AuthService` | `JwtStrategy`, `GoogleStrategy` | 9 | None | 0 | 100% missing |
| **2. Users & Admin Users** | `UserController`, `UsersAdminController` | `UserService`, `UsersAdminService` | `UsersStore` | 8 | None | 0 | 100% missing |
| **3. Addresses** | `AddressesController` | `AddressesService` | `AddressesStore` | 5 | None | 0 | 100% missing |
| **4. Categories** | `CategoriesController` | `CategoriesService` | Direct Drizzle queries | 5 | None | 0 | 100% missing |
| **5. Products** | `ProductsController` | `ProductsService` | Direct Drizzle queries | 8 | None | 0 | 100% missing |
| **6. Cart** | `CartController` | `CartService` | `CartStore`, `AbandonedCartProcessor` | 5 | None | 0 | 100% missing |
| **7. Orders** | `OrdersController` | `OrdersService`, `InvoicesService` | `OrdersStore`, `OutboxProcessor` | 9 | `orders.service.spec.ts` (BROKEN) | 0 | 100% missing |
| **8. Payments** | `PaymentsController` | `PaymentsService` | `PaymentsStore` | 3 | `payments.service.spec.ts` (BROKEN) | 0 | 100% missing |
| **9. Refunds** | `RefundsController` | `RefundsService` | Direct Drizzle queries | 4 | None | 0 | 100% missing |
| **10. Promos** | `PromosController`, `PromosAdminController` | `PromosService` | Direct Drizzle queries | 7 | None | 0 | 100% missing |
| **11. Loyalty** | `LoyaltyController` | `LoyaltyService` | `LoyaltyStore` | 4 | None | 0 | 100% missing |
| **12. Reviews** | `ReviewsController`, `ReviewsAdminController` | `ReviewsService` | `ReviewsStore` | 6 | None | 0 | 100% missing |
| **13. Wishlists** | `WishlistsController` | `WishlistsService` | `WishlistsStore` | 3 | None | 0 | 100% missing |
| **14. Courier** | `CourierController`, `AdminCourierController` | `CourierService` | Direct Drizzle queries | 6 | None | 0 | 100% missing |
| **15. Notifications** | N/A (Internal) | `MailService`, `SmsService` | Direct Resend / BulkSMSBD API | N/A | None | 0 | 100% missing |
| **16. Settings & Storefront** | `SettingsController`, `StorefrontController` | `SettingsService` | `SettingsStore` | 5 | None | 0 | 100% missing |
| **17. Analytics** | `AnalyticsController` | `AnalyticsService` | Direct Drizzle queries | 2 | None | 0 | 100% missing |
| **18. Health** | `HealthController` | Terminus HealthCheck | Terminus probes | 3 | None | 0 | 100% missing |
| **19. Storage** | N/A (Internal) | `StorageService` | AWS S3 SDK (Cloudflare R2) | N/A | None | 0 | 100% missing |
| **20. Database & Migrations** | N/A | Drizzle ORM | 20 Migration files | N/A | None | 0 | 100% missing |
| **21. Cache & Outbox Worker** | N/A | `RedisService` | `OutboxProcessor` (Cron) | N/A | None | 0 | 100% missing |

---

## 2. Exhaustive Module-by-Module Test Matrix

### 2.1 `AuthModule` (Authentication & Security)
- **Relevant Source Paths:**
  - Controller: [`server/src/modules/auth/auth.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.controller.ts)
  - Service: [`server/src/modules/auth/auth.service.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.service.ts)
  - Strategies & Guards: [`jwt.strategy.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/strategies/jwt.strategy.ts), [`jwt-auth.guard.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/guards/jwt-auth.guard.ts), [`roles.guard.ts`](file:///home/trroyel/gramoz/server/src/modules/auth/guards/roles.guard.ts)
- **Existing Test Files:** `None`
- **Missing Tests:** 100% missing.

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-AUTH-01** | Customer registration with valid email & password | Unit / API | **P0** | Argon2 hashes password; creates user with `status: 'active'`; returns 201 with `{ success: true }`; generates 6-digit email OTP in Redis. | `npm --prefix server test -- -t "AuthService.register"` | User saved in DB; password is valid Argon2 hash; email OTP stored in Redis with 4h TTL. | `NOT_STARTED` |
| **B-AUTH-02** | Registration with duplicate email address | API | **P0** | Throws `BadRequestException` ("Email already registered"); HTTP 400. | `npm --prefix server test -- -t "AuthService.register duplicate"` | Returns 400 Bad Request; zero duplicate users created in DB. | `NOT_STARTED` |
| **B-AUTH-03** | User login with valid credentials | Unit / API | **P0** | Verifies Argon2 hash; sets `httpOnly` secure cookies for `access_token` (15m) and `refresh_token` (7d); returns user profile. | `npm --prefix server test -- -t "AuthService.login"` | Returns 200 OK; response `Set-Cookie` contains `httpOnly`, `SameSite=Lax` cookies; tokens have valid JWT signatures. | `NOT_STARTED` |
| **B-AUTH-04** | User login with invalid password | Unit / API | **P0** | Throws `UnauthorizedException` ("Invalid email or password"); HTTP 401; no cookies set. | `npm --prefix server test -- -t "AuthService.login invalid"` | Returns 401; no token generated; timing-safe password comparison. | `NOT_STARTED` |
| **B-AUTH-05** | Token refresh flow with valid refresh token cookie | Integration | **P0** | Verifies refresh token in Redis; issues new 15-minute access token cookie without prompting re-login. | `npm --prefix server test -- -t "AuthService.refresh"` | Returns 200 OK; new `access_token` cookie emitted; refresh token remains valid until expiry or revocation. | `NOT_STARTED` |
| **B-AUTH-06** | Logout revokes refresh token in Redis | Integration | **P1** | Clears cookies in client response (`Max-Age=0`); removes refresh token from Redis. | `npm --prefix server test -- -t "AuthService.logout"` | Cookies cleared; subsequent refresh calls with old cookie fail with 401. | `NOT_STARTED` |
| **B-AUTH-07** | Email OTP verification: correct code | Integration | **P1** | Compares submitted code with Redis key; marks `isEmailVerified = true` in DB; deletes Redis OTP key. | `npm --prefix server test -- -t "AuthService.verifyEmail"` | User `isEmailVerified` updated to true in DB; OTP key removed from Redis. | `NOT_STARTED` |
| **B-AUTH-08** | Email OTP brute force safeguard | Integration | **P0** | Increments attempt counter in Redis before comparison; after 5 failed attempts, invalidates code permanently. | `npm --prefix server test -- -t "AuthService.verifyEmail brute force"` | 6th attempt rejected even with correct code; HTTP 400 "Too many failed attempts. Code expired." | `NOT_STARTED` |
| **B-AUTH-09** | Phone SMS OTP generation & rate limit | Integration | **P0** | Generates 6-digit OTP; stores in Redis with 10-minute TTL; dispatches SMS outbox event; enforces 1 OTP per 60 seconds per phone. | `npm --prefix server test -- -t "AuthService.sendPhoneOtp"` | Redis key exists; rate-limit key prevents immediate re-send; SMS payload logged in outbox. | `NOT_STARTED` |
| **B-AUTH-10** | Phone SMS OTP verification | Integration | **P0** | Verifies OTP code; updates user `phone` and `isPhoneVerified = true` in DB. | `npm --prefix server test -- -t "AuthService.verifyPhoneOtp"` | User record in DB shows `isPhoneVerified = true` and `phone` updated. | `NOT_STARTED` |
| **B-AUTH-11** | Password reset request & code verification | Unit / Integration | **P1** | Generates secure reset token; verifies code; updates password hash with new Argon2 salt; revokes all existing refresh sessions. | `npm --prefix server test -- -t "AuthService.resetPassword"` | Password hash changed; old password no longer works; active sessions invalidated. | `NOT_STARTED` |
| **B-AUTH-12** | Route throttling on `/auth/login` and `/auth/forgot-password` | API / Throttler | **P1** | Exceeding 5 requests in 60s from single IP returns HTTP 429 Too Many Requests. | `npm --prefix server test -- -t "AuthController throttling"` | 6th request within 60s receives HTTP 429. | `NOT_STARTED` |
| **B-AUTH-13** | RBAC Role guard enforcement | API / Guards | **P0** | Standard customer calling `@Roles('admin')` endpoint receives HTTP 403 Forbidden. | `npm --prefix server test -- -t "RolesGuard"` | HTTP 403 Forbidden returned; admin operation not executed. | `NOT_STARTED` |

---

### 2.2 `OrdersModule` & `InvoicesService` (Checkout & Lifecycle)
- **Relevant Source Paths:**
  - Controller: [`server/src/modules/orders/orders.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.controller.ts)
  - Services: [`server/src/modules/orders/orders.service.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts), [`invoices.service.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/invoices.service.ts)
  - Store: [`server/src/modules/orders/orders.store.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.store.ts)
  - Processor: [`server/src/modules/orders/outbox.processor.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/outbox.processor.ts)
- **Existing Test Files:** [`server/src/modules/orders/orders.service.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.spec.ts) (Fails compilation due to missing `OrdersStore`, `PromosService`, `LoyaltyService`, `SettingsService`, and broken `MailService` import).

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-ORD-01** | Repair test fixture DI dependencies | Test Fixture | **P0** | Update `orders.service.spec.ts` with mocks for `OrdersStore`, `PromosService`, `LoyaltyService`, `SettingsService`, `CourierService`, and valid `MailService`. | `npm --prefix server test -- orders.service.spec.ts` | Test suite compiles without TypeScript errors; test runner exits 0. | `NOT_STARTED` |
| **B-ORD-02** | Checkout with verified phone number and sufficient stock | Integration | **P0** | In atomic transaction: creates shipping address, order record, order items; deducts product stock via SQL predicate; logs `inventory_transactions` (`type: 'out'`); clears cart; creates outbox notification. | `npm --prefix server test -- -t "OrdersService.createOrderFromCart"` | Order status `'pending'`, stock decremented, audit entry created, cart empty. | `NOT_STARTED` |
| **B-ORD-03** | Checkout rejection for unverified phone number | API | **P0** | If `user.isPhoneVerified === false`, endpoint rejects request with HTTP 403 Forbidden ("Phone number verification is required"). | `npm --prefix server test -- -t "OrdersController phone verification"` | Returns 403 Forbidden; zero orders or stock mutations committed. | `NOT_STARTED` |
| **B-ORD-04** | Checkout fails when item is out of stock | Integration | **P0** | Product stock = 0; checkout throws `InsufficientStockError`; transaction rolls back; address and order records not persisted. | `npm --prefix server test -- -t "OrdersService out of stock"` | Returns 400 Bad Request; zero changes committed to database. | `NOT_STARTED` |
| **B-ORD-05** | Order cancellation restores deducted stock | Integration | **P0** | Admin or system cancels order (`status = 'cancelled'`); calls `restockOrder`; stock increments; `inventory_transactions` logs `type: 'in'`; promo usage decremented; loyalty points refunded. | `npm --prefix server test -- -t "OrdersService.updateOrderStatus cancelled"` | Stock matches pre-order level; audit log contains `'in'` entry; promo uses count decremented. | `NOT_STARTED` |
| **B-ORD-06** | Unpaid order auto-expiry background cleaner | Integration / Cron | **P0** | Cron job scans orders with `status = 'pending'`, `paymentStatus = 'unpaid'`, `createdAt < NOW() - 30 minutes`; cancels order and restores inventory. | `npm --prefix server test -- -t "OrdersService auto-expire"` | Stale pending order marked `cancelled`; inventory returned to warehouse. | `NOT_STARTED` |
| **B-ORD-07** | Order transition to `shipped` creates courier consignment outbox event | Integration | **P1** | Updating status to `'shipped'` inserts `CREATE_CONSIGNMENT` outbox event with `orderId`. | `npm --prefix server test -- -t "OrdersService shipped outbox"` | `outbox_events` table contains pending `CREATE_CONSIGNMENT` row. | `NOT_STARTED` |
| **B-ORD-08** | Order transition to `delivered` credits loyalty points | Integration | **P1** | Transitioning status to `'delivered'` awards loyalty points to customer based on `settings.pointsEarnRate` and logs SMS alert. | `npm --prefix server test -- -t "OrdersService delivered loyalty"` | Customer loyalty balance increased; loyalty history entry logged; SMS outbox row created. | `NOT_STARTED` |
| **B-ORD-09** | Invoice PDF generation and authorization | Integration / PDFKit | **P1** | Generates valid PDF buffer containing order items, delivery charge, VAT, discount, customer details; customer can only download own invoice (IDOR check). | `npm --prefix server test -- -t "InvoicesService.generateInvoicePdf"` | PDF header `%PDF-1.` verified; unauthorized customer request returns 403. | `NOT_STARTED` |

---

### 2.3 `PaymentsModule` (Gateways, IPN & Webhooks)
- **Relevant Source Paths:**
  - Controller: [`server/src/modules/payments/payments.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.controller.ts)
  - Service: [`server/src/modules/payments/payments.service.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts)
  - Store: [`server/src/modules/payments/payments.store.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.store.ts)
- **Existing Test Files:** [`server/src/modules/payments/payments.service.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.spec.ts) (Fails compilation due to missing `PaymentsStore` provider in `Test.createTestingModule`).

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-PAY-01** | Repair test fixture DI dependencies | Test Fixture | **P0** | Add `PaymentsStore` mock provider to `payments.service.spec.ts` test builder. | `npm --prefix server test -- payments.service.spec.ts` | Test suite compiles cleanly and passes 100%. | `NOT_STARTED` |
| **B-PAY-02** | Initiate online payment session (SSLCommerz) | Integration | **P0** | Calls SSLCommerz `/gwprocess/v4/api.php`; creates pending payment record with `session_id`; returns redirect URL. | `npm --prefix server test -- -t "PaymentsService.initiatePayment"` | Payment record created in DB with `status = 'initiated'`; gateway URL returned. | `NOT_STARTED` |
| **B-PAY-03** | Initiate Cash on Delivery (COD) payment | Integration | **P0** | Confirms order with `paymentMethod = 'cod'`, `paymentStatus = 'unpaid'`, `orderStatus = 'confirmed'`. | `npm --prefix server test -- -t "PaymentsService.initiatePayment COD"` | Payment record created; order marked confirmed; no gateway redirect needed. | `NOT_STARTED` |
| **B-PAY-04** | Valid IPN webhook confirmation with dual signature check | Integration | **P0** | IPN payload with valid MD5 / SHA-256 HMAC signature and matching order amount sets payment `status = 'completed'`, order `paymentStatus = 'paid'`. | `npm --prefix server test -- -t "PaymentsService.handleIpn valid"` | Payment status updated to `completed`; order payment status updated to `paid`. | `NOT_STARTED` |
| **B-PAY-05** | IPN amount tampering attack detection | Security / Integration | **P0** | Order amount = 1000.00 BDT; IPN payload reports `amount = 10.00 BDT` with valid signature. System detects mismatch (`> 0.01 BDT`) and marks payment `failed`. | `npm --prefix server test -- -t "PaymentsService.handleIpn amount mismatch"` | Transaction rejected; order status remains `unpaid`; security alert logged. | `NOT_STARTED` |
| **B-PAY-06** | Invalid IPN signature rejection | Security / Integration | **P0** | Webhook payload with forged or invalid signature is rejected. Order remains unpaid. | `npm --prefix server test -- -t "PaymentsService.handleIpn invalid signature"` | Returns false or throws error; zero state mutations to order. | `NOT_STARTED` |
| **B-PAY-07** | Duplicate IPN webhook replay idempotency | Integration | **P1** | Receiving duplicate IPN for already completed payment returns 200 OK without re-triggering outbox events or loyalty points. | `npm --prefix server test -- -t "PaymentsService.handleIpn duplicate"` | Idempotent response; no duplicate side effects. | `NOT_STARTED` |
| **B-PAY-08** | Stale payment auto-recovery on retry | Integration | **P1** | User initiates payment, closes gateway tab, returns 15m later and initiates new payment. Previous initiated payment marked `failed`; new session created. | `npm --prefix server test -- -t "PaymentsService stale payment"` | Previous stale payment marked `failed`; new valid payment created. | `NOT_STARTED` |

---

### 2.4 `CartModule` (Cart, Concurrency & Abandonment)
- **Relevant Source Paths:**
  - Controller: [`server/src/modules/cart/cart.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.controller.ts)
  - Service: [`server/src/modules/cart/cart.service.ts`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.service.ts)
  - Store: [`server/src/modules/cart/cart.store.ts`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.store.ts)
  - Processor: [`server/src/modules/cart/abandoned-cart.processor.ts`](file:///home/trroyel/gramoz/server/src/modules/cart/abandoned-cart.processor.ts)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-CRT-01** | Add item to cart (standard product & variant) | Unit / API | **P1** | Adds item; associates variant attributes; returns updated cart items with computed subtotals. | `npm --prefix server test -- -t "CartService.addItem"` | Item exists in cart with correct `productId`, `variantId`, and `quantity`. | `NOT_STARTED` |
| **B-CRT-02** | Concurrent duplicate item addition race condition | Integration / Concurrency | **P0** | Two simultaneous "Add to Cart" requests for same user and product/variant execute atomic upsert (`ON CONFLICT DO UPDATE`). | `npm --prefix server test -- -t "CartStore concurrency"` | Exactly 1 database row exists in `cart_items` with `quantity = initial + added`. | `NOT_STARTED` |
| **B-CRT-03** | Update cart item quantity & quantity = 0 removal | Unit / API | **P1** | Updating quantity updates row; setting `quantity <= 0` removes item from cart. | `npm --prefix server test -- -t "CartService.updateItemQuantity"` | Quantity updated or row deleted. | `NOT_STARTED` |
| **B-CRT-04** | Abandoned cart processor cron worker | Integration / Processor | **P2** | Background worker scans carts unmodified for `storeSettings.abandonedCartIdleHours`; aggregates items; triggers email alert. | `npm --prefix server test -- -t "AbandonedCartProcessor"` | Sends reminder email to user; marks reminder timestamp to prevent spam. | `NOT_STARTED` |

---

### 2.5 `ProductsModule` & `CategoriesModule` (Catalog, Variants & Cache)
- **Relevant Source Paths:**
  - Controllers: [`products.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/products/products.controller.ts), [`categories.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/categories/categories.controller.ts)
  - Services: [`products.service.ts`](file:///home/trroyel/gramoz/server/src/modules/products/products.service.ts), [`categories.service.ts`](file:///home/trroyel/gramoz/server/src/modules/categories/categories.service.ts)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-PRD-01** | Create product with multiple variants and images | Integration | **P1** | Admin creates product with SKU, variants, price; inserts product and `product_variants` in database; creates audit log. | `npm --prefix server test -- -t "ProductsService.create"` | Product and variant rows created with matching `product_id`. | `NOT_STARTED` |
| **B-PRD-02** | Product detail lookup caches in Redis | Integration / Cache | **P1** | `GET /products/:id` caches product data in Redis under `product:<id>` with 300s TTL; subsequent request served from Redis. | `npm --prefix server test -- -t "ProductsService.findOne cached"` | Second request does not execute SQL query; served from Redis. | `NOT_STARTED` |
| **B-PRD-03** | Product update/delete invalidates Redis cache | Integration / Cache | **P1** | Updating or soft-deleting product deletes `product:<id>` key in Redis. | `npm --prefix server test -- -t "ProductsService.update invalidates"` | Redis cache key removed immediately on mutation. | `NOT_STARTED` |
| **B-PRD-04** | Soft delete semantics | Integration | **P1** | `DELETE /products/:id` sets `deletedAt = NOW()` and `status = 'archived'`. Historical order items retain foreign key integrity. | `npm --prefix server test -- -t "ProductsService.remove"` | Product marked archived; catalog queries exclude deleted product. | `NOT_STARTED` |
| **B-PRD-05** | Category tree hierarchy and slug generation | Unit / Integration | **P2** | Creates parent and child categories; generates unique URL slugs; prevents circular parent assignment. | `npm --prefix server test -- -t "CategoriesService"` | Hierarchy structured correctly; slugs URL-safe and unique. | `NOT_STARTED` |

---

### 2.6 `PromosModule` & `LoyaltyModule` (Discounts & Rewards)
- **Relevant Source Paths:**
  - Controllers: [`promos.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/promos/controllers/promos/promos.controller.ts), [`promos-admin.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/promos/controllers/promos-admin/promos-admin.controller.ts), [`loyalty.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/loyalty/loyalty.controller.ts)
  - Services: [`promos.service.ts`](file:///home/trroyel/gramoz/server/src/modules/promos/promos.service.ts), [`loyalty.service.ts`](file:///home/trroyel/gramoz/server/src/modules/loyalty/loyalty.service.ts)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-PRM-01** | Promo code validation: percentage & fixed discount math | Unit | **P1** | Percentage discount calculates `(total * percent) / 100` up to `maxDiscountAmount`; fixed discount deducts exact amount. | `npm --prefix server test -- -t "PromosService.validatePromo"` | Math rounded to 2 decimal places in cents; discount capped at maximum. | `NOT_STARTED` |
| **B-PRM-02** | Promo code validation: minimum spend threshold | Unit | **P1** | Cart total below `minOrderAmount` rejects promo with HTTP 400 ("Minimum order amount not met"). | `npm --prefix server test -- -t "PromosService minOrderAmount"` | Returns 400 Bad Request; discount = 0. | `NOT_STARTED` |
| **B-PRM-03** | Promo code validation: expiration date | Unit | **P1** | Promo with `expiresAt < NOW()` is rejected with HTTP 400 ("Promo code expired"). | `npm --prefix server test -- -t "PromosService expired"` | Returns 400 Bad Request. | `NOT_STARTED` |
| **B-PRM-04** | Atomic promo usage quota race condition | Integration / Concurrency | **P0** | Coupon has `maxUses = 1`, `currentUses = 0`. Two users checkout simultaneously. Exactly one succeeds in applying promo; second pays full price. | `npm --prefix server test -- -t "PromosService quota concurrency"` | `currentUses` = 1; zero quota overselling. | `NOT_STARTED` |
| **B-LOY-01** | Loyalty points redemption calculation | Unit | **P1** | Converts customer points to currency using configured `pointsToCurrencyRatio`; prevents points redemption exceeding subtotal. | `npm --prefix server test -- -t "LoyaltyService.calculateRedemption"` | Converted value matches exact ratio; remaining order total ≥ 0. | `NOT_STARTED` |
| **B-LOY-02** | Atomic loyalty points debit & refund | Integration | **P0** | Checkout atomically debits customer points balance; order cancellation restores debited points. | `npm --prefix server test -- -t "LoyaltyService.deductAndRefund"` | Balance reflects exact point deductions and additions; zero negative balances. | `NOT_STARTED` |

---

### 2.7 `RefundsModule`, `ReviewsModule` & `WishlistsModule`
- **Relevant Source Paths:**
  - Controllers: [`refunds.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.controller.ts), [`reviews.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/reviews/reviews.controller.ts), [`wishlists.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/wishlists/wishlists.controller.ts)
  - Services: [`refunds.service.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.ts), [`reviews.service.ts`](file:///home/trroyel/gramoz/server/src/modules/reviews/reviews.service.ts), [`wishlists.service.ts`](file:///home/trroyel/gramoz/server/src/modules/wishlists/wishlists.service.ts)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-REF-01** | Customer refund request validation | Unit / API | **P1** | Customer can only request refund for their own delivered order; refund amount cannot exceed order total; only 1 active refund per order. | `npm --prefix server test -- -t "RefundsService.requestRefund"` | Rejects non-delivered orders, excessive amounts, or duplicate requests with 400. | `NOT_STARTED` |
| **B-REF-02** | Admin approve refund & atomic stock restoration | Integration | **P0** | Admin marks refund `status = 'processed'`. In atomic transaction: sets refund `processed`, sets payment `refunded`, sets order `refunded`, increments stock, logs inventory audit. | `npm --prefix server test -- -t "RefundsService.processRefund"` | All status columns synchronized; stock restored to warehouse. | `NOT_STARTED` |
| **B-REV-01** | Review submission verified purchase gate | Unit / API | **P1** | Customer can only review products from delivered orders they purchased; enforces unique index `(userId, productId, orderId)`. | `npm --prefix server test -- -t "ReviewsService.create"` | Non-purchasers rejected; duplicate reviews for same order rejected. | `NOT_STARTED` |
| **B-REV-02** | Review moderation & rating aggregate recalculation | Integration | **P2** | Admin approves review (`status = 'approved'`); updates product `rating_avg` and `rating_count`. | `npm --prefix server test -- -t "ReviewsService.approve"` | Only approved reviews visible to public; average rating updated correctly. | `NOT_STARTED` |
| **B-WSH-01** | Wishlist item add, deduplication & removal | Unit / API | **P2** | Adding duplicate product to wishlist is idempotent; removal deletes row. | `npm --prefix server test -- -t "WishlistsService"` | Idempotent add; clean delete. | `NOT_STARTED` |

---

### 2.8 `CourierModule`, `NotificationsModule` & `StorageModule`
- **Relevant Source Paths:**
  - Controllers: [`courier.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/courier/courier.controller.ts), [`admin-courier.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/courier/admin-courier.controller.ts)
  - Services: [`courier.service.ts`](file:///home/trroyel/gramoz/server/src/modules/courier/courier.service.ts), [`mail.service.ts`](file:///home/trroyel/gramoz/server/src/modules/notifications/mail.service.ts), [`sms.service.ts`](file:///home/trroyel/gramoz/server/src/modules/notifications/sms.service.ts), [`storage.service.ts`](file:///home/trroyel/gramoz/server/src/modules/storage/storage.service.ts)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-COU-01** | Delivery charge calculation by weight & zone | Unit | **P1** | Computes fee based on `zoneId`, `deliveryMethod` (home vs branch), and `weightKg`. | `npm --prefix server test -- -t "CourierService.calculateCharge"` | Exact rate calculated from shipping zone table. | `NOT_STARTED` |
| **B-COU-02** | Steadfast consignment creation & mock tracking | Integration | **P1** | In mock mode, generates simulated vehicle coordinates based on destination lat/long; in live mode, calls Steadfast API. | `npm --prefix server test -- -t "CourierService.createOrder"` | Returns valid `consignmentId` and `trackingUrl`. | `NOT_STARTED` |
| **B-NOT-01** | SMS sending via BulkSMSBD with fallback | Integration | **P1** | Formats Bangladeshi phone numbers (`8801...`); calls BulkSMSBD API; handles gateway timeouts gracefully without crashing caller. | `npm --prefix server test -- -t "SmsService.sendSms"` | Dispatches SMS; logs failure if external API returns error. | `NOT_STARTED` |
| **B-NOT-02** | Email sending via Resend API | Integration | **P1** | Compiles HTML templates (order receipt, verification code, password reset); calls Resend SDK. | `npm --prefix server test -- -t "MailService.sendEmail"` | Email dispatched with valid HTML body. | `NOT_STARTED` |
| **B-STR-01** | File upload to Cloudflare R2 / S3 | Integration | **P1** | Uploads image stream to Cloudflare R2; validates mimetype (`image/jpeg`, `image/png`, `image/webp`); rejects files > 5MB. | `npm --prefix server test -- -t "StorageService.upload"` | File uploaded to S3 bucket; public CDN URL returned. | `NOT_STARTED` |

---

### 2.9 `DatabaseModule`, Migrations & `RedisModule` (Infrastructure)
- **Relevant Source Paths:**
  - Schema: [`server/src/database/schema/index.ts`](file:///home/trroyel/gramoz/server/src/database/schema/index.ts)
  - Migrations: `server/drizzle/migrations/*.sql`
  - Redis: [`server/src/cache/redis.service.ts`](file:///home/trroyel/gramoz/server/src/cache/redis.service.ts)
  - Outbox: [`server/src/modules/orders/outbox.processor.ts`](file:///home/trroyel/gramoz/server/src/modules/orders/outbox.processor.ts)

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **B-DB-01** | Migration clean execution from baseline | Migration / Integration | **P0** | Executes all migrations `0000` through `0017` on clean PostgreSQL instance without aborts. | `npm --prefix server run db:migrate` | Migrations execute with exit code 0; all 20 tables exist with indexes. | `NOT_STARTED` |
| **B-DB-02** | Migration `0013` constraint drop fix | Migration / Integration | **P0** | Migration `0013` uses `ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS` instead of raw `DROP INDEX`. | `npm --prefix server run db:migrate` | No `cannot drop index ... because constraint requires it` errors. | `NOT_STARTED` |
| **B-DB-03** | Outbox polling concurrency (`FOR UPDATE SKIP LOCKED`) | Concurrency / Worker | **P0** | Two parallel outbox processor workers execute polling query simultaneously. | `npm --prefix server test -- -t "OutboxProcessor concurrency"` | Exactly 0 duplicate event claims; each worker claims distinct event IDs. | `NOT_STARTED` |
| **B-DB-04** | Outbox max attempt retry & failure dead-lettering | Integration | **P1** | Failing job increments `attempts`; after 3 failures, status marked `'failed'` with `last_error` recorded. | `npm --prefix server test -- -t "OutboxProcessor retry"` | Job stopped from infinite retries; error logged in database. | `NOT_STARTED` |
| **B-CFG-01** | Production boot assertion on fallback secrets | Startup / Security | **P0** | In production mode (`NODE_ENV=production`), server terminates with fatal error if `AUTH_JWT_SECRET === 'secret'` or `SSLCOMMERZ_STORE_SECRET === 'testpass'`. | `npm --prefix server test -- -t "ConfigService production boot"` | Server process terminates immediately with exit code 1. | `NOT_STARTED` |
