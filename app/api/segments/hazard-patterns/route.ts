export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { fetchHazard } from "@/lib/collectors/hazard";
import { fetchWeather } from "@/lib/collectors/weather";
import { prisma } from "@/lib/prisma";
import { fetchSegmentHistoricPatterns, fetchRecentSegmentEvents, buildSegmentHazardPattern, hydrateSegmentHazardInput } from "@/lib/analysis/hazard-patterns";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: {
    segments: Array<{
      index: number;
      fromLat: number;
      fromLon: number;
      toLat: number;
      toLon: number;
      floodIndex?: number;
      landslideIndex?: number;
      rainfall?: number;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  if (!body.segments || !Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json({ message: "No segments provided" }, { status: 400 });
  }

  const inputs = body.segments.map((s) => ({
    index: s.index,
    fromLat: s.fromLat,
    fromLon: s.fromLon,
    toLat: s.toLat,
    toLon: s.toLon,
    floodIndex: s.floodIndex ?? 0,
    landslideIndex: s.landslideIndex ?? 0,
    rainfall: s.rainfall ?? 0,
  }));

  const hydratedInputs = await Promise.all(
    inputs.map(async (input) => {
      const midpointLat = (input.fromLat + input.toLat) / 2;
      const midpointLon = (input.fromLon + input.toLon) / 2;

      const [weatherResult, hazardResult] = await Promise.allSettled([
        fetchWeather(midpointLat, midpointLon, req.signal),
        fetchHazard(midpointLat, midpointLon, prisma, req.signal),
      ]);

      const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
      const hazard = hazardResult.status === "fulfilled" ? hazardResult.value : null;

      return hydrateSegmentHazardInput(input, weather, hazard);
    }),
  );

  const [historicMap, recentMap] = await Promise.all([
    fetchSegmentHistoricPatterns(hydratedInputs),
    fetchRecentSegmentEvents(hydratedInputs),
  ]);

  const patterns = hydratedInputs.map((input) => ({
    index: input.index,
    pattern: buildSegmentHazardPattern(input, historicMap.get(input.index), recentMap.get(input.index) ?? 0),
  }));

  return NextResponse.json({ patterns });
}
