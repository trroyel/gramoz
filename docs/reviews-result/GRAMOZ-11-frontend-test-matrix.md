# GRAMOZ-11: Frontend Comprehensive Test Matrix

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Principal Software Engineer & Staff Frontend QA Architect  
**Scope:** Complete Coverage Matrix for Next.js 16 Web Application (40 Routes, 29 Components, 3 Zustand Stores, 16 API Clients, Edge Proxy)  
**Date:** October 2026  
**Status:** AUDITED MASTER INVENTORY  

---

## 1. Frontend Architecture Inventory Overview

The Gramoz frontend is built with **Next.js 16.2.3** (App Router) and React 19. The testable surface consists of:
- **40 Route Pages & Layouts** under `web/src/app`
- **29 Reusable Components** under `web/src/components`
- **3 Zustand Stores** under `web/src/stores`
- **16 API Client Modules** under `web/src/lib/api`
- **1 Core HTTP Client** with token refresh queues under `web/src/lib/http-clients.ts`
- **1 Edge Proxy Guard** under `web/src/proxy.ts`

**Current Test Status:** **0% Coverage**. No testing dependencies or test scripts exist in `web/package.json`.

---

## 2. Exhaustive Frontend Component & Feature Test Matrix

### 2.1 State Management (Zustand Stores)
- **Relevant Source Paths:**
  - Cart Store: [`web/src/stores/cart-store.ts`](file:///home/trroyel/gramoz/web/src/stores/cart-store.ts)
  - Auth Store: [`web/src/stores/auth-store.ts`](file:///home/trroyel/gramoz/web/src/stores/auth-store.ts)
  - Wishlist Store: [`web/src/stores/wishlist-store.ts`](file:///home/trroyel/gramoz/web/src/stores/wishlist-store.ts)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-STR-01** | `cart-store`: Add item and variant calculation | Unit / Store | **P0** | Adds item; updates `subtotal` by multiplying `price * quantity`; computes correct decimal sum. | `npm --prefix web test -- cart-store.spec.ts` | Subtotal matches expected sum; item quantity increments correctly. | `NOT_STARTED` |
| **F-STR-02** | `cart-store`: Quantity increment, decrement & auto-removal | Unit / Store | **P0** | Decrementing quantity below 1 removes item from `items` array and recalculates subtotal. | `npm --prefix web test -- cart-store.spec.ts` | Item removed when quantity reaches 0; subtotal updated. | `NOT_STARTED` |
| **F-STR-03** | `cart-store`: Promo code application math | Unit / Store | **P0** | Applies percentage or fixed promo; computes `discountAmount`; updates total; caps discount at max limit. | `npm --prefix web test -- cart-store.spec.ts` | Discount deducted from total; total never drops below 0. | `NOT_STARTED` |
| **F-STR-04** | `cart-store`: LocalStorage persistence & hydration | Unit / Store | **P1** | Cart items serialize to `localStorage`; rehydrates on app mount without corrupting state. | `npm --prefix web test -- cart-store.spec.ts` | Cart contents persist across page reloads. | `NOT_STARTED` |
| **F-STR-05** | `auth-store`: Login, session state & role storage | Unit / Store | **P1** | Sets `isAuthenticated = true` and `user` object on login; clears state on logout. | `npm --prefix web test -- auth-store.spec.ts` | State properly updated; logout resets user to null. | `NOT_STARTED` |
| **F-STR-06** | `wishlist-store`: Add, remove & deduplication | Unit / Store | **P2** | Toggles item in wishlist; prevents duplicate entries for the same `productId`. | `npm --prefix web test -- wishlist-store.spec.ts` | Wishlist array contains unique IDs only. | `NOT_STARTED` |

---

### 2.2 Core HTTP Client & API Resiliency
- **Relevant Source Paths:**
  - HTTP Client: [`web/src/lib/http-clients.ts`](file:///home/trroyel/gramoz/web/src/lib/http-clients.ts)
  - API Modules: `web/src/lib/api/*.ts`
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-NET-01** | Concurrent 401 Unauthorized token refresh deduplication | Unit / Network | **P0** | When 3 simultaneous API requests receive HTTP 401, only 1 calls `POST /auth/refresh`; other 2 subscribe to queue. | `npm --prefix web test -- http-clients.spec.ts` | Exactly 1 refresh request dispatched; all 3 original requests replayed after refresh. | `NOT_STARTED` |
| **F-NET-02** | Refresh failure redirects to `/login` | Unit / Network | **P0** | If `POST /auth/refresh` fails with 401, clears auth store, triggers logout, and redirects to `/login`. | `npm --prefix web test -- http-clients.spec.ts` | Subscriber queue rejected; window redirected to login page. | `NOT_STARTED` |
| **F-NET-03** | Stream body retry protection | Unit / Network | **P1** | If a request with a stream body (e.g. file upload `FormData`) receives 401, client surfaces notification rather than crashing. | `npm --prefix web test -- http-clients.spec.ts` | Surfaces user-friendly notification: "Session refreshed. Please try again." | `NOT_STARTED` |

---

### 2.3 Form Validation & Interactive Components
- **Relevant Source Paths:**
  - Auth Forms: [`login-form.tsx`](file:///home/trroyel/gramoz/web/src/components/auth/login-form.tsx), [`register-form.tsx`](file:///home/trroyel/gramoz/web/src/components/auth/register-form.tsx), [`phone-verification-modal.tsx`](file:///home/trroyel/gramoz/web/src/components/auth/phone-verification-modal.tsx)
  - Product Form: [`create-product-form.tsx`](file:///home/trroyel/gramoz/web/src/components/products/create-product-form.tsx)
  - Refund Modal: [`refund-request-modal.tsx`](file:///home/trroyel/gramoz/web/src/components/refunds/refund-request-modal.tsx)
  - Review Modal: [`review-form-modal.tsx`](file:///home/trroyel/gramoz/web/src/components/reviews/review-form-modal.tsx)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-FRM-01** | `login-form`: Client-side validation & error display | Component | **P1** | Submitting empty fields displays validation errors; invalid email format shows error; submit button disabled while loading. | `npm --prefix web test -- login-form.spec.tsx` | Error messages rendered in DOM; button shows loading spinner during request. | `NOT_STARTED` |
| **F-FRM-02** | `register-form`: Password strength & mismatch validation | Component | **P1** | Checks minimum 8 characters; displays error if passwords do not match. | `npm --prefix web test -- register-form.spec.tsx` | Form submission blocked until passwords match. | `NOT_STARTED` |
| **F-FRM-03** | `phone-verification-modal`: OTP countdown timer & resend | Component | **P0** | Displays 10-minute countdown; disables "Resend" button until countdown expires; accepts 6 digits only. | `npm --prefix web test -- phone-verification-modal.spec.tsx` | Input sanitized to digits only; resend button disabled during active timer. | `NOT_STARTED` |
| **F-FRM-04** | `create-product-form`: Multi-variant dynamic matrix | Component | **P1** | Allows adding variant combinations (Color/Size); validates price and stock per variant; handles image upload list. | `npm --prefix web test -- create-product-form.spec.tsx` | Renders dynamic variant rows; requires price and stock on each variant. | `NOT_STARTED` |
| **F-FRM-05** | `refund-request-modal`: Reason selection & image attachment | Component | **P1** | Validates refund reason dropdown, comment text, and optional photo upload; blocks submission if reason is empty. | `npm --prefix web test -- refund-request-modal.spec.tsx` | Submit button disabled until required fields are filled. | `NOT_STARTED` |
| **F-FRM-06** | `review-form-modal`: Star rating selection & validation | Component | **P2** | Interactive 1-5 star selector; validates rating > 0 and comment length; submits payload to review API. | `npm --prefix web test -- review-form-modal.spec.tsx` | Star click updates state; submission blocked if rating = 0. | `NOT_STARTED` |

---

### 2.4 Storefront, Catalog & Cart Pages
- **Relevant Source Paths:**
  - Catalog: [`(shop)/products/page.tsx`](file:///home/trroyel/gramoz/web/src/app/(shop)/products/page.tsx), [`products/[id]/page.tsx`](file:///home/trroyel/gramoz/web/src/app/(shop)/products/[id]/page.tsx)
  - Cart: [`(shop)/cart/page.tsx`](file:///home/trroyel/gramoz/web/src/app/(shop)/cart/page.tsx)
  - Offers: [`(shop)/offers/page.tsx`](file:///home/trroyel/gramoz/web/src/app/(shop)/offers/page.tsx)
  - Filters: [`product-filters.tsx`](file:///home/trroyel/gramoz/web/src/components/products/product-filters.tsx)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-CAT-01** | Product catalog listing, category filter & search | Component / Page | **P1** | Displays product grid; selecting category filters list; typing search query debounces and updates results. | `npm --prefix web test -- catalog.spec.tsx` | Filters update product list; search query reflected in URL params. | `NOT_STARTED` |
| **F-CAT-02** | Product detail page: variant selection updates price & stock | Component / Page | **P0** | Selecting variant attribute (e.g. Size: "XL", Color: "Black") updates displayed price, SKU, and available stock. | `npm --prefix web test -- product-detail.spec.tsx` | Price changes dynamically; "Add to Cart" disabled if variant stock = 0. | `NOT_STARTED` |
| **F-CAT-03** | Cart page: summary, item deletion, checkout CTA | Component / Page | **P0** | Displays line items, unit prices, subtotal; allows quantity adjustments; "Proceed to Checkout" navigates to `/checkout`. | `npm --prefix web test -- cart-page.spec.tsx` | Empty cart shows "Your cart is empty" with link to catalog; checkout button disabled on empty cart. | `NOT_STARTED` |

---

### 2.5 Multi-Step Checkout & Payment Flow Pages
- **Relevant Source Paths:**
  - Checkout: [`(shop)/checkout/page.tsx`](file:///home/trroyel/gramoz/web/src/app/(shop)/checkout/page.tsx)
  - Callbacks: `/checkout/success/page.tsx`, `/checkout/fail/page.tsx`, `/checkout/cancel/page.tsx`
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-CHK-01** | Shipping address selection vs new address form | Component / Page | **P0** | Selecting existing address populates delivery fields; selecting "Use a different address" mounts location picker. | `npm --prefix web test -- checkout-page.spec.tsx` | Active address highlighted; coordinates captured on new address selection. | `NOT_STARTED` |
| **F-CHK-02** | Real-time delivery charge calculation on zone selection | Component / Page | **P0** | Changing division/district/zone triggers `courierApi.calculateCharge`; delivery fee added to order total. | `npm --prefix web test -- checkout-page.spec.tsx` | Total updates immediately: `total = subtotal - promo - loyalty + delivery`. | `NOT_STARTED` |
| **F-CHK-03** | Loyalty rewards slider toggle & total deduction | Component / Page | **P1** | Toggling loyalty points switch applies points value up to allowable order total; updates order breakdown. | `npm --prefix web test -- checkout-page.spec.tsx` | Loyalty discount line item displayed; total reduced accordingly. | `NOT_STARTED` |
| **F-CHK-04** | Payment method selection (SSLCommerz vs COD) | Component / Page | **P0** | Selecting bKash/Nagad/Cards sets method to `sslcommerz` and prepares gateway redirect; selecting COD sets method to `cod`. | `npm --prefix web test -- checkout-page.spec.tsx` | Correct method passed to `paymentsApi.initiate`. | `NOT_STARTED` |
| **F-CHK-05** | Phone verification interceptor on checkout submit | Component / Page | **P0** | If checkout API returns "Phone number verification is required", opens `PhoneVerificationModal` without losing form state. | `npm --prefix web test -- checkout-page.spec.tsx` | Modal rendered; checkout re-submits automatically upon OTP success. | `NOT_STARTED` |
| **F-CHK-06** | Checkout success, failure & cancel callback pages | Component / Page | **P1** | `/checkout/success` renders order confirmation and invoice button; `/checkout/fail` renders retry button. | `npm --prefix web test -- checkout-callbacks.spec.tsx` | Proper status cards rendered with clear user recovery actions. | `NOT_STARTED` |

---

### 2.6 Customer Dashboard & Order Tracking
- **Relevant Source Paths:**
  - Dashboard: `web/src/app/dashboard/**/*.page.tsx`
  - Tracking: [`track/page.tsx`](file:///home/trroyel/gramoz/web/src/app/track/page.tsx), [`tracking-map.tsx`](file:///home/trroyel/gramoz/web/src/components/tracking/tracking-map.tsx)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-DSH-01** | Order history listing & status badges | Component / Page | **P1** | Displays customer orders with status badges (`pending`, `confirmed`, `shipped`, `delivered`, `cancelled`). | `npm --prefix web test -- dashboard-orders.spec.tsx` | Correct badge colors rendered; clicking order navigates to order detail. | `NOT_STARTED` |
| **F-DSH-02** | Customer order detail & invoice download | Component / Page | **P1** | Displays line items, payment status, timeline; "Download Invoice" triggers PDF blob download. | `npm --prefix web test -- dashboard-order-detail.spec.tsx` | Triggers browser download without error. | `NOT_STARTED` |
| **F-TRK-01** | Live shipment tracking page & waypoint milestones | Component / Page | **P2** | Entering tracking code fetches status; renders milestone stepper and Leaflet map placeholder with shipment coordinates. | `npm --prefix web test -- track-page.spec.tsx` | Renders courier milestones (Pickup -> Transit -> Out for Delivery -> Delivered). | `NOT_STARTED` |

---

### 2.7 Administrative Backoffice Portal (`/admin/*`)
- **Relevant Source Paths:**
  - Layout: [`web/src/app/admin/layout.tsx`](file:///home/trroyel/gramoz/web/src/app/admin/layout.tsx)
  - Pages: `web/src/app/admin/**/*.page.tsx`
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-ADM-01** | Admin layout authorization guard | Component / Layout | **P0** | Non-platform users redirect to `/`; unauthenticated users redirect to `/login`. | `npm --prefix web test -- admin-layout.spec.tsx` | Unauthorized users blocked from mounting admin sidebar and pages. | `NOT_STARTED` |
| **F-ADM-02** | Order management: status updates & bulk courier dispatch | Component / Page | **P0** | Admin can update order status; marking `shipped` sends outbox consignment; prints packing slips. | `npm --prefix web test -- admin-orders.spec.tsx` | Status change triggers API call; UI displays success toast. | `NOT_STARTED` |
| **F-ADM-03** | Product catalog management: CRUD operations | Component / Page | **P1** | Admin can create, edit, and archive products; manages variant SKU stock levels. | `npm --prefix web test -- admin-products.spec.tsx` | Form submission sends multipart request; table refreshes. | `NOT_STARTED` |
| **F-ADM-04** | Refund request approval & rejection | Component / Page | **P0** | Admin reviews customer refund requests; clicking "Approve" triggers `POST /refunds/admin/:id/process`. | `npm --prefix web test -- admin-refunds.spec.tsx` | Status updates to processed; inventory and payment refund confirmed. | `NOT_STARTED` |
| **F-ADM-05** | Promo code creation & quota management | Component / Page | **P1** | Admin creates coupon with percentage/fixed discount, expiration, and `maxUses`. | `npm --prefix web test -- admin-promos.spec.tsx` | Created promo appears in table with active quota. | `NOT_STARTED` |

---

### 2.8 Edge Proxy Guard (`web/src/proxy.ts`)
- **Relevant Source Paths:** [`web/src/proxy.ts`](file:///home/trroyel/gramoz/web/src/proxy.ts)
- **Existing Test Files:** `None`

| Scenario ID | Test Scenario | Test Type | Priority | Expected Behavior | Verification Command | Acceptance Criteria | Status |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| **F-PRX-01** | Edge proxy redirects unauthenticated requests | Edge / Unit | **P0** | Visiting `/admin` or `/dashboard` without `access_token` cookie returns `HTTP 307` redirect to `/login?redirect=...`. | `npm --prefix web test -- proxy.spec.ts` | Redirect location contains requested path as redirect parameter. | `NOT_STARTED` |
| **F-PRX-02** | Edge proxy role verification for `/admin` | Edge / Unit | **P0** | Authenticated customer with role `customer` visiting `/admin` is rejected and redirected to `/`. | `npm --prefix web test -- proxy.spec.ts` | Non-admin users cannot access admin route bundles. | `NOT_STARTED` |
| **F-PRX-03** | Edge proxy redirects logged-in user away from auth pages | Edge / Unit | **P1** | Authenticated user visiting `/login` or `/register` is redirected to `/dashboard`. | `npm --prefix web test -- proxy.spec.ts` | Prevents redundant login for active sessions. | `NOT_STARTED` |
