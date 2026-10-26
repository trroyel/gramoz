import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyJwtToken } from "@/lib/auth/jwt-verify";
import { PLATFORM_ROLES } from "@/types";

export async function proxy(request: NextRequest) {
  // Read the httpOnly cookie set by the server on login.
  // This cookie is inaccessible to JavaScript (XSS-safe).
  const token = request.cookies.get("access_token")?.value;
  const pathname = request.nextUrl.pathname;

  const isAuthPage =
    pathname.startsWith("/login") || pathname.startsWith("/register");

  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAdminRoute = pathname.startsWith("/admin");
  const isProtected = isDashboardRoute || isAdminRoute;

  // Cryptographically verify token if present
  const payload = token ? await verifyJwtToken(token) : null;
  const isTokenValid = Boolean(payload);

  // If token is present but expired, tampered, or invalid on a protected route,
  // we purge the stale cookie from the client response.
  const hasCorruptedToken = Boolean(token && !isTokenValid);

  // Sanitize incoming client-supplied identity headers so untrusted client headers
  // can never be passed to downstream components or treated as authenticated identity.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-user-id");
  requestHeaders.delete("x-user-role");

  // Redirect already-authenticated users away from login/register
  if (isAuthPage) {
    if (isTokenValid) {
      const destination =
        payload?.role && PLATFORM_ROLES.includes(payload.role)
          ? "/admin"
          : "/dashboard";
      return NextResponse.redirect(new URL(destination, request.url));
    }
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Protect dashboard and admin routes
  if (isProtected) {
    if (!isTokenValid) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      const res = NextResponse.redirect(loginUrl);
      if (hasCorruptedToken) {
        res.cookies.delete("access_token");
      }
      return res;
    }

    // Role-based authorization for admin routes
    if (isAdminRoute) {
      const userRole = payload?.role;
      const isPlatformUser = Boolean(
        userRole && PLATFORM_ROLES.includes(userRole),
      );

      if (!isPlatformUser) {
        // Authenticated customer attempting to access admin route — bounce to home at edge
        return NextResponse.redirect(new URL("/", request.url), {
          status: 307,
        });
      }
    }

    // Forward ONLY cryptographically verified user claims to downstream components
    if (payload?.sub) requestHeaders.set("x-user-id", payload.sub);
    if (payload?.role) requestHeaders.set("x-user-role", payload.role);

    const res = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    if (payload?.sub) res.headers.set("x-user-id", payload.sub);
    if (payload?.role) res.headers.set("x-user-role", payload.role);

    return res;
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/register"],
};
