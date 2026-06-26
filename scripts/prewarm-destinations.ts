/**
 * Prewarms destination live data for the most-viewed destinations.
 *
 * Strategy:
 *   Top 30 destinations sorted by popularityScore
 *   + destinations accessed by any user in the last 24h
 *
 * Computes for an "anonymous" profile — user-specific route risk is
 * computed on-demand per user. This prewarm ensures weather + hazard +
 * safety score are cached before a real user requests them.
 *
 * Run via cron every 5 minutes:
 *   npx tsx scripts/prewarm-destinations.ts
 */
import { prisma } from "@/lib/prisma";
import { externalApiCache } from "@/lib/collectors/external-api-cache";
import { computeDestinationLive } from "@/lib/destinations/live";

const ANONYMOUS_USER_ID = "prewarm";

async function prewarmDestinations(): Promise<void> {
  console.log("[prewarm] Starting destination prewarm...");

  // Top 30 destinations by popularity score
  const topDestinations = await prisma.destination.findMany({
    orderBy: { popularityScore: "desc" },
    take: 30,
    select: { id: true, name: true },
  });

  const toPrewarm = topDestinations;

  console.log(`[prewarm] Warming ${toPrewarm.length} destinations...`);

  let warmed = 0;
  let failed = 0;

  for (const dest of toPrewarm) {
    try {
      const cacheKey = `live:${dest.id}:${ANONYMOUS_USER_ID}`;
      await externalApiCache.getOrFetch(
        cacheKey,
        5 * 60_000,
        () => computeDestinationLive(dest.id, ANONYMOUS_USER_ID),
        { timeoutMs: 25_000, negativeTtlMs: 30_000 },
      );
      warmed++;
      if (warmed % 10 === 0) {
        console.log(`[prewarm] ${warmed}/${toPrewarm.length} destinations warmed`);
      }
    } catch {
      failed++;
    }
  }

  console.log(`[prewarm] Complete: ${warmed} warmed, ${failed} failed`);
}

prewarmDestinations()
  .catch((err) => console.error("[prewarm] Fatal error:", err))
  .finally(() => prisma.$disconnect());
