/**
 * FILE: route.ts
 * LOCATION: /app/api/analyze/route.ts
 * PURPOSE: Returns a full temporal risk report for a destination on a specific date
 *
 * POST /api/analyze
 * Body: {
 *   destinationId: string   — Location.id from DB
 *   travelDate:    string   — YYYY-MM-DD
 *   tripType:      "SOLO" | "GROUP"
 * }
 *
 * Returns: TravelRiskReport — full safety analysis with:
 *   - Historical weather stats (OpenMeteo 5-year)
 *   - Historical hazard incidents (BIPAD + USGS)
 *   - Seasonal risk factors
 *   - Personalised health advisories (from user's UserHealth)
 *   - Recommendations (gear, medical, timing, route)
 *   - Notable past disasters
 *
 * Cached for 6 hours (same destination + date → don't re-fetch)
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { PrismaClient }              from "@/app/generated/prisma/client";
import { PrismaPg }                  from "@prisma/adapter-pg";
import { Pool }                      from "pg";
import { analyzeTemporalRisk }       from "@/lib/analysis/temporal-risk";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    destinationId: string;
    travelDate:    string;
    tripType:      "SOLO" | "GROUP";
  };

  const { destinationId, travelDate, tripType } = body;

  if (!destinationId || !travelDate) {
    return NextResponse.json({ message: "destinationId and travelDate are required." }, { status: 400 });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate)) {
    return NextResponse.json({ message: "travelDate must be YYYY-MM-DD format." }, { status: 400 });
  }

  try {
    // Fetch destination details
    const location = await prisma.location.findUnique({
      where:   { id: destinationId },
      include: { district: { include: { province: true } } },
    });

    if (!location) {
      return NextResponse.json({ message: "Destination not found." }, { status: 404 });
    }

    // Fetch user's health profile for personalised analysis
    const userHealth = await prisma.userHealth.findUnique({
      where:  { userId: session.user.id },
      select: {
        fitnessLevel:      true,
        mobilityLimited:   true,
        chronicConditions: true,
        allergies:         true,
      },
    });

    // Fetch user's home location for altitude comparison
    const user = await prisma.user.findUnique({
      where:   { id: session.user.id },
      include: {
        homeLocation: {
          include: { district: { include: { province: true } } },
        },
      },
    });

    const homeAltitude = user?.homeLocation?.altitude ?? 0;
    const homeProvince = user?.homeLocation?.district?.province?.name ?? "";

    // Build health profile
    const healthProfile = userHealth ? {
      fitnessLevel:      userHealth.fitnessLevel      as "LOW" | "MODERATE" | "HIGH",
      mobilityLimited:   userHealth.mobilityLimited,
      chronicConditions: userHealth.chronicConditions,
      allergies:         userHealth.allergies,
      homeAltitude,
      homeProvince,
    } : null;

    // Run full temporal risk analysis
    const report = await analyzeTemporalRisk({
      destinationName: location.name,
      district:        location.district.name,
      province:        location.district.province.name,
      lat:             location.latitude,
      lon:             location.longitude,
      altitude:        location.altitude,
      travelDate,
      userHealth:      healthProfile,
      tripType:        tripType ?? "SOLO",
    });

    return NextResponse.json(report);

  } catch (err) {
    console.error("[analyze]", err);
    return NextResponse.json({ message: "Analysis failed." }, { status: 500 });
  }
}
