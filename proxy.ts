/**
 * FILE: proxy.ts
 * LOCATION: /proxy.ts (project root)
 * PURPOSE: Auth guard — checks session cookie on every request
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const AUTH_ROUTES      = ["/sign-in", "/register", "/forgot-password"];
const VERIFY_ROUTES    = ["/verify-email"];
const ONBOARDING_ROUTE = "/onboarding";
const PUBLIC_ROUTES    = ["/", ...AUTH_ROUTES];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow: API, static, Next internals, files with extensions
  if (
    pathname.startsWith("/api")     ||
    pathname.startsWith("/_next")   ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(req);
  const isLoggedIn    = !!sessionCookie;

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    // Allow public + auth + verify pages
    if (
      PUBLIC_ROUTES.includes(pathname) ||
      VERIFY_ROUTES.some((r) => pathname.startsWith(r))
    ) {
      return NextResponse.next();
    }
    // Everything else → sign in
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // ── Logged in ──────────────────────────────────────────────────────────────
  // Allow auth pages through — the session may be stale (DB wiped, expired, etc.)
  // Let the page/API handle the actual session check rather than redirecting blindly
  if (AUTH_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  // Allow verify + onboarding
  if (
    VERIFY_ROUTES.some((r) => pathname.startsWith(r)) ||
    pathname === ONBOARDING_ROUTE
  ) {
    return NextResponse.next();
  }

  // For admin routes, set x-pathname header for role-based layout checks
  if (pathname.startsWith("/admin")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // All other protected routes — allow through
  // Session validity is checked inside each API route
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
