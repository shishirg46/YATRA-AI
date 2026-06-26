export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { buildRouteUltraFast } from "@/lib/route-intelligence";
import type { Route } from "@/lib/route-intelligence";
import type { VehicleProfile } from "@/lib/routing/types";
import { routeIntelligenceRequestSchema, validateBody } from "@/lib/validation";
import { withRateLimit } from "@/lib/rate-limit";
import { findNearestRouteNode } from "@/lib/routing/node-graph";
import { routeIntelligenceKey } from "@/lib/routing/route-key";
import { intelligenceCache } from "@/lib/cache/route-intelligence-cache";
import { enqueueRouteIntelligence } from "@/lib/queue/route-intelligence-job";
import { prisma } from "@/lib/prisma";

/**
 * Compute a stable, node-based route intelligence key.
 * Falls back to a coordinate-based key when graph node resolution fails.
 *
 * Node resolution is performed at the handler layer so the key is available
 * before any heavy computation begins.  Downstream graph operations will
 * re-resolve the same nodes (memoized by buildAdjacency).
 *
 * WARNING (Phase 0 invariant):
 *   Node resolution here is for identity construction ONLY.
 *   Do NOT pass resolved nodes into downstream functions — the graph layer
 *   handles its own resolution.
 */
async function makeIntelligenceKey(
  origin: { lat: number; lon: number },
  dest: { lat: number; lon: number },
  departureDate: string,
  vehicle?: string,
): Promise<string> {
  const [originNode, destNode] = await Promise.all([
    findNearestRouteNode(origin.lat, origin.lon),
    findNearestRouteNode(dest.lat, dest.lon),
  ]);
  if (originNode && destNode) {
    return routeIntelligenceKey({
      originNodeId: originNode.id,
      destNodeId: destNode.id,
      departureDate,
      vehicle,
    });
  }
  // Fallback: coordinate-based key (no graph node available)
  return `v0|${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}→${dest.lat.toFixed(4)},${dest.lon.toFixed(4)}|${vehicle ?? "car"}|${departureDate}`;
}

// ── Ultra-fast response formatting ──────────────────────────────────────────────

function formatUltraFastRoutes(routes: Route[]): object[] {
  return routes.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    distance: r.distance,
    duration: r.duration,
    breakpoints: (r.waypoints ?? []).slice(0, 12).map((p) => ({ lat: p.lat, lon: p.lon, name: p.name })),
    breakpointNames: (r as any).breakpointNames ?? [],
    encodedPolyline: r.encodedPolyline,
    turnByTurn: r.turnByTurn,
    placesAlongRoute: r.placesAlongRoute?.slice(0, 10).map((p) => ({
      name: p.placeName,
      category: p.category,
      detourMinutes: p.detourMinutes,
      distanceFromRouteKm: p.distanceFromRouteKm,
      score: p.score,
      lat: p.lat,
      lon: p.lon,
    })),
    rankedStops: r.rankedStops?.slice(0, 5).map((s) => ({
      name: s.name,
      score: s.score,
      detourTime: s.detourTime,
      category: s.category,
    })),
    segments: (r.segments ?? []).map((s) => ({
      from: s.startPoint,
      to: s.endPoint,
      riskLevel: s.riskLevel,
      riskScore: s.riskScore,
      hazards: s.hazards ?? [],
      roadCode: s.roadCode,
      roadName: s.roadName,
    })),
  }));
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function routeIntelligenceHandler(req: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const rawBody = await req.json();
    const parsed = validateBody(routeIntelligenceRequestSchema, rawBody);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error }, { status: parsed.status });
    }

    const { origin, destination, departureDate, destinationId, vehicle } = parsed.data;
    const opts = { destinationId, vehicle: vehicle as VehicleProfile | undefined };
    const key = await makeIntelligenceKey(origin, destination, departureDate, vehicle);

    // ── L1: In-memory cache (performance hint only — never authoritative) ────
    const cached = intelligenceCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ ...cached.result, status: "complete" });
    }

    // ── L2: DB is the source of truth for "complete" ──────────────────────────
    let job: { status: string; result: unknown; expiresAt: Date | null } | null = null;
    try {
      job = await prisma.routeIntelligenceJob.findUnique({
        where: { key },
        select: { status: true, result: true, expiresAt: true },
      });
    } catch (dbErr: unknown) {
      const err = dbErr as { code?: string; message?: string };
      if (err.code === "P2021") {
        console.warn("[route-intelligence][L2] DB table missing (P2021, dev only)");
      } else {
        throw dbErr;
      }
    }
    if (job?.status === "done" && job.result) {
      // Hydrate cache from DB truth
      intelligenceCache.set(key, {
        result: job.result as object,
        expiresAt: job.expiresAt ? job.expiresAt.getTime() : Date.now() + 30 * 60_000,
      });
      return NextResponse.json({ ...job.result as object, status: "complete" });
    }

    // ── L3: Ultra-fast compute + enqueue background enrichment ────────────────
    const controller = new AbortController();
    const slaTimer = setTimeout(() => controller.abort(), 15_000);
    let fast: Awaited<ReturnType<typeof buildRouteUltraFast>>;
    try {
      fast = await buildRouteUltraFast(
        { lat: origin.lat, lon: origin.lon, name: origin.name },
        { lat: destination.lat, lon: destination.lon, name: destination.name },
        departureDate,
        opts,
        controller.signal,
      );
    } finally {
      clearTimeout(slaTimer);
    }

    enqueueRouteIntelligence(key, {
      origin: { lat: origin.lat, lon: origin.lon, name: origin.name },
      destination: { lat: destination.lat, lon: destination.lon, name: destination.name },
      departureDate,
      opts,
    }).catch((enqErr: unknown) => {
      const e = enqErr as { code?: string; message?: string };
      if (e.code !== "P2021") {
        console.warn("[route-intelligence][enqueue] non-critical failure", e.message ?? e);
      }
    });

    return NextResponse.json({
      routes: formatUltraFastRoutes(fast.routes),
      intelligence: null,
      status: "degraded",
    });
  } catch (err) {
    console.error("[route-intelligence] Error:", err);
    return NextResponse.json(
      { message: "Failed to compute route. Please try again.", error: String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(routeIntelligenceHandler, { max: 15, windowSeconds: 60 });
