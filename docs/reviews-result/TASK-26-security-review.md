# GRAMOZ — TASK-26: Production Security Review & Vulnerability Assessment

**Security Team & Roles:**
- Principal Application Security Engineer
- Staff Infrastructure Security Specialist
- Cryptographic Systems Architect
- Senior Penetration Tester & Audit Lead

**Date:** October 25, 2026  
**Status:** **`CONDITIONALLY READY`** (Specific Auth & Courier Residuals Remain Documented Operational Conditions)  
**Deliverable Document:** `docs/reviews-result/TASK-26-security-review.md`

---

## 1. Executive Summary & Security Posture

A comprehensive application security audit of the Gramoz E-Commerce platform was conducted to identify, verify, and resolve vulnerabilities prior to production deployment.

The evaluation specifically targeted:
1. Authentication lifecycle, session invalidation, and Redis caching invariants (TASK-09 risks).
2. Payment gateway callback security, timing attacks, and unauthenticated state tampering.
3. Logistics API integration, dispatch idempotency, and double-collection prevention.
4. File upload parsing, MIME spoofing, Stored XSS, and directory traversal.
5. Network edge proxy trust, rate limiting, and HTTP security headers.

---

## 2. In-Depth Audit of TASK-09 Authentication Residual Risks

| Risk Identifier | Finding Description | Severity | Verification Status | Mitigation & Remaining Risk Assessment |
| :--- | :--- | :---: | :---: | :--- |
| **AUTH-SEC-01** | **DB Commit Succeeded while Redis Invalidation Failed** | **P1** | **VERIFIED RESIDUAL** | If PostgreSQL commits a user suspension/demotion but Redis is unreachable during `invalidateUserCache()`, Redis retains the cached active profile until `CACHE_TTL_SECONDS` (60s) expires. **Mitigation:** `RolesGuard` performs an authoritative DB read for all privileged routes (`skipCache: true`). Customer endpoints (e.g. `getMe`) remain stale for up to 60s. |
| **AUTH-SEC-02** | **Stale JWT Role Claims in Next.js Proxy** | **P2** | **VERIFIED RESIDUAL** | Next.js Edge Proxy (`web/src/proxy.ts`) decrypts access tokens locally and inspects `role` without contacting backend API. A demoted admin can navigate `/admin` pages client-side until the JWT access token expires (up to 15m). **Mitigation:** Backend NestJS `RolesGuard` strictly rejects all data fetching with 403 Forbidden. UI-only exposure. |
| **AUTH-SEC-03** | **Clock Skew in `SAFE_SET_LUA` Timestamp Branch** | **P2** | **MITIGATED** | `SAFE_SET_LUA` checks both timestamp tombstones and monotonic generation counters. If server clocks between app instances drift, the timestamp branch could allow stale overwrites. **Mitigation:** Generation counter increment (`INCR {user:id}:gen`) is monotonic inside Redis and immune to system clock skew. |
| **AUTH-SEC-04** | **Stale Cache Repopulation Beyond Tombstone TTL** | **P2** | **VERIFIED PROTECTED** | Tombstone TTL is set to 24 hours (`TOMBSTONE_TTL_SECONDS = 86400`), while user cache TTL is 60 seconds (`CACHE_TTL_SECONDS = 60`). Database query latency ceiling of 10s drops slow queries. Ghost writes cannot outlive the tombstone. |
| **AUTH-SEC-05** | **Session Revocation Concurrency & Failure** | **P1** | **VERIFIED PROTECTED** | Token refresh employs atomic Redis Lua Compare-And-Swap (`rotateSession`). Replayed or raced refresh tokens immediately fail CAS. `refreshToken` service explicitly reads PostgreSQL with `{ skipCache: true }` before issuing tokens. |
| **AUTH-SEC-06** | **Token-Type Confusion Attacks** | **P0** | **VERIFIED PROTECTED** | JWT verification enforces strict `token_type` separation: `JwtStrategy` rejects `token_type !== 'access'`, and `authService.refreshToken()` rejects `token_type !== 'refresh'`. Presenting a refresh token as a Bearer token fails authentication. |

---

## 3. Payment Gateway (SSLCommerz) Security Analysis

### 3.1 Timing-Safe Hash Verification (SEC-18)
- **Defect Remediated:** IPN signature comparisons previously evaluated strings via standard JavaScript `===`, leaking timing discrepancies. In addition, the computed expected hash was logged to stdout.
- **Remediation:** Implemented `crypto.timingSafeEqual()` on fixed-length byte buffers:
  ```ts
  const safeEqual = (a: string, b: string): boolean => {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  };
  ```
  Expected hashes were removed from log statements.

### 3.2 Unauthenticated Callback State Tampering (SEC-18-7 & SEC-18-8)
- **Defect Remediated:** If an attacker sent a forged IPN with `verify_sign` omitted or invalid, but `status=FAILED`, the service previously forwarded the payload to `handleFailedPayment()`, cancelling genuine in-flight customer orders.
- **Remediation:** In `verifyPayment()`, if `!isValid`:
  1. If `val_id` is missing or status is not `VALID`, immediately return `{ success: false, message: 'Invalid IPN signature' }` without mutating state.
  2. If `val_id` is provided and the gateway Validation API returns `FAILED` or `CANCELLED`, the unauthenticated request is rejected without modifying database records.
