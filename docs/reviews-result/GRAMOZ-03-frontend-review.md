# GRAMOZ-03: Frontend Application & User Experience Review

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Staff Software Engineer & Principal Frontend Architect  
**Scope:** Next.js 16 Web Application, App Router, State Management, Client Security, Network Resilience, and UX  
**Date:** October 2026  
**Status:** Complete Audit  

---

## 1. Frontend Architecture & Technology Stack

The Gramoz frontend is built with **Next.js v16.0.0** leveraging the React 19 compiler (`reactCompiler: true`), React Server Components (RSC), Tailwind CSS v4, Lucide React icons, and Zustand for client-side state.

### 1.1 Route & Directory Structure (`web/src/app`)

```
web/src/app/
├── (auth)/                  # Route group for unauthenticated flows
│   ├── login/               # Email & Social login
│   ├── register/            # Customer registration
│   ├── verify-email/        # OTP email verification
│   └── auth/                # OAuth callbacks (Google, Facebook)
├── (shop)/                  # Customer-facing storefront
│   ├── about/               # Company information
│   ├── cart/                # Interactive shopping cart
│   ├── checkout/            # Multi-step checkout & payment
│   ├── offers/              # Active promotions & banners
│   └── products/            # Catalog, filters, and product details
├── admin/                   # Administrative backoffice
│   ├── categories/          # Category tree management
│   ├── courier/             # Steadfast courier configuration & bulk dispatch
│   ├── orders/              # Order status, invoices, and fulfillment
│   ├── products/            # Product catalog CRUD with variant builder
│   ├── promos/              # Coupon codes and usage limits
│   ├── refunds/             # Refund approval and processing
│   ├── reviews/             # Review moderation
│   ├── settings/            # System settings (loyalty, delivery, credentials)
│   ├── storefront/          # CMS banners and homepage curation
│   ├── system/              # Health metrics and audit logs
│   └── users/               # Customer & staff account management
├── dashboard/               # Customer account portal (orders, profile, addresses)
├── track/                   # Live shipment tracking with Leaflet interactive map
├── layout.tsx               # Root layout (Navbar, Footer, Global Providers)
└── page.tsx                 # Dynamic homepage (Hero, Featured, Categories, Offers)
```

---

## 2. In-Depth Architectural & Security Findings

### 2.1 P0 - CRITICAL: Ineffective Edge Middleware (`proxy.ts` vs `middleware.ts`)

> [!NOTE]
> **AUDIT CORRECTION (October 2026 / GRAMOZ-08):**
> Verification against Next.js 16.2.3 demonstrated that Next.js 16 officially deprecated `middleware.ts` in favor of `proxy.ts` exporting `proxy`. The file `web/src/proxy.ts` IS executed at the edge (confirmed via Next.js build log `ƒ Proxy (Middleware)` and live runtime test `HTTP 307` redirect on unauthenticated requests).
> However, `proxy.ts` currently only checks for token presence (`!token`) and does not verify user roles for authenticated requests. Non-admin logged-in users pass edge protection to `/admin`. This item has been reclassified as **P1 — High Priority (TASK-05)** focusing on edge role claims checking.

