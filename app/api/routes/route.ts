export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateEnhancedRoadsBetween } from "@/lib/routing/route-generation";
import { withRateLimit } from "@/lib/rate-limit";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function getRoutesHandler(req: NextRequest) {
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
        { message: "Local OSRM returned no road route", roads: [] },
        { status: 502 },
      );
    }

    return NextResponse.json({
      roads: generated.roads,
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
    });
  } catch (error) {
    console.error("[api/routes] failed to generate routes:", error);
    const message = error instanceof Error ? error.message : "Failed to generate route";
    return NextResponse.json({ message }, { status: 502 });
  }
}

export const POST = withRateLimit(getRoutesHandler, { max: 40, windowSeconds: 60 });
