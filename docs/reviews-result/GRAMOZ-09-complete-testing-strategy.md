# GRAMOZ-09: Complete Production Testing Strategy & QA Architecture

**Project:** Gramoz E-Commerce Platform  
**Authors:** Principal Software Engineer, Staff QA Architect, Production Reliability Engineer  
**Scope:** Full-Stack Testing Philosophy, Multi-Layer Architecture, Test Tooling, Coverage Gates, and Operational Verification  
**Date:** October 2026  
**Status:** APPROVED ARCHITECTURAL SPECIFICATION  

---

## 1. Executive Testing Philosophy & Production Readiness Mandate

Gramoz is an end-to-end e-commerce platform servicing real retail customers, warehouse operations, logistics providers (Steadfast), and financial payment gateways (SSLCommerz). In an e-commerce system:
- **A defect in pricing calculation, promo deduction, or stock locking leads directly to financial loss or unfulfillable orders.**
- **A defect in order cancellation or checkout abandonment permanently drains warehouse inventory.**
- **A security defect in authorization or IPN validation allows malicious actors to mark orders as paid or access administrative controls.**

Therefore, testing cannot be restricted to isolated unit mocks or happy-path smoke tests. Every implemented feature, data mutation, boundary condition, and failure mode must be guarded by reliable, deterministic, automated tests before live production deployment.

### 1.1 Core Testing Principles

1. **Source Code is Ground Truth:** Tests must exercise actual repository code, actual schema definitions, and actual endpoint contracts. Never invent fictitious modules or mock away the exact behaviors under test.
2. **Real Infrastructure for Data Integrity:** Database transactions, foreign key cascades, partial indexes, and concurrency predicates (`FOR UPDATE SKIP LOCKED`, atomic `stock = stock - qty WHERE stock >= qty`) cannot be meaningfully tested against in-memory stubs. Integration tests must run against real, ephemeral PostgreSQL 16 and Redis 7 instances.
3. **Deterministic Mocking of External Side Effects:** 3rd-party network integrations (SSLCommerz gateway APIs, Steadfast Courier REST endpoints, BulkSMSBD gateway, Resend email) must be tested with deterministic mock fixtures and simulated failure states (timeouts, invalid signatures, network 500s). No live financial transactions or live SMS messages during automated test runs.
4. **Behavioral & Contract Verification Over Implementation Details:** Test user-observable outcomes and API HTTP contracts. Frontend tests should verify rendered UI states, accessible roles, and user actions; backend tests should verify HTTP status codes, response envelopes, database side effects, and transactional outbox entries.
5. **Zero-Tolerance for Flaky or Weakened Tests:** No tests may be skipped, commented out, or weakened to turn CI green. Tests failing due to outdated mocks or changed dependency injections (such as `orders.service.spec.ts`) must be repaired to reflect active constructor signatures.

---

## 2. Multi-Layer Testing Pyramid Architecture

```
                                      ▲
                                     / \
                                    /   \
                                   / E2E \         Layer 5: Playwright Headless Browser Tests
                                  /-------\        (End-to-End Customer & Admin Journeys)
                                 / Concur- \
                                /   rency   \      Layer 4: Concurrency & Stress Scenarios
                               /-------------\     (Stock Races, Promo Quotas, Outbox Locks)
                              /  API & Auth   \
                             /    Contracts    \   Layer 3: Supertest Fastify API & Security
                            /-------------------\  (RBAC, IDOR, Input Validation Pipes)
                           /     Integration     \
                          /       (Real DB)       \ Layer 2: Testcontainers / Ephemeral DB & Redis
                         /-------------------------\ (Migrations, Transactions, Atomic SQL, Outbox)
                        /       Unit & State        \
                       /         Test Suites         \ Layer 1: Jest (Server) & Vitest (Web)
                      /-------------------------------\ (Services, DTOs, Stores, Reducers, Utils)
```

