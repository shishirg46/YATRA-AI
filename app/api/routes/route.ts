export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { generateDynamicRoutes } from "@/lib/dynamic-route";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { startLat, startLon, endLat, endLon } = body ?? {};

    if (
      !isFiniteNumber(startLat) ||
      !isFiniteNumber(startLon) ||
      !isFiniteNumber(endLat) ||
      !isFiniteNumber(endLon)
    ) {
      return NextResponse.json(
        { message: "Missing or invalid coordinates. Required: startLat, startLon, endLat, endLon" },
        { status: 400 }
      );
    }

    if (!isValidLatLon(startLat, startLon) || !isValidLatLon(endLat, endLon)) {
      return NextResponse.json(
        { message: "Coordinates out of valid range" },
        { status: 400 }
      );
    }

    const result = await generateDynamicRoutes({ startLat, startLon, endLat, endLon });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/routes] failed to generate routes:", error);
    return NextResponse.json(
      { message: "Failed to generate routes dynamically" },
      { status: 502 }
    );
  }
}
