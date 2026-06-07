import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const AUTH_ROUTES = ["/sign-in", "/register", "/forgot-password"];
const VERIFY_ROUTES = ["/verify-email"];
const ONBOARDING_ROUTE = "/onboarding";
const PUBLIC_PAGES = ["/", ...AUTH_ROUTES, ...VERIFY_ROUTES];

const rateMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anonymous"
  );
}

function checkRateLimit(ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(key);
  }
}, 300_000);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow: API, static, Next internals, files with extensions
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    if (pathname.startsWith("/api")) {
      const ip = getClientIp(req);
      if (!checkRateLimit(`mw:${ip}`, 200, 60_000)) {
        return NextResponse.json(
          { message: "Too many requests. Please try again later." },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }
    }
    const res = NextResponse.next();
    if (pathname.startsWith("/admin")) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-pathname", pathname);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    return setSecurityHeaders(res);
  }

  const sessionCookie = getSessionCookie(req);
  const isLoggedIn = !!sessionCookie;

  // ── Not logged in ──
  if (!isLoggedIn) {
    if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return setSecurityHeaders(NextResponse.next());
    }
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // ── Logged in ──
  if (
    AUTH_ROUTES.includes(pathname) ||
    VERIFY_ROUTES.some((r) => pathname.startsWith(r)) ||
    pathname === ONBOARDING_ROUTE
  ) {
    return setSecurityHeaders(NextResponse.next());
  }

  if (pathname.startsWith("/admin")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", pathname);
    return setSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } })
    );
  }

  return setSecurityHeaders(NextResponse.next());
}

function setSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload"
  );
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
