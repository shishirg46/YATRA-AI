export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { buildSegmentedRoute } from "@/lib/routing/route-service";
import { fetchHistoricalWeather } from "@/lib/collectors/historical-weather";
import { fetchHistoricalHazard } from "@/lib/collectors/historical-hazard";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import { haversineKm } from "@/lib/routing/geo";
import { prisma } from "@/lib/prisma";
import { computeRouteRisk } from "@/lib/scoring/route-risk";
import { fetchDisasterCounts, buildCorridorLookup } from "@/lib/scoring/disaster-data";
import { withRateLimit } from "@/lib/rate-limit";

interface RoutePoint {
  lat: number;
  lon: number;
  name?: string;
  district?: string;
  province?: string;
}

interface CheckRouteRequest {
  origin: RoutePoint | null;
  destination: RoutePoint & { id?: string };
  travelDate: string;
}

function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return "Pre-monsoon";
  if (month >= 6 && month <= 9) return "Monsoon";
  if (month >= 10 && month <= 11) return "Post-monsoon";
  return "Winter";
}

function getSeasonalRisks(
  month: number,
  isHilly: boolean,
  isTerai: boolean
): { name: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; description: string }[] {
  const risks: {
    name: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    description: string;
  }[] = [];

  if (month >= 6 && month <= 9) {
    if (isHilly) {
      risks.push({
        name: "Landslide risk",
        severity: "HIGH",
        description:
          "Monsoon season in hilly terrain significantly increases landslide risk along corridor segments.",
      });
    }
    if (isTerai) {
      risks.push({
        name: "Flood risk",
        severity: "HIGH",
        description: "Monsoon season in Terai increases flood risk on lowland highway segments.",
      });
    }
    risks.push({
      name: "Road conditions",
      severity: "MEDIUM",
      description: "Roads may be muddy or temporarily blocked. Allow extra travel time between stops.",
    });
  }

  if (month >= 12 || month <= 2) {
    if (isHilly) {
      risks.push({
        name: "Snow/Ice on roads",
        severity: "MEDIUM",
        description: "Winter ice and frost are possible on higher corridor segments.",
      });
    }
  }

  return risks;
}

function sampleAlongRoute(
  points: { lat: number; lon: number }[],
  count: number
): { lat: number; lon: number }[] {
  if (points.length <= count) return points;
  const sampled: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= count; i++) {
    const idx = Math.round((i / count) * (points.length - 1));
    sampled.push(points[idx]);
  }
  return sampled;
}

