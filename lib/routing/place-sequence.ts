import { findNearestPlacePG, type PlaceResult } from "@/lib/routing/spatial";

export interface PlaceSequenceOptions {
  /** Search radius in meters for each sample point (default: 3000) */
  radiusMeters?: number;
  /** Minimum distance (km) between consecutive unique places (default: 2.0) */
  minGapKm?: number;
  /** Sample every N vertices; 1 = every point (default: 5) */
  sampleEvery?: number;
  /** Maximum places to return (default: 100) */
  maxPlaces?: number;
  /** Skip small villages by type */
  minType?: "CITY" | "TOWN" | "VILLAGE";
}

export interface PlaceSequenceItem {
  place: PlaceResult;
  /** Index in the original polyline where this place was found */
  polylineIndex: number;
  /** Cumulative distance (km) from start of polyline */
  cumulativeKm: number;
  /** Distance from the polyline to the place (km) */
  snapDistanceKm: number;
}

export async function buildPlaceSequence(
  polyline: Array<{ lat: number; lon: number }>,
  options: PlaceSequenceOptions = {},
): Promise<PlaceSequenceItem[]> {
  const {
    radiusMeters = 3000,
    minGapKm = 2.0,
    sampleEvery = 5,
    maxPlaces = 100,
    minType,
  } = options;

  if (polyline.length < 2) return [];

  const found: PlaceSequenceItem[] = [];
  const seen = new Set<string>();
  let prevLat = polyline[0].lat;
  let prevLon = polyline[0].lon;
  let cumulativeKm = 0;
  let lastPlaceKm = -Infinity;

  for (let i = 0; i < polyline.length; i += sampleEvery) {
    const pt = polyline[i];
    if (i > 0) {
      cumulativeKm += haversineKm(prevLat, prevLon, pt.lat, pt.lon);
    }
    prevLat = pt.lat;
    prevLon = pt.lon;

    if (cumulativeKm - lastPlaceKm < minGapKm) continue;

    const place = await findNearestPlacePG(pt.lat, pt.lon, radiusMeters);
    if (!place) continue;
    if (minType === "TOWN" && place.type === "VILLAGE") continue;
    if (minType === "CITY" && place.type !== "CITY") continue;
    if (seen.has(place.id)) continue;

    seen.add(place.id);
    found.push({
      place,
      polylineIndex: i,
      cumulativeKm,
      snapDistanceKm: place.distanceKm,
    });
    lastPlaceKm = cumulativeKm;

    if (found.length >= maxPlaces) break;
  }

  return found;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
