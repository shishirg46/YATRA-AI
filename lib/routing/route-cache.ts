type CacheEntry<T> = {
  data: T;
  expiresAt: number;
  tags: string[];
};

class RouteCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private tagIndex = new Map<string, Set<string>>();
  private defaultTTL: number;

  constructor(defaultTTLMs = 5 * 60 * 1000) {
    this.defaultTTL = defaultTTLMs;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeFromTagIndex(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number, tags?: string[]): void {
    const cleanTags = tags ?? [];
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTTL),
      tags: cleanTags,
    });
    for (const tag of cleanTags) {
      const keys = this.tagIndex.get(tag) ?? new Set();
      keys.add(key);
      this.tagIndex.set(tag, keys);
    }
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      this.tagIndex.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) {
        this.store.delete(key);
        this.removeFromTagIndex(key);
      }
    }
  }

  invalidateByTag(tag: string): void {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;
    for (const key of keys) {
      this.store.delete(key);
    }
    this.tagIndex.delete(tag);
  }

  private removeFromTagIndex(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    for (const tag of entry.tags) {
      this.tagIndex.get(tag)?.delete(key);
    }
  }

  getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number,
    tags?: string[],
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return Promise.resolve(cached);
    return fetcher().then((data) => {
      this.set(key, data, ttlMs, tags);
      return data;
    });
  }

  size(): number {
    return this.store.size;
  }
}

export const routeCache = new RouteCache(10 * 60 * 1000);

export const routeGeometryCache = new RouteCache(30 * 60 * 1000);

export const placesCache = new RouteCache(5 * 60 * 1000);

export function makeRouteCacheKey(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  vehicle: string,
  waypoints?: string
): string {
  return `route:${fromLat.toFixed(4)}:${fromLon.toFixed(4)}:${toLat.toFixed(4)}:${toLon.toFixed(4)}:${vehicle}${waypoints ? `:${waypoints}` : ""}`;
}

export function makeBufferCacheKey(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  vehicle: string
): string {
  return `buffer:${fromLat.toFixed(4)}:${fromLon.toFixed(4)}:${toLat.toFixed(4)}:${toLon.toFixed(4)}:${vehicle}`;
}
