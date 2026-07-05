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
import { withRateLimit } from "@/lib/rate-limit";
import { computeSafetyScore, buildHealthFlags, WeatherInput, HazardInput, LocationContext } from "@/lib/scoring/safety";
import { computeRouteRisk } from "@/lib/scoring/route-risk";
import { fetchDisasterCounts, buildCorridorLookup } from "@/lib/scoring/disaster-data";
import { fetchHazard } from "@/lib/collectors/hazard";
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

const UNRELIABLE_CATEGORIES: DestinationCategory[] = ["CHOWK", "MUNICIPALITY"];

function buildRecommendationMeta(destination: { description: string | null; tags: string[] }) {
  const text = `${destination.description ?? ""} ${destination.tags.join(" ")}`.toLowerCase();
  return {
    closedOrRestricted: [
      "road closed",
      "route closed",
      "closed road",
      "closed route",
      "off limits",
      "closed territory",
      "remained closed",
      "currently closed",
      "temporarily closed",
      "not open to visitors",
    ].some((term) => text.includes(term)),
    unavailablePermit: [
      "impossibility of gaining a permit",
      "impossible to gain a permit",
      "permit unavailable",
      "permits unavailable",
      "no permits issued",
      "never been officially climbed",
    ].some((term) => text.includes(term)),
  };
}

function estimatedWeather(alt: number | null, isMonsoon: boolean): WeatherInput {
  const altitude = alt ?? 0;
  const temp = Math.round((25 - altitude * 0.0065) * 10) / 10;
  const windBase = 2 + (altitude / 1000) * 1.5;
  const rainfall = isMonsoon ? Math.min(altitude * 0.005 + 2, 25) : 0.5;
  return {
    temperature: Math.max(-10, temp),
    humidity: isMonsoon ? 80 : 50,
    rainfall,
    windSpeed: Math.min(Math.round(windBase * 10) / 10, 20),
    pressure: 1013,
  };
}

