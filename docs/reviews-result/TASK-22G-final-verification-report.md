# GRAMOZ — TASK-22G Final Verification Report: P0 SSLCommerz Refund Settlement Contract Verification

**Author:** Principal Payment Systems Engineer, SSLCommerz Integration Specialist, Staff NestJS Engineer, PostgreSQL Concurrency Engineer, Financial Security Auditor  
**Project:** Gramoz E-Commerce Platform  
**Target Architecture:** NestJS 11 (Fastify), Next.js 16, PostgreSQL 16 (Drizzle ORM), Redis 7, SSLCommerz, Steadfast Courier, PostgreSQL Transactional Outbox  
**Deployment Profile:** 1 vCPU / 1 GB RAM (Resource-constrained production baseline)  
**Verification Date:** 2026-10-21  
**Task Status:** `VERIFIED`  
**Priority:** P0 — Financial Settlement Correctness  

---

## 1. Executive Summary

TASK-22G investigated an architectural finding concerning the SSLCommerz payment gateway integration: **the conflation of refund initiation acceptance with authoritative financial settlement.**

In previous iterations (including the TASK-22F verification report and `RefundsService.processRefund`), receiving `status: 'success'` from SSLCommerz's refund initiation endpoint was treated as proof of finalized financial settlement. The system immediately marked:
- `refunds.status = 'processed'`
- `payments.status = 'refunded'`
- `orders.status = 'refunded'`
- Restocked inventory to saleable levels
- Refunded customer loyalty points

However, cross-referencing official SSLCommerz integration documentation and developer specifications confirmed:
1. **Refund Initiation API (`/validator/api/merchantTransIDvalidationAPI.php`):** A response of `status: 'success'` indicates only that the refund request was received, validated, and forwarded to the banking network. It does **not** establish final settlement or actual debit/credit of funds.
2. **Refund Status Inquiry API (`/validator/api/merchantTransIDvalidationAPI.php` with `refund_ref_id`):** Completed financial settlement is indicated **exclusively** by `status: 'refunded'` (along with `APIConnect: 'DONE'`, `refund_ref_id`, `bank_tran_id`, `tran_id`, `initiated_on`, and `refunded_on`).

The finding has been classified as **CONFIRMED P0 ARCHITECTURAL DEFECT**.

Through TASK-22G, we have:
- Replaced the ambiguous initiation mapping: initiation `status: 'success'` transitions the refund to `status: 'processing'` with the captured `refund_ref_id` and **bypasses final settlement**.
- Strictly decoupled financial settlement: `orders`, `payments`, physical inventory, and loyalty points remain unaltered until authoritative settlement confirmation.
- Implemented strict status inquiry contracts in `PaymentsService.queryRefundStatus` validating provider authentication (`APIConnect === 'DONE'`), refund reference ID identity, and original transaction identity (`bank_tran_id` / `tran_id`).
- Implemented authoritative settlement reconciliation in `RefundsService.reconcileRefund` (and admin endpoint `POST /refunds/admin/:id/reconcile`), which finalizes the financial transaction *only* upon receiving `status: 'refunded'`.
- Preserved all prior TASK-22F invariants: atomic short-transaction claims, partial unique constraints (`WHERE status != 'rejected'`), missing variant inventory quarantines, damaged goods exclusion, and canonical row lock hierarchy (`orders` -> `payments` -> `refunds` -> `users`).
- Verified all 12 target regression scenarios (REF-G01 through REF-G12) with real PostgreSQL 16.
- Achieved **692 passing backend tests** across 45 suites (+11 over TASK-22F baseline), **120 passing frontend Vitest tests** across 12 files, and **30 passing Playwright E2E tests**.

---

## 2. Actual Provider Contract (SSLCommerz)

