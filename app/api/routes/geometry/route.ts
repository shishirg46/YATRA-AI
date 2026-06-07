export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isPointInNepal } from "@/lib/routing/geo";
import { resolveTravelOrigin } from "@/lib/routing/origin-resolver";
import { buildSegmentedRoute, toMapPayload } from "@/lib/routing/route-service";
import { fetchRouteGeometry } from "@/lib/routing/openroute-service";
import type { RouteInstruction, VehicleProfile } from "@/lib/routing/types";
import { withRateLimit } from "@/lib/rate-limit";

function isValidLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function openRouteServiceFallback(
  originLat: number,
  originLon: number,
  endLat: number,
  endLon: number,
  originName?: string,
  destinationName?: string,
  vehicle: VehicleProfile = "car"
) {
  const route = await fetchRouteGeometry(
    { lat: originLat, lon: originLon, name: originName },
    { lat: endLat, lon: endLon, name: destinationName },
    vehicle
  );

  const instructions: RouteInstruction[] = [];
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      instructions.push(step);
    }
  }

  return {
    waypoints: [
      { lat: originLat, lon: originLon, name: originName ?? "Origin" },
      { lat: endLat, lon: endLon, name: destinationName ?? "Destination" },
    ],
    polyline: route.coordinates,
    segments: [],
    distance: route.distance,
    duration: route.duration,
    instructions,
    segmentRoutes: [],
    encodedPolyline: route.encodedPolyline,
  };
}

async function getRouteGeometryHandler(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const body = await req.json();
    const {
      startLat,
      startLon,
      endLat,
      endLon,
      destinationId,
      destinationName,
      originName,
      accuracy,
      originRouteNodeId,
      useResolvedOrigin = true,
      originAlreadyResolved = false,
      displayStartLat,
      displayStartLon,
      waypoints,
      perSegmentRouting,
      dynamicOsmRouting,
      vehicle = "car",
    } = body;

    if (!isValidLatLon(startLat, startLon) || !isValidLatLon(endLat, endLon)) {
      return NextResponse.json({ message: "Invalid coordinates" }, { status: 400 });
    }

    let originLat = startLat;
    let originLon = startLon;
    let originDisplayLat = startLat;
    let originDisplayLon = startLon;
    let resolvedOriginName = typeof originName === "string" ? originName : undefined;
    let resolvedNodeId = typeof originRouteNodeId === "string" ? originRouteNodeId : null;
    let originNote: string | undefined;

    if (originAlreadyResolved === true) {
      if (!isPointInNepal(startLat, startLon)) {
        return NextResponse.json({ message: "Origin is outside Nepal" }, { status: 400 });
      }
      originDisplayLat = typeof displayStartLat === "number" ? displayStartLat : startLat;
      originDisplayLon = typeof displayStartLon === "number" ? displayStartLon : startLon;
    } else if (useResolvedOrigin !== false) {
      const resolved = await resolveTravelOrigin({
        lat: startLat,
        lon: startLon,
        accuracyMeters: typeof accuracy === "number" ? accuracy : undefined,
        name: resolvedOriginName,
        userId: session?.user?.id,
      });
      originLat = resolved.place.lat;
      originLon = resolved.place.lon;
      originDisplayLat = resolved.place.displayLat ?? resolved.rawLat ?? resolved.place.lat;
      originDisplayLon = resolved.place.displayLon ?? resolved.rawLon ?? resolved.place.lon;
      resolvedOriginName = resolved.place.name;
      resolvedNodeId = resolved.routeNodeId;
      originNote = resolved.note;
    } else if (!isPointInNepal(startLat, startLon)) {
      return NextResponse.json({ message: "Origin is outside Nepal" }, { status: 400 });
    }

    let payload;
    let resolutionNote: string | undefined;

    try {
      const built = await buildSegmentedRoute({
        originLat,
        originLon,
        originDisplayLat,
        originDisplayLon,
        originName: resolvedOriginName,
        originRouteNodeId: resolvedNodeId,
        destinationLat: endLat,
        destinationLon: endLon,
        destinationId: typeof destinationId === "string" ? destinationId : undefined,
        destinationName: typeof destinationName === "string" ? destinationName : undefined,
        waypoints: Array.isArray(waypoints) ? waypoints : undefined,
        perSegmentRouting: perSegmentRouting === true,
        dynamicOsmRouting: dynamicOsmRouting === true,
        vehicle: vehicle as VehicleProfile,
      });
      payload = toMapPayload(built);
      resolutionNote = built.resolutionNote;
    } catch {
      console.warn("[api/routes/geometry] segmented build failed, falling back to OpenRouteService");
      try {
        payload = await openRouteServiceFallback(
          originLat, originLon, endLat, endLon,
          resolvedOriginName,
          typeof destinationName === "string" ? destinationName : undefined,
          vehicle as VehicleProfile
        );
        resolutionNote = "Routed via OpenRouteService";
      } catch (orsErr) {
        console.error("[api/routes/geometry] ORS fallback also failed:", orsErr);
        throw orsErr;
      }
    }

    return NextResponse.json({
      ...payload,
      geometry: null,
      originNote: [originNote, resolutionNote].filter(Boolean).join("; "),
    });
  } catch (error) {
    console.error("[api/routes/geometry] error:", error);
    const message = error instanceof Error ? error.message : "Failed to build route geometry";
    const status = message.includes("outside Nepal") ? 400 : 500;
    return NextResponse.json({ message }, { status });
  }
}

export const POST = withRateLimit(getRouteGeometryHandler, { max: 20, windowSeconds: 60 });
