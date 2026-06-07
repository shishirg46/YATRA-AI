export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  tags: string[];
}

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, data: T, ttlMs?: number, tags?: string[]): Promise<void>;
  del(key: string): Promise<void>;
  invalidateByTag(tag: string): Promise<void>;
  clear(): Promise<void>;
}

// ─── In-memory adapter (fallback when Redis is unavailable) ────────────────────

export class InMemoryCache implements CacheAdapter {
  private store = new Map<string, CacheEntry<unknown>>();
  private tagIndex = new Map<string, Set<string>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttlMs = 300_000, tags: string[] = []): Promise<void> {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs, tags });
    for (const tag of tags) {
      const keys = this.tagIndex.get(tag) ?? new Set();
      keys.add(key);
      this.tagIndex.set(tag, keys);
    }
  }

  async del(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      for (const tag of entry.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }
    this.store.delete(key);
  }

  async invalidateByTag(tag: string): Promise<void> {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;
    for (const key of keys) {
      this.store.delete(key);
    }
    this.tagIndex.delete(tag);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.tagIndex.clear();
  }

  size(): number {
    return this.store.size;
  }

  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number,
    tags?: string[],
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const data = await fetcher();
    await this.set(key, data, ttlMs, tags);
    return data;
  }
}

// ─── Singleton instances ──────────────────────────────────────────────────────

/** Route / OSRM geometry cache (10 min) */
export const routeCache = new InMemoryCache();

/** Weather snapshot cache (10 min) */
export const weatherCache2 = new InMemoryCache();

/** AI response cache (5 min) */
export const aiCache = new InMemoryCache();

/** Reverse-geocode location name cache (30 min) */
export const geoNameCache = new InMemoryCache();

/** Analysis / pillar-model cache (3 min) */
export const analysisCache = new InMemoryCache();

// ─── Background cleanup ───────────────────────────────────────────────────────

function sweepStale(store: Map<string, CacheEntry<unknown>>, tagIndex: Map<string, Set<string>>) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
      for (const tag of entry.tags) tagIndex.get(tag)?.delete(key);
    }
  }
}

setInterval(() => {
  sweepStale(routeCache["store"], routeCache["tagIndex"]);
  sweepStale(weatherCache2["store"], weatherCache2["tagIndex"]);
  sweepStale(aiCache["store"], aiCache["tagIndex"]);
  sweepStale(geoNameCache["store"], geoNameCache["tagIndex"]);
  sweepStale(analysisCache["store"], analysisCache["tagIndex"]);
}, 60_000);
