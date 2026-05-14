/**
 * FILE: route.ts
 * LOCATION: /app/api/dashboard/route.ts
 * PURPOSE: Returns all data needed for the dashboard page
 *
 * DESTINATIONS:
 *   Only returns locations that have at least one RiskAssessment row.
 *   Re-scores each using the user's travel purposes + health flags
 *   so the score shown is personalised to this specific user.
 *   Sorted safest first.
 *
 * FIRST RUN:
 *   destinations: [] until POST /api/assess runs successfully.
 *   curl -X POST http://localhost:3000/api/assess \
 *        -H "Authorization: Bearer $ASSESS_SECRET"
 */

export const dynamic = "force-dynamic";

import { NextResponse }  from "next/server";
import { auth }          from "@/lib/auth";
import { headers }       from "next/headers";
import { PrismaClient }  from "@/app/generated/prisma/client";
import { PrismaPg }      from "@prisma/adapter-pg";
import { Pool }          from "pg";
import { computeSafetyScore, buildHealthFlags, WeatherInput, HazardInput, LocationContext } from "@/lib/scoring/safety";

// Prisma stores JSON columns as JsonValue — we cast through unknown to our types
type JsonRecord = Record<string, unknown>;

function getWeatherMeta(snapshot: unknown) {
  const data = (snapshot ?? {}) as Record<string, unknown>;
  return {
    source: typeof data.source === "string" ? data.source : undefined,
    sourceLabel: typeof data.sourceLabel === "string" ? data.sourceLabel : undefined,
    officialSource: typeof data.officialSource === "boolean" ? data.officialSource : undefined,
    stationName: typeof data.stationName === "string" ? data.stationName : undefined,
    stationDistanceKm: typeof data.stationDistanceKm === "number" ? data.stationDistanceKm : undefined,
  };
}

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Fetch user, profile notification, and health in parallel
    const [user, userHealth] = await Promise.all([
      prisma.user.findUnique({
        where:   { id: session.user.id },
        include: {
          homeLocation: {
            include: { district: { include: { province: true } } },
          },
          preference: true,
          behavior: true,
        },
      }),
      prisma.userHealth.findUnique({
        where:  { userId: session.user.id },
        select: {
          fitnessLevel:      true,
          mobilityLimited:   true,
          chronicConditions: true,
          allergies:         true,
          bloodType:         true,
        },
      }),
    ]);

    if (!user || !user.preference) {
      return NextResponse.json({ message: "Profile incomplete", needsOnboarding: true }, { status: 403 });
    }

    // Combine travel purposes + health flags for personalised scoring
    const healthFlags     = userHealth ? buildHealthFlags(userHealth) : [];
    const scoringPurposes = healthFlags; // Removed travelPurposes from health flag mix since it's now in preference

    // Fetch only assessed locations (those with at least one RiskAssessment)
    const locations = await prisma.location.findMany({
      where: { riskReports: { some: {} } },
      include: {
        district: { include: { province: true } },
        riskReports: {
          orderBy: { createdAt: "desc" },
          take:    1,
          select: {
            safetyScore:     true,
            safetyLevel:     true,
            confidence:      true,
            decisionTrace:   true,
            weatherSnapshot: true,
            hazardSnapshot:  true,
            createdAt:       true,
          },
        },
      },
    });

    // Build destination cards with personalised scores
    const destinations = locations.map((loc) => {
      const latest   = loc.riskReports[0];
      let score      = latest.safetyScore;
      let level      = latest.safetyLevel;

      const trace   = latest.decisionTrace as unknown as JsonRecord;
      let reasoning = (Array.isArray(trace?.reasoning) ? trace.reasoning : []) as string[];

      const weatherSnap = latest.weatherSnapshot as unknown as WeatherInput | null;
      const hazardRaw   = latest.hazardSnapshot  as unknown as (HazardInput & { earthquakeIndex?: number }) | null;
      // Ensure earthquakeIndex exists — older snapshots may not have it
      const hazardSnap  = hazardRaw ? { ...hazardRaw, earthquakeIndex: hazardRaw.earthquakeIndex ?? 0 } : null;

      // Always re-score using user's health + location context
      // Even users with no travel purposes get personalised scores
      // (health flags alone change altitude/air quality penalties significantly)
      if (weatherSnap && hazardSnap) {
        try {
          const result = computeSafetyScore(
            weatherSnap,
            hazardSnap,
            scoringPurposes, // may be empty — health flags still apply
            "SOLO",
            "cached",
            {
              altitude:     loc.altitude,
              districtName: loc.district.name,
              locationName: loc.name,
            }
          );
          score     = result.safetyScore;
          level     = result.safetyLevel;
          reasoning = result.decisionTrace.reasoning;
        } catch { /* keep stored score on error */ }
      }

      const w = weatherSnap;
      const weatherMeta = getWeatherMeta(weatherSnap);
      const weatherRecord = weatherSnap as unknown as JsonRecord | null;
      const hazard = hazardSnap ? {
        floodIndex:     hazardSnap.floodIndex,
        landslideIndex: hazardSnap.landslideIndex,
        earthquakeIndex: hazardSnap.earthquakeIndex,
        airQuality:     hazardSnap.airQuality,
      } : null;

      return {
        id:          loc.id,
        name:        loc.name,
        district:    loc.district.name,
        province:    loc.district.province.name,
        latitude:    loc.latitude,
        longitude:   loc.longitude,
        altitude:    loc.altitude ?? null,
        safetyScore: score,
        safetyLevel: level,
        confidence:  latest.confidence,
        reasoning,
        weather: w ? {
          temperature: w.temperature,
          rainfall:    w.rainfall,
          windSpeed:   w.windSpeed,
          description: typeof weatherRecord?.description === "string"
            ? String(weatherRecord.description)
            : undefined,
          source: weatherMeta.source,
          sourceLabel: weatherMeta.sourceLabel,
          officialSource: weatherMeta.officialSource,
          stationName: weatherMeta.stationName,
          stationDistanceKm: weatherMeta.stationDistanceKm,
        } : null,
        hazard,
        assessedAt: latest.createdAt,
      };
    });

    // Safest destinations first
    destinations.sort((a, b) => b.safetyScore - a.safetyScore);

    const stats = {
      total:    destinations.length,
      safe:     destinations.filter((d) => d.safetyLevel === "SAFE").length,
      caution:  destinations.filter((d) => d.safetyLevel === "CAUTION").length,
      highRisk: destinations.filter((d) => d.safetyLevel === "HIGH_RISK").length,
      extreme:  destinations.filter((d) => d.safetyLevel === "EXTREME").length,
    };

    return NextResponse.json({
      user: {
        id:       user?.id,
        name:     user?.name,
        email:    user?.email,
        image:    user?.image,
        username: user?.username ?? null,
        homeLocation: user?.homeLocation ? {
          name:     user.homeLocation.name,
          district: user.homeLocation.district.name,
          province: user.homeLocation.district.province.name,
        } : null,
        preference: user?.preference ?? null,
        behavior: user?.behavior ?? null,
      },
      destinations,
      stats,
    });

  } catch (err) {
    console.error("[dashboard]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
