import type { DetourInfo, RouteCoordinate, RouteStop } from "./types";
import { haversineKm } from "./geo";

export interface RankedStopResult {
  stops: RouteStop[];
  bestStop: RouteStop | null;
}

export interface RankingWeights {
  popularity: number;
  accessibility: number;
  proximity: number;
  detour: number;
  category: number;
}

const DEFAULT_WEIGHTS: RankingWeights = {
  popularity: 0.25,
  accessibility: 0.20,
  proximity: 0.20,
  detour: 0.20,
  category: 0.15,
};

const CATEGORY_BONUS: Record<string, number> = {
  VIEWPOINT: 0.15,
  WATERFALL: 0.15,
  LAKE: 0.12,
  MOUNTAIN: 0.12,
  TREKKING_VILLAGE: 0.10,
  TEMPLE: 0.08,
  TOURIST_ATTRACTION: 0.10,
  FOREST: 0.08,
  RIVERSIDE: 0.08,
  MOUNTAIN_SETTLEMENT: 0.10,
};

export function rankPlacesForRoute(
  places: DetourInfo[],
  route: RouteCoordinate[],
  weights: RankingWeights = DEFAULT_WEIGHTS,
  userPreferences?: string[]
): RankedStopResult {
  if (places.length === 0) {
    return { stops: [], bestStop: null };
  }

  const totalRouteDistance = calculateRouteDistance(route);

  const scored = places.map((place) => {
    const popScore = place.popularityScore;
    const accScore = place.accessibilityScore;
    const proxScore = Math.max(0, 1 - (place.distanceFromRouteKm / 50));
    const detourScore = Math.max(0, 1 - (place.detourMinutes / 180));
    const catScore = getCategoryScore(place.category, userPreferences);

    const finalScore = Math.round((
      popScore * weights.popularity +
      accScore * weights.accessibility +
      proxScore * weights.proximity +
      detourScore * weights.detour +
      catScore * weights.category
    ) * 1000) / 1000;

    return {
      name: place.placeName,
      score: finalScore,
      detourTime: place.detourMinutes,
      category: place.category,
      lat: place.lat,
      lon: place.lon,
      detourDistanceKm: place.detourDistanceKm,
      popularityScore: place.popularityScore,
      accessibilityScore: place.accessibilityScore,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const nonZero = scored.filter((s) => s.score > 0);

  return {
    stops: scored,
    bestStop: nonZero[0] ?? scored[0] ?? null,
  };
}

function getCategoryScore(category: string, userPreferences?: string[]): number {
  const baseBonus = CATEGORY_BONUS[category] ?? 0.05;

  if (userPreferences?.length) {
    const prefMatch = userPreferences.some(
      (pref) => category.toLowerCase().includes(pref.toLowerCase())
    );
    return baseBonus + (prefMatch ? 0.2 : 0);
  }

  return baseBonus;
}

function calculateRouteDistance(route: RouteCoordinate[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += haversineKm(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon);
  }
  return total;
}

export function filterPlacesByCategory(places: DetourInfo[], categories: string[]): DetourInfo[] {
  if (!categories.length) return places;
  return places.filter((p) => categories.includes(p.category));
}

export function getTopStopsByScore(stops: RouteStop[], count = 5): RouteStop[] {
  return stops.slice(0, count);
}