### Layer 1: Unit & Component Testing
- **Backend Framework:** Jest 29 + `ts-jest` (configured in [`server/package.json`](file:///home/trroyel/gramoz/server/package.json)).
  - **Scope:** Pure business logic, unit price rounding into cents, loyalty points conversion rates, promo code validation logic, input DTO transformation, custom exception filters, and utility functions.
  - **Speed Target:** Entire unit suite executes in `< 15 seconds`.
- **Frontend Framework:** Vitest + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`.
  - **Scope:** Zustand client stores ([`cart-store`](file:///home/trroyel/gramoz/web/src/stores/cart-store.ts), [`auth-store`](file:///home/trroyel/gramoz/web/src/stores/auth-store.ts), [`wishlist-store`](file:///home/trroyel/gramoz/web/src/stores/wishlist-store.ts)), form validation schemas (Zod), formatters (currency, dates), and UI components (buttons, modals, tables, badges).

### Layer 2: Real Database & Ephemeral Service Integration Testing
- **Engine:** Ephemeral PostgreSQL 16 instance running on port `5433` (or spawned via Docker/testcontainers).
- **Scope:**
  - Drizzle ORM queries and repository stores ([`OrdersStore`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.store.ts), [`PaymentsStore`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.store.ts), [`CartStore`](file:///home/trroyel/gramoz/server/src/modules/cart/cart.store.ts), [`UsersStore`](file:///home/trroyel/gramoz/server/src/modules/users/users.store.ts)).
  - Database schema migrations execution from clean baseline through migration `0017` (and newly generated migrations).
  - Explicit rollback testing: verifying that when an order checkout fails on stock exhaustion, created shipping addresses, promo usages, and outbox rows are 100% rolled back.
  - Redis cache operations: TTL expiration, OTP rate limit keys, session invalidation on logout.

### Layer 3: API Contract & Security Testing
- **Engine:** `@nestjs/testing` + `supertest` with NestJS Fastify adapter.
- **Scope:**
  - Global `ValidationPipe` enforcement: verifying payload whitelisting, non-whitelisted property rejection (`forbidNonWhitelisted: true`), and type coercion.
  - Response envelope consistency: validating `{ success: boolean, message: string, data: any }`.
  - Authorization & RBAC: ensuring `GET /orders/admin/all` returns `401 Unauthorized` without a cookie, `403 Forbidden` with a customer cookie, and `200 OK` with an admin cookie.
  - IDOR protection: ensuring Customer A cannot view or download Customer B's order invoice.
  - IPN validation: testing SSLCommerz webhook responses with valid signatures, invalid signatures, tampered amounts, and duplicate transaction IDs.

### Layer 4: Concurrency, Race Conditions & Atomicity Testing
- **Engine:** Custom Node.js asynchronous test runners executing `Promise.all` across parallel worker connections.
- **Critical Invariants Tested:**
  1. **Stock Exhaustion Race:** 10 simultaneous checkout requests attempting to purchase the last 1 remaining inventory unit. Invariant: Exactly 1 succeeds with order confirmation; exactly 9 fail with `InsufficientStockError`; final database stock is exactly 0.
  2. **Cart Addition Race:** Rapid simultaneous clicks on "Add to Cart" for the same product variant. Invariant: Exactly 1 row exists in `cart_items` with aggregated quantity (zero duplicate rows).
  3. **Promo Quota Race:** 5 concurrent users redeeming a coupon with `maxUses = 1` remaining. Invariant: Exactly 1 receives discount; 4 pay full price; promo `currentUses` equals `maxUses`.
  4. **Transactional Outbox Polling:** 2 parallel worker processes executing `@Cron` tick claiming events with `FOR UPDATE SKIP LOCKED`. Invariant: Zero duplicate event claims; each outbox row processed exactly once.

### Layer 5: End-to-End (E2E) Browser Testing
- **Engine:** Playwright (Chromium headless).
- **Scope:** Full-stack user journeys running against a live frontend (`:3000`) and live backend API (`:5000`):
  1. Customer registration, login, and phone OTP modal verification.
  2. Catalog search, category filter, variant selection, and cart persistence.
  3. Full checkout lifecycle: shipping address entry, delivery zone selection, promo code application, loyalty redemption slider, SSLCommerz sandbox payment redirect, simulated success return, and order confirmation receipt.
  4. Admin operations: product creation with variants, order status transition to `shipped`, Steadfast courier consignment generation, tracking map waypoint rendering, and order cancellation restock verification.

---

## 3. Tooling Setup & Configuration Roadmap

### 3.1 Backend Tooling Configuration (`server/`)
- **Current State:** Jest 29 is installed with `ts-jest`. `server/package.json` has scripts `"test"`, `"test:cov"`, `"test:e2e"`. However, tests fail to compile due to broken mock fixtures, and `server/test` has zero `.e2e-spec.ts` files.
- **Remediation Configuration:**
  1. Fix `server/src/modules/orders/orders.service.spec.ts` and `payments.service.spec.ts`.
  2. Update `jest.config.ts` / `server/package.json` to configure test paths:
     - Unit tests: `server/src/**/*.spec.ts`
     - Integration tests: `server/test/integration/**/*.integration-spec.ts`
     - E2E API tests: `server/test/api/**/*.api-spec.ts`
  3. Add testing scripts to `server/package.json`:
     ```json
     "test": "jest --config jest.config.ts --runInBand",
     "test:unit": "jest --testPathPattern=src/.*\\.spec\\.ts$",
     "test:integration": "jest --testPathPattern=test/integration/.*\\.integration-spec\\.ts$ --runInBand",
     "test:api": "jest --testPathPattern=test/api/.*\\.api-spec\\.ts$ --runInBand",
     "test:concurrency": "tsx test/concurrency/run-all.ts",
     "test:cov": "jest --coverage"
     ```

### 3.2 Frontend Tooling Configuration (`web/`)
- **Current State:** Zero test tooling configured in `web/package.json`. No `test` script exists.
- **Required Testing Dependencies for Web:**
  - `vitest`: Ultra-fast test runner compatible with Next.js and Vite.
  - `@testing-library/react` & `@testing-library/dom`: React component testing utilities.
  - `@testing-library/jest-dom`: Custom matchers for DOM assertions (`toBeInTheDocument`, etc.).
  - `jsdom`: Browser environment simulator for Node.js.
  - `@playwright/test`: Cross-browser E2E testing framework.
- **Required Configuration Files:**
  - `web/vitest.config.ts`: Configures Vitest with React plugin, path aliases (`@/*` mapping to `./src/*`), and `jsdom` environment.
  - `web/vitest.setup.ts`: Imports `@testing-library/jest-dom` and mocks Next.js navigation (`useRouter`, `usePathname`, `useSearchParams`).
  - `playwright.config.ts`: Configures base URL `http://localhost:3000`, browser matrix, and test artifacts.
- **Scripts Added to `web/package.json`:**
  ```json
  "test": "vitest run",
  "test:watch": "vitest",
  "test:cov": "vitest run --coverage",
  "test:e2e": "playwright test"
  ```

---

## 4. Measurable Test Coverage Targets & Quality Gates

Rather than chasing vanity metrics, Gramoz establishes **risk-weighted coverage gates**:

| Layer / Component | Minimum Statement Coverage | Minimum Branch Coverage | Invariant Verification Target | Criticality |
| :--- | :---: | :---: | :--- | :---: |
| **Financial & Core Backend Domain** (`orders`, `payments`, `refunds`, `promos`, `loyalty`) | **≥ 85%** | **≥ 80%** | **100%** of identified financial invariants (exact cents rounding, IPN signature, refund limits, promo caps). | **BLOCKER** |
| **Catalog & Cart Services** (`products`, `cart`, `categories`, `courier`) | **≥ 80%** | **≥ 75%** | **100%** of stock deduction & cart deduplication invariants. | **HIGH** |
| **Identity & Access** (`auth`, `users`, `guards`, `strategies`) | **≥ 85%** | **≥ 80%** | **100%** of RBAC, OTP attempt limits, and password reset flows. | **BLOCKER** |
| **Infrastructure & Workers** (`outbox.processor`, `abandoned-cart`, `storage`, `redis`) | **≥ 80%** | **≥ 70%** | 100% outbox event claiming & dead-letter transitions. | **HIGH** |
| **Frontend Stores & Calculations** (`cart-store`, `auth-store`, `validations`, delivery math) | **≥ 85%** | **≥ 80%** | Subtotal, discounts, points conversion, and coupon math verified. | **BLOCKER** |
| **Frontend Form Components & Pages** (`login-form`, `checkout/page`, `orders/page`, etc.) | **≥ 75%** | **≥ 65%** | Error message rendering, button loading states, and submit guards. | **MEDIUM** |
| **E2E Critical User Journeys** | **N/A** | **N/A** | **100% (6/6 journeys)** pass in headless Chromium. | **BLOCKER** |

### Legitimate Exclusions from Numerical Coverage
- Drizzle auto-generated migration files under `server/drizzle/migrations/`.
- Static DTO interface declarations and TypeScript type definitions (`types/index.ts`).
- Leaflet map rendering internals (`tracking-map.tsx`) which require WebGL/Canvas browser context (covered via component presence and mock props).
- Next.js auto-generated `.next` build artifacts.

---

## 5. Automated CI/CD Pipeline & Quality Gate Enforcement

The continuous integration pipeline is designed to enforce quality gates on every Pull Request to `main` or `develop`.

```
[PR Created / Updated]
        |
        v
+-------------------------------------------------------------+
| Stage 1: Static Quality Gate                                |
| - Backend Typecheck & Lint (`npm --prefix server run lint`) |
| - Frontend Typecheck & Lint (`npm --prefix web run lint`)   |
+-------------------------------------------------------------+
        |
        v
+-------------------------------------------------------------+
| Stage 2: Database Migration & Schema Gate                   |
| - Spin up ephemeral PostgreSQL 16 & Redis 7 containers      |
| - Run migrations: `npm --prefix server run db:migrate`       |
| - Verify zero migration syntax or constraint errors          |
+-------------------------------------------------------------+
        |
        v
+-------------------------------------------------------------+
| Stage 3: Automated Test Execution Gate                      |
| - Backend Unit & Integration Tests (`npm test -- --cov`)     |
| - Frontend Unit & Store Tests (`npm --prefix web test`)      |
| - Enforce minimum coverage thresholds (80% domain / stores) |
+-------------------------------------------------------------+
        |
        v
+-------------------------------------------------------------+
| Stage 4: Production Build Verification                      |
| - Backend production build: `npm --prefix server run build`  |
| - Frontend production build: `npm --prefix web run build`    |
+-------------------------------------------------------------+
        |
        v
+-------------------------------------------------------------+
| Stage 5: Playwright End-to-End Regression Gate              |
| - Run 6 release-critical E2E customer & admin journeys       |
+-------------------------------------------------------------+
        |
        v
[Merge Approved & Deployment Unblocked]
```

### Release Blocking Policy
1. If any test fails, PR merge is automatically blocked.
2. If code coverage drops below the required 80% threshold on modified domain files, PR is blocked.
3. If database migrations fail or produce schema diffs against Drizzle schema definitions, PR is blocked.
4. No release to production staging or live environments can occur while any P0 or P1 test task remains in `NOT_STARTED`, `FAILED`, or `BLOCKED` status.
