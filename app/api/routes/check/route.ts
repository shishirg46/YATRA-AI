/**
 * FILE: route.ts
 * LOCATION: /app/api/routes/check/route.ts
 * PURPOSE: Quick route safety check for a specific date
 *
 * POST /api/routes/check
 * Body: {
 *   origin:      { lat: number; lon: number; name?: string; district?: string } | null,
 *   destination: { lat: number; lon: number; name: string; district: string; province: string },
 *   travelDate:  string (YYYY-MM-DD)
 * }
 *
 * Returns: Route safety analysis with seasonal context, historical hazards, and recommendations
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { fetchHistoricalWeather, HistoricalWeatherStats } from "@/lib/collectors/historical-weather";
import { fetchHistoricalHazard, HistoricalHazardStats } from "@/lib/collectors/historical-hazard";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";

interface RoutePoint {
  lat: number;
  lon: number;
  name?: string;
  district?: string;
  province?: string;
}

interface CheckRouteRequest {
  origin: RoutePoint | null;
  destination: RoutePoint;
  travelDate: string;
}

// Get season from month
function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return "Pre-monsoon";
  if (month >= 6 && month <= 9) return "Monsoon";
  if (month >= 10 && month <= 11) return "Post-monsoon";
  return "Winter";
}

// Get seasonal risk factors based on month and terrain type
function getSeasonalRisks(month: number, isHilly: boolean, isTerai: boolean): {
  name: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
}[] {
  const risks: { name: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; description: string }[] = [];
  
  // Monsoon risks (June-September)
  if (month >= 6 && month <= 9) {
    if (isHilly) {
      risks.push({
        name: "Landslide risk",
        severity: "HIGH",
        description: "Monsoon season in hilly terrain significantly increases landslide risk. Heavy rainfall can trigger landslides on steep slopes and unstable terrain."
      });
    }
    if (isTerai) {
      risks.push({
        name: "Flood risk",
        severity: "HIGH",
        description: "Monsoon season in Terai (lowland) increases flood risk from rivers and heavy rainfall. Some areas may experience flash floods."
      });
    }
    risks.push({
      name: "Road conditions",
      severity: "MEDIUM",
      description: "Roads may be muddy, slippery, or temporarily blocked due to rainfall. Travel times can increase significantly."
    });
  }
  
  // Winter risks (December-February)
  if (month >= 12 || month <= 2) {
    if (isHilly) {
      risks.push({
        name: "Snow/Ice on roads",
        severity: "MEDIUM",
        description: "Winter conditions can cause ice and frost on mountain roads, especially at higher elevations. Early morning travel may be hazardous."
      });
      risks.push({
        name: "Fog",
        severity: "MEDIUM",
        description: "Morning fog is common in valleys and can reduce visibility significantly. Drive with caution and use fog lights."
      });
    }
  }
  
  // Pre-monsoon (March-May) - thunderstorms
  if (month >= 3 && month <= 5) {
    risks.push({
      name: "Thunderstorms",
      severity: "LOW",
      description: "Pre-monsoon thunderstorms can occur in afternoons. May cause temporary road blockages or travel disruptions."
    });
  }
  
  return risks;
}

// Sample points along a route for analysis
function sampleRoutePoints(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  count: number
): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= count; i++) {
    const ratio = i / count;
    points.push({
      lat: from.lat + (to.lat - from.lat) * ratio,
      lon: from.lon + (to.lon - from.lon) * ratio,
    });
  }
  return points;
}

export async function POST(req: NextRequest) {
  try {
    const body: CheckRouteRequest = await req.json();
    const { origin, destination, travelDate } = body;

    if (!destination || !travelDate) {
      return NextResponse.json(
        { message: "Missing required fields: destination and travelDate" },
        { status: 400 }
      );
    }

    // Parse travel date
    const travelDateObj = new Date(travelDate);
    const month = travelDateObj.getMonth() + 1;
    const season = getSeason(month);

    // Determine terrain type based on altitude (if available)
    const destAltitude = destination.lat; // This is wrong - we need actual altitude
    const isHilly = true; // Default assumption for Nepal
    const isTerai = destination.name?.toLowerCase().includes("terai") || 
                    destination.district?.toLowerCase().includes("sunsari") ||
                    destination.district?.toLowerCase().includes("saptari") ||
                    destination.district?.toLowerCase().includes("birgunj") ||
                    false;

    // Get seasonal risks
    const seasonalRisks = getSeasonalRisks(month, isHilly, isTerai);

    // If origin is provided, analyze the route segment
    let routeAnalysis = null;
    if (origin && origin.lat && origin.lon && destination.lat && destination.lon) {
      // Sample points along the route
      const routePoints = sampleRoutePoints(
        { lat: origin.lat, lon: origin.lon },
        { lat: destination.lat, lon: destination.lon },
        3
      );

      // Fetch historical weather and hazard data for each point
      const pointData = await Promise.all(
        routePoints.map(async (point) => {
          const [weather, hazard, histWeather, histHazard] = await Promise.all([
            fetchWeather(point.lat, point.lon).catch(() => null),
            fetchHazard(destination.district || "", point.lat, point.lon).catch(() => null),
            fetchHistoricalWeather(point.lat, point.lon, travelDate, 5).catch(() => null),
            fetchHistoricalHazard(destination.district || "", point.lat, point.lon, travelDate, 5).catch(() => null),
          ]);
          return { point, weather, hazard, histWeather, histHazard };
        })
      );

      // Calculate route-level risks
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
          if (data.histWeather.snowProbability > 0.15) {
            weatherRisk = Math.max(weatherRisk, 0.5);
          }
        }
      }

      // Determine overall route risk
      let routeRisk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
      let routeRiskReason = "Route conditions appear favorable for the selected travel date.";

      if (hasData) {
        if (floodRisk >= 0.6 || landslideRisk >= 0.6) {
          routeRisk = "HIGH";
          routeRiskReason = `High hazard risk detected along route: flood index ${Math.round(floodRisk * 100)}%, landslide index ${Math.round(landslideRisk * 100)}%. Consider alternative dates or routes.`;
        } else if (floodRisk >= 0.35 || landslideRisk >= 0.35 || weatherRisk >= 0.5) {
          routeRisk = "MEDIUM";
          routeRiskReason = `Moderate risk factors identified. ${floodRisk > 0 ? `Flood risk: ${Math.round(floodRisk * 100)}%. ` : ''}${landslideRisk > 0 ? `Landslide risk: ${Math.round(landslideRisk * 100)}%. ` : ''}Monitor conditions before travel.`;
        } else if (month >= 6 && month <= 9 && isHilly) {
          routeRisk = "MEDIUM";
          routeRiskReason = "Monsoon season on hilly route - expect possible landslides and wet roads. Check local road status before travel.";
        }
      }

      routeAnalysis = {
        risk: routeRisk,
        reason: routeRiskReason,
        seasonalContext: `${season} in ${destination.district || 'the destination region'}. ${month >= 6 && month <= 9 ? 'Monsoon season brings heavy rainfall and increased landslide/flood risk in hilly areas.' : month >= 12 || month <= 2 ? 'Winter season may bring cold temperatures, fog, and potential ice on roads.' : 'Generally favorable travel conditions.'}`,
        floodRisk: Math.round(floodRisk * 100),
        landslideRisk: Math.round(landslideRisk * 100),
        weatherRisk: Math.round(weatherRisk * 100),
      };
    }

    // Build response
    const response = {
      travelDate,
      season,
      destination: destination.name,
      route: routeAnalysis,
      seasonalRisks,
      recommendations: [] as string[],
    };

    // Add recommendations based on risks
    if (routeAnalysis) {
      if (routeAnalysis.risk === "HIGH") {
        response.recommendations.push("Consider rescheduling your trip to a safer season.");
        response.recommendations.push("Check for alternative routes that avoid high-risk areas.");
      } else if (routeAnalysis.risk === "MEDIUM") {
        response.recommendations.push("Monitor weather forecasts before your travel date.");
        response.recommendations.push("Keep emergency contacts handy for road status updates.");
      }
    }

    // Add seasonal recommendations
    if (month >= 6 && month <= 9) {
      response.recommendations.push("Pack waterproof gear and expect possible travel delays.");
      if (isHilly) {
        response.recommendations.push("Avoid traveling during heavy rainfall - wait for weather to clear.");
      }
    }
    if (month >= 12 || month <= 2) {
      response.recommendations.push("Start early to avoid morning fog and icy conditions.");
      response.recommendations.push("Carry warm clothing and emergency supplies.");
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[api/routes/check] Error:", error);
    return NextResponse.json(
      { message: "Failed to check route safety" },
      { status: 500 }
    );
  }
}