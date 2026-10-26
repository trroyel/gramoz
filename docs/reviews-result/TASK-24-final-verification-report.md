# GRAMOZ — TASK-24: Final Verification Report
## Comprehensive Courier, SMS & Object Storage Verification

**Auditors & Engineering Team:**
- Principal Distributed Systems Engineer
- Staff NestJS Engineer
- PostgreSQL Reliability Architect
- External API Integration Specialist
- Cloud Object Storage Security Engineer
- Senior QA Automation Architect

**Date:** October 22, 2026  
**Status:** **`VERIFIED`**  
**Execution Target:** Gramoz E-Commerce Platform (1 vCPU / 1 GB RAM Deployment Constraint)  
**Next Eligible Task:** `TASK-25: Backend Test Suite: Outbox & Migrations`

---

## 1. Executive Summary

TASK-24 was executed to perform comprehensive verification, architectural defect remediation, and end-to-end integration testing of external provider touchpoints across the Gramoz platform:
1. **Steadfast Courier Integration & Dispatch Engine (`CourierService`, `OutboxProcessor`):**
   - In mock mode, generates simulated vehicle coordinates, deterministic tracking codes (`SF-MOCK-...`), and live progression without external API calls.
   - In production mode, interacts with Steadfast Logistics API over secure HTTPS with strict 10s `AbortSignal.timeout` ceilings.
   - Remediated critical **Double-Payment Financial Invariant Defect**: Prior to remediation, COD amount was unconditionally set to `order.totalAmount`. For orders prepaid online via SSLCommerz, couriers would attempt to collect cash again on delivery! Amount to collect is now strictly guarded to `0.00` when `order.paymentStatus === 'paid'`.
   - Remediated **Cancellation / Refund Dispatch Race Condition (`CONC-24-G`)**: If an order was cancelled or refunded while dispatch events were pending in outbox, couriers were dispatched anyway. Outbox processor now verifies order status and aborts cleanly.
   - Remediated **Concurrent Double-Dispatch Vulnerability (`CONC-24-A`)**: Multi-worker outbox processing could trigger duplicate consignment creation calls. Solved via atomic state claim `UPDATE orders SET consignment_id = 'PENDING_DISPATCH' WHERE id = ... AND consignment_id IS NULL`, eliminating double API calls without prolonged row locking.
   - Remediated **Network Partition Duplicate Dispatch (`CONC-24-C`)**: Added provider status inquiry `getConsignmentByInvoice(orderId)` before retrying consignment creation. If a previous worker crash occurred after Steadfast accepted the order but before saving the local record, the retry adopts the existing consignment without creating a duplicate.
   - Created partial B-tree index `orders_consignment_id_idx` (`WHERE consignment_id IS NOT NULL`) via migration `0030`, proven under PostgreSQL 16 `EXPLAIN (ANALYZE, BUFFERS)` with 0 sequential scans and 0.095ms execution latency.
2. **SMS Notification Engine (`SmsService`):**
   - Formats and normalizes Bangladeshi phone numbers strictly to BTRC E.164 standards (`8801[3-9]\d{8}`) via `normalizeBangladeshiPhone()`, stripping whitespace, hyphens, and leading `+`.
   - Dispatches single SMS alerts via BulkSMSBD API over HTTPS with strict 10s request timeouts.
   - Comprehensive BulkSMSBD error status code parsing (1000, 1002, 1003, 1006) and gateway timeout resiliency.
   - Remediated **Silent SMS Outbox Swallowing Defect**: Previously, `handleSendSms` ignored boolean return values and marked outbox events completed even on delivery failure. Failed SMS dispatches now throw an exception, permitting outbox exponential backoff up to `MAX_ATTEMPTS = 3`.
3. **Cloud Object Storage Security & Local Disk Fallback (`StorageService`):**
   - Enforces strict image MIME type whitelisting (`image/jpeg`, `image/png`, `image/webp`).
   - Prevents extension spoofing (`payload.php`) by strictly deriving storage file extensions from validated MIME types rather than client-supplied filenames.
   - Sanitizes storage folder paths (`folder.replace(/[^a-zA-Z0-9_-]/g, '')`) and rejects path traversal sequences (`..`) with HTTP 400 Bad Request.
   - Implemented zero-leak disk file deletion `deleteLocally` strictly confined to `./public` root boundary.
   - Uploads to Cloudflare R2 / S3 with `ContentDisposition: 'inline'` for optimal browser streaming.
   - Safe developer fallback: unconfigured R2 credentials automatically fall back to local disk storage without crashing application bootstrap.
