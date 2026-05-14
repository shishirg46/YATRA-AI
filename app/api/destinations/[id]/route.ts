/**
 * FILE: route.ts
 * LOCATION: /app/api/destinations/[id]/route.ts
 * PURPOSE: Returns comprehensive data for the Destination Detail Page
 *
 * GET /api/destinations/{id}
 *
 * Returns: location info, live weather/hazard, safety score breakdown,
 *          weather/hazard history, assessment trend, seasonal guide,
 *          connected routes, and nearby destinations.
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

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── Seasonal helpers ──────────────────────────────────────────────────────────

function getSeason(month: number): string {
  if (month >= 6  && month <= 9)  return "Monsoon";
  if (month >= 12 || month <= 2)  return "Winter";
  if (month >= 3  && month <= 5)  return "Pre-monsoon (Spring)";
  return "Post-monsoon (Autumn)";
}

function getSeasonalGuide(altitude: number | null): {
  seasons: { name: string; months: string; risk: string; description: string }[];
  best: string;
  worst: string;
} {
  const alt = altitude ?? 0;
  const isHigh = alt > 3000;

  return {
    seasons: [
      {
        name: "Pre-monsoon (Spring)",
        months: "Mar – May",
        risk: isHigh ? "MEDIUM" : "LOW",
        description: isHigh
          ? "Popular trekking season. Clear mornings with afternoon thunderstorm risk above 3500m. Rhododendrons bloom at lower elevations."
          : "Warm and pleasant. Occasional pre-monsoon showers in late May. Good visibility for mountain views.",
      },
      {
        name: "Monsoon",
        months: "Jun – Sep",
        risk: "HIGH",
        description: "Heavy rainfall, active landslides, flooding, and road closures. Leeches on trails. Terai areas face flood risk. Not recommended for trekking.",
      },
      {
        name: "Post-monsoon (Autumn)",
        months: "Oct – Nov",
        risk: "LOW",
        description: isHigh
          ? "Best trekking season. Crystal-clear skies, stable weather, outstanding mountain views. Trails are dry and well-traveled."
          : "Comfortable temperatures, minimal rain, excellent visibility. Peak tourist season across Nepal.",
      },
      {
        name: "Winter",
        months: "Dec – Feb",
        risk: isHigh ? "HIGH" : "LOW",
        description: isHigh
          ? "Cold and snowy above 3500m. Passes may close. Shorter daylight hours. Full winter gear essential. Some routes officially closed."
          : "Cool and dry. Clear skies with some morning fog in valleys. Pleasant for cultural tours and lowland exploration.",
      },
    ],
    best: isHigh ? "Post-monsoon (Autumn)" : "Post-monsoon (Autumn)",
    worst: "Monsoon",
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    // ── 1. Fetch core location data ─────────────────────────────────────────
    const location = await prisma.location.findUnique({
      where: { id },
      include: { district: { include: { province: true } } },
    });

    if (!location) {
      return NextResponse.json({ message: "Destination not found." }, { status: 404 });
    }

    // ── 2. Fetch user data for personalised scoring ──────────────────────────
    const [profileNotif, userHealth] = await Promise.all([
      prisma.notification.findFirst({
        where: { userId: session.user.id, message: { contains: '"_type":"PROFILE"' } },
      }),
      prisma.userHealth.findUnique({
        where: { userId: session.user.id },
        select: {
          fitnessLevel: true,
          mobilityLimited: true,
          chronicConditions: true,
          allergies: true,
        },
      }),
    ]);

    const profile = profileNotif ? JSON.parse(profileNotif.message) : null;
    const travelPurposes = (profile?.travelPurposes ?? []) as string[];
    const healthFlags = userHealth ? buildHealthFlags(userHealth) : [];
    const scoringPurposes = [...travelPurposes, ...healthFlags];

    // ── 3. Fetch everything else in parallel ────────────────────────────────
    const [
      weatherResult,
      hazardResult,
      weatherHistory,
      hazardHistory,
      assessmentHistory,
      connectedRoutes,
      nearbyLocations,
    ] = await Promise.all([
      // Live weather
      fetchWeather(location.latitude, location.longitude).catch(() => null),

      // Live hazard
      fetchHazard(location.district.name, location.latitude, location.longitude).catch(() => ({
        floodIndex: 0, landslideIndex: 0, earthquakeIndex: 0, heatIndex: 0, airQuality: 0, source: "unavailable",
      })),

      // Weather history — last 30 data points
      prisma.weatherData.findMany({
        where: { locationId: id },
        orderBy: { recordedAt: "desc" },
        take: 30,
        select: {
          recordedAt: true,
          temperature: true,
          humidity: true,
          rainfall: true,
          windSpeed: true,
          pressure: true,
          source: true,
        },
      }),

      // Hazard history — last 30 data points
      prisma.hazardData.findMany({
        where: { locationId: id },
        orderBy: { recordedAt: "desc" },
        take: 30,
        select: {
          recordedAt: true,
          floodIndex: true,
          landslideIndex: true,
          heatIndex: true,
          airQuality: true,
        },
      }),

      // Assessment history — last 20 entries
      prisma.riskAssessment.findMany({
        where: { locationId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          createdAt: true,
          safetyScore: true,
          safetyLevel: true,
          confidence: true,
        },
      }),

      // Connected route templates
      prisma.routeTemplate.findMany({
        where: {
          isActive: true,
          OR: [
            { originLocationId: id },
            { destinationLocationId: id },
          ],
        },
        include: {
          originLocation: { select: { id: true, name: true } },
          destinationLocation: { select: { id: true, name: true } },
        },
        take: 10,
      }),

      // Nearby destinations in same district (top 6, excluding self)
      prisma.location.findMany({
        where: {
          districtId: location.districtId,
          id: { not: id },
          riskReports: { some: {} },
        },
        include: {
          district: { include: { province: true } },
          riskReports: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              safetyScore: true,
              safetyLevel: true,
            },
          },
        },
        take: 6,
      }),
    ]);

    // ── 4. Compute live safety score ────────────────────────────────────────
    const liveWeather = weatherResult ?? {
      temperature: 18, humidity: 60, rainfall: 0, windSpeed: 3,
      pressure: 1013, description: "fallback:weather", source: "fallback",
      sourceLabel: "Nepal estimate", officialSource: false,
    };

    const liveHazard = {
      ...hazardResult,
      heatIndex: Math.max(0, Math.min(((liveWeather as { temperature: number }).temperature - 25) / 20, 1)),
    };

    const safety = computeSafetyScore(
      liveWeather as { temperature: number; humidity: number; rainfall: number; windSpeed: number; pressure: number },
      liveHazard as { floodIndex: number; landslideIndex: number; earthquakeIndex: number; heatIndex: number; airQuality: number },
      ["SOLO", ...scoringPurposes],
      "SOLO",
      (liveWeather as { source?: string }).source ?? "unknown",
      {
        altitude: location.altitude,
        districtName: location.district.name,
        locationName: location.name,
      }
    );

    // ── 5. Build seasonal guide ─────────────────────────────────────────────
    const now = new Date();
    const currentSeason = getSeason(now.getMonth() + 1);
    const guide = getSeasonalGuide(location.altitude);

    // ── 6. Format response ──────────────────────────────────────────────────
    return NextResponse.json({
      location: {
        id: location.id,
        name: location.name,
        district: location.district.name,
        province: location.district.province.name,
        altitude: location.altitude,
        latitude: location.latitude,
        longitude: location.longitude,
      },

      safety: {
        score: safety.safetyScore,
        level: safety.safetyLevel,
        confidence: safety.confidence,
        penalties: safety.decisionTrace.penalties,
        multipliers: safety.decisionTrace.multipliers,
        totalPenalty: safety.decisionTrace.totalPenalty,
        reasoning: safety.decisionTrace.reasoning,
      },

      liveWeather: {
        temperature: (liveWeather as Record<string, unknown>).temperature,
        humidity: (liveWeather as Record<string, unknown>).humidity,
        rainfall: (liveWeather as Record<string, unknown>).rainfall,
        windSpeed: (liveWeather as Record<string, unknown>).windSpeed,
        pressure: (liveWeather as Record<string, unknown>).pressure,
        description: (liveWeather as Record<string, unknown>).description ?? null,
        source: (liveWeather as Record<string, unknown>).source ?? null,
        sourceLabel: (liveWeather as Record<string, unknown>).sourceLabel ?? null,
        officialSource: (liveWeather as Record<string, unknown>).officialSource ?? false,
      },

      liveHazard: {
        floodIndex: liveHazard.floodIndex,
        landslideIndex: liveHazard.landslideIndex,
        earthquakeIndex: liveHazard.earthquakeIndex ?? 0,
        airQuality: liveHazard.airQuality,
      },

      weatherHistory: weatherHistory.reverse().map((w) => ({
        recordedAt: w.recordedAt,
        temperature: w.temperature,
        humidity: w.humidity,
        rainfall: w.rainfall,
        windSpeed: w.windSpeed,
      })),

      hazardHistory: hazardHistory.reverse().map((h) => ({
        recordedAt: h.recordedAt,
        floodIndex: h.floodIndex,
        landslideIndex: h.landslideIndex,
        heatIndex: h.heatIndex,
        airQuality: h.airQuality,
      })),

      assessmentHistory: assessmentHistory.reverse().map((a) => ({
        createdAt: a.createdAt,
        safetyScore: a.safetyScore,
        safetyLevel: a.safetyLevel,
        confidence: a.confidence,
      })),

      seasonalGuide: {
        current: currentSeason,
        ...guide,
      },

      connectedRoutes: connectedRoutes.map((r) => ({
        id: r.id,
        name: r.name,
        distanceKm: r.distanceKm,
        from: r.originLocation,
        to: r.destinationLocation,
      })),

      nearbyDestinations: nearbyLocations.map((loc) => ({
        id: loc.id,
        name: loc.name,
        district: loc.district.name,
        province: loc.district.province.name,
        altitude: loc.altitude,
        safetyScore: loc.riskReports[0]?.safetyScore ?? null,
        safetyLevel: loc.riskReports[0]?.safetyLevel ?? null,
      })),

      assessedAt: new Date().toISOString(),
      isLive: true,
    });

  } catch (err) {
    console.error("[destinations/[id]]", err);
    return NextResponse.json({ message: "Server error." }, { status: 500 });
  }
}
