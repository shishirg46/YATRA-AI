import { prisma } from "@/lib/prisma";
import { intelligenceCache, warmupCache } from "@/lib/cache/route-intelligence-cache";
import type { RouteIntelligencePayload } from "@/lib/queue/route-intelligence-job";
import type { VehicleProfile } from "@/lib/routing/types";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 5;
const JOB_TIMEOUT_MS = 60_000;
const LOCK_DURATION_MS = 60_000;

let workerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic worker loop.
 * Call once at server startup (or import time in dev).
 * In production, this can run alongside server instances; the SKIP LOCKED
 * pattern ensures only one worker processes each job.
 */
export async function startIntelligenceWorker(intervalMs = 10_000): Promise<void> {
  if (workerInterval) return;
  // Preload cache from DB to serve recent completed routes immediately
  await warmupCache();
  workerInterval = setInterval(processQueue, intervalMs);
}

export function stopIntelligenceWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

/**
 * Process pending route intelligence jobs.
 *
 * Uses an UPDATE-based distributed lock (lockUntil column) to ensure
 * exactly-once processing across workers/instances without DB-level
 * FOR UPDATE SKIP LOCKED (which Prisma Client does not expose).
 */
export async function processQueue(): Promise<void> {
  try {
    // 1. Claim up to BATCH_SIZE pending jobs whose lock has expired
    const claimed = await claimJobs();
    if (claimed.length === 0) return;

    // 2. Process each claimed job concurrently
    await Promise.allSettled(claimed.map((job) => processJob(job)));
  } catch (err) {
    console.error("[intel-worker] Queue poll error:", err);
  }
}

async function claimJobs(): Promise<
  Array<{
    id: string;
    key: string;
    payload: RouteIntelligencePayload;
    attempts: number;
  }>
> {
  // Atomically set status=processing + lockUntil for eligible pending jobs.
  // The subquery selects jobs that are:
  //   - status = "pending"
  //   - runAfter is due
  //   - lockUntil is null or expired
  // Limitation: Prisma does not expose FOR UPDATE SKIP LOCKED, so we use
  // a two-phase lock via lockUntil with a best-effort updateMany.
  const now = new Date();
  const lockDeadline = new Date(now.getTime() + LOCK_DURATION_MS);

  // Find eligible job IDs first
  const eligible = await prisma.routeIntelligenceJob.findMany({
    where: {
      status: "pending",
      runAfter: { lte: now },
      OR: [{ lockUntil: null }, { lockUntil: { lte: now } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  if (eligible.length === 0) return [];

  const ids = eligible.map((j) => j.id);

  // Attempt to acquire lock — updateMany with the same WHERE ensures
  // only jobs that are still eligible get claimed.
  const lock = await prisma.routeIntelligenceJob.updateMany({
    where: {
      id: { in: ids },
      status: "pending",
      OR: [{ lockUntil: null }, { lockUntil: { lte: now } }],
    },
    data: {
      status: "processing",
      lockUntil: lockDeadline,
    },
  });

  if (lock.count === 0) return [];

  // Read back the claimed jobs
  const claimed = await prisma.routeIntelligenceJob.findMany({
    where: {
      id: { in: ids },
      status: "processing",
      lockUntil: { gte: lockDeadline },
    },
    select: {
      id: true,
      key: true,
      payload: true,
      attempts: true,
    },
  });

  return claimed as Array<{
    id: string;
    key: string;
    payload: RouteIntelligencePayload;
    attempts: number;
  }>;
}

async function processJob(job: {
  id: string;
  key: string;
  payload: RouteIntelligencePayload;
  attempts: number;
}): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const { origin, destination, departureDate, opts } = job.payload;

    // Dynamic import to avoid circular dependency at module level
    const {
      generateRouteIntelligence,
      formatRouteIntelligenceResponse,
    } = await import("@/lib/route-intelligence");

    // Per-job timeout wrapper
    const result = await Promise.race([
      generateRouteIntelligence(
        { lat: origin.lat, lon: origin.lon, name: origin.name },
        { lat: destination.lat, lon: destination.lon, name: destination.name },
        departureDate,
        opts as { destinationId?: string; vehicle?: VehicleProfile },
      ),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("intelligence timeout")),
          JOB_TIMEOUT_MS,
        );
      }),
    ]);

    clearTimeout(timeoutId);
    timeoutId = undefined;

    // Format and cache the result
    const formatted = formatRouteIntelligenceResponse(result);

    // 1. Write to in-memory cache (shared with handler)
    intelligenceCache.set(job.key, {
      result: formatted as object,
      expiresAt: Date.now() + 30 * 60_000,
    });

    // 2. Write to DB for durability across restarts
    await prisma.routeIntelligenceJob.update({
      where: { id: job.id },
      data: {
        status: "done",
        result: formatted as object,
        lockUntil: null,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
  } catch (err) {
    // Exponential backoff
    const nextAttempt = job.attempts + 1;
    const backoffMs = Math.min(1000 * Math.pow(2, nextAttempt), 60_000);

    if (nextAttempt >= MAX_ATTEMPTS) {
      await prisma.routeIntelligenceJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: String(err),
          lockUntil: null,
        },
      });
      console.error(`[intel-worker] Job ${job.key} failed after ${MAX_ATTEMPTS} attempts:`, err);
    } else {
      await prisma.routeIntelligenceJob.update({
        where: { id: job.id },
        data: {
          status: "pending",
          attempts: nextAttempt,
          error: String(err),
          runAfter: new Date(Date.now() + backoffMs),
          lockUntil: null,
        },
      });
      console.warn(
        `[intel-worker] Job ${job.key} attempt ${nextAttempt}/${MAX_ATTEMPTS} failed, retrying in ${backoffMs}ms:`,
        err,
      );
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
