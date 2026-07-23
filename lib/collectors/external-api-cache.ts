/**
 * Global external API cache with single-flight dedup + negative caching.
 *
 * Converts N concurrent identical requests into a single upstream call.
 * Failed results are briefly cached (negative TTL) to prevent retry storms.
 * A per-request timeout ensures hung APIs don't stall coalesced callers.
 *
 * INVARIANT: fetcher MUST pass { signal } to native fetch().
 * Without this, AbortSignal cancellation is a no-op and fetch chains leak.
 *
 * Usage pattern:
 *   apiCache.getOrFetch("bipad:Kathmandu", 300_000, () => fetch(url, { signal }),
 *                       { timeoutMs: 10_000, signal })
 */
export class ExternalApiCache {
  private inflight = new Map<string, Promise<unknown>>();
  private resolved = new Map<string, { value: unknown; expiresAt: number; failed: boolean }>();
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(sweepIntervalMs = 60_000) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  async getOrFetch<T>(
    key: string,
    ttlMs: number,
    fetcher: (opts?: { signal?: AbortSignal }) => Promise<T>,
    options?: { timeoutMs?: number; negativeTtlMs?: number; signal?: AbortSignal },
  ): Promise<T | null> {
    // 0. Already aborted → skip all work
    if (options?.signal?.aborted) return null;

    // 1. Resolved cache hit → return immediately
    const cached = this.resolved.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.failed ? null : (cached.value as T);
    }

    // 2. In-flight dedup → share promise (coalesces concurrent identical requests)
    const inflight = this.inflight.get(key);
    if (inflight) {
      try {
        return (await inflight) as T | null;
      } catch {
        return null;
      }
    }

    // 3. Fetch with cancellation signal + timeout
    const promise = this.executeFetch(key, ttlMs, fetcher, options);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } catch {
      return null;
    }
  }

  private async executeFetch<T>(
    key: string,
    ttlMs: number,
    fetcher: (opts?: { signal?: AbortSignal }) => Promise<T>,
    options?: { timeoutMs?: number; negativeTtlMs?: number; signal?: AbortSignal },
  ): Promise<T | null> {
    const { signal, timeoutMs } = options ?? {};

    if (signal?.aborted) {
      console.warn("[external-cache] FETCH_ABORTED", { key });
      return null;
    }

    try {
      // Compose external signal with per-request timeout for true HTTP cancellation
      const combined = timeoutMs != null
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])])
        : signal;

      const result = await fetcher({ signal: combined });
      this.resolved.set(key, {
        value: result,
        expiresAt: Date.now() + ttlMs,
        failed: false,
      });
      return result;
    } catch (err) {
      if (signal?.aborted) {
        console.warn("[external-cache] FETCH_TIMEOUT", { key });
      }
      const negativeTtl = options?.negativeTtlMs ?? 30_000;
      this.resolved.set(key, {
        value: null,
        expiresAt: Date.now() + negativeTtl,
        failed: true,
      });
      return null;
    } finally {
      this.inflight.delete(key);
    }
  }

  invalidate(key?: string): void {
    if (key) {
      this.resolved.delete(key);
      this.inflight.delete(key);
    }
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.resolved.keys()) {
      if (key.startsWith(prefix)) this.resolved.delete(key);
    }
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
  }

  size(): { resolved: number; inflight: number } {
    return { resolved: this.resolved.size, inflight: this.inflight.size };
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    this.resolved.clear();
    this.inflight.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.resolved) {
      if (entry.expiresAt <= now) this.resolved.delete(key);
    }
  }
}

/** Global singleton — all external API sources share one cache. */
export const externalApiCache = new ExternalApiCache();
