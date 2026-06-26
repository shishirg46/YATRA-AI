export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateEnhancedRoadsBetween } from "@/lib/routing/route-generation";
import {
  calculateSegmentOwnedRouteRisk,
  fetchDHMWeather as fetchOpenMeteoWeather,
  fetchHistoricalDisastersNearRoute,
  fetchRealtimeDisastersNearRoute,
} from "@/lib/disaster-pipeline";
import { withRateLimit } from "@/lib/rate-limit";
import type { EnhancedRoad } from "@/lib/routing/types";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function roadToRiskInput(road: EnhancedRoad) {
  const routePoints = road.segments.flatMap((seg) =>
    seg.subCoords.map((sc) => sc.coord),
  );
  const segments = road.segments.map((seg) => ({
    from: seg.fromName,
    to: seg.toName,
    midpoint: {
      lat: (seg.fromCoord.lat + seg.toCoord.lat) / 2,
      lon: (seg.fromCoord.lon + seg.toCoord.lon) / 2,
    },
  }));
  return { routePoints, segments, road };
}

async function getRoutesWithRiskHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      startLat,
      startLon,
      endLat,
      endLon,
      destinationId,
      destinationName,
      originName,
    } = body ?? {};

    let resolvedEndLat = endLat;
    let resolvedEndLon = endLon;
    let resolvedDestinationName = destinationName;

    if (destinationId) {
      const destination = await prisma.destination.findUnique({
        where: { id: destinationId },
        select: { name: true, latitude: true, longitude: true },
      });
      if (destination) {
        resolvedEndLat = destination.latitude;
        resolvedEndLon = destination.longitude;
        resolvedDestinationName = destination.name;
      }
    }

    if (
      !isFiniteNumber(startLat) ||
      !isFiniteNumber(startLon) ||
      !isFiniteNumber(resolvedEndLat) ||
      !isFiniteNumber(resolvedEndLon)
    ) {
      return NextResponse.json(
        {
          message:
            "Missing or invalid coordinates. Required: startLat, startLon, endLat, endLon (or destinationId)",
        },
        { status: 400 },
      );
    }

    if (!isValidLatLon(startLat, startLon) || !isValidLatLon(resolvedEndLat, resolvedEndLon)) {
      return NextResponse.json(
        { message: "Coordinates out of valid range" },
        { status: 400 },
      );
    }

    const generated = await generateEnhancedRoadsBetween({
      start: {
        lat: startLat,
        lon: startLon,
        name: typeof originName === "string" ? originName : "User Location",
      },
      destination: {
        lat: resolvedEndLat,
        lon: resolvedEndLon,
        name: resolvedDestinationName || "Destination",
      },
    });

    if (generated.roads.length === 0) {
      return NextResponse.json(
        { message: "Local OSRM returned no road route" },
        { status: 502 },
      );
    }

    const roadInputs = generated.roads.map(roadToRiskInput);
    const allRoutePoints = roadInputs.flatMap((r) => r.routePoints);

    const center = allRoutePoints[Math.floor(allRoutePoints.length / 2)] || { lat: startLat, lon: startLon };

    const [realtime, historical, weather] = await Promise.all([
      fetchRealtimeDisastersNearRoute(allRoutePoints, 15, 7).catch(() => []),
      fetchHistoricalDisastersNearRoute(allRoutePoints, 15).catch(() => []),
      fetchOpenMeteoWeather(center.lat, center.lon).catch(() => ({ rain_mm_per_hr: 0, wind_kph: 0 })),
    ]);

    const roadsWithRisk = roadInputs.map((input) => {
      const risk = calculateSegmentOwnedRouteRisk({
        routePoints: input.routePoints,
        realtimeDisasters: realtime,
        historicalDisasters: historical,
        weather,
        segments: input.segments,
      });

      const segmentRiskMap = new Map<string, (typeof risk.segments)[number]>();
      for (const seg of risk.segments) {
        segmentRiskMap.set(`${seg.from}||${seg.to}`, seg);
      }

      const enrichedSegments = input.road.segments.map((seg) => {
        const riskSeg = segmentRiskMap.get(`${seg.fromName}||${seg.toName}`);
        return {
          ...seg,
          risk: riskSeg
            ? { percent: riskSeg.risk, level: riskSeg.level, alerts: riskSeg.alerts }
            : null,
        };
      });

      return {
        ...input.road,
        segments: enrichedSegments,
        routeRisk: risk.routeRisk,
      };
    });

    return NextResponse.json({
      roads: roadsWithRisk,
      origin: {
        id: null,
        name: typeof originName === "string" ? originName : "User Location",
        lat: startLat,
        lon: startLon,
        match: "coordinates",
      },
      destination: {
        id: destinationId || null,
        name: resolvedDestinationName || "Destination",
        lat: resolvedEndLat,
        lon: resolvedEndLon,
        match: destinationId ? "id" : "coordinates",
      },
      source: "local-osrm+nominatim",
      evidence: {
        weather,
        realtimeCount: realtime.length,
        historicalCount: historical.length,
      },
    });
  } catch (error) {
    console.error("[api/routes/with-risk] failed:", error);
    const message = error instanceof Error ? error.message : "Failed to generate route with risk";
    return NextResponse.json({ message }, { status: 502 });
  }
}

export const POST = withRateLimit(getRoutesWithRiskHandler, { max: 20, windowSeconds: 60 });
