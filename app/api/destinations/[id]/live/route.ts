export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";

import {
  computeSafetyScore,
  buildHealthFlags,
} from "@/lib/scoring/safety";

import { assessRouteSegment } from "@/lib/analysis/group-risk";
import { computeRouteRisk } from "@/lib/scoring/route-risk";
import { fetchDisasterCounts, buildCorridorLookup } from "@/lib/scoring/disaster-data";
import { withRateLimit } from "@/lib/rate-limit";

async function getLiveHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // ================= AUTH =================
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    // ================= DESTINATION =================
    const destination = await prisma.destination.findUnique({
      where: { id },
    });

    if (!destination) {
      return NextResponse.json(
        { message: "Destination not found" },
        { status: 404 }
      );
    }

    // ================= USER DATA =================
    const [user, profileNotif, userHealth] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
          homeLocation: {
            include: {
              district: {
                include: { province: true },
              },
            },
          },
        },
      }),

      prisma.notification.findFirst({
        where: {
          userId: session.user.id,
          message: {
            contains: '"_type":"PROFILE"',
          },
        },
      }),

      prisma.userHealth.findUnique({
        where: { userId: session.user.id },
      }),
    ]);

    const profile = profileNotif
      ? JSON.parse(profileNotif.message)
      : null;

    const travelPurposes = profile?.travelPurposes ?? [];
    const healthFlags = userHealth
      ? buildHealthFlags(userHealth)
      : [];

    // ================= WEATHER =================
    const weather = await fetchWeather(
      destination.latitude,
      destination.longitude
    );

    const liveWeather = {
      temperature: weather?.temperature ?? 18,
      humidity: weather?.humidity ?? 60,
      rainfall: weather?.rainfall ?? 0,
      windSpeed: weather?.windSpeed ?? 3,
      pressure: weather?.pressure ?? 1013,

      description: weather?.description ?? "fallback",
      source: weather?.source ?? "fallback",
      sourceLabel: weather?.sourceLabel ?? "Nepal estimate",
      officialSource: weather?.officialSource ?? false,
    };

    // ================= HAZARD =================
    const hazard = await fetchHazard(
      destination.district,
      destination.latitude,
      destination.longitude
    );

    const liveHazard = {
      ...hazard,
      heatIndex: Math.max(
        0,
        Math.min((liveWeather.temperature - 25) / 20, 1)
      ),
    };

    // ================= SAFETY =================
    const safety = computeSafetyScore(
      liveWeather,
      liveHazard,
      ["SOLO", ...travelPurposes, ...healthFlags],
      "SOLO",
      liveWeather.source,
      {
        altitude: destination.altitude ?? null,
        districtName: destination.district,
        locationName: destination.name,
      }
    );

    // ================= ROUTE RISK =================
    const currentMonth = new Date().getMonth() + 1;
    const isMonsoon = currentMonth >= 6 && currentMonth <= 9;
    const purposes = [...travelPurposes, ...healthFlags];

    let routeRisk = null;
    let routeHazardRisk = null;

    const home = user?.homeLocation;

    if (home && home.latitude && home.longitude) {
      routeRisk = await assessRouteSegment(
        {
          locationId: home.id,
          locationName: home.name,
          district: home.district.name,
          province: home.district.province.name,
          lat: home.latitude,
          lon: home.longitude,
          altitude: home.altitude ?? null,
          arrivalDate: new Date().toISOString().split("T")[0],
          departureDate: new Date().toISOString().split("T")[0],
        },
        {
          locationId: destination.id,
          locationName: destination.name,
          district: destination.district,
          province: destination.province,
          lat: destination.latitude,
          lon: destination.longitude,
          altitude: destination.altitude ?? null,
          arrivalDate: new Date().toISOString().split("T")[0],
          departureDate: new Date().toISOString().split("T")[0],
        }
      ).catch(() => null);

      // District-level historic/recent disaster context
      const { historicDisasters, recentDisasters } = await fetchDisasterCounts(prisma);
      const corridorDistrictLookup = buildCorridorLookup([
        { lat: home.latitude, lon: home.longitude, district: home.district.name },
        { lat: destination.latitude, lon: destination.longitude, district: destination.district },
      ]);
      routeHazardRisk = computeRouteRisk({
        originLat: home.latitude,
        originLon: home.longitude,
        originAlt: home.altitude ?? null,
        originDistrict: home.district.name,
        destLat: destination.latitude,
        destLon: destination.longitude,
        destAlt: destination.altitude ?? null,
        destDistrict: destination.district,
        isMonsoon,
        currentMonth,
        purposes,
        corridorDistrictLookup,
        historicDisasters,
        recentDisasters,
      });
    }

    // ================= NEAREST ROUTE NODE =================
    const nearestRouteNode = await prisma.routeNode.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        isHub: true,
      },
    });

    // ================= RESPONSE =================
    return NextResponse.json({
      destination,
      weather: liveWeather,
      hazard: liveHazard,
      safety,
      routeRisk,
      routeHazardRisk,
      nearestRouteNode,
      assessedAt: new Date().toISOString(),
      isLive: true,
    });
  } catch (error) {
    console.error("[DESTINATION_LIVE_ERROR]", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

export const GET = withRateLimit(getLiveHandler, { max: 60, windowSeconds: 60 });