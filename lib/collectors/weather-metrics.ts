interface ProviderMetrics {
  calls: number;
  successes: number;
  timeouts: number;
  errors: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
}

export interface WeatherMetricsSnapshot {
  providers: {
    dhm: ProviderMetrics;
    openMeteo: ProviderMetrics;
    openweathermap: ProviderMetrics;
    fallback: ProviderMetrics;
  };
  cache: {
    hits: number;
    misses: number;
    entries: number;
  };
  uptimeMs: number;
}

function emptyProvider(): ProviderMetrics {
  return { calls: 0, successes: 0, timeouts: 0, errors: 0, totalLatencyMs: 0, lastLatencyMs: 0 };
}

const _providers: Record<string, ProviderMetrics> = {
  dhm: emptyProvider(),
  openMeteo: emptyProvider(),
  openweathermap: emptyProvider(),
  fallback: emptyProvider(),
};

let _cacheHits = 0;
let _cacheMisses = 0;
let _cacheEntries = 0;

export function recordCall(provider: string): void {
  const p = _providers[provider];
  if (p) p.calls++;
}

export function recordSuccess(provider: string, latencyMs: number): void {
  const p = _providers[provider];
  if (p) {
    p.successes++;
    p.totalLatencyMs += latencyMs;
    p.lastLatencyMs = latencyMs;
  }
}

export function recordTimeout(provider: string): void {
  const p = _providers[provider];
  if (p) p.timeouts++;
}

export function recordError(provider: string): void {
  const p = _providers[provider];
  if (p) p.errors++;
}

export function recordCacheHit(): void {
  _cacheHits++;
}

export function recordCacheMiss(): void {
  _cacheMisses++;
}

export function recordCacheEntries(n: number): void {
  _cacheEntries = n;
}

export function getSnapshot(): WeatherMetricsSnapshot {
  return {
    providers: {
      dhm: { ..._providers.dhm },
      openMeteo: { ..._providers.openMeteo },
      openweathermap: { ..._providers.openweathermap },
      fallback: { ..._providers.fallback },
    },
    cache: {
      hits: _cacheHits,
      misses: _cacheMisses,
      entries: _cacheEntries,
    },
    uptimeMs: process.uptime() * 1000,
  };
}

export function reset(): void {
  for (const key of Object.keys(_providers)) {
    _providers[key] = emptyProvider();
  }
  _cacheHits = 0;
  _cacheMisses = 0;
  _cacheEntries = 0;
}
