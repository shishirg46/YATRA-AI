export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { fetchRouteWithAlternatives } from "@/lib/routing/openroute-service";
import { computeRouteRisk } from "@/lib/scoring/route-risk";
import { fetchDisasterCounts, buildCorridorLookup } from "@/lib/scoring/disaster-data";
import { prisma } from "@/lib/prisma";
import type { VehicleProfile } from "@/lib/routing/types";
import { withRateLimit } from "@/lib/rate-limit";

async function getRouteAlternativesHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const originLat = parseFloat(searchParams.get("originLat") || "");
  const originLon = parseFloat(searchParams.get("originLon") || "");
  const destLat = parseFloat(searchParams.get("destLat") || "");
  const destLon = parseFloat(searchParams.get("destLon") || "");
  const originDistrict = searchParams.get("originDistrict") || "";
  const destDistrict = searchParams.get("destDistrict") || "";
  const vehicle = (searchParams.get("vehicle") || "car") as VehicleProfile;

  if (!isFinite(originLat) || !isFinite(originLon) || !isFinite(destLat) || !isFinite(destLon)) {
    return NextResponse.json({ message: "Invalid coordinates" }, { status: 400 });
  }

  console.log("[routes/alternatives] req:", { originLat, originLon, destLat, destLon, vehicle });

  try {
    const routes = await fetchRouteWithAlternatives(
      { lat: originLat, lon: originLon },
      { lat: destLat, lon: destLon },
      vehicle,
    );

    const isMonsoon = (() => {
      const m = new Date().getMonth() + 1;
      return m >= 6 && m <= 9;
    })();

    // Get user preferences for risk computation
    const userPref = await prisma.userPreference.findUnique({
      where: { userId: session.user.id },
      select: { interests: true, riskTolerance: true, travelStyle: true },
    });
    const purposes = [...(userPref?.interests ?? []), ...(userPref?.travelStyle ?? [])];
    const currentMonth = new Date().getMonth() + 1;

    // Fetch disaster event counts per district for route-aware risk
    const { historicDisasters, recentDisasters } = await fetchDisasterCounts(prisma);
    const corridorDistrictLookup = buildCorridorLookup(
      [
        originDistrict ? { lat: originLat, lon: originLon, district: originDistrict } : null,
        destDistrict ? { lat: destLat, lon: destLon, district: destDistrict } : null,
      ].filter(Boolean) as { lat: number; lon: number; district: string }[],
    );

    const alternatives = await Promise.all(
      routes.map(async (route, idx) => {
        const risk = computeRouteRisk({
          originLat, originLon, destLat, destLon,
          originAlt: null, destAlt: null,
          isMonsoon, currentMonth,
          purposes,
          corridorDistrictLookup,
          historicDisasters,
          recentDisasters,
        });

        // Label based on route characteristics
        let label: string;
        if (idx === 0) label = "Recommended";
        else if (route.distance === Math.min(...routes.map((r) => r.distance))) label = "Shortest";
        else if (route.duration === Math.min(...routes.map((r) => r.duration))) label = "Fastest";
        else label = `Alternative ${idx + 1}`;

        return {
          index: idx,
          label,
          distance: route.distance,
          duration: route.duration,
          distanceKm: Math.round(route.distance / 1000 * 10) / 10,
          durationMin: Math.round(route.duration / 60),
          polyline: route.coordinates,
          encodedPolyline: route.encodedPolyline,
          riskScore: risk.routeRiskScore,
          riskLevel: risk.routeRiskLevel,
          summary: `${Math.round(route.distance / 1000)} km · ${Math.round(route.duration / 60)} min · ${risk.routeRiskLevel}`,
        };
      }),
    );

    // Assign scenic label to the route with most elevation change or longest
    if (alternatives.length >= 2) {
      const longest = alternatives.reduce((a, b) => (a.distance > b.distance ? a : b));
      const scenic = alternatives.find((a) => a.label === "Recommended" || a.label === "Alternative 2");
      if (scenic && longest.index !== 0) {
        scenic.label = "Scenic";
      } else if (alternatives.length > 2) {
        alternatives[2].label = "Scenic";
      }
    }

    return NextResponse.json({ alternatives, count: alternatives.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[routes/alternatives]", msg, err instanceof Error ? err.stack : "");
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

export const GET = withRateLimit(getRouteAlternativesHandler, { max: 20, windowSeconds: 60 });