async function checkRouteHandler(req: NextRequest) {
  try {
    const body: CheckRouteRequest = await req.json();
    const { origin, destination, travelDate } = body;

    if (!destination || !travelDate) {
      return NextResponse.json(
        { message: "Missing required fields: destination and travelDate" },
        { status: 400 }
      );
    }

    const travelDateObj = new Date(travelDate);
    const month = travelDateObj.getMonth() + 1;
    const season = getSeason(month);

    const isTerai =
      destination.district?.toLowerCase().includes("sunsari") ||
      destination.district?.toLowerCase().includes("saptari") ||
      destination.name?.toLowerCase().includes("birgunj") ||
      false;
    const isHilly = !isTerai;

    const seasonalRisks = getSeasonalRisks(month, isHilly, isTerai);

    let routeAnalysis = null;
    if (origin?.lat && origin?.lon && destination.lat && destination.lon) {
      const built = await buildSegmentedRoute({
        originLat: origin.lat,
        originLon: origin.lon,
        originName: origin.name,
        destinationLat: destination.lat,
        destinationLon: destination.lon,
        destinationId: destination.id,
        destinationName: destination.name,
      });

      const routePoints =
        built.polyline.length >= 2
          ? built.polyline
          : built.nodes.map((n) => ({ lat: n.lat, lon: n.lon }));

      const sampled = sampleAlongRoute(routePoints, 5);

      const pointData = await Promise.all(
        sampled.map(async (point) => {
          const [weather, hazard, histWeather, histHazard] = await Promise.all([
            fetchWeather(point.lat, point.lon).catch(() => null),
            fetchHazard(destination.district || "", point.lat, point.lon).catch(() => null),
            fetchHistoricalWeather(point.lat, point.lon, travelDate, 5).catch(() => null),
            fetchHistoricalHazard(
              destination.district || "",
              point.lat,
              point.lon,
              travelDate,
              5
            ).catch(() => null),
          ]);
          return { point, weather, hazard, histWeather, histHazard };
        })
      );

      let floodRisk = 0;
      let landslideRisk = 0;
      let weatherRisk = 0;
      let hasData = false;

      for (const data of pointData) {
        if (data.hazard) {
          hasData = true;
          floodRisk = Math.max(floodRisk, data.hazard.floodIndex);
          landslideRisk = Math.max(landslideRisk, data.hazard.landslideIndex);
        }
        if (data.histWeather) {
          hasData = true;
          if (data.histWeather.avgRainfall > 30 || data.histWeather.heavyRainProbability > 0.4) {
            weatherRisk = Math.max(weatherRisk, 0.6);
          }
        }
      }

      let routeRisk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
      let routeRiskReason =
        "Corridor route via known stops appears favorable for the selected travel date.";

      const corridorLabel = built.nodes.map((n) => n.name).join(" → ");
      const totalKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);

      if (hasData) {
        if (floodRisk >= 0.6 || landslideRisk >= 0.6) {
          routeRisk = "HIGH";
          routeRiskReason = `High hazard risk on corridor (${corridorLabel}): flood ${Math.round(floodRisk * 100)}%, landslide ${Math.round(landslideRisk * 100)}%.`;
        } else if (floodRisk >= 0.35 || landslideRisk >= 0.35 || weatherRisk >= 0.5) {
          routeRisk = "MEDIUM";
          routeRiskReason = `Moderate risk along ${built.nodes.length} stops (${corridorLabel}). Monitor advisories before travel.`;
        }
      } else if (month >= 6 && month <= 9 && isHilly) {
        routeRisk = "MEDIUM";
        routeRiskReason = `Monsoon conditions on hilly corridor (${Math.round(totalKm)} km, ${built.nodes.length} stops).`;
      }

      // District-level historic/recent disaster context
      const { historicDisasters, recentDisasters } = await fetchDisasterCounts(prisma);
      const corridorDistrictLookup = buildCorridorLookup([
        origin.district || origin.name
          ? { lat: origin.lat, lon: origin.lon, district: origin.district || origin.name || "" }
          : null,
        destination.district || destination.name
          ? { lat: destination.lat, lon: destination.lon, district: destination.district || destination.name || "" }
          : null,
      ].filter(Boolean) as { lat: number; lon: number; district: string }[]);
      const isMonsoon = month >= 6 && month <= 9;
      const disasterRouteRisk = computeRouteRisk({
        originLat: origin.lat,
        originLon: origin.lon,
        originAlt: null,
        originDistrict: origin.district ?? undefined,
        destLat: destination.lat,
        destLon: destination.lon,
        destAlt: null,
        destDistrict: destination.district ?? "",
        isMonsoon,
        currentMonth: month,
        purposes: [],
        corridorDistrictLookup,
        historicDisasters,
        recentDisasters,
      });

      routeAnalysis = {
        risk: routeRisk,
        reason: routeRiskReason,
        seasonalContext: `${season} · Route: ${corridorLabel}${built.resolutionNote ? ` (${built.resolutionNote})` : ""}`,
        floodRisk: Math.round(floodRisk * 100),
        landslideRisk: Math.round(landslideRisk * 100),
        weatherRisk: Math.round(weatherRisk * 100),
        stops: built.nodes.map((n) => n.name),
        distanceKm: Math.round(totalKm),
        source: built.source,
        disasterRouteRisk,
      };
    }

    const response = {
      travelDate,
      season,
      destination: destination.name,
      route: routeAnalysis,
      seasonalRisks,
      recommendations: [] as string[],
    };

    if (routeAnalysis?.risk === "HIGH") {
      response.recommendations.push("Consider rescheduling or choosing an alternative corridor.");
    } else if (routeAnalysis?.risk === "MEDIUM") {
      response.recommendations.push("Check road status at each major stop before departure.");
    }

    if (month >= 6 && month <= 9) {
      response.recommendations.push("Pack waterproof gear; expect delays between corridor stops.");
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[api/routes/check] Error:", error);
    return NextResponse.json({ message: "Failed to check route safety" }, { status: 500 });
  }
}

export const POST = withRateLimit(checkRouteHandler, { max: 10, windowSeconds: 60 });
