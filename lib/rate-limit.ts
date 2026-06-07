import { NextRequest, NextResponse } from "next/server";

const rateMap = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "anonymous";
}

export function checkRateLimit(
  key: string,
  maxRequests: number = 60,
  windowMs: number = 60_000,
): RateLimitResult {
  const now = Date.now();
  const entry = rateMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetIn: entry.resetAt - now };
}

type ApiHandler = (req: NextRequest, ...args: any[]) => Promise<NextResponse | Response>;

export function withRateLimit(
  handler: ApiHandler,
  opts: { max: number; windowSeconds: number },
): ApiHandler {
  return async (req: NextRequest, ...args: unknown[]) => {
    const ip = getClientIp(req);
    const path = req.nextUrl?.pathname ?? "unknown";
    const result = checkRateLimit(`rl:${path}:${ip}`, opts.max, opts.windowSeconds * 1000);
    if (!result.allowed) {
      return NextResponse.json(
        { message: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(result.resetIn / 1000)),
            "X-RateLimit-Remaining": "0",
          },
        },
      );
    }
    return handler(req, ...args);
  };
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(key);
  }
}, 300_000);
