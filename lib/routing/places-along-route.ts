import { prisma } from "@/lib/prisma";
import { findDestinationsInBuffer } from "./route-buffer";
import type { DetourInfo, RouteCoordinate, VehicleProfile } from "./types";
import { haversineKm } from "./geo";

export interface PlacesAlongRouteOptions {
  bufferWkt: string;
  radiusMeters: number;
  mainRoute: RouteCoordinate[];
  categories?: string[];
  vehicle?: VehicleProfile;
}

export async function findPlacesAlongRoute(
  options: PlacesAlongRouteOptions
): Promise<DetourInfo[]> {
  const { bufferWkt, radiusMeters, mainRoute, categories } = options;

  const destinations = await findDestinationsInBuffer(bufferWkt, radiusMeters, categories, mainRoute);

  const detourInfos: DetourInfo[] = destinations.map((dest) => {
    const distanceFromRouteKm = dest.distanceFromRoute / 1000;

    const nearestRouteIdx = findNearestPointOnRoute(dest.latitude, dest.longitude, mainRoute);
    const routePoint = mainRoute[nearestRouteIdx];

    const detourDistanceKm = routePoint
      ? haversineKm(routePoint.lat, routePoint.lon, dest.latitude, dest.longitude)
      : distanceFromRouteKm;

    const detourDurationSeconds = Math.round((detourDistanceKm / 30) * 3600);
    const detourMinutes = Math.round(detourDurationSeconds / 60);

    const totalRouteKm = haversineKm(
      mainRoute[0]?.lat ?? 0,
      mainRoute[0]?.lon ?? 0,
      mainRoute[mainRoute.length - 1]?.lat ?? 0,
      mainRoute[mainRoute.length - 1]?.lon ?? 0
    );

    const detourPercentage = totalRouteKm > 0
      ? Math.round((detourDistanceKm / totalRouteKm) * 100)
      : 0;

    const score = calculatePlaceScore({
      popularityScore: dest.popularityScore,
      accessibilityScore: dest.accessibilityScore,
      distanceFromRouteKm,
      detourMinutes,
    });

    return {
      placeId: dest.id,
      placeName: dest.name,
      lat: dest.latitude,
      lon: dest.longitude,
      category: dest.category,
      routeDeviationKm: distanceFromRouteKm,
      detourDistanceKm,
      detourDurationSeconds,
      detourMinutes,
      detourPercentage,
      distanceFromRouteKm,
      accessibilityScore: dest.accessibilityScore,
      popularityScore: dest.popularityScore,
      score,
    };
  });

  return detourInfos.sort((a, b) => b.score - a.score);
}

function findNearestPointOnRoute(
  lat: number,
  lon: number,
  route: RouteCoordinate[]
): number {
  if (route.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < route.length; i++) {
    const d = haversineKm(lat, lon, route[i].lat, route[i].lon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function calculatePlaceScore(params: {
  popularityScore: number;
  accessibilityScore: number;
  distanceFromRouteKm: number;
  detourMinutes: number;
}): number {
  const popularityWeight = 0.3;
  const accessibilityWeight = 0.25;
  const proximityWeight = 0.25;
  const detourWeight = 0.2;

  const popularityScore = Math.min(1, params.popularityScore);
  const accessibilityScore = Math.min(1, params.accessibilityScore);
  const proximityScore = Math.max(0, 1 - params.distanceFromRouteKm / 50);
  const detourScore = Math.max(0, 1 - params.detourMinutes / 120);

  return Math.round((
    popularityScore * popularityWeight +
    accessibilityScore * accessibilityWeight +
    proximityScore * proximityWeight +
    detourScore * detourWeight
  ) * 100) / 100;
}

export async function getPlacesByCategory(
  categories: string[],
  limit = 20
): Promise<Array<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  popularityScore: number;
  accessibilityScore: number;
  description?: string;
  image?: string;
}>> {
  const results = await prisma.destination.findMany({
    where: {
      category: { in: categories as any },
      verified: true,
    },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      category: true,
      popularityScore: true,
      accessibilityScore: true,
      description: true,
      image: true,
    },
    orderBy: { popularityScore: "desc" },
    take: limit,
  });

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    category: r.category,
    popularityScore: r.popularityScore ?? 0,
    accessibilityScore: r.accessibilityScore ?? 0,
    description: r.description ?? undefined,
    image: r.image ?? undefined,
  }));
}
