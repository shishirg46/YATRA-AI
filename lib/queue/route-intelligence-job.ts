import { prisma } from "@/lib/prisma";
import type { VehicleProfile } from "@/lib/routing/types";

export type RouteIntelligencePayload = {
  origin: { lat: number; lon: number; name?: string };
  destination: { lat: number; lon: number; name?: string };
  departureDate: string;
  opts?: { destinationId?: string; vehicle?: VehicleProfile };
};

/**
 * Enqueue a route intelligence job in the DB-backed queue.
 *
 * Single-flight guarantee: the `@@unique([key])` constraint on the
 * RouteIntelligenceJob model ensures at most one pending/processing job
 * per route key at any time.  If a job already exists for this key:
 *   - idle (pending/failed) → reset and reprocess
 *   - in flight (processing) → no-op (already being handled)
 */
export async function enqueueRouteIntelligence(
  key: string,
  payload: RouteIntelligencePayload,
): Promise<void> {
  const existing = await prisma.routeIntelligenceJob.findUnique({
    where: { key },
    select: { status: true },
  });

  if (existing?.status === "processing") {
    return; // already being handled by a worker
  }

  await prisma.routeIntelligenceJob.upsert({
    where: { key },
    create: {
      key,
      status: "pending",
      payload: payload as object,
    },
    update: {
      status: "pending",
      payload: payload as object,
      error: null,
      attempts: 0,
      runAfter: new Date(),
      lockUntil: null,
    },
  });
}
