export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { resolveTravelOrigin } from "@/lib/routing/origin-resolver";
import { buildSegmentedRoute } from "@/lib/routing/route-service";
import { sampleRoutePoints } from "@/lib/dynamic-route";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * POST /api/routes
 * Builds a segmented route through known corridor places (not direct A→B).
 */
export async function POST(req: NextRequest) {
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

    if (
      !isFiniteNumber(startLat) ||
      !isFiniteNumber(startLon) ||
      !isFiniteNumber(endLat) ||
      !isFiniteNumber(endLon)
    ) {
      return NextResponse.json(
        {
          message:
            "Missing or invalid coordinates. Required: startLat, startLon, endLat, endLon",
        },
        { status: 400 }
      );
    }

    if (!isValidLatLon(startLat, startLon) || !isValidLatLon(endLat, endLon)) {
      return NextResponse.json(
        { message: "Coordinates out of valid range" },
        { status: 400 }
      );
    }

    const session = await auth.api.getSession({ headers: await headers() });
    const resolved = await resolveTravelOrigin({
      lat: startLat,
      lon: startLon,
      name: typeof originName === "string" ? originName : undefined,
      userId: session?.user?.id,
    });

    const built = await buildSegmentedRoute({
      originLat: resolved.place.lat,
      originLon: resolved.place.lon,
      originName: resolved.place.name,
      originRouteNodeId: resolved.routeNodeId,
      destinationLat: endLat,
      destinationLon: endLon,
      destinationId: typeof destinationId === "string" ? destinationId : undefined,
      destinationName: typeof destinationName === "string" ? destinationName : undefined,
    });

    const points = built.polyline.map((p) => ({ lat: p.lat, lon: p.lon }));
    const corridorName = built.nodes.map((n) => n.name).join(" → ");

    const route = {
      id: "segmented-primary",
      name: corridorName,
      distance: built.distance,
      duration: built.duration,
      points,
      sampledPoints: sampleRoutePoints(points, 8),
      nodes: built.nodes,
      segments: built.segments,
      source: built.source,
      resolutionNote: [resolved.note, built.resolutionNote].filter(Boolean).join("; "),
    };

    return NextResponse.json({
      routes: [route],
      origin: built.origin,
      destination: built.destination,
      resolutionNote: [resolved.note, built.resolutionNote].filter(Boolean).join("; "),
    });
  } catch (error) {
    console.error("[api/routes] failed to generate routes:", error);
    const message = error instanceof Error ? error.message : "Failed to generate route";
    return NextResponse.json({ message }, { status: 502 });
  }
}