#### Code Evidence:
Inspection of [`web/src/proxy.ts`](file:///home/trroyel/gramoz/web/src/proxy.ts#L1-L38):
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  ...
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/register"],
};
```

#### Defect Analysis (Historical Finding):
- Next.js strictly requires that edge middleware be located in `middleware.ts` (or `src/middleware.ts`) and export either a default function or a named function called `middleware`.
- Because this file is named `proxy.ts`, **Next.js completely ignores it**. No middleware runs during edge routing.
- **Consequence:** Unauthenticated or unauthorized HTTP GET requests to `/admin`, `/admin/orders`, `/admin/products`, and `/dashboard` are served directly by the Next.js server without checking the `access_token` cookie. The only protection currently active is the client-side `useEffect` redirect in [`web/src/app/admin/layout.tsx:57-64`](file:///home/trroyel/gramoz/web/src/app/admin/layout.tsx#L57-L64).
- **Security Impact:** An unauthenticated visitor can download the compiled JavaScript bundles for the admin dashboard, inspect admin API schemas, and view UI templates before the client-side redirect executes.

#### Remediation:
1. Preserve `web/src/proxy.ts` as the standard Next.js 16 convention.
2. Enhance `proxy.ts` to decode JWT token payload or verify role claims before allowing navigation into `/admin/*`.
3. Enhance the edge middleware to decode the JWT payload or call a lightweight edge verification endpoint to confirm the `role` is in `PLATFORM_ROLES` before allowing navigation into `/admin/*`.

---

### 2.2 P1 - HIGH: Client-Side State Role Spoofing in Zustand

#### Code Evidence:
In [`web/src/stores/auth-store.ts:68-79`](file:///home/trroyel/gramoz/web/src/stores/auth-store.ts#L68-L79):
```typescript
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({ ... }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
```

And in [`web/src/app/admin/layout.tsx:57-68`](file:///home/trroyel/gramoz/web/src/app/admin/layout.tsx#L57-L68):
```typescript
  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      router.push("/login");
    } else if (user.role && !PLATFORM_ROLES.includes(user.role)) {
      router.push("/");
    }
  }, [user, router]);

  const isPlatformUser = user && user.role && PLATFORM_ROLES.includes(user.role);
  if (!isPlatformUser) return null;
```

#### Defect Analysis:
- The entire `user` object—including `user.role`—is serialized into unencrypted browser `localStorage` under key `'auth-storage'`.
- Any authenticated customer can open DevTools, run:
  ```javascript
  const state = JSON.parse(localStorage.getItem('auth-storage'));
  state.state.user.role = 'super_admin';
  localStorage.setItem('auth-storage', JSON.stringify(state));
  window.location.href = '/admin';
  ```
- Because edge middleware is inactive, the admin layout will rehydrate from `localStorage`, evaluate `isPlatformUser = true`, and mount the full admin UI and sidebar.
- While backend API calls (e.g., `GET /orders/admin/all`) will fail with HTTP 403 Forbidden because Fastify checks the database record, the client-side security boundary is compromised, exposing internal UI screens, business metrics, and workflow forms.

#### Remediation:
- Protect `/admin` on the server using Server Components and Next.js middleware with server-validated session cookies.
- Avoid relying on `localStorage` for authorization boundaries. Use an initial server-side session fetch (`/auth/me`) on layout render to establish authoritative identity.

---

### 2.3 P1 - HIGH: Hardcoded Proxy Rewrites in `next.config.ts`

#### Code Evidence:
In [`web/next.config.ts:18-29`](file:///home/trroyel/gramoz/web/next.config.ts#L18-L29):
```typescript
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:5000/api/:path*",
      },
      {
        source: "/public/:path*",
        destination: "http://localhost:5000/public/:path*",
      },
    ];
  },
```

#### Defect Analysis:
- The proxy destinations are hardcoded to `http://localhost:5000`.
- In a containerized production environment (e.g., Docker Swarm, Kubernetes, AWS ECS, or separate host deployments), the backend service is located at a service DNS name (e.g., `http://backend:5000` or `https://api.gramoz.com`).
- When deployed, any request routed through Next.js rewrites (`/api/*` or `/public/*`) will fail with `ECONNREFUSED` because the container does not run the backend on its own loopback address.

#### Remediation:
Use environment variables in `next.config.ts`:
```typescript
const backendUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:5000";
```

---

## 3. Network Resilience & HTTP Client Architecture

### 3.1 Concurrency-Safe Refresh Token Architecture (`web/src/lib/http-clients.ts`)

#### Architectural Evaluation: **EXCELLENT (A)**
The custom HTTP client implements a robust token refresh mechanism designed for single-page applications:
1. **Refresh Deduplication:** If multiple concurrent API calls (e.g., loading product details, notifications, and cart count simultaneously) receive HTTP 401 Unauthorized, only the first request initiates the `POST /auth/refresh` call.
2. **Subscriber Queue:** Subsequent requests are queued in `refreshSubscribers`. Once the refresh succeeds, all queued requests are replayed automatically.
3. **Stream Body Protection:** Fastify/Fetch `FormData` streams cannot be re-read after consumption. [`http-clients.ts:60`](file:///home/trroyel/gramoz/web/src/lib/http-clients.ts#L60) detects `isStreamBody` and gracefully surfaces a `"Session refreshed. Please try again."` notification rather than throwing a silent stream error.
4. **Direct Multipart Bypass:** In [`web/src/lib/api/products.ts:15-36`](file:///home/trroyel/gramoz/web/src/lib/api/products.ts#L15-L36), file uploads bypass Next.js rewrites and stream directly to the Fastify backend, avoiding stream corruption known to occur when Next.js rewrites buffer multipart bodies.

---

## 4. User Experience & Design Assessment

### 4.1 Design & Visual Aesthetics
- **Theme & Typography:** Cohesive dark/light palette using zinc neutrals, emerald green accents (`#22c55e`), modern typography, and clean cards.
- **Micro-Interactions:** Skeleton loading screens across product grids and dashboards; toast notifications (`sonner`) providing immediate feedback on cart actions and order state changes.
- **Interactive Tracking:** The shipment tracking page (`/track`) integrates Leaflet with custom vehicle markers, rendering real-time waypoints between the Rajshahi fulfillment center and the customer's district destination.

### 4.2 Checkout UX Flow
1. **Phone Verification Gate:** Customers without verified phone numbers are intercepted with an interactive OTP modal before checkout, minimizing COD fake order placement.
2. **Dynamic Delivery Fee Calculation:** Real-time fee recalculation triggered whenever the customer changes their shipping zone or toggles between "Home Delivery" and "Branch Pickup".
3. **Loyalty Redemption:** Interactive slider/checkbox allowing customers to redeem accumulated reward points against their order total in real time.

---

## 5. Performance, SEO & Core Web Vitals

1. **Images:** The application uses Next.js `<Image />` components with defined dimensions and responsive sizes. However, [`next.config.ts:7-16`](file:///home/trroyel/gramoz/web/next.config.ts#L7-L16) only authorizes `images.unsplash.com` and `localhost`. In production, Cloudflare R2's public domain (e.g., `media.gramoz.com`) must be added to `remotePatterns` to prevent image loading failures.
2. **SEO Metadata:** Root layout includes title tags, OpenGraph metadata, and viewport configurations. Product detail pages generate dynamic metadata based on product title and descriptions.
3. **Error Boundaries:** [`global-error.tsx`](file:///home/trroyel/gramoz/web/src/app/global-error.tsx) implements an error boundary that captures unhandled runtime exceptions with user-friendly recovery actions.

---

## 6. Frontend Remediation Priority Plan

| Priority | Issue | Affected File(s) | Remediation |
| :--- | :--- | :--- | :--- |
| **P0** | Edge middleware bypassed due to filename | `web/src/proxy.ts` | Rename to `web/src/middleware.ts` and export `middleware`. |
| **P1** | Role spoofing in localStorage Zustand store | `web/src/stores/auth-store.ts`, `admin/layout.tsx` | Enforce server-side role check in Server Component / middleware. |
| **P1** | Hardcoded backend URL in `next.config.ts` | `web/next.config.ts` | Replace `http://localhost:5000` with `process.env.INTERNAL_API_URL`. |
| **P2** | Missing R2 domain in Next.js image config | `web/next.config.ts` | Add R2 storage domain to `images.remotePatterns`. |
| **P2** | 0% Automated test coverage on web app | `web/` | Implement Vitest component tests and Playwright E2E checkout suite. |