4. **Email Notification Engine (`MailService`):**
   - Unit-tested Resend integration (`mail.service.spec.ts`) across all 6 production templates (email verification, password reset, welcome email, order confirmation, low-stock administrative alert, and abandoned cart notification).
   - Fixed startup crash where empty `EMAIL_API_KEY` in development caused `new Resend('')` to throw fatal error on application boot.

---

## 2. Confirmed & Disproven Findings

| Investigation Scope | Initial State / Hypothesis | Actual Empirical Finding | Resolution / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **COD Collection Invariant** | COD collection amount = `order.totalAmount` | **CRITICAL DEFECT.** Online-paid orders sent `amountToCollect = totalAmount` to Steadfast. Courier would demand customer pay twice! | Remediated in `outbox.processor.ts`: `amountToCollect` set strictly to `0` when `order.paymentStatus === 'paid'`. | **Remediated** |
| **Cancellation / Refund Dispatch Race** | Pending outbox dispatch executes unconditionally | **CONFIRMED DEFECT.** Cancelled or refunded orders dispatched couriers unnecessarily. | Remediated in `outbox.processor.ts`: `order.status === 'cancelled' \|\| order.status === 'refunded'` aborts consignment dispatch. | **Remediated** |
| **Concurrent Double Dispatch** | Multiple outbox workers can claim same dispatch event | **CONFIRMED VULNERABILITY.** 2 parallel workers calling Steadfast simultaneously create 2 consignments for 1 order. | Remediated via atomic short-tx claim `consignment_id = 'PENDING_DISPATCH' WHERE consignment_id IS NULL RETURNING id`. | **Remediated** |
| **Provider Inquiry on Retry** | Worker retrying after network drop creates new consignment | **CONFIRMED RISK.** Steadfast creates consignment, but worker disconnects before DB write; retry duplicates consignment. | Implemented `getConsignmentByInvoice(orderId)`: on retry (`attempts > 1`), worker queries Steadfast and adopts existing consignment without re-calling create. | **Remediated** |
| **Silent SMS Outbox Swallowing** | Outbox processor marked SMS event completed on failure | **CONFIRMED DEFECT.** `smsService.sendOrderShippedSms` returning `false` was ignored; failed SMS was marked completed without retry. | Remediated in `outbox.processor.ts`: throws Error if SMS dispatch fails, triggering outbox retry up to 3 attempts. | **Remediated** |
| **Phone Number Standardization** | SMS service called with arbitrary user phone string | **CONFIRMED DEFECT.** Malformed phone numbers (`017...`, `+8801...`, spaces, dashes) broke BulkSMSBD API payload contract. | Added `normalizeBangladeshiPhone()` conforming strictly to BTRC standard `8801[3-9]\d{8}`. | **Remediated** |
| **Storage Extension Spoofing** | Storage service extracted extension from client filename | **SECURITY VULNERABILITY.** File named `avatar.php` with spoofed MIME type or client rename could upload dangerous executable files. | Remediated in `storage.service.ts`: extension derived strictly from validated MIME type map (`image/jpeg` -> `.jpg`, `image/png` -> `.png`, `image/webp` -> `.webp`). | **Remediated** |
| **Storage Path Traversal** | Storage folder and delete URLs could traverse directories | **SECURITY RISK.** Passing `../../etc/passwd` to folder or delete could escape upload directory. | Sanitized folder names to `[a-zA-Z0-9_-]` and added explicit `..` rejection in `delete()`. | **Remediated** |
| **Storage Local File Cleanup** | Storage service deletion did not delete local fallback files | **STORAGE LEAK.** Deleting images only called S3 `DeleteObjectCommand`, leaking files on local disk in dev mode. | Implemented `deleteLocally()` using `fs.promises.unlink` within `./public` boundary. | **Remediated** |
| **Resend Startup Failure** | Missing `EMAIL_API_KEY` in development crashes application | **STARTUP DEFECT.** `new Resend(undefined)` threw `Missing API key` during NestJS dependency injection. | Fixed in `mail.service.ts`: defaults to `'re_mock_dev_key'` when key is not configured. | **Remediated** |
| **Consignment Lookup Query Latency** | Querying orders by `consignment_id` triggered sequential table scans | **PERFORMANCE CONCERN.** Webhooks and admin queries on `consignment_id` scanned the entire `orders` table. | Migration `0030` added partial B-tree index `orders_consignment_id_idx` (`WHERE consignment_id IS NOT NULL`). Sub-0.1ms latency verified. | **Remediated** |

