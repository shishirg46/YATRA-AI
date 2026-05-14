/**
 * FILE: route.ts
 * LOCATION: /app/api/destinations/[id]/live/route.ts
 * PURPOSE: Returns live weather, hazard, safety, and route risk from home.
 * GET /api/destinations/{id}/live
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { PrismaClient }              from "@/app/generated/prisma/client";
import { PrismaPg }                  from "@prisma/adapter-pg";
import { Pool }                      from "pg";
import { fetchWeather }              from "@/lib/collectors/weather";
import { fetchHazard }               from "@/lib/collectors/hazard";
import { computeSafetyScore, buildHealthFlags } from "@/lib/scoring/safety";
import { assessRouteSegment }        from "@/lib/analysis/group-risk";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const location = await prisma.location.findUnique({
    where: { id },
    include: { district: { include: { province: true } } },
  });

  if (!location) return NextResponse.json({ message: "Destination not found." }, { status: 404 });

  const [user, profileNotif, userHealth] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        homeLocation: {
          include: { district: { include: { province: true } } },
        },
      },
    }),
    prisma.notification.findFirst({
      where: { userId: session.user.id, message: { contains: '"_type":"PROFILE"' } },
    }),
    prisma.userHealth.findUnique({
      where: { userId: session.user.id },
      select: {
        fitnessLevel:      true,
        mobilityLimited:   true,
        chronicConditions: true,
        allergies:         true,
      },
    }),
  ]);

  const profile = profileNotif ? JSON.parse(profileNotif.message) : null;
  const travelPurposes = (profile?.travelPurposes ?? []) as string[];
  const healthFlags = userHealth ? buildHealthFlags(userHealth) : [];

  const weather = await fetchWeather(location.latitude, location.longitude);
  const hazard  = await fetchHazard(location.district.name, location.latitude, location.longitude);

  const liveWeather = weather ?? {
    temperature: 18,
    humidity:    60,
    rainfall:    0,
    windSpeed:   3,
    pressure:    1013,
    description: "fallback:weather",
    source:      "fallback",
    sourceLabel: "Nepal estimate",
    officialSource: false,
  };

  const liveHazard = { ...hazard, heatIndex: Math.max(0, Math.min((liveWeather.temperature - 25) / 20, 1)) };

  const safety = computeSafetyScore(
    liveWeather,
    liveHazard,
    ["SOLO", ...travelPurposes, ...healthFlags],
    "SOLO",
    liveWeather.source,
    {
      altitude:     location.altitude,
      districtName: location.district.name,
      locationName: location.name,
    }
  );

  let routeRisk = null;
  const home = user?.homeLocation;
  if (home && home.latitude !== 0 && home.longitude !== 0 && location.id !== home.id) {
    routeRisk = await assessRouteSegment(
      {
        locationId:    home.id,
        locationName:  home.name,
        district:      home.district.name,
        province:      home.district.province.name,
        lat:           home.latitude,
        lon:           home.longitude,
        altitude:      home.altitude,
        arrivalDate:   new Date().toISOString().split("T")[0],
        departureDate: new Date().toISOString().split("T")[0],
      },
      {
        locationId:    location.id,
        locationName:  location.name,
        district:      location.district.name,
        province:      location.district.province.name,
        lat:           location.latitude,
        lon:           location.longitude,
        altitude:      location.altitude,
        arrivalDate:   new Date().toISOString().split("T")[0],
        departureDate: new Date().toISOString().split("T")[0],
      }
    ).catch(() => null);
  }

  return NextResponse.json({
    location: {
      id:       location.id,
      name:     location.name,
      district: location.district.name,
      province: location.district.province.name,
      altitude: location.altitude,
    },
    weather: liveWeather,
    hazard: liveHazard,
    safety,
    routeRisk,
    assessedAt: new Date().toISOString(),
    isLive: true,
  });
}
