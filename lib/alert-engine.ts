/**
 * FILE: alert-engine.ts
 * LOCATION: /lib/alert-engine.ts
 * PURPOSE: Dynamic, rule-based alert generation from route + disaster + weather data.
 */

export type AlertDisasterType = "landslide" | "flood" | "earthquake";
export type AlertRegion = "Terai" | "Hill" | "Mountain";

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface DisasterCluster {
  type: AlertDisasterType;
  lat: number;
  lon: number;
  location?: string;
  region?: AlertRegion;
  count: number;
  recent: boolean;
  severityScore: number; // 0-1
}

export interface AlertEngineInput {
  routePoints: RoutePoint[];
  clusters: DisasterCluster[];
  weather?: {
    rain_mm_per_hr?: number;
    wind?: number;
  };
}

const LOCATION_CACHE_TTL_MS = 30 * 60 * 1000;
const locationCache = new Map<string, { expiresAt: number; value: string | null }>();

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function minDistanceKm(routePoints: RoutePoint[], lat: number, lon: number): number {
  if (!routePoints.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const p of routePoints) {
    const d = haversineKm(p.lat, p.lon, lat, lon);
    if (d < min) min = d;
  }
  return min;
}

function inferRegion(lat: number): AlertRegion {
  if (lat < 27.0) return "Terai";
  if (lat < 28.0) return "Hill";
  return "Mountain";
}

function cacheKey(lat: number, lon: number) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

async function resolveLocationName(lat: number, lon: number): Promise<string | null> {
  const key = cacheKey(lat, lon);
  const cached = locationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "YatraAI/1.0 (route-alert-engine)",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(3500),
      }
    );
    if (!res.ok) {
      locationCache.set(key, { value: null, expiresAt: Date.now() + LOCATION_CACHE_TTL_MS });
      return null;
    }

    const data = (await res.json()) as {
      address?: Record<string, string | undefined>;
      display_name?: string;
    };
    const addr = data.address ?? {};
    const name =
      addr.city_district ||
      addr.town ||
      addr.city ||
      addr.village ||
      addr.county ||
      addr.state_district ||
      data.display_name?.split(",")[0]?.trim() ||
      null;

    locationCache.set(key, { value: name, expiresAt: Date.now() + LOCATION_CACHE_TTL_MS });
    return name;
  } catch {
    locationCache.set(key, { value: null, expiresAt: Date.now() + LOCATION_CACHE_TTL_MS });
    return null;
  }
}

async function enrichClusterLocations(clusters: DisasterCluster[]): Promise<DisasterCluster[]> {
  return Promise.all(
    clusters.map(async (c) => {
      if (c.location && c.location.trim()) return c;
      const resolved = await resolveLocationName(c.lat, c.lon);
      return { ...c, location: resolved ?? "this area" };
    })
  );
}

function filterClusters(input: AlertEngineInput): DisasterCluster[] {
  return input.clusters.filter((cluster) => {
    const distanceKm = minDistanceKm(input.routePoints, cluster.lat, cluster.lon);
    const nearRoute = distanceKm <= 10;
    const relevantActivity = cluster.count > 1 || cluster.recent;
    return nearRoute && relevantActivity;
  });
}

function toTitleCaseHazard(type: AlertDisasterType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export async function generateDynamicAlerts(input: AlertEngineInput): Promise<{ alerts: string[] }> {
  if (!input || !Array.isArray(input.routePoints) || !Array.isArray(input.clusters)) {
    return { alerts: [] };
  }

  const filtered = filterClusters(input);
  if (!filtered.length) return { alerts: [] };

  const enriched = await enrichClusterLocations(filtered);
  const alerts = new Set<string>();

  for (const cluster of enriched) {
    const region = cluster.region ?? inferRegion(cluster.lat);
    const location = cluster.location?.trim() || "this area";

    // Landslide rule
    if (cluster.type === "landslide" && cluster.count >= 5) {
      alerts.add(`Landslide-prone zone near ${location}`);
    }

    // Flood rule
    if (cluster.type === "flood" && region === "Terai") {
      alerts.add("Flood history in Terai belt");
    }

    // Earthquake rule
    if (cluster.type === "earthquake" && cluster.severityScore > 0.5) {
      alerts.add(`Seismic activity recorded near ${location}`);
    }

    // Fallback dynamic rule for relevant, non-critical cluster signal
    if (cluster.recent && cluster.count > 1 && cluster.severityScore > 0.2) {
      alerts.add(`Recent ${toTitleCaseHazard(cluster.type)} activity detected near ${location}`);
    }

    // Weather trigger (regional)
    if ((input.weather?.rain_mm_per_hr ?? 0) > 20 && region === "Hill") {
      alerts.add("Heavy rainfall increases landslide risk");
    }
  }

  return { alerts: [...alerts] };
}

