# GRAMOZ-05: Application Security, Cryptography & Threat Assessment

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Principal Security Architect & Certified Production Auditor  
**Scope:** Authentication, RBAC, Gateway Integrity, Cryptography, Secrets, Injection, Rate Limiting & DoS  
**Date:** October 2026  
**Status:** Complete Audit  

---

## 1. Executive Security Posture

The Gramoz platform demonstrates a **substantially stronger security foundation** than typical e-commerce MVPs. Key strengths include:
1. **Zero LocalStorage Tokens:** Authentication tokens are stored exclusively in `httpOnly`, `SameSite=Lax`, secure cookies, neutralizing client-side JavaScript token theft (XSS).
2. **Cryptographic Brute-Force Safeguards:** Email and SMS verification endpoints utilize atomic pre-increment attempt counters in Redis, permanently invalidating OTP codes after 5 failures.
3. **Double-Signature Gateway Verification & Amount Assertion:** The SSLCommerz webhook listener validates both SHA-256 and MD5 HMAC signatures, followed by strict server-side assertion of the paid transaction amount against database records.
4. **Phone Verification COD Gate:** Cash on Delivery orders are strictly blocked unless the customer has verified their phone number via SMS OTP, mitigating fake COD checkout attacks.

However, several high-impact vulnerabilities require immediate remediation prior to public deployment.

---

## 2. Threat Modeling & Vulnerability Findings

### 2.1 P0 - CRITICAL: Bypassed Edge Route Protection & Admin UI Exposure