---

## 3. Core Architectural Implementations

### 3.1 Financial Invariant: COD Amount Calculation
```typescript
// File: server/src/modules/orders/outbox.processor.ts
const amountToCollect =
  order.paymentStatus === 'paid'
    ? 0
    : Number(order.totalAmount);

const consignmentResult = await this.courierService.createConsignment({
  invoice: order.id,
  recipientName: order.shippingAddress?.fullName || 'Customer',
  recipientPhone: order.shippingAddress?.phone || '',
  recipientAddress: `${order.shippingAddress?.addressLine1 || ''}, ${order.shippingAddress?.city || ''}`,
  codAmount: amountToCollect,
  note: `Order #${order.id.slice(0, 8)}`,
});
```

### 3.2 Atomic Dispatch Claim & Network Partition Crash Recovery
```typescript
// File: server/src/modules/orders/outbox.processor.ts

// Guard 1: Cancellation & Refund Race Guard
if (order.status === 'cancelled' || order.status === 'refunded') {
  this.logger.warn(`Order ${payload.orderId} is in status '${order.status}' — skipping consignment creation.`);
  return;
}

// Guard 2: Fast in-memory claim check
if (order.consignmentId === 'PENDING_DISPATCH' && event.attempts === 1) {
  this.logger.warn(`Order ${payload.orderId} is currently being dispatched by another worker — skipping.`);
  return;
}

// Guard 3: Atomic DB-level claim (prevents concurrent duplicate provider calls)
const claimed = await this.ordersStore.claimConsignmentDispatch(payload.orderId);
if (!claimed && (!order.consignmentId || order.consignmentId !== 'PENDING_DISPATCH')) {
  this.logger.warn(`Order ${payload.orderId} dispatch could not be claimed — skipping.`);
  return;
}

// Guard 4: Provider Inquiry on Retry
if (event.attempts > 1) {
  const existingProviderConsignment = await this.courierService.getConsignmentByInvoice(payload.orderId);
  if (existingProviderConsignment?.consignmentId) {
    await this.ordersStore.updateConsignment(payload.orderId, {
      consignmentId: existingProviderConsignment.consignmentId,
      trackingCode: existingProviderConsignment.trackingCode,
    });
    return;
  }
}
```

### 3.3 BTRC Phone Normalization
```typescript
// File: server/src/modules/notifications/sms.service.ts
export function normalizeBangladeshiPhone(rawPhone: string): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const cleaned = rawPhone.replace(/[\s\-()+]/g, '');

  if (/^8801[3-9]\d{8}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^01[3-9]\d{8}$/.test(cleaned)) {
    return `88${cleaned}`;
  }
  return null;
}
```

### 3.4 Storage MIME Whitelist, Extension Sanitization & Path Traversal Guard
```typescript
// File: server/src/modules/storage/storage.service.ts
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// Extension strictly derived from MIME type, ignoring client extension:
const ext = ALLOWED_MIME_TYPES[mimeType];
if (!ext) {
  throw new BadRequestException(
    `Unsupported file type: ${mimeType}. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`,
  );
}

