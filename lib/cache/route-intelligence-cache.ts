import { prisma } from "@/lib/prisma";

/**
 * Shared in-memory route intelligence cache.
 *
 * This cache is NEVER authoritative — it is a performance acceleration layer only.
 * The canonical source of truth for "complete" state is the RouteIntelligenceJob
 * DB row with status === "done" and result != null.
 *
 * Cache hydration paths (all originate from DB, never from guesswork):
 *   - warmupCache(): bulk load at worker startup
 *   - handler lazy hydration: per-key inline on cache miss when DB has "done"
 *   - worker write: after enrichment completes
 *
 * In a multi-instance deployment each instance has its own copy;
 * the RouteIntelligenceJob.result DB field provides cross-instance durability.
 */
export const intelligenceCache = new Map<string, { result: object; expiresAt: number }>();

const CACHE_TTL_MS = 30 * 60_000; // 30 minutes

/**
 * Bulk-load recent "done" jobs from DB into in-memory cache.
 * Intended to be called once at worker startup to prevent a cold-start
 * DB burst when many requests arrive simultaneously.
 *
 * Reads up to 200 most-recently-updated jobs where:
 *   - status === "done"
 *   - result != null
 *   - expiresAt > now (still fresh)
 */
export async function warmupCache(): Promise<void> {
  try {
    const now = new Date();
    const done = await prisma.routeIntelligenceJob.findMany({
      where: {
        status: "done",
        expiresAt: { gte: now },
      },
      select: { key: true, result: true, expiresAt: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    for (const job of done) {
      if (!job.result) continue;
      intelligenceCache.set(job.key, {
        result: job.result as object,
        expiresAt: job.expiresAt!.getTime(),
      });
    }
  } catch (err) {
    console.error("[intel-cache] warmup failed (non-fatal):", err);
  }
}