- **Vulnerability Type:** Broken Access Control (CWE-284)
- **Location:** [`web/src/proxy.ts`](file:///home/trroyel/gramoz/web/src/proxy.ts) & [`web/src/stores/auth-store.ts:70`](file:///home/trroyel/gramoz/web/src/stores/auth-store.ts#L70)
- **Mechanics:**
  - The Next.js edge route guard is defined in `web/src/proxy.ts` rather than `web/src/middleware.ts`. Next.js never loads or executes this file.
  - The Zustand `auth-store` persists the raw user object into unencrypted `localStorage` under `auth-storage`.
  - An attacker can edit `localStorage` to set `"role": "super_admin"`. Navigating to `/admin` renders the entire admin layout, sidebar, and client-side interfaces.
- **Impact:** Administrative interface structure, customer analytics charts, internal management routes, and configuration screens are exposed to arbitrary users.
- **Remediation:**
  1. Rename `web/src/proxy.ts` to `web/src/middleware.ts` with named export `middleware`.
  2. Implement server-side cookie verification inside the Next.js middleware, rejecting unauthenticated or non-platform users before any admin HTML or JS bundles are streamed.

---

### 2.2 P1 - HIGH: Dangerous Default Secrets in Source Code

- **Vulnerability Type:** Hardcoded Cryptographic Secrets & Insecure Defaults (CWE-798 / CWE-1188)
- **Locations:**
  - [`config.service.ts:78`](file:///home/trroyel/gramoz/server/src/config/config.service.ts#L78):
    ```typescript
    get jwtSecret(): string {
      return this.configService.get<string>('AUTH_JWT_SECRET', 'secret');
    }
    ```
  - [`payments.service.ts:23-25`](file:///home/trroyel/gramoz/server/src/modules/payments/payments.service.ts#L23-L25):
    ```typescript
    this.storeId = this.configService.get<string>('SSLCOMMERZ_STORE_ID') || 'testbox';
    this.storePasswd = this.configService.get<string>('SSLCOMMERZ_STORE_SECRET') || 'testpass';
    ```
- **Mechanics:**
  - If `AUTH_JWT_SECRET` is omitted from the deployment environment, the server silently falls back to `'secret'`, allowing anyone to forge administrative JWTs.
  - If `SSLCOMMERZ_STORE_SECRET` is missing in staging or production, the gateway validator falls back to `'testpass'`, allowing signature spoofing.
- **Remediation:** Enforce strict startup environment validation. If critical secrets (`AUTH_JWT_SECRET`, `DATABASE_URL`, `SSLCOMMERZ_STORE_SECRET`) are missing or match insecure default strings, the application must immediately throw a fatal error and refuse to boot.

---

### 2.3 P1 - HIGH: Missing Anti-Hammering Rate Limiter on Login / Password Endpoints

- **Vulnerability Type:** Credential Stuffing & Password Spraying (CWE-307)
- **Locations:** [`auth.controller.ts:47`](file:///home/trroyel/gramoz/server/src/modules/auth/auth.controller.ts#L47) (`POST /auth/login`), `POST /auth/forgot-password`
- **Mechanics:**
  - While `@Throttle({ default: { ttl: 60_000, limit: 5 } })` is correctly applied to `POST /orders/checkout` and `POST /payments/initiate`, the `POST /auth/login` and `POST /auth/forgot-password` endpoints rely only on the global rate limit (100 requests per 60 seconds).
  - 100 requests per minute allows distributed botnets to execute high-volume password guessing and email spamming.
- **Remediation:** Apply strict route-level throttling on authentication endpoints:
  ```typescript
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // 5 attempts per minute per IP
  @Post('login')
  ```
  Additionally, track failed password attempts per email in Redis, temporarily locking the account after 5 consecutive failures.

---

## 3. Cryptographic Implementation Review

| Primitive | Implementation | Evaluation | Assessment |
| :--- | :--- | :--- | :--- |
| **Password Hashing** | `argon2.hash()` (Argon2id) | Memory-hard algorithm resistant to GPU/ASIC cracking. | **BEST IN CLASS (A+)** |
| **Session Tokens** | `RS256` or `HS256` via `@nestjs/jwt` | 15m expiration, signed payload containing `sub` and `email`. | **STRONG (A)** |
| **OTP Verification** | `crypto.randomInt(100000, 999999)` | Secure PRNG, prevents predictable random seed attacks. | **EXCELLENT (A+)** |
| **OAuth CSRF State** | `crypto.createHmac('sha256', secret)` | Signed HMAC-SHA256 cookie verified on OAuth callback. | **EXCELLENT (A+)** |
| **IPN Signature** | Dual SHA-256 and MD5 HMAC | Recomputes gateway signature with store password. | **STRONG (A)** |

---

## 4. Insecure Direct Object References (IDOR) Audit

A thorough audit of data access controls across all customer-facing endpoints was performed:

1. **Order Detail Access:**
   - In [`orders.store.ts:202-215`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.store.ts#L202-L215), `getOrderDetailsWithPayments` enforces:
     ```sql
     WHERE orders.id = :orderId AND orders.user_id = :userId
     ```
   - Customer A cannot view Customer B's order details.
2. **Invoice Download Authorization:**
   - In [`orders.controller.ts:63-72`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.controller.ts#L63-L72), `downloadInvoice` executes:
     ```typescript
     await this.ordersService.getOrderDetails(user.id, id);
     await this.invoicesService.generateInvoicePdf(id, res);
     ```
   - The ownership verification check strictly runs *before* PDF generation commences.
3. **Refund Requests:**
   - In [`refunds.service.ts:51`](file:///home/trroyel/gramoz/server/src/modules/refunds/refunds.service.ts#L51), `requestRefund` verifies:
     ```typescript
     if (order.userId !== userId) throw new ForbiddenOperationError('You can only request a refund for your own orders');
     ```

---

## 5. Denial of Service (DoS) & Abuse Prevention

### 5.1 File Upload Limits & Stream Exhaustion
- In [`main.ts:50-54`](file:///home/trroyel/gramoz/server/src/main.ts#L50-L54), `@fastify/multipart` is configured with:
  ```typescript
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 5,
  }
  ```
- In [`fastify-file-upload.interceptor.ts:31-35`](file:///home/trroyel/gramoz/server/src/common/interceptors/fastify-file-upload.interceptor.ts#L31-L35), non-image mimetypes are rejected, and invalid streams are immediately drained (`await part.toBuffer().catch(() => {})`) to prevent leaving the HTTP request stream open or leaking memory.

### 5.2 SQL & Parameter Injection
- Drizzle ORM compiles queries using parameterized placeholders (`$1`, `$2`, etc.), preventing SQL injection.
- Dynamic sorting in [`products.service.ts:156-161`](file:///home/trroyel/gramoz/server/src/modules/products/products.service.ts#L156-L161) uses strict conditional branching (`query?.sort === 'price_asc' ? ... : ...`) rather than interpolating user strings into `ORDER BY` clauses.

---

## 6. Security Remediation Matrix

| Priority | Vulnerability / Risk | Remediation Action | Target Timeline |
| :--- | :--- | :--- | :--- |
| **P0** | Inactive Edge Middleware (`proxy.ts`) | Rename to `web/src/middleware.ts` and enforce role verification. | Immediate |
| **P1** | Hardcoded default secrets (`'secret'`, `'testpass'`) | Implement startup config assertion throwing fatal error if defaults are detected. | Pre-Deployment |
| **P1** | Unthrottled login / forgot-password endpoints | Add `@Throttle({ default: { ttl: 60_000, limit: 5 } })` on auth routes. | Pre-Deployment |
| **P2** | User role stored in client `localStorage` | Rely on server-validated session cookie for authorization. | Pre-Deployment |
| **P2** | Content Security Policy (CSP) headers | Refine CSP header directives in Fastify Helmet config to restrict external CDNs. | Post-Launch |