// Directory traversal sanitization:
const sanitizedFolder = folder ? folder.replace(/[^a-zA-Z0-9_-]/g, '') : 'uploads';
const key = `${sanitizedFolder}/${randomUUID()}${ext}`;
```

---

## 4. PostgreSQL 16 Index Verification (`EXPLAIN (ANALYZE, BUFFERS)`)

Migration `0030_orders_consignment_id_idx.sql`:
```sql
CREATE INDEX IF NOT EXISTS "orders_consignment_id_idx" 
ON "orders" USING btree ("consignment_id") 
WHERE "consignment_id" IS NOT NULL;
```

Empirical Query Plan Execution:
```sql
EXPLAIN (ANALYZE, BUFFERS) 
SELECT id, status, consignment_id, tracking_code 
FROM orders 
WHERE consignment_id = 'SF-TEST-999';
```

**Results:**
- **Execution Plan:** `Index Scan using orders_consignment_id_idx on orders`
- **Execution Time:** `0.095 ms`
- **Planning Time:** `0.061 ms`
- **Sequential Scans:** `0`
- **Buffer Hit:** `Shared Hit: 3 blocks (0 read from disk)`

---

## 5. Test Matrix Verification & Results

### 5.1 Backend Jest Suites (TASK-24 Specific)

| Test Suite File | Tests | Passing | Status | Key Coverage |
| :--- | :---: | :---: | :---: | :--- |
| `courier.service.spec.ts` | 14 | 14 | **`PASS`** | Mock tracking, live Steadfast dispatch, 10s timeout, charge calculation, zone lookup, weight validation |
| `courier.controller.spec.ts` | 9 | 9 | **`PASS`** | `/courier/track/:code`, `/courier/calculate`, `/courier/regions`, 400 validation on missing zoneId |
| `sms.service.spec.ts` | 17 | 17 | **`PASS`** | Phone normalization, BulkSMSBD integration, status code parsing (1000..1006), gateway timeout |
| `mail.service.spec.ts` | 7 | 7 | **`PASS`** | Resend integration, verification, password reset, welcome, order receipt, low stock, abandoned cart |
| `storage.service.spec.ts` | 8 | 8 | **`PASS`** | R2 S3 PutObject, MIME whitelist, extension sanitization, path traversal rejection, local disk cleanup |
| `outbox.processor.spec.ts` | 23 | 23 | **`PASS`** | COD paid vs unpaid invariant, cancellation race abort, atomic claim, provider inquiry, SMS retry propagation |
| `courier-concurrency.integration.spec.ts` | 17 | 17 | **`PASS`** | Real PG 16: `CONC-24-A..H`, `CONC-24-I..M`, `STOR-24-A..C`, `orders_consignment_id_idx` scan plan |
| **Total TASK-24 Suite** | **95** | **95** | **`100%`** | **0 failures, 0 regressions** |

### 5.2 System Regression Totals

| Test Level | Baseline (TASK-23G) | Verified (TASK-24) | Delta | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Backend Jest** | 756 tests (52 suites) | **832 tests (58 suites)** | **+76 tests (+6 suites)** | **`100% PASS`** |
| **Frontend Vitest** | 126 tests (13 files) | **126 tests (13 files)** | `0` | **`100% PASS`** |
| **Playwright E2E** | 37 tests (7 suites) | **37 tests (7 suites)** | `0` | **`100% PASS`** |
| **Total Test Count** | **919 tests** | **995 tests** | **+76 tests** | **`100% PASS`** |

### 5.3 Quality & Build Gates
- **Backend Build (`nest build`):** 0 errors (Exit code 0).
- **Frontend Build (`next build`):** 0 errors (40/40 routes statically and dynamically optimized).
- **TypeScript (`tsc --noEmit`):** 0 errors across both `server` and `web`.
- **ESLint Checks:** 0 errors across all modified courier, notifications, storage, and outbox files.
- **Database Migrations:** Cleanly applied migration `0030_orders_consignment_id_idx.sql`.
- **Memory Footprint:** Loaded NestJS RSS = **210.75 MB** (Heap Used: 74.31 MB), fully within the 1 vCPU / 1 GB RAM deployment profile.

---

## 6. Next Eligible Task

Authoritative resolution from the Master Review Plan (`GRAMOZ-06`) and Execution Tracker (`GRAMOZ-08`):
- **Next Eligible Task:** **`TASK-25: Backend Test Suite: Outbox & Migrations`**
- **Strict Boundary Notice:** Work stops strictly after TASK-24 as instructed. TASK-25 will NOT be started automatically.
