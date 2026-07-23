import type { CacheEntry } from "./types";
import { narrativeConfig } from "../config";

class AiNarrativeCache {
  private cache = new Map<string, CacheEntry>();

  key(raw: string): string {
    return `${narrativeConfig.cache.version}:${raw}`;
  }

  get(k: string): CacheEntry | undefined {
    const entry = this.cache.get(k);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > narrativeConfig.cache.ttlMs) {
      this.cache.delete(k);
      return undefined;
    }
    return entry;
  }

  set(k: string, entry: Omit<CacheEntry, "createdAt">): void {
    if (this.cache.size >= narrativeConfig.cache.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(k, { ...entry, createdAt: Date.now() });
  }
}

export const narrativeCache = new AiNarrativeCache();
