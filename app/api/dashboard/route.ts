/**
 * FILE: route.ts
 * LOCATION: /app/api/dashboard/route.ts
 * PURPOSE: Returns all data needed for the dashboard page
 *
 * DESTINATIONS:
 *   Returns all destination records from the database.
 *   Unverified destinations are included and mapped into dashboard card fields.
 *   Sorted to surface verified, route-accessible, and higher-quality destinations.
 *
 * FIRST RUN:
 *   destinations: all database records are returned immediately.
 *   curl -X POST http://localhost:3000/api/assess \
 *        -H "Authorization: Bearer $ASSESS_SECRET"
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse }  from "next/server";
import { auth }          from "@/lib/auth";
import { headers, cookies }       from "next/headers";
import { prisma }        from "@/lib/prisma";
import { computeSafetyScore, buildHealthFlags, WeatherInput, HazardInput, LocationContext } from "@/lib/scoring/safety";
import type { DestinationCategory } from "@/app/generated/prisma/client";

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

const UNRELIABLE_CATEGORIES: DestinationCategory[] = ["CHOWK", "MUNICIPALITY", "OTHER"];

export async function GET(request?: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const showAll = request?.nextUrl.searchParams.get("categories") === "all";
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

    const cookieStore = await cookies();
    const isSigningUp = cookieStore.get("is_signing_up")?.value === "true";

    const isAdminOrAnalyst = user?.role === "ADMIN" || user?.role === "ANALYST";
    
    // New user check: has the signing up cookie OR account created in the last 15 minutes
    const isRecent = user?.createdAt ? (Date.now() - new Date(user.createdAt).getTime() < 15 * 60 * 1000) : false;
    const isNewUser = isSigningUp || isRecent;

    if (!user || (!user.preference && !isAdminOrAnalyst && isNewUser)) {
      return NextResponse.json({ message: "Profile incomplete", needsOnboarding: true }, { status: 403 });
    }

    // Combine travel purposes + health flags for personalised scoring
    const healthFlags     = userHealth ? buildHealthFlags(userHealth) : [];
    const scoringPurposes = healthFlags; // Removed travelPurposes from health flag mix since it's now in preference

    // Fetch destination records from the database
    // By default exclude unreliable categories (CHOWK, MUNICIPALITY, OTHER)
    const destinations = await prisma.destination.findMany({
      where: showAll ? {} : {
        category: { notIn: UNRELIABLE_CATEGORIES },
      },
      orderBy: [
        { verified: "desc" },
        { dataQualityScore: "desc" },
        { name: "asc" },
      ],
    });

    const mappedDestinations = destinations.map((dest) => {
      const qualityScore = dest.dataQualityScore ?? 50;
      const isVerified = dest.verified ?? false;
      const routeAccessible = dest.routeAccessible ?? false;
      const safetyLevel = isVerified ? "SAFE" : routeAccessible ? "CAUTION" : "HIGH_RISK";
      const safetyScore = Math.max(0, Math.min(100, qualityScore));
      const reasoning = [
        dest.description ?? "Destination loaded from source data.",
        isVerified ? "Verified destination" : "Verification pending",
        routeAccessible ? "Route accessible" : "Route accessibility not confirmed",
      ];

      return {
        id:          dest.id,
        name:        dest.name,
        district:    dest.district,
        province:    dest.province,
        category:    dest.category,
        latitude:    dest.latitude,
        longitude:   dest.longitude,
        altitude:    dest.altitude ?? null,
        safetyScore,
        safetyLevel: safetyLevel as "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME",
        confidence:  null,
        reasoning,
        weather:     null,
        hazard:      null,
        assessedAt:  dest.sourceLastFetch?.toISOString() ?? dest.updatedAt.toISOString(),
        verified:    dest.verified,
        routeAccessible: dest.routeAccessible,
        dataQualityScore: dest.dataQualityScore,
      };
    });

    // Sort destinations so verified, accessible, and higher quality appear first
    mappedDestinations.sort((a, b) => {
      if ((a.verified ? 1 : 0) !== (b.verified ? 1 : 0)) return (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
      if ((a.routeAccessible ? 1 : 0) !== (b.routeAccessible ? 1 : 0)) return (b.routeAccessible ? 1 : 0) - (a.routeAccessible ? 1 : 0);
      return (b.safetyScore ?? 0) - (a.safetyScore ?? 0);
    });

    const stats = {
      total:    mappedDestinations.length,
      safe:     mappedDestinations.filter((d) => d.safetyLevel === "SAFE").length,
      caution:  mappedDestinations.filter((d) => d.safetyLevel === "CAUTION").length,
      highRisk: mappedDestinations.filter((d) => d.safetyLevel === "HIGH_RISK").length,
      extreme:  mappedDestinations.filter((d) => d.safetyLevel === "EXTREME").length,
    };

    return NextResponse.json({
      user: {
        id:       user?.id,
        name:     user?.name,
        email:    user?.email,
        image:    user?.image,
        username: user?.username ?? null,
        role:     user?.role ?? "USER",
        homeLocation: user?.homeLocation ? {
          name:     user.homeLocation.name,
          district: user.homeLocation.district.name,
          province: user.homeLocation.district.province.name,
        } : null,
        preference: user?.preference ?? null,
        behavior: user?.behavior ?? null,
        health: userHealth ?? null,
      },
      destinations: mappedDestinations,
      stats,
    });

  } catch (err) {
    console.error("[dashboard]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
