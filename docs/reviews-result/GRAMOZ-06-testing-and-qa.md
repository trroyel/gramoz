# GRAMOZ-06: Testing Strategy, Quality Assurance & Test Architecture

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Principal QA Architect & Staff Systems Reliability Engineer  
**Scope:** Test Coverage Audit, Root-Cause Failure Triage, Test Architecture Redesign, and E2E Test Matrix  
**Date:** October 2026  
**Status:** Complete Audit  

---

## 1. Current Testing Landscape & Baseline Audit

### 1.1 Test Suite Inventory & Coverage

A comprehensive audit of automated tests across the monorepo reveals:

| Workspace | Test Framework | Existing Spec Files | Passing Tests | Failing Tests | Estimated Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Backend (`server/`)** | Jest 29 + `ts-jest` | 2 files | 0 | 2 suites (100% fail) | **< 4%** |
| **Frontend (`web/`)** | None | 0 files | 0 | 0 | **0%** |
| **End-to-End (E2E)** | None | 0 files | 0 | 0 | **0%** |

---

## 2. Root Cause Triage of Existing Test Failures

Execution of `npm test` on the backend terminates with dependency injection compilation errors in both existing test files:

### 2.1 Failure 1: `server/src/modules/orders/orders.service.spec.ts`
- **Error:**
  ```
  Cannot find module '../auth/mail.service' from 'src/modules/orders/orders.service.spec.ts'
  Nest can't resolve dependencies of OrdersService (OrdersStore, PromosService, LoyaltyService, SettingsService, CourierService).
  ```
- **Root Cause:**
  - `OrdersService` was refactored to delegate data persistence to `OrdersStore` and collaborate with `PromosService`, `LoyaltyService`, and `SettingsService`.
  - The test fixture ([`orders.service.spec.ts:80-108`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.spec.ts#L80-L108)) was never updated to reflect the new constructor dependencies and imports, retaining an obsolete import path for `MailService`.

### 2.2 Failure 2: `server/src/modules/payments/payments.service.spec.ts`
- **Error:**
  ```
  Nest can't resolve dependencies of PaymentsService (ConfigService, ?).
  Please make sure that the argument PaymentsStore at index [1] is available in the RootTestModule module.
  ```
- **Root Cause:**
  - `PaymentsService` constructor was refactored to require `PaymentsStore`.
  - The test factory [`buildService`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.spec.ts#L98-L108) omitted `PaymentsStore` from the `providers` array in `Test.createTestingModule`.

---

## 3. Redesigned Production Test Architecture

To achieve production reliability for a real e-commerce business handling financial transactions, the testing pyramid must be structured into three distinct layers:

```
                              / \
                             /   \
                            / E2E \           Layer 3: Playwright Browser Tests
                           /-------\          (Critical Customer Journeys)
                          / Integ-  \
                         /  ration   \        Layer 2: Testcontainers (PostgreSQL + Redis)
                        /-------------\       (Transactions, Locking, Outbox Worker)
                       /     Unit      \
                      /      Tests      \     Layer 1: Jest / Vitest
                     /-------------------\    (Services, Stores, DTOs, Edge Cases)
```

### Layer 1: Unit Tests (Fast & Isolated)
- **Scope:** Pure business logic, discount calculators, loyalty point conversion, domain error mapping, and input validation schemas.
- **Mocking:** External HTTP APIs (Steadfast, SSLCommerz, BulkSMSBD) and database query builders are mocked using in-memory stubs.
- **Target Execution Time:** < 15 seconds for the entire suite.

### Layer 2: Integration Tests with Real Services (`testcontainers`)
- **Scope:** Drizzle repository queries, SQL constraints, database migrations, atomic stock decrement transactions, and the Transactional Outbox worker.
- **Engine:** Spawns ephemeral PostgreSQL 16 and Redis 7 containers via Docker.
- **Critical Behaviors Verified:**
  - Concurrent stock decrement: 10 parallel threads attempting to purchase 1 remaining stock item; exactly 1 succeeds, 9 fail with `InsufficientStockError`.
  - Outbox claiming: 2 parallel workers executing `FOR UPDATE SKIP LOCKED`; zero duplicate event processing.

### Layer 3: End-to-End (E2E) Tests with Playwright
- **Scope:** Full-stack user journeys running against a live backend and frontend in headless Chromium.
- **Core Scenarios:**
  1. Customer registration -> SMS OTP verification modal -> Profile updated.
  2. Product catalog browsing -> Variant selection (Size/Color) -> Cart state persistence across page refreshes.
  3. Checkout with coupon application -> Delivery zone selection -> Dynamic fee calculation -> Payment gateway redirect -> Simulated success webhook -> Order confirmation screen.
  4. Administrative fulfillment -> Mark shipped -> Consignment created -> Order tracking map renders vehicle waypoints.

---

## 4. Comprehensive E-Commerce QA Test Matrix

### 4.1 Order, Cart & Concurrency Test Matrix

| ID | Module | Scenario / Test Case | Input Conditions | Expected Outcome | Risk Level |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-01** | `Orders` | Concurrent stock exhaustion | Product has stock = 1; User A and User B checkout simultaneously | User A receives Order #, User B receives `InsufficientStockError`; stock = 0 | **CRITICAL** |
| **TC-02** | `Orders` | Order cancellation stock release | Order with 2 items marked `status = 'cancelled'` | Stock increments by 2; `inventory_transactions` logged; promo usage decremented | **CRITICAL** |
| **TC-03** | `Orders` | Unverified phone number checkout | User has `isPhoneVerified = false` calls `POST /orders/checkout` | HTTP 403 Forbidden with `"Phone number verification required"` | **HIGH** |
| **TC-04** | `Cart` | Concurrent duplicate item addition | User rapidly clicks "Add to Cart" 3 times | Exactly 1 cart item exists with `quantity = 3` (no duplicate rows) | **HIGH** |
| **TC-05** | `Promos` | Max usage quota race condition | Promo has `maxUses = 10`, `currentUses = 9`; two users checkout concurrently | Exactly one user gets discount; second user pays full price; `currentUses = 10` | **HIGH** |
| **TC-06** | `Promos` | Expired promo code application | Promo expiration date is in the past | HTTP 400 Bad Request `"Promo code has expired"` | **MEDIUM** |
| **TC-07** | `Loyalty` | Points redemption exceeding order | Customer has 5,000 points (500 BDT); order total is 300 BDT | Points deducted = 3,000; order total = 0 BDT; 2,000 points remain in wallet | **MEDIUM** |

---

### 4.2 Payments & Fraud Test Matrix

| ID | Module | Scenario / Test Case | Input Conditions | Expected Outcome | Risk Level |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-08** | `Payments` | IPN amount tampering attack | Order is 1,000 BDT; IPN payload reports `amount = 10.00 BDT` with valid signature | Transaction rejected; status remains `unpaid`; security warning logged | **CRITICAL** |
| **TC-09** | `Payments` | Duplicate IPN webhook replay | Valid IPN received twice for already-completed payment | Second IPN returns 200 OK without re-triggering order status updates or outbox events | **HIGH** |
| **TC-10** | `Payments` | Invalid HMAC signature | Malicious actor posts forged payload to `/payments/sslcommerz/ipn` | Rejected with HTTP 400 or `"Invalid IPN signature"`; order remains unpaid | **CRITICAL** |
| **TC-11** | `Payments` | Stale payment auto-recovery | Customer starts payment, closes tab, returns 10 mins later and retries | Stale pending payment marked `failed`; new payment initialized successfully | **MEDIUM** |

---

### 4.3 Refunds & Logistics Test Matrix

| ID | Module | Scenario / Test Case | Input Conditions | Expected Outcome | Risk Level |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-12** | `Refunds` | Refund request on non-delivered order | Order status is `shipped` or `pending` | HTTP 400 Bad Request `"Refunds can only be requested for delivered orders"` | **HIGH** |
| **TC-13** | `Refunds` | Refund amount exceeding order total | Order total is 500 BDT; refund requested for 600 BDT | HTTP 400 Bad Request `"Refund amount cannot exceed order total"` | **HIGH** |
| **TC-14** | `Refunds` | Inventory restock on processed refund | Admin approves and marks refund `status = 'processed'` | Product stock increments; payment marked `refunded`; order marked `refunded` | **CRITICAL** |
| **TC-15** | `Courier` | Outbox consignment creation | Outbox worker claims `CREATE_CONSIGNMENT` | Calls Steadfast API; updates order with `consignmentId` and `trackingUrl` | **HIGH** |

---

## 5. Automated CI/CD Quality Pipeline

A complete GitHub Actions workflow configuration (`.github/workflows/ci.yml`) is designed to enforce quality gates on every Pull Request:

```yaml
name: CI Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  validate:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm --prefix server ci
      - run: npm --prefix web ci
      - name: Backend Typecheck & Lint
        run: |
          npm --prefix server run lint
          npm --prefix server run build
      - name: Frontend Typecheck & Build
        run: |
          npm --prefix web run build

  test-backend:
    name: Backend Unit & Integration Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: platform_user
          POSTGRES_PASSWORD: platform_pass
          POSTGRES_DB: platform_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm --prefix server ci
      - name: Run Database Migrations
        run: npm --prefix server run db:migrate
        env:
          DATABASE_URL: postgresql://platform_user:platform_pass@localhost:5432/platform_db
      - name: Run Backend Tests with Coverage
        run: npm --prefix server test -- --coverage
        env:
          DATABASE_URL: postgresql://platform_user:platform_pass@localhost:5432/platform_db
          REDIS_HOST: localhost
          REDIS_PORT: 6379

  test-e2e:
    name: Playwright E2E Tests
    needs: [ validate, test-backend ]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm --prefix web ci
      - name: Install Playwright Browsers
        run: npx playwright install --with-deps chromium
      - name: Run Playwright E2E
        run: npm --prefix web run test:e2e
```

---

## 6. QA Remediation Priority Plan

| Priority | Action Item | Target Component | Success Metric |
| :--- | :--- | :--- | :--- |
| **P0** | Repair broken Jest unit tests | `orders.service.spec.ts`, `payments.service.spec.ts` | `npm test` executes cleanly with 100% passing tests. |
| **P1** | Add Unit Tests for Auth & Cart Services | `auth.service.spec.ts`, `cart.service.spec.ts` | 80%+ branch coverage on authentication and cart logic. |
| **P1** | Implement Playwright E2E Checkout Flow | `web/tests/e2e/checkout.spec.ts` | Automated end-to-end checkout executes on PRs. |
| **P2** | Establish CI/CD Pipeline in GitHub Actions | `.github/workflows/ci.yml` | Pull requests blocked if tests or typechecks fail. |
