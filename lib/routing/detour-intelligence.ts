import type { DetourInfo, GeoPoint, RouteCoordinate, VehicleProfile } from "./types";
import { fetchRoadRoute } from "./openroute-service";
import { haversineKm } from "./geo";

export interface DetourResult {
  placeId: string;
  placeName: string;
  mainRouteDistance: number;
  mainRouteDuration: number;
  detourRouteDistance: number;
  detourRouteDuration: number;
  extraDistance: number;
  extraDuration: number;
  extraMinutes: number;
  detourPercentage: number;
  detourCoordinates: RouteCoordinate[];
  feasible: boolean;
}

export async function computeDetour(
  from: GeoPoint,
  place: { lat: number; lon: number },
  to: GeoPoint,
  vehicle: VehicleProfile = "car"
): Promise<DetourResult> {
  try {
    const directRoute = await fetchRoadRoute(from, to, vehicle);
    const viaRoute = await fetchRoadRoute(from, to, vehicle, { waypoints: [{ lat: place.lat, lon: place.lon, name: "" }] });

    const main = directRoute[0];
    const detour = viaRoute[0];

    const extraDistance = detour.distance - main.distance;
    const extraDuration = detour.duration - main.duration;
    const extraMinutes = Math.round(extraDuration / 60);
    const detourPercentage = main.distance > 0
      ? Math.round((extraDistance / main.distance) * 100)
      : 0;

    return {
      placeId: "",
      placeName: place.lat.toFixed(4) + "," + place.lon.toFixed(4),
      mainRouteDistance: main.distance,
      mainRouteDuration: main.duration,
      detourRouteDistance: detour.distance,
      detourRouteDuration: detour.duration,
      extraDistance,
      extraDuration,
      extraMinutes,
      detourPercentage,
      detourCoordinates: detour.coordinates,
      feasible: extraMinutes < 180,
    };
  } catch {
    const directDist = haversineKm(from.lat, from.lon, to.lat, to.lon);
    const viaDist = haversineKm(from.lat, from.lon, place.lat, place.lon) +
      haversineKm(place.lat, place.lon, to.lat, to.lon);
    const extra = viaDist - directDist;

    return {
      placeId: "",
      placeName: place.lat.toFixed(4) + "," + place.lon.toFixed(4),
      mainRouteDistance: Math.round(directDist * 1000),
      mainRouteDuration: Math.round((directDist / 35) * 3600),
      detourRouteDistance: Math.round(viaDist * 1000),
      detourRouteDuration: Math.round((viaDist / 30) * 3600),
      extraDistance: Math.round(extra * 1000),
      extraDuration: Math.round((extra / 30) * 3600),
      extraMinutes: Math.round((extra / 30) * 60),
      detourPercentage: directDist > 0 ? Math.round((extra / directDist) * 100) : 0,
      detourCoordinates: [],
      feasible: extra * 1000 < 100000,
    };
  }
}

export async function computeBulkDetours(
  from: GeoPoint,
  to: GeoPoint,
  places: DetourInfo[],
  vehicle: VehicleProfile = "car",
  concurrency = 3
): Promise<DetourInfo[]> {
  const results: DetourInfo[] = [];

  for (let i = 0; i < places.length; i += concurrency) {
    const batch = places.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((place) =>
        computeDetour(from, { lat: place.lat, lon: place.lon }, to, vehicle)
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        const detour = result.value;
        results.push({
          ...places[i + j],
          detourDistanceKm: detour.extraDistance / 1000,
          detourDurationSeconds: detour.extraDuration,
          detourMinutes: detour.extraMinutes,
          detourPercentage: detour.detourPercentage,
        });
      } else {
        results.push(places[i + j]);
      }
    }
  }

  return results.sort((a, b) => a.score - b.score);
}

export function calculateDeviation(
  point: { lat: number; lon: number },
  route: RouteCoordinate[]
): { distanceKm: number; nearestIndex: number } {
  if (route.length === 0) return { distanceKm: 0, nearestIndex: 0 };

  let minDist = Infinity;
  let nearestIdx = 0;

  for (let i = 0; i < route.length; i++) {
    const d = haversineKm(point.lat, point.lon, route[i].lat, route[i].lon);
    if (d < minDist) {
      minDist = d;
      nearestIdx = i;
    }
  }

  return { distanceKm: Math.round(minDist * 100) / 100, nearestIndex: nearestIdx };
}
