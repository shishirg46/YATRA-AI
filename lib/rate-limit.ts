/**
 * In-memory sliding window rate limiter.
 * Swap for @upstash/ratelimit when Redis is available.
 */

import { NextResponse } from "next/server";

type Window = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Window>();

// Cleanup stale entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of store) {
    if (win.resetAt <= now) store.delete(key);
  }
}, 60_000);

export interface RateLimitConfig {
  /** Max requests per window */
  max: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

export function rateLimit(
  key: string,
  config: RateLimitConfig = { max: 30, windowSeconds: 60 }
): { allowed: boolean; remaining: number; resetAt: number } {
  const { max, windowSeconds } = config;
  const now = Date.now();
  const winKey = `${key}:${Math.floor(now / (windowSeconds * 1000))}`;

  const win = store.get(winKey);
  const resetAt = (Math.floor(now / (windowSeconds * 1000)) + 1) * windowSeconds * 1000;

  if (!win || win.resetAt <= now) {
    store.set(winKey, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }

  if (win.count >= max) {
    return { allowed: false, remaining: 0, resetAt: win.resetAt };
  }

  win.count++;
  return { allowed: true, remaining: max - win.count, resetAt: win.resetAt };
}

/**
 * Higher-order function to wrap API handlers with rate limiting.
 */
export function withRateLimit<T extends (req: any) => any>(
  handler: T,
  config?: RateLimitConfig
): T {
  const wrapped = async (req: Parameters<T>[0]): Promise<ReturnType<T>> => {
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    const route = new URL(req.url).pathname;
    const result = rateLimit(`${ip}:${route}`, config);

    if (!result.allowed) {
      return NextResponse.json(
        { message: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(result.resetAt),
          },
        }
      ) as ReturnType<T>;
    }

    const response = await handler(req);
    const headers = new Headers((response as Response).headers);
    headers.set("X-RateLimit-Remaining", String(result.remaining));
    headers.set("X-RateLimit-Reset", String(result.resetAt));

    return new NextResponse((response as Response).body, {
      status: (response as Response).status,
      statusText: (response as Response).statusText,
      headers,
    }) as ReturnType<T>;
  };
  return wrapped as T;
}
