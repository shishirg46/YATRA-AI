export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { analyzeStop } from "@/lib/analysis/stop-analyzer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lat, lon, radiusKm, name } = body;

    if (typeof lat !== "number" || typeof lon !== "number") {
      return NextResponse.json(
        { message: "lat and lon are required numbers" },
        { status: 400 }
      );
    }

    const result = await analyzeStop(lat, lon, { radiusKm, name });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/analysis/stop] Error:", err);
    return NextResponse.json(
      { message: "Failed to analyze stop" },
      { status: 500 }
    );
  }
}