### Official References
- SSLCommerz Integration Documentation: [https://sslcommerz.com/integration-document/](https://sslcommerz.com/integration-document/)
- SSLCommerz Developer Guide v4: [https://developer.sslcommerz.com/doc/v4/index.html](https://developer.sslcommerz.com/doc/v4/index.html)

### Contract Breakdown: Initiation vs Inquiry

| Contract Dimension | Refund Initiation API | Refund Status Inquiry API |
| :--- | :--- | :--- |
| **Endpoint** | `/validator/api/merchantTransIDvalidationAPI.php` | `/validator/api/merchantTransIDvalidationAPI.php` |
| **Key Parameters** | `bank_tran_id`, `refe_id`, `refund_amount`, `refund_remarks` | `refund_ref_id` |
| **Accepted/Success State** | `status: 'success'` (request accepted for processing) | `status: 'refunded'` (cleared by bank/card network) |
| **Pending State** | `status: 'processing'` (queued at bank/gateway) | `status: 'processing'` (clearing in progress) |
| **Rejected/Failed State** | `status: 'failed'` (rejected by gateway) | `status: 'cancelled'` or `status: 'failed'` |
| **Identity Verification** | `APIConnect: 'DONE'`, optional `bank_tran_id` echo | `APIConnect: 'DONE'`, `refund_ref_id`, `bank_tran_id`, `tran_id` |
| **Settlement Timestamp** | N/A | `refunded_on: string` |

---

## 3. Confirmed Vulnerability & Root Cause Analysis

### Vulnerability Classification: CONFIRMED P0 DEFECT
Treating initiation `status: 'success'` as completed settlement introduced a severe financial consistency hazard:
1. **Premature Restocking:** If an online refund request was accepted by the gateway (`status: 'success'`) but subsequently declined by the acquiring bank (e.g., card expired, account frozen, merchant refund balance exhausted), physical inventory had already been returned to saleable stock and spent loyalty points had been re-credited to the customer.
2. **Irreversible Accounting State:** The database recorded `payments.status = 'refunded'` and `orders.status = 'refunded'`, creating phantom settlement records in the merchant ledger before actual monetary transfer occurred.
3. **Ambiguity on Inquiry Success:** An inquiry endpoint returning `status: 'success'` (an initiation-style response rather than the documented `status: 'refunded'`) could be erroneously accepted as settlement.

### Root Cause
1. **Ambiguous Lifecycle Mapping:** `PaymentsService.initiateRefund` returned `{ success: true, status: 'success' }` which `processRefund` interpreted as terminal completion, executing Step 3 (final settlement) immediately.
2. **Missing In-Flight State Invariant:** The platform treated `status = 'processing'` only as an atomic claim guard during external HTTP execution, rather than an in-flight business lifecycle state awaiting settlement confirmation.

---

## 4. Status Mapping Contract

To prevent accidental cross-use, the domain model strictly separates initiation and inquiry response types in TypeScript:

```typescript
// server/src/modules/payments/payments.service.ts

export interface RefundInitiationResult {
  success: boolean;
  status: 'initiated' | 'processing' | 'failed';
  refundRefId?: string;
  bankTranId?: string;
  errorReason?: string;
  rawResponse?: any;
}

export interface RefundInquiryResult {
  success: boolean;
  status:
    | 'refunded'          // Authoritative settlement confirmed
    | 'processing'        // Settlement still in progress
    | 'cancelled'         // Explicitly cancelled by provider
    | 'failed_auth'       // APIConnect !== 'DONE'
    | 'invalid_identity'  // refund_ref_id or bank_tran_id mismatch
    | 'unknown_status'    // Malformed, unexpected, or initiation-style status
    | 'transport_error';  // Network timeout or HTTP 5xx
  refundRefId: string;
  bankTranId?: string;
  tranId?: string;
  initiatedOn?: string;
  refundedOn?: string;
  errorReason?: string;
  rawResponse?: any;
}
```

### 4.1 Initiation Status Mapping
| Provider Payload | APIConnect | Result Status | Result Success | Domain Action |
| :--- | :---: | :---: | :---: | :--- |
| `status: 'success'`, `refund_ref_id: '...'` | `DONE` | `'initiated'` | `true` | Save `gatewayRefundId`, persist `status: 'processing'`. **Zero ledger/inventory alteration.** |
| `status: 'processing'` | `DONE` | `'processing'` | `true` | Persist `status: 'processing'`. Safe for inquiry polling. |
| `status: 'failed'` | Any | `'failed'` | `false` | Transition `status: 'rejected'`. Zero ledger/inventory alteration. |
| Missing `refund_ref_id` on `status: 'success'` | `DONE` | `'failed'` | `false` | Rejection. Unsafe to proceed without provider refund reference. |
| Identity mismatch (`bank_tran_id` != expected) | `DONE` | `'failed'` | `false` | Security rejection. Protects against provider routing corruption. |
| HTTP 502 / Network Timeout | N/A | `'processing'` | `false` | In-flight status preserved for reconciliation. Prevents blind duplicate initiation. |

### 4.2 Status Inquiry Mapping
| Provider Payload | APIConnect | Identity Check | Result Status | Finalization Permitted? | Domain Action |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `status: 'refunded'` | `DONE` | Matched | `'refunded'` | **YES (EXACTLY ONCE)** | Execute canonical settlement: refund `processed`, payment `refunded`, order `refunded`, inventory restocked, loyalty restored. |
| `status: 'processing'` | `DONE` | Matched | `'processing'` | **NO** | Preserve `status: 'processing'`. No ledger changes. |
| `status: 'cancelled'` | `DONE` | Matched | `'cancelled'` | **NO** | Fail closed. Retain `processing` with actionable audit log. |
| `status: 'success'` | `DONE` | Matched | `'unknown_status'` | **NO** | Reject. Initiation-style status is not settlement proof (REF-G04). |
| Unknown / Malformed status | Any | Any | `'unknown_status'` | **NO** | Preserve safe unresolved state. Log security warning. |
| `APIConnect !== 'DONE'` | Any | Any | `'failed_auth'` | **NO** | Authentication failure; fail closed. |
| `refund_ref_id` mismatch | Any | Mismatch | `'invalid_identity'`| **NO** | Cross-tenant reference mismatch rejected. |
| `bank_tran_id` mismatch | Any | Mismatch | `'invalid_identity'`| **NO** | Target payment transaction mismatch rejected. |

---

## 5. Settlement Transaction & Database State Transitions

### Legal State Transitions (Refund Machine)
```
          ┌─────────────┐
          │  requested  │
          └──────┬──────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
  ┌───────────┐     ┌───────────┐
  │ approved  │     │ rejected  │ (Terminal: customer may re-submit with new evidence)
  └─────┬─────┘     └───────────┘
        │
        ▼ (Atomic Claim Short Tx)
  ┌───────────┐
  │processing │ ◄────────────────────────────────────────────────┐
  └─────┬─────┘                                                  │
        │                                                        │
        ├─────────────────────────────┐                          │
        ▼ (Provider Initiation)       ▼ (Initiation Failed)      │
  ┌───────────┐                 ┌───────────┐                    │
  │processing │                 │ rejected  │                    │
  │(ref saved)│                 └───────────┘                    │
  └─────┬─────┘                                                  │
        │                                                        │
        ├─────────────────────────────┬──────────────────────────┤
        ▼ (Inquiry: 'refunded')       ▼ (Inquiry: 'cancelled')   ▼ (Inquiry: 'processing'/timeout)
  ┌───────────┐                 ┌───────────┐             ┌───────────┐
  │ processed │                 │processing │             │processing │
  └───────────┘                 │(audit log)│             │ (pending) │
   (Terminal                     └───────────┘             └───────────┘
   Financial
   Settlement)
```

### Financial Settlement Invariant
Only confirmed settlement (`inquiry.status === 'refunded'` or administrative COD voucher confirmation) triggers:
1. `refunds.status = 'processed'`
2. `payments.status = 'refunded'`
3. `orders.status = 'refunded'`
4. Physical inventory restocking (respecting variant quarantine & damaged goods exclusion)
5. Loyalty points restoration (idempotent ledger adjustment)

---

## 6. Verification Scenarios & Test Evidence

### 6.1 Provider Contract Regression Suite (`REF-G01` – `REF-G12`)

| ID | Specification & Input Conditions | Target Invariant | Real DB / Test Result | Evidence & Test Location |
| :--- | :--- | :--- | :---: | :--- |
| **REF-G01** | Refund initiation returns `status: 'success'` | Refund remains `processing`; reference saved; order/payment untouched | **PASS** | [`sslcommerz-refund.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts), [`refunds.service.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts) |
| **REF-G02** | Refund inquiry returns `status: 'processing'` | No premature finalization; zero stock or loyalty changes | **PASS** | [`sslcommerz-refund.spec.ts:192`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts#L192), [`refunds.service.spec.ts:340`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts#L340) |
| **REF-G03** | Refund inquiry returns `status: 'refunded'` | Exactly 1 finalization; ledger, stock, and loyalty updated; provider reference retained | **PASS** | [`sslcommerz-refund.spec.ts:213`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts#L213), [`refunds.service.spec.ts:355`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts#L355) |
| **REF-G04** | Refund inquiry returns `status: 'success'` | Initiation-style status rejected as settlement; mapped to `unknown_status` | **PASS** | [`sslcommerz-refund.spec.ts:241`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts#L241), [`refunds.service.spec.ts:375`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts#L375) |
| **REF-G05** | Provider returns mismatched `refund_ref_id` | Mismatched reference rejected; status `invalid_identity`; no finalization | **PASS** | [`sslcommerz-refund.spec.ts:264`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts#L264), [`refunds.service.spec.ts:391`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts#L391) |
| **REF-G06** | Provider returns mismatched original `bank_tran_id` | Transaction identity mismatch rejected; status `invalid_identity`; no finalization | **PASS** | [`sslcommerz-refund.spec.ts:289`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts#L289), [`refunds.service.spec.ts:408`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts#L408) |
| **REF-G07** | Provider auth fails (`APIConnect !== 'DONE'`) | Authentication failure rejected; status `failed_auth`; zero state alteration | **PASS** | [`sslcommerz-refund.spec.ts:316`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts#L316), [`refunds.service.spec.ts:424`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts#L424) |
| **REF-G08** | Gateway returns unknown/malformed status | Preserves safe unresolved state (`unknown_status`); logs warning; no finalization | **PASS** | [`sslcommerz-refund.spec.ts:337`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts#L337), [`refunds.service.spec.ts:440`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts#L440) |
| **REF-G09** | Concurrent admin reconciliation race | Exactly 1 logical settlement; 0 duplicate stock or loyalty points | **PASS (Real PG 16)** | [`refunds-concurrency.spec.ts:823`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds-concurrency.spec.ts#L823) |
| **REF-G10** | Node crash between atomic claim and provider response | Atomic claim blocks blind re-initiation; preserved in `processing`; manual/query reconciliation supported | **PASS (Real PG 16)** | [`refunds-concurrency.spec.ts:914`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds-concurrency.spec.ts#L914) |
| **REF-G11** | Customer views processing refund in UI | UI indicates `processing`/amber badge; does not falsely claim completed settlement | **PASS** | [`web/src/lib/api/refunds.spec.ts:50`](file:///home/trroyel/gramoz/web/src/lib/api/refunds.spec.ts#L50), [`web/src/app/dashboard/refunds/page.tsx`](file:///home/trroyel/gramoz/web/src/app/dashboard/refunds/page.tsx) |
| **REF-G12** | Customer views settled refund in UI | Accurate `processed` status with retained gateway reference and settlement timestamp | **PASS** | [`web/src/lib/api/refunds.spec.ts:79`](file:///home/trroyel/gramoz/web/src/lib/api/refunds.spec.ts#L79), [`web/src/app/dashboard/refunds/page.tsx`](file:///home/trroyel/gramoz/web/src/app/dashboard/refunds/page.tsx) |

---

## 7. Modified Files Summary

| File Path | Description of Changes |
| :--- | :--- |
| [`server/src/modules/payments/payments.service.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts) | Exported typed interfaces `RefundInitiationResult` and `RefundInquiryResult`. Updated `initiateRefund` to map `status: 'success'` to `'initiated'`. Updated `queryRefundStatus` to validate `APIConnect`, `refund_ref_id`, `bank_tran_id`/`tran_id`, and strictly map `status: 'refunded'` vs `'processing'` vs `'cancelled'` vs `'unknown_status'`. |
| [`server/src/modules/refunds/refunds.service.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.ts) | Decoupled initiation from settlement: `processRefund` keeps online refunds in `processing` upon initiation. Settlement transaction occurs strictly in `reconcileRefund` (upon inquiry `status: 'refunded'`) or for COD vouchers. Added in-flight guard blocking duplicate processing calls. |
| [`server/src/modules/refunds/refunds.controller.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.controller.ts) | Exposed `POST /refunds/admin/:id/reconcile` with `JwtAuthGuard` and `RolesGuard` for administrative settlement reconciliation. |
| [`server/src/modules/payments/sslcommerz-refund.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/payments/sslcommerz-refund.spec.ts) | Updated initiation tests to assert `status: 'initiated'`. Added comprehensive test suite for inquiry contracts REF-G02 through REF-G08. |
| [`server/src/modules/refunds/refunds.service.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.spec.ts) | Added unit tests for REF-G01 (initiation non-settlement), COD settlement with voucher, and `reconcileRefund` scenarios for REF-G02..G08. |
| [`server/src/modules/refunds/refunds-concurrency.spec.ts`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds-concurrency.spec.ts) | Updated `CONC-22-I` for initiation non-settlement and subsequent reconciliation. Added `REF-G09` (concurrent reconciliation idempotency) and `REF-G10` (interrupted operation recovery). |
| [`web/src/lib/api/refunds.ts`](file:///home/trroyel/gramoz/web/src/lib/api/refunds.ts) | Added `reconcileRefund(id)` API method. |
| [`web/src/app/admin/refunds/page.tsx`](file:///home/trroyel/gramoz/web/src/app/admin/refunds/page.tsx) | Added amber `Reconcile` action button for in-flight `processing` refunds, with typed error handling. |
| [`web/src/app/dashboard/refunds/page.tsx`](file:///home/trroyel/gramoz/web/src/app/dashboard/refunds/page.tsx) | Added amber `processing` status badge indicating in-flight provider processing. |
| [`web/src/lib/api/refunds.spec.ts`](file:///home/trroyel/gramoz/web/src/lib/api/refunds.spec.ts) | Added frontend Vitest tests for `reconcileRefund`, `updateRefundStatus`, `REF-G11` and `REF-G12`. |

---

## 8. Complete Regression Totals

| Test Suite / Verification Scope | Command Executed | Result | Duration | Status |
| :--- | :--- | :---: | :---: | :---: |
| **Refunds & SSLCommerz Suites** | `npm --prefix server test -- refunds sslcommerz-refund` | **63 / 63 passed (5 suites)** | 38.8s | **PASS** |
| **Full Backend Jest Suite** | `npm --prefix server test` | **692 / 692 passed (45 suites)** | 48.9s | **PASS** |
| **Full Frontend Vitest Suite** | `npm --prefix web test` | **120 / 120 passed (12 files)** | 1.3s | **PASS** |
| **Full Playwright E2E Suite** | `npm --prefix web run test:e2e` | **30 / 30 passed** | 1.3m | **PASS** |
| **Backend TypeScript Build** | `npm --prefix server run build` | **0 errors (exit code 0)** | 9.8s | **PASS** |
| **Frontend Production Build** | `npm --prefix web run build` | **0 errors (40/40 routes compiled)** | 18.4s | **PASS** |
| **Modified Web ESLint Checks** | `npx eslint src/app/admin/refunds/page.tsx src/app/dashboard/refunds/page.tsx src/lib/api/refunds.ts src/lib/api/refunds.spec.ts` | **0 errors, 0 warnings** | 1.8s | **PASS** |

---

## 9. Remaining P0/P1 Risks & Financial Integrity Assessment

- **Remaining P0/P1 Financial Settlement Defects:** **0**.
- **Settlement Correctness Guarantee:** No refund may be recorded as financially completed without authoritative settlement evidence (`inquiry.status === 'refunded'` with verified provider credentials and identities, or explicit manual COD voucher acknowledgment).
- **Concurrency Guarantee:** Atomic operation claims guarantee at most 1 external initiation per eligible refund. Concurrent reconciliation attempts are serialized via canonical row locks and idempotently recover without double-restocking or double loyalty points adjustments.
- **Inventory Restocking Correctness:** Variant quarantine prevents phantom parent stock inflation when variants are missing; damaged goods returns remain excluded from saleable inventory.

---

## 10. Final Release Decision & Next Eligible Task

### Release Gate Status
- **Settlement Contract Verification:** `VERIFIED`
- **Refund State Machine Integrity:** `VERIFIED`
- **PostgreSQL 16 Concurrency Stress:** `VERIFIED`
- **Release Decision:** **PROCEED TO NEXT TASK**

### Next Eligible Task
- **Next Task:** `TASK-23: Backend Test Suite: Reviews & Wishlist`