async function getDashboardHandler(request?: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const showAll = request?.nextUrl.searchParams.get("categories") === "all";
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Fetch user, profile notification, health, and saved destinations in parallel
    const [user, userHealth, userSaved] = await Promise.all([
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
      prisma.savedDestination.findMany({
        where:  { userId: session.user.id },
        select: { destinationId: true },
      }),
    ]);

    const savedDestinationIds = userSaved.map((s) => s.destinationId);

    const cookieStore = await cookies();
    const isSigningUp = cookieStore.get("is_signing_up")?.value === "true";

    const isAdminOrAnalyst = user?.role === "ADMIN" || user?.role === "ANALYST";
    
    // New user check: has the signing up cookie OR account created in the last 15 minutes
    const isRecent = user?.createdAt ? (Date.now() - new Date(user.createdAt).getTime() < 15 * 60 * 1000) : false;
    const isNewUser = isSigningUp || isRecent;

    if (!user || (!user.preference && !isAdminOrAnalyst && isNewUser)) {
      return NextResponse.json({ message: "Profile incomplete", needsOnboarding: true }, { status: 403 });
    }

    const healthFlags = userHealth ? buildHealthFlags(userHealth) : [];
    const userPrefs = user?.preference;
    const purposes: string[] = [...healthFlags];

    if (
      userPrefs?.interests?.includes("trekking") ||
      userPrefs?.travelStyle?.includes("trekking")
    ) {
      purposes.push("TREKKING");
    }
    if (userPrefs?.travelStyle?.includes("solo")) {
      purposes.push("SOLO");
    }
    if (
      userPrefs?.interests?.includes("cultural") ||
      userPrefs?.interests?.includes("heritage") ||
      userPrefs?.travelStyle?.includes("cultural")
    ) {
      purposes.push("TOURISM");
    }
    const riskTolerance = userPrefs?.riskTolerance === "LOW" || userPrefs?.riskTolerance === "HIGH"
      ? userPrefs.riskTolerance as "LOW" | "HIGH"
      : "MEDIUM";

    const currentMonth = new Date().getMonth() + 1;
    const isMonsoon = currentMonth >= 6 && currentMonth <= 9;

    const neutralHazard: HazardInput = {
      floodIndex: isMonsoon ? 0.15 : 0,
      landslideIndex: 0,
      earthquakeIndex: 0,
      heatIndex: 0,
      airQuality: 0,
    };

    const destinations = await prisma.destination.findMany({
      where: showAll
        ? {}
        : {
            category: { notIn: UNRELIABLE_CATEGORIES },
          },
      orderBy: [
        { verified: "desc" },
        { dataQualityScore: "desc" },
        { name: "asc" },
      ],
    });

    // Dynamic origin from request params (frontend GPS / manual pick).
    // Fallback chain: request params → DB preference → DB home location.
    const reqOriginLat = parseFloat(request?.nextUrl.searchParams.get("originLat") ?? "");
    const reqOriginLon = parseFloat(request?.nextUrl.searchParams.get("originLon") ?? "");
    const reqOriginDist = request?.nextUrl.searchParams.get("originDistrict") ?? undefined;
    const hasReqOrigin = Number.isFinite(reqOriginLat) && Number.isFinite(reqOriginLon);

    const homeLat = hasReqOrigin
      ? reqOriginLat
      : (user?.preference?.locationLat ?? user?.homeLocation?.latitude ?? null);
    const homeLon = hasReqOrigin
      ? reqOriginLon
      : (user?.preference?.locationLng ?? user?.homeLocation?.longitude ?? null);
    const homeAlt = user?.homeLocation?.altitude ?? null;
    const originDistrict = hasReqOrigin
      ? (reqOriginDist ?? null)
      : (user?.homeLocation?.district?.name ?? null);
    const hasHome = homeLat !== null && homeLon !== null;

    // Fetch real-time hazard data for the user's origin area (skipped for dynamic
    // request origins unless the frontend also supplies the district name).
    let originHazard = null;
    if (originDistrict && homeLat && homeLon) {
      try {
        const result = await Promise.race([
          fetchHazard(homeLat, homeLon, prisma),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("hazard fetch timeout")), 6000)
          ),
        ]);
        originHazard = result;
      } catch {
        // Timeout or failure — continue without real-time data
      }
    }

    // Query DB for cached hazard data per destination district (from latest assessment run)
    const latestHazardByDistrict = new Map<string, { floodIndex: number; landslideIndex: number; earthquakeIndex: number; heatIndex: number; airQuality: number }>();
    try {
      const hazardRows = await prisma.$queryRaw<Array<{
        district: string;
        floodIndex: number | null;
        landslideIndex: number | null;
        airQuality: number | null;
      }>>`
        SELECT DISTINCT ON (d.name)
          d.name AS district,
          h."floodIndex",
          h."landslideIndex",
          h."airQuality"
        FROM "HazardData" h
        JOIN "Location" l ON l.id = h."locationId"
        JOIN "District" d ON d.id = l."districtId"
        WHERE h."floodIndex" IS NOT NULL
        ORDER BY d.name, h."recordedAt" DESC
      `;
      for (const row of hazardRows) {
        if (row.district) {
          latestHazardByDistrict.set(row.district.toLowerCase(), {
            floodIndex: row.floodIndex ?? 0,
            landslideIndex: row.landslideIndex ?? 0,
            earthquakeIndex: 0,
            heatIndex: 0,
            airQuality: row.airQuality ?? 0,
          });
        }
      }
    } catch {
      // DB query failure — continue without district hazard data
    }

    // ── Disaster event counts per district (historic 5yr + recent 30d) ──
    const { historicDisasters, recentDisasters } = await fetchDisasterCounts(prisma);

    // Build corridor district lookup: each destination acts as a coordinate→district anchor
    const corridorDistrictLookup = buildCorridorLookup(
      destinations.map((d) => ({ lat: d.latitude, lon: d.longitude, district: d.district })),
    );

    const mappedDestinations = destinations.map((dest) => {
      const isVerified = dest.verified ?? false;
      const routeAccessible = dest.routeAccessible ?? false;

      const alt = dest.altitude ?? null;
      const locationCtx: LocationContext = {
        altitude: alt,
        districtName: dest.district,
        locationName: dest.name,
      };

      const score = computeSafetyScore(
        estimatedWeather(alt, isMonsoon),
        neutralHazard,
        purposes,
        "SOLO",
        "fallback-estimated",
        locationCtx,
        riskTolerance,
      );

      const staticReasoning: string[] = [];
      if (dest.description) {
        staticReasoning.push(dest.description);
      }
      staticReasoning.push(
        isVerified ? "Verified destination" : "Verification pending"
      );
      staticReasoning.push(
        routeAccessible ? "Route accessible" : "Route accessibility not confirmed"
      );

      const allReasoning = [
        ...score.decisionTrace.reasoning,
        ...staticReasoning.filter(
          (r) => !score.decisionTrace.reasoning.some((sr) => sr.includes(r))
        ),
      ];

      const routeRisk = hasHome
        ? computeRouteRisk({
            originLat: homeLat!,
            originLon: homeLon!,
            originAlt: homeAlt,
            originDistrict: originDistrict ?? undefined,
            destLat: dest.latitude,
            destLon: dest.longitude,
            destAlt: alt,
            destDistrict: dest.district,
            isMonsoon,
            currentMonth,
            purposes,
            originHazard: originHazard ?? undefined,
            destHazard: latestHazardByDistrict.get(dest.district.toLowerCase()) ?? undefined,
            corridorDistrictLookup,
            historicDisasters,
            recentDisasters,
          })
        : null;

      return {
        id: dest.id,
        name: dest.name,
        district: dest.district,
        province: dest.province,
        category: dest.category,
        latitude: dest.latitude,
        longitude: dest.longitude,
        image: dest.image ?? null,
        altitude: dest.altitude ?? null,
        safetyScore: score.safetyScore,
        safetyLevel: score.safetyLevel,
        confidence: score.confidence,
        reasoning: allReasoning,
        routeRisk,
        weather: null,
        hazard: null,
        assessedAt: new Date().toISOString(),
        verified: dest.verified,
        routeAccessible: dest.routeAccessible,
        popularityScore: dest.popularityScore,
        dataQualityScore: dest.dataQualityScore,
        tags: dest.tags,
        recommendationMeta: buildRecommendationMeta(dest),
      };
    });

    // Nearby boost: add haversine proximity bonus when user has a home location
    function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const nearbyBoost = (hasHome && homeLat != null && homeLon != null)
      ? (dest: typeof mappedDestinations[number]) => {
          const km = haversineKm(homeLat!, homeLon!, dest.latitude, dest.longitude);
          return km <= 120 ? 15 : km <= 300 ? 8 : km <= 600 ? 3 : 0;
        }
      : () => 0;

    // Sort — verified/accessible first, then combine safety score and route risk with nearby boost
    mappedDestinations.sort((a, b) => {
      if ((a.verified ? 1 : 0) !== (b.verified ? 1 : 0)) return (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
      if ((a.routeAccessible ? 1 : 0) !== (b.routeAccessible ? 1 : 0)) return (b.routeAccessible ? 1 : 0) - (a.routeAccessible ? 1 : 0);
      const aRec = a.routeRisk
        ? Math.round(a.safetyScore * 0.6 + a.routeRisk.routeRiskScore * 0.4)
        : a.safetyScore;
      const bRec = b.routeRisk
        ? Math.round(b.safetyScore * 0.6 + b.routeRisk.routeRiskScore * 0.4)
        : b.safetyScore;
      return (bRec + nearbyBoost(b)) - (aRec + nearbyBoost(a));
    });

    const stats = {
      total:    mappedDestinations.length,
      safe:     mappedDestinations.filter((d) => d.safetyLevel === "SAFE").length,
      caution:  mappedDestinations.filter((d) => d.safetyLevel === "CAUTION").length,
      highRisk: mappedDestinations.filter((d) => d.safetyLevel === "HIGH_RISK").length,
      extreme:  mappedDestinations.filter((d) => d.safetyLevel === "EXTREME").length,
      routeRisk: {
        safe:     mappedDestinations.filter((d) => d.routeRisk?.routeRiskLevel === "SAFE").length,
        caution:  mappedDestinations.filter((d) => d.routeRisk?.routeRiskLevel === "CAUTION").length,
        highRisk: mappedDestinations.filter((d) => d.routeRisk?.routeRiskLevel === "HIGH_RISK").length,
        extreme:  mappedDestinations.filter((d) => d.routeRisk?.routeRiskLevel === "EXTREME").length,
      },
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
          latitude: user.homeLocation.latitude,
          longitude: user.homeLocation.longitude,
          altitude: user.homeLocation.altitude,
        } : null,
        preference: user?.preference ?? null,
        behavior: user?.behavior ?? null,
        health: userHealth ?? null,
        savedDestinationIds,
      },
      destinations: mappedDestinations,
      stats,
    });

  } catch (err) {
    console.error("[dashboard]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export const GET = withRateLimit(getDashboardHandler, { max: 20, windowSeconds: 60 });
