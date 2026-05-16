import { prisma } from "@/lib/prisma";
import { haversineKm, isValidLatLon, nameSimilarity, normalizePlaceName } from "@/lib/routing/geo";
import { findNearestRouteNode, getRouteNodeById } from "@/lib/routing/node-graph";
import type { ResolvedPlace } from "@/lib/routing/types";

type DbLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

let locationCache: { expiresAt: number; rows: DbLocation[] } | null = null;

async function loadAllLocations(): Promise<DbLocation[]> {
  if (locationCache && locationCache.expiresAt > Date.now()) {
    return locationCache.rows;
  }
  const rows = await prisma.location.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  const valid = rows.filter(
    (r) =>
      Number.isFinite(r.latitude) &&
      Number.isFinite(r.longitude) &&
      !(r.latitude === 0 && r.longitude === 0)
  );
  locationCache = { rows: valid, expiresAt: Date.now() + 10 * 60 * 1000 };
  return valid;
}

export function invalidatePlaceCache(): void {
  locationCache = null;
}

export async function resolvePlaceByName(
  name: string,
  hintLat?: number,
  hintLon?: number
): Promise<ResolvedPlace | null> {
  const locations = await loadAllLocations();
  if (!locations.length) return null;

  const normalized = normalizePlaceName(name);
  let best: { row: DbLocation; score: number } | null = null;

  for (const row of locations) {
    const score = nameSimilarity(name, row.name);
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { row, score };
    }
    if (normalizePlaceName(row.name) === normalized) {
      return {
        id: row.id,
        name: row.name,
        lat: row.latitude,
        lon: row.longitude,
        match: "exact",
      };
    }
  }

  if (best && best.score >= 0.6) {
    const dist =
      hintLat != null && hintLon != null
        ? haversineKm(hintLat, hintLon, best.row.latitude, best.row.longitude)
        : undefined;
    return {
      id: best.row.id,
      name: best.row.name,
      lat: best.row.latitude,
      lon: best.row.longitude,
      match: "fuzzy",
      distanceKm: dist,
    };
  }

  return null;
}

export async function resolvePlaceById(id: string): Promise<ResolvedPlace | null> {
  const row = await prisma.location.findUnique({
    where: { id },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  if (
    !row ||
    !Number.isFinite(row.latitude) ||
    !Number.isFinite(row.longitude) ||
    (row.latitude === 0 && row.longitude === 0)
  ) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    lat: row.latitude,
    lon: row.longitude,
    match: "exact",
  };
}

export async function findNearestKnownPlace(
  lat: number,
  lon: number,
  maxKm = 50
): Promise<ResolvedPlace | null> {
  const locations = await loadAllLocations();
  let best: DbLocation | null = null;
  let bestDist = Infinity;

  for (const row of locations) {
    const d = haversineKm(lat, lon, row.latitude, row.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = row;
    }
  }

  if (!best || bestDist > maxKm) return null;

  return {
    id: best.id,
    name: best.name,
    lat: best.latitude,
    lon: best.longitude,
    match: "nearest",
    distanceKm: bestDist,
  };
}

export async function resolveDestination(input: {
  destinationId?: string;
  destinationName?: string;
  destinationLat?: number;
  destinationLon?: number;
}): Promise<{ place: ResolvedPlace; note?: string }> {
  if (input.destinationId) {
    const byId = await resolvePlaceById(input.destinationId);
    if (byId) return { place: byId };
  }

  if (input.destinationName) {
    const byName = await resolvePlaceByName(
      input.destinationName,
      input.destinationLat,
      input.destinationLon
    );
    if (byName) return { place: byName };

    if (
      input.destinationLat != null &&
      input.destinationLon != null &&
      isValidLatLon(input.destinationLat, input.destinationLon)
    ) {
      const nearest = await findNearestKnownPlace(
        input.destinationLat,
        input.destinationLon,
        80
      );
      if (nearest) {
        return {
          place: nearest,
          note: `"${input.destinationName}" not found; using nearest known place ${nearest.name} (${nearest.distanceKm?.toFixed(1)} km away)`,
        };
      }
      return {
        place: {
          id: null,
          name: input.destinationName,
          lat: input.destinationLat,
          lon: input.destinationLon,
          match: "coordinates",
        },
        note: `"${input.destinationName}" not in database; routing via coordinates`,
      };
    }
  }

  if (
    input.destinationLat != null &&
    input.destinationLon != null &&
    isValidLatLon(input.destinationLat, input.destinationLon)
  ) {
    const hub = await findNearestRouteNode(input.destinationLat, input.destinationLon, 50);
    const nearest = await findNearestKnownPlace(
      input.destinationLat,
      input.destinationLon,
      50
    );
    if (nearest || hub) {
      return {
        place: {
          id: nearest?.id ?? null,
          name: nearest?.name ?? hub?.name ?? input.destinationName ?? "Destination",
          lat: hub?.lat ?? nearest?.lat ?? input.destinationLat,
          lon: hub?.lon ?? nearest?.lon ?? input.destinationLon,
          match: nearest?.match ?? "nearest",
          distanceKm: hub?.distanceKm ?? nearest?.distanceKm,
        },
        note: hub
          ? `Snapped to route hub: ${hub.name}`
          : `Snapped to nearest known place: ${nearest?.name}`,
      };
    }
    throw new Error("Destination coordinates could not be matched to a known place");
  }

  throw new Error("Could not resolve destination");
}

export async function resolveOrigin(
  lat: number,
  lon: number,
  name?: string,
  routeNodeId?: string | null
): Promise<{ place: ResolvedPlace; note?: string; routeNodeId?: string | null }> {
  if (!isValidLatLon(lat, lon)) {
    throw new Error("Invalid origin coordinates");
  }

  const presetNode = routeNodeId ? await getRouteNodeById(routeNodeId) : null;
  const routeNode =
    presetNode
      ? { ...presetNode, distanceKm: haversineKm(lat, lon, presetNode.lat, presetNode.lon) }
      : await findNearestRouteNode(lat, lon, 25);

  if (routeNode && (routeNodeId === routeNode.id || routeNode.distanceKm <= 25)) {
    const useDisplay = routeNode.distanceKm <= 8;
    return {
      place: {
        id: null,
        name: name ?? routeNode.name,
        lat: routeNode.lat,
        lon: routeNode.lon,
        displayLat: useDisplay ? lat : undefined,
        displayLon: useDisplay ? lon : undefined,
        match: "nearest",
        distanceKm: routeNode.distanceKm,
      },
      routeNodeId: routeNode.id,
      note:
        routeNode.distanceKm > 0.5
          ? `Route via ${routeNode.name} (${routeNode.distanceKm.toFixed(1)} km from you)`
          : undefined,
    };
  }

  const nearest = await findNearestKnownPlace(lat, lon, 15);
  if (nearest) {
    const hub = await findNearestRouteNode(nearest.lat, nearest.lon, 30);
    return {
      place: {
        ...nearest,
        name: name ?? nearest.name,
        lat: hub?.lat ?? nearest.lat,
        lon: hub?.lon ?? nearest.lon,
        match: "nearest",
      },
      routeNodeId: hub?.id ?? null,
      note: `Snapped to ${nearest.name}${hub ? ` via ${hub.name}` : ""}`,
    };
  }

  return {
    place: {
      id: null,
      name: name ?? "Your location",
      lat: routeNode?.lat ?? lat,
      lon: routeNode?.lon ?? lon,
      match: "user",
    },
    routeNodeId: routeNode?.id ?? null,
  };
}

export async function getAllKnownPlaces(): Promise<DbLocation[]> {
  return loadAllLocations();
}