- **Test Evidence:** Verified in `SEC-18-7` and `SEC-18-8` (`payments-security-concurrency.spec.ts`).

### 3.3 Transaction Substitution & Order ID Cross-Tampering
- Tested against amount tampering (`SEC-18-1`), currency substitution (`SEC-18-2`), forged transaction ID (`SEC-18-3`), and order cross-reference tampering (`SEC-18-4`). All attempts fail-closed with transaction rollback.

---

## 4. Courier & Logistics Security Analysis

### 4.1 Steadfast Provider Ambiguity & Duplicate Shipments
- **Vulnerability:** Steadfast does not accept client-provided idempotency keys and cannot look up tracking codes by merchant invoice. If an HTTP request to `create_order` times out, a consignment may or may not have been created at the provider.
- **Mitigation:**
  1. Ambiguous outcomes keep the order's `consignment_id` sentinel as `'PENDING_DISPATCH'` and throw a retryable error.
  2. On retry, `handleCreateConsignment()` queries `getConsignmentByInvoice()`.
  3. If the provider indicates the shipment exists (`exists: true`), the event dead-letters with `RECONCILIATION_REQUIRED`.
  4. If the provider returns 404, the event also dead-letters because Steadfast eventual consistency means the parcel may appear minutes later. The worker **never issues a duplicate create call**.
- **Remaining Operational Blocker:** Admin manual reconciliation tooling and real-time alerting for dead-lettered shipments are not yet built.

### 4.2 Cash on Delivery (COD) Double Collection
- Verified invariant: If an order was paid online via SSLCommerz, `amountToCollect` sent to Steadfast is strictly forced to `0`. Couriers cannot collect cash on pre-paid orders.

---

## 5. File Upload, Storage & Infrastructure Security

### 5.1 Multipart Upload Stream Hardening
- Replaced memory-buffering `part.toBuffer()` with zero-allocation stream draining (`part.file.resume()`).
- File size capped at 2 MB; non-file fields capped at 20.
- Implemented magic byte validation (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF`/`WEBP`).
- Active script scanning: Uploaded file headers are scanned for `<html`, `<svg`, `<script`, and `<?xml` to eliminate Stored XSS and SVG script injection.

### 5.2 Path Traversal Defense
- Storage keys sanitized: `folder.replace(/[^a-zA-Z0-9_-]/g, '')`.
- Traversal sequences (`..`) rejected with HTTP 400.
- Local disk fallback constrained strictly within `./public/uploads`.

### 5.3 Network Edge Security & Security Headers
- Helmet configured with `frameguard: { action: 'sameorigin' }` and Content Security Policy.
- Fastify configured with `trustProxy: 1` to prevent `X-Forwarded-For` spoofing behind single-hop reverse proxies.
- Auth cookies enforced with `httpOnly: true`, `secure: true` (in production), and `sameSite: 'lax'`.
- Rate limiting enforced via `ThrottlerStorageRedisService` on sensitive auth routes (login, register, forgot-password, OTP).

---

## 6. Vulnerability Matrix Summary

| Vulnerability ID | Category | Severity | Status | Resolution / Action Required |
| :--- | :--- | :---: | :---: | :--- |
| **VULN-26-01** | Outbox Worker Lease Overwrite | **P0** | **RESOLVED** | Atomic ownership check & attempt-equality fencing implemented. |
| **VULN-26-02** | Duplicate Carrier Shipment on Timeout | **P0** | **RESOLVED** | Ambiguous creates retain sentinel; provider 404 dead-letters for manual reconciliation. |
| **VULN-26-03** | Future Migration Skips via Corrupted Journal | **P1** | **RESOLVED** | Timestamps in `_journal.json` and dev DB realigned to monotonic past timestamps. |
| **VULN-26-04** | Unauthenticated IPN State Mutation | **P1** | **RESOLVED** | Fail-closed validation; negative IPNs without valid signature do not touch DB. |
| **VULN-26-05** | IPN Timing Attack & Secret Hash Leak | **P2** | **RESOLVED** | Replaced `===` with `crypto.timingSafeEqual()`; removed hash logging. |
| **VULN-26-06** | Missing Graceful Shutdown Hooks | **P1** | **RESOLVED** | Added `app.enableShutdownHooks()` in `main.ts`. |
| **VULN-26-07** | Stale Cache Window on Redis Invalidation Failure | **P1** | **OPERATIONAL RISK** | Documented: 60s cache TTL on non-privileged endpoints. RolesGuard protects admin APIs. |
| **VULN-26-08** | Stale JWT Role Claims in Edge Proxy | **P2** | **OPERATIONAL RISK** | Documented: 15m client-side navigation window; backend strictly enforces 403. |
| **VULN-26-09** | Missing Carrier Reconciliation Admin Panel | **P1** | **RELEASE BLOCKER** | Manual resolution path required before high-volume shipping. |
