import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryCache } from "@/lib/cache";

describe("InMemoryCache", () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves values", async () => {
    await cache.set("key1", "value1");
    expect(await cache.get("key1")).toBe("value1");
  });

  it("returns null for missing key", async () => {
    expect(await cache.get("nonexistent")).toBeNull();
  });

  it("respects TTL", async () => {
    await cache.set("key1", "value1", 1000);
    expect(await cache.get("key1")).toBe("value1");

    vi.advanceTimersByTime(1001);
    expect(await cache.get("key1")).toBeNull();
  });

  it("deletes entries", async () => {
    await cache.set("key1", "value1");
    await cache.del("key1");
    expect(await cache.get("key1")).toBeNull();
  });

  it("clears all entries", async () => {
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    await cache.clear();
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).toBeNull();
  });

  it("supports tag-based invalidation", async () => {
    await cache.set("key1", "value1", 5000, ["tag-a"]);
    await cache.set("key2", "value2", 5000, ["tag-a", "tag-b"]);
    await cache.set("key3", "value3", 5000, ["tag-b"]);

    await cache.invalidateByTag("tag-a");
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).toBeNull();
    expect(await cache.get("key3")).toBe("value3");
  });

  it("getOrFetch fetches and caches", async () => {
    const fetcher = vi.fn().mockResolvedValue("fetched");
    const result = await cache.getOrFetch("key1", fetcher, 5000);
    expect(result).toBe("fetched");
    expect(fetcher).toHaveBeenCalledTimes(1);

    const cached = await cache.getOrFetch("key1", fetcher, 5000);
    expect(cached).toBe("fetched");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports size correctly", async () => {
    expect(cache.size()).toBe(0);
    await cache.set("key1", "value1");
    expect(cache.size()).toBe(1);
    await cache.set("key2", "value2");
    expect(cache.size()).toBe(2);
    await cache.clear();
    expect(cache.size()).toBe(0);
  });
});
