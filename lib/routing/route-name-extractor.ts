import type { NamedPlace, NamedRoute } from "@/lib/routing/types";
import { haversineM } from "@/lib/routing/geo";
import { simplifyPolyline, type LatLon } from "@/lib/routing/polyline-simplify";
import { reverseGeocodeNepal } from "@/lib/routing/nominatim";
import { fetchOsrmRouteThroughNodes } from "@/lib/routing/osrm-client";

type PlaceLabel = "city" | "town" | "village" | "municipality";

const PLACE_PRIORITY: PlaceLabel[] = [
  "city",
  "town",
  "village",
  "municipality",
];

function isSettlement(addr?: {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
}): boolean {
  if (!addr) return false;
  return !!(addr.city || addr.town || addr.village || addr.municipality);
}

function getSettlementLabel(addr?: {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
}): PlaceLabel | null {
  if (!addr) return null;
  for (const key of PLACE_PRIORITY) {
    if (addr[key]) return key;
  }
  return null;
}

function getSettlementName(addr?: {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
}): string | null {
  if (!addr) return null;
  for (const key of PLACE_PRIORITY) {
    const val = addr[key];
    if (val) return normalizeSettlementName(val);
  }
  return null;
}

function normalizeSettlementName(name: string): string | null {
  const normalized = name
    .replace(/\bward\s*(no\.?|number)?\s*\d+\b/gi, "")
    .replace(/\bmunicipality\b/gi, "")
    .replace(/\bcity\b/gi, "")
    .replace(/\bsub-?metropolitan\b/gi, "")
    .replace(/\bmetropolitan\b/gi, "")
    .replace(/\brural\b/gi, "")
    .replace(/\bgaunpalika\b/gi, "")
    .replace(/\bnagarpalika\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[,.\-\s]+|[,.\-\s]+$/g, "")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function inRoadCorridor(
  lat: number, lon: number,
  placeLat: number, placeLon: number,
  samples: LatLon[],
  index: number,
  alongMeters: number,
  crossMeters: number,
): boolean {
  const prev = index > 0 ? samples[index - 1] : null;
  const next = index < samples.length - 1 ? samples[index + 1] : null;

  let dlat: number, dlng: number;
  if (prev && next) {
    dlat = next.lat - prev.lat;
    dlng = next.lon - prev.lon;
  } else if (prev) {
    dlat = lat - prev.lat;
    dlng = lon - prev.lon;
  } else if (next) {
    dlat = next.lat - lat;
    dlng = next.lon - lon;
  } else {
    return haversineM(lat, lon, placeLat, placeLon) <= Math.hypot(alongMeters, crossMeters);
  }

  const dirLen = Math.hypot(dlat, dlng);
  if (dirLen < 1e-12) {
    return haversineM(lat, lon, placeLat, placeLon) <= Math.hypot(alongMeters, crossMeters);
  }

  const ux = dlng / dirLen;
  const uy = dlat / dirLen;

  const cosLat = Math.cos(lat * Math.PI / 180);
  const dx = (placeLon - lon) * (111320 * cosLat);
  const dy = (placeLat - lat) * 111320;

  const uxm = ux * (111320 * cosLat);
  const uym = uy * 111320;
  const umag = Math.hypot(uxm, uym);
  if (umag < 1e-12) return true;

  const uxn = uxm / umag;
  const uyn = uym / umag;

  const vxn = -uyn;
  const vyn = uxn;

  const along = dx * uxn + dy * uyn;
  const cross = Math.abs(dx * vxn + dy * vyn);

  return Math.abs(along) <= alongMeters && cross <= crossMeters;
}

export async function extractRouteNames(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  existingCoords?: Array<{ lat: number; lon: number }>,
): Promise<NamedRoute | null> {
  let coordinates: LatLon[];

  if (existingCoords && existingCoords.length >= 2) {
    coordinates = existingCoords;
  } else {
    const route = await fetchOsrmRouteThroughNodes([
      { lat: originLat, lon: originLon, name: "" },
      { lat: destLat, lon: destLon, name: "" },
    ]);
    if (!route || route.length === 0) return null;
    coordinates = route[0].coordinates;
  }

  if (coordinates.length < 2) return null;

  const sampled = simplifyPolyline(coordinates, 1.0);

  const results = await Promise.all(
    sampled.map(async (p, idx) => ({
      coord: p,
      result: await reverseGeocodeNepal(p.lat, p.lon),
      index: idx,
    })),
  );

  const namedPlaces: NamedPlace[] = [];
  const seen = new Set<string>();
  for (const { coord, result: r, index: idx } of results) {
    if (!r) continue;
    if (!inRoadCorridor(coord.lat, coord.lon, r.lat, r.lon, sampled, idx, 500, 250)) continue;
    if (!isSettlement(r.address)) continue;

    const name = getSettlementName(r.address);
    const label = getSettlementLabel(r.address);
    if (!name || !label) continue;

    if (seen.has(name)) continue;
    seen.add(name);

    namedPlaces.push({
      name,
      lat: r.lat,
      lon: r.lon,
      type: label,
    });
  }

  return {
    coordinates,
    namedPlaces: namedPlaces.map((p) => p.name),
    distance: 0,
    duration: 0,
  };
}
