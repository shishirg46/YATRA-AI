import type { NamedPlace, NamedRoute } from "@/lib/routing/types";
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
    sampled.map((p) => reverseGeocodeNepal(p.lat, p.lon)),
  );

  const namedPlaces: NamedPlace[] = [];
  for (const r of results) {
    if (!r) continue;
    if (!isSettlement(r.address)) continue;

    const name = getSettlementName(r.address);
    const label = getSettlementLabel(r.address);
    if (!name || !label) continue;

    const last = namedPlaces[namedPlaces.length - 1];
    if (last && last.name === name) continue;

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
