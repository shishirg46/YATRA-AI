import { haversineKm, resamplePolyline } from "@/lib/routing/geo";
import { fetchElevationBatch } from "@/lib/collectors/elevation";
import { fetchOsmRoadSurface, fetchOsmRivers } from "@/lib/routing/osm-road-fetcher";
import type { GeoPoint } from "@/lib/routing/types";

export interface SegmentProfile {
  index: number;
  midpoint: { lat: number; lon: number };
  startPoint: { lat: number; lon: number };
  endPoint: { lat: number; lon: number };
  distance: number;
  gradient: number | null;
  elevationStart: number | null;
  elevationEnd: number | null;
  roadSurface: {
    highway: string;
    surface: string | null;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  } | null;
  riverProximityKm: number | null;
}

function classifySurfaceRisk(surface: string | null, highway: string): "LOW" | "MEDIUM" | "HIGH" | "EXTREME" {
  if (!surface) {
    if (["motorway", "trunk", "primary"].includes(highway)) return "LOW";
    if (["secondary", "tertiary"].includes(highway)) return "MEDIUM";
    if (["unclassified", "residential"].includes(highway)) return "HIGH";
    return "HIGH";
  }
  const s = surface.toLowerCase();
  if (["paved", "asphalt", "concrete", "paving_stones"].some((v) => s.includes(v))) return "LOW";
  if (["cobblestone", "metal", "wood"].some((v) => s.includes(v))) return "MEDIUM";
  if (["gravel", "dirt", "earth", "ground", "unpaved", "compacted"].some((v) => s.includes(v))) return "HIGH";
  if (["sand", "mud", "grass", "pebblestone"].some((v) => s.includes(v))) return "EXTREME";
  return "MEDIUM";
}

export async function analyzeRouteSegments(
  waypoints: { lat: number; lon: number }[],
  origin: GeoPoint,
  destination: GeoPoint
): Promise<SegmentProfile[]> {
  if (waypoints.length < 2) return [];

  const resampled = resamplePolyline(waypoints, 150);
  if (resampled.length < 2) return [];

  const midpoints: { lat: number; lon: number }[] = [];
  for (let i = 0; i < resampled.length - 1; i++) {
    midpoints.push({
      lat: (resampled[i].lat + resampled[i + 1].lat) / 2,
      lon: (resampled[i].lon + resampled[i + 1].lon) / 2,
    });
  }

  const [elevations, roadWays, rivers] = await Promise.all([
    fetchElevationBatch(resampled),
    fetchOsmRoadSurface(origin.lat, origin.lon, destination.lat, destination.lon),
    fetchOsmRivers(origin.lat, origin.lon, destination.lat, destination.lon),
  ]);

  const segments: SegmentProfile[] = [];
  for (let i = 0; i < resampled.length - 1; i++) {
    const start = resampled[i];
    const end = resampled[i + 1];
    const dist = haversineKm(start.lat, start.lon, end.lat, end.lon) * 1000;
    const elevStart = elevations[i] ?? null;
    const elevEnd = elevations[i + 1] ?? null;
    const gradient =
      elevStart !== null && elevEnd !== null && dist > 0
        ? ((elevEnd - elevStart) / dist) * 100
        : null;

    const mid = midpoints[i];
    let closestRoad: (typeof roadWays)[0] | null = null;
    let closestDist = Infinity;
    for (const r of roadWays) {
      const d = haversineKm(mid.lat, mid.lon, r.centerLat, r.centerLon);
      if (d < closestDist) {
        closestDist = d;
        closestRoad = r;
      }
    }

    let closestRiverDist = Infinity;
    for (const r of rivers) {
      const d = haversineKm(mid.lat, mid.lon, r.centerLat, r.centerLon);
      if (d < closestRiverDist) closestRiverDist = d;
    }

    segments.push({
      index: i,
      midpoint: mid,
      startPoint: start,
      endPoint: end,
      distance: Math.round(dist),
      gradient: gradient !== null ? Math.round(gradient * 10) / 10 : null,
      elevationStart: elevStart,
      elevationEnd: elevEnd,
      roadSurface:
          closestRoad && closestDist < 1
          ? {
              highway: closestRoad.highway,
              surface: closestRoad.surface ?? null,
              riskLevel: classifySurfaceRisk(closestRoad.surface ?? null, closestRoad.highway),
            }
          : null,
      riverProximityKm:
        closestRiverDist !== Infinity ? Math.round(closestRiverDist * 100) / 100 : null,
    });
  }

  return segments;
}
