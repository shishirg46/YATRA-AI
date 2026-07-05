export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool } from "@/lib/prisma";
import { matchRouteToSegments } from "@/lib/routing/route-matcher";
import { enrichRouteWithHazards } from "@/lib/routing/route-intelligence-engine";
import { withRateLimit } from "@/lib/rate-limit";

const deterministicRequestSchema = z.object({
  origin: z.array(z.number()).length(2),
  destination: z.array(z.number()).length(2),
  graphVersion: z.string().default("v3-kathmandu"),
});

async function handler(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parsed = deterministicRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid request", errors: parsed.error.issues },
        { status: 400 },
      );
    }

    const { origin, destination, graphVersion } = parsed.data;
    const osrmUrl = process.env.OSRM_URL || "http://localhost:5000";

    const result = await matchRouteToSegments(
      pgPool,
      origin as [number, number],
      destination as [number, number],
      graphVersion,
      osrmUrl,
    );

    if (!result) {
      return NextResponse.json(
        { message: "OSRM unreachable or no route found" },
        { status: 502 },
      );
    }

    if (result.segments.length === 0) {
      return NextResponse.json({
        route: {
          origin,
          destination,
          totalDistanceM: result.totalDistanceM,
          totalDurationS: result.totalDurationS,
          confidence: result.confidence,
        },
        segments: [],
        hazards: [],
        clusters: [],
        summary: {
          highestSeverity: "unknown",
          estimatedDelayMin: 0,
          affectedDistanceM: 0,
          totalHazards: 0,
          confidence: result.confidence,
        },
      });
    }

    // Fetch full OSRM geometry for hazard projection
    const osrmRes = await fetch(
      `${osrmUrl}/route/v1/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=full&geometries=geojson`
    );
    if (!osrmRes.ok) {
      return NextResponse.json(
        { message: "Failed to fetch route geometry from OSRM" },
        { status: 502 },
      );
    }
    const osrmData = await osrmRes.json();

    const report = await enrichRouteWithHazards(pgPool, {
      segments: result.segments,
      osrmRouteGeojson: osrmData.routes[0].geometry,
      totalDistanceM: result.totalDistanceM,
    });

    // ── Assemble response ───────────────────────────────────────────
    const routeSummary = {
      origin,
      destination,
      totalDistanceM: result.totalDistanceM,
      totalDistanceKm: Math.round(result.totalDistanceM / 10) / 100,
      totalDurationS: result.totalDurationS,
      totalDurationMin: Math.round(result.totalDurationS / 60),
      confidence: Math.round(result.confidence * 1000) / 1000,
      osmWayCount: Object.keys(result.segmentsByWay).length,
    };

    const segments = report.segments.map((s) => ({
      segmentId: s.segmentId,
      orderIndex: s.orderIndex,
      roadName: s.roadName,
      highway: s.highway,
      surface: s.surface,
      lengthM: Math.round(s.lengthM * 10) / 10,
      startKm: Math.round(s.startKm * 1000) / 1000,
      endKm: Math.round(s.endKm * 1000) / 1000,
      hazardCount: s.hazardCount,
      affectedPercent: s.affectedPercent,
      severityScore: s.severityScore,
    }));

    const hazards = report.hazards.map((h) => ({
      hazardId: h.hazardId,
      hazardType: h.hazardType,
      severity: h.severity,
      km: h.km,
      segmentId: h.segmentId,
      roadName: h.roadName,
      highway: h.highway,
      confidence: h.confidence,
      source: h.source,
    }));

    const clusters = report.clusters.map((c) => ({
      hazardType: c.hazardType,
      severity: c.severity,
      startKm: Math.round(c.startKm * 1000) / 1000,
      endKm: Math.round(c.endKm * 1000) / 1000,
      hazardCount: c.hazardCount,
      avgConfidence: Math.round(c.avgConfidence * 100) / 100,
      segmentIds: c.segmentIds,
    }));

    return NextResponse.json({
      route: routeSummary,
      segments,
      hazards,
      clusters,
      summary: {
        highestSeverity: report.highestSeverity,
        mostCommonType: report.mostCommonType,
        totalHazards: report.totalHazards,
        totalHazardTypes: report.totalHazardTypes,
        estimatedDelayMin: report.estimatedDelayMin,
        affectedDistanceM: report.affectedDistanceM,
        affectedPercent: report.affectedPercent,
        severityScore: report.severityScore,
        recommendDetour: report.recommendDetour,
        confidence: result.confidence,
      },
    });
  } catch (err) {
    console.error("[deterministic-route] Error:", err);
    return NextResponse.json(
      { message: "Failed to compute deterministic route", error: String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, { max: 20, windowSeconds: 60 });
