import { resolveTravelOrigin } from "@/lib/routing/origin-resolver";
import { resolveDestination } from "@/lib/routing/place-resolver";
import { buildSegmentedRoute } from "@/lib/routing/route-service";
import { generateRouteIntelligence } from "@/lib/route-intelligence";

export type OriginLocation = {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  district: { name: string; province: { name: string } };
};

export async function resolveOriginAndRoute(
  originLat: number | null,
  originLon: number | null,
  userId: string,
  location: { id: string; name: string; latitude: number; longitude: number },
  home: OriginLocation | undefined,
  travelDate: string,
) {
  const hasClientOrigin = Number.isFinite(originLat) && Number.isFinite(originLon);
  let effectiveHome: OriginLocation | null = null;
  let routePlan: Awaited<ReturnType<typeof buildSegmentedRoute>> | null = null;
  let originResolutionNote: string | undefined;

  try {
    const resolved = await resolveTravelOrigin({
      lat: hasClientOrigin ? Number(originLat) : undefined,
      lon: hasClientOrigin ? Number(originLon) : undefined,
      userId,
      preferSavedHome: !hasClientOrigin,
    });

    const destResolved = await resolveDestination({
      destinationId: location.id,
      destinationName: location.name,
      destinationLat: location.latitude,
      destinationLon: location.longitude,
    });

    routePlan = await buildSegmentedRoute({
      originLat: resolved.place.lat,
      originLon: resolved.place.lon,
      originName: resolved.place.name,
      originRouteNodeId: resolved.routeNodeId,
      destinationLat: destResolved.place.lat,
      destinationLon: destResolved.place.lon,
      destinationName: destResolved.place.name,
      destinationId: location.id,
    });

    originResolutionNote = [resolved.note, destResolved.note, routePlan.resolutionNote]
      .filter(Boolean)
      .join("; ");

    const districtRow = home?.district ?? null;
    effectiveHome = {
      id: resolved.place.id ?? home?.id,
      name: resolved.place.name,
      latitude: resolved.place.lat,
      longitude: resolved.place.lon,
      altitude: home?.altitude ?? null,
      district: districtRow ?? { name: location.name, province: { name: "Bagmati" } },
    };
  } catch {
    if (home) {
      effectiveHome = home as OriginLocation;
    }
  }

  return { effectiveHome, routePlan, originResolutionNote };
}

export async function assessRoute(
  effectiveHome: OriginLocation | null,
  location: { id: string; name: string; latitude: number; longitude: number; altitude: number | null; district: { name: string; province: { name: string } } },
  travelDate: string,
) {
  if (!effectiveHome || Math.abs(effectiveHome.latitude) < 0.001) return null;

  const latDiff = effectiveHome.latitude - location.latitude;
  const lonDiff = effectiveHome.longitude - location.longitude;
  if (latDiff * latDiff + lonDiff * lonDiff < 1e-10) return null;

  try {
    const result = await generateRouteIntelligence(
      { lat: effectiveHome.latitude, lon: effectiveHome.longitude, name: effectiveHome.name },
      { lat: location.latitude, lon: location.longitude, name: location.name },
      travelDate,
      { destinationId: location.id },
    );

    if (!result.bestRoute) return null;

    const highRiskSegments = result.bestRoute.segments.filter(
      (s) => s.riskLevel === "HIGH" || s.riskLevel === "EXTREME"
    );
    const segmentAlerts = highRiskSegments
      .map((s) => s.hazards.join(", "))
      .filter(Boolean);

    const reason = segmentAlerts.length > 0
      ? `Route hazards detected on ${highRiskSegments.length} of ${result.bestRoute.segments.length} segments: ${segmentAlerts.join("; ")}`
      : `All ${result.bestRoute.segments.length} route segments appear favorable.`;

    const first = result.bestRoute.segments[0];
    const last = result.bestRoute.segments[result.bestRoute.segments.length - 1];

    return {
      from: first?.startPoint.name || effectiveHome.name,
      to: last?.endPoint.name || location.name,
      date: travelDate,
      risk: result.bestRoute.riskLevel === "EXTREME" ? "HIGH" : result.bestRoute.riskLevel as "LOW" | "MEDIUM" | "HIGH",
      reason,
      segments: result.bestRoute.segments.map((s) => ({
        from: s.startPoint.name || "unknown",
        to: s.endPoint.name || "unknown",
        distanceKm: s.distance,
        riskLevel: s.riskLevel,
        riskScore: s.riskScore,
        hazards: s.hazards,
        realtime: s.realtime ? {
          floodIndex: s.realtime.floodIndex,
          landslideIndex: s.realtime.landslideIndex,
          earthquakeIndex: s.realtime.earthquakeIndex,
          airQuality: s.realtime.airQuality,
          rainfall: s.realtime.rainfall,
          windSpeed: s.realtime.windSpeed,
        } : null,
        historical: s.historical ? {
          floodRisk: s.historical.floodRisk,
          landslideRisk: s.historical.landslideRisk,
        } : null,
        alerts: s.evidence?.historical?.notableEvents || [],
      })),
      totalDistanceKm: result.bestRoute.distance,
      totalDurationHours: result.bestRoute.duration,
      sources: ["bipad", "usgs", "openstreetmap", "openweather"],
    };
  } catch {
    return null;
  }
}

export const FALLBACK_HOME = {
  name: "Kathmandu",
  district: "Kathmandu",
  province: "Bagmati",
  lat: 27.7172,
  lon: 85.324,
  altitude: 1400,
};

export function resolveHome(effectiveHome: OriginLocation | null) {
  if (effectiveHome && effectiveHome.latitude !== 0 && effectiveHome.longitude !== 0) {
    return {
      name: effectiveHome.name,
      district: effectiveHome.district.name,
      province: effectiveHome.district.province.name,
      lat: effectiveHome.latitude,
      lon: effectiveHome.longitude,
      altitude: effectiveHome.altitude ?? 1400,
    };
  }
  return FALLBACK_HOME;
}
