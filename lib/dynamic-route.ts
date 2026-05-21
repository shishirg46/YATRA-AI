import type { GeoPoint, VehicleProfile, RouteCoordinate } from "@/lib/routing/types";
import { fetchRoadRoute, fetchRouteWithAlternatives } from "@/lib/routing/openroute-service";
import { routeCache, makeRouteCacheKey } from "@/lib/routing/route-cache";

export interface DynamicRouteRequest {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  vehicle?: VehicleProfile;
}

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface DynamicRoute {
  id: string;
  name: string;
  distance: number;
  duration: number;
  points: RoutePoint[];
  sampledPoints: RoutePoint[];
  encodedPolyline?: string;
  legs?: Array<{
    distance: number;
    duration: number;
    summary: string;
    steps: Array<{
      text: string;
      distance: number;
      duration: number;
      type: string;
      lat: number;
      lon: number;
    }>;
  }>;
}

export function sampleRoutePoints(points: RoutePoint[], step = 10): RoutePoint[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const safeStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 10;
  return points.filter((_, index) => index % safeStep === 0);
}

function toRouteName(index: number): string {
  return index === 0 ? "Primary Route" : `Alternative Route ${index}`;
}

function toDynamicRoute(index: number, coordinates: RouteCoordinate[], distance: number, duration: number, encodedPolyline?: string, legs?: DynamicRoute["legs"]): DynamicRoute {
  const points = coordinates.map((c) => ({ lat: c.lat, lon: c.lon }));
  return {
    id: `route_${index + 1}`,
    name: toRouteName(index),
    distance: Math.round(distance),
    duration: Math.round(duration),
    points,
    sampledPoints: sampleRoutePoints(points, 10),
    encodedPolyline,
    legs,
  };
}

async function fetchRoadRoutes(input: DynamicRouteRequest): Promise<DynamicRoute[]> {
  const start: GeoPoint = { lat: input.startLat, lon: input.startLon };
  const end: GeoPoint = { lat: input.endLat, lon: input.endLon };
  const vehicle = input.vehicle ?? "car";

  const cacheKey = makeRouteCacheKey(input.startLat, input.startLon, input.endLat, input.endLon, vehicle);

  return routeCache.getOrFetch(
    cacheKey,
    async () => {
      const routes = await fetchRouteWithAlternatives(start, end, vehicle);
      return routes.map((route, index) =>
        toDynamicRoute(
          index,
          route.coordinates,
          route.distance,
          route.duration,
          route.encodedPolyline,
          route.legs.map((leg) => ({
            distance: leg.distance,
            duration: leg.duration,
            summary: leg.summary,
            steps: leg.steps.map((s) => ({
              text: s.text,
              distance: s.distance,
              duration: s.duration,
              type: s.type,
              lat: s.lat,
              lon: s.lon,
            })),
          }))
        )
      );
    },
    10 * 60 * 1000
  );
}

export async function generateDynamicRoutes(input: DynamicRouteRequest): Promise<{ routes: DynamicRoute[] }> {
  try {
    const routes = await fetchRoadRoutes(input);
    return { routes };
  } catch (orsErr) {
    throw new Error(`OpenRouteService routing failed: ${String(orsErr)}`);
  }
}
