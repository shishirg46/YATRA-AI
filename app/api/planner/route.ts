export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool } from "@/lib/prisma";
import { matchRouteToSegments } from "@/lib/routing/route-matcher";
import { enrichRouteWithHazards } from "@/lib/routing/route-intelligence-engine";
import { generatePlannerOutputSafe } from "@/lib/planner/planner";
import { plannerRequestSchema, type PlannerRouteInput } from "@/lib/planner/types";
import { withRateLimit } from "@/lib/rate-limit";

async function handler(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parsed = plannerRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid request", errors: parsed.error.issues },
        { status: 400 },
      );
    }

    const { origin, destination, preferences, graphVersion } = parsed.data;
    const osrmUrl = process.env.OSRM_URL || "http://localhost:5000";

    // Step 1: Match route to segments
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

    // Step 2: Enrich with hazards
    const osrmRes = await fetch(
      `${osrmUrl}/route/v1/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=full&geometries=geojson`,
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

    // Step 3: Build planner input
    const plannerInput: PlannerRouteInput = {
      origin: origin as [number, number],
      destination: destination as [number, number],
      totalDistanceKm: Math.round(result.totalDistanceM / 10) / 100,
      totalDurationMin: Math.round(result.totalDurationS / 60),
      confidence: Math.round(result.confidence * 1000) / 1000,
      osmWayCount: Object.keys(result.segmentsByWay).length,
      segments: report.segments.map((s) => ({
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
      })),
      hazards: report.hazards.map((h) => ({
        hazardId: h.hazardId,
        hazardType: h.hazardType,
        severity: h.severity,
        km: h.km,
        segmentId: h.segmentId,
        roadName: h.roadName,
        highway: h.highway,
        confidence: h.confidence,
        source: h.source,
      })),
      clusters: report.clusters.map((c) => ({
        hazardType: c.hazardType,
        severity: c.severity,
        startKm: Math.round(c.startKm * 1000) / 1000,
        endKm: Math.round(c.endKm * 1000) / 1000,
        hazardCount: c.hazardCount,
        avgConfidence: Math.round(c.avgConfidence * 100) / 100,
        segmentIds: c.segmentIds,
      })),
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
    };

    // Step 4: Run planner
    const planner = generatePlannerOutputSafe(plannerInput);

    return NextResponse.json({
      planner,
      route: {
        origin,
        destination,
        totalDistanceKm: plannerInput.totalDistanceKm,
        totalDurationMin: plannerInput.totalDurationMin,
        confidence: plannerInput.confidence,
        osmWayCount: plannerInput.osmWayCount,
      },
      segments: plannerInput.segments,
      hazards: plannerInput.hazards,
      clusters: plannerInput.clusters,
      summary: plannerInput.summary,
    });
  } catch (err) {
    console.error("[planner] Error:", err);
    return NextResponse.json(
      { message: "Failed to compute planner assessment", error: String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, { max: 10, windowSeconds: 60 });
