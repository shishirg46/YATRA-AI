import { NextRequest, NextResponse } from "next/server";
import { getNearbyDestinations } from "@/lib/destinations/pipeline";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get("lat") ?? "");
    const lon = parseFloat(searchParams.get("lon") ?? "");
    const radiusKm = parseFloat(searchParams.get("radius") ?? "10");
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      return NextResponse.json({ error: "lat and lon query params required" }, { status: 400 });
    }

    const destinations = await getNearbyDestinations(lat, lon, radiusKm, limit);

    return NextResponse.json({ destinations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[destinations/nearby]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
