import { prisma } from "@/lib/prisma";
import { haversineKm, isValidLatLon, nameSimilarity, normalizePlaceName } from "@/lib/routing/geo";
import { getRouteNodeById } from "@/lib/routing/node-graph";
import {
  findNearestLocation,
  findNearestRouteNode,
  findNearestPlace,
} from "@/lib/routing/spatial";
import type { ResolvedPlace } from "@/lib/routing/types";

type DbLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

async function searchLocationsByName(
  name: string,
  limit = 20
): Promise<DbLocation[]> {
  const normalized = normalizePlaceName(name);
  return prisma.$queryRawUnsafe<DbLocation[]>(
    `SELECT id, name, latitude, longitude
     FROM "Location"
     WHERE name ILIKE $1
     LIMIT $2`,
    `%${normalized}%`,
    limit
  );
}

export async function resolvePlaceByName(
  name: string,
  hintLat?: number,
  hintLon?: number
): Promise<ResolvedPlace | null> {
  const normalized = normalizePlaceName(name);
  if (!normalized) return null;

  // Try exact match first via ILIKE + spatial proximity
  const candidates = await searchLocationsByName(normalized, 20);
  if (candidates.length === 0) return null;

  // Check for exact normalized match
  for (const c of candidates) {
    if (normalizePlaceName(c.name) === normalized) {
      return {
        id: c.id,
        name: c.name,
        lat: c.latitude,
        lon: c.longitude,
        match: "exact",
      };
    }
  }

  // Fuzzy sort by name similarity, then spatial proximity
  let scored = candidates.map((c) => ({
    row: c,
    score: nameSimilarity(name, c.name),
    dist: hintLat != null && hintLon != null
      ? haversineKm(hintLat, hintLon, c.latitude, c.longitude)
      : Infinity,
  }));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score >= 0.6) {
    return {
      id: best.row.id,
      name: best.row.name,
      lat: best.row.latitude,
      lon: best.row.longitude,
      match: "fuzzy",
      distanceKm: best.dist === Infinity ? undefined : best.dist,
    };
  }

  // Fallback: search Destination table
  const destHits = await prisma.destination.findMany({
    where: { normalizedName: { contains: normalized } },
    select: { id: true, name: true, normalizedName: true, latitude: true, longitude: true, district: true },
    take: 10,
  });

  if (destHits.length > 0) {
    const byName = hintLat != null && hintLon != null
      ? destHits.sort(
          (a, b) => haversineKm(hintLat!, hintLon!, a.latitude, a.longitude)
            - haversineKm(hintLat!, hintLon!, b.latitude, b.longitude)
        )[0]
      : destHits.sort((a, b) => nameSimilarity(name, b.name) - nameSimilarity(name, a.name))[0];

    if (
      Number.isFinite(byName.latitude) &&
      Number.isFinite(byName.longitude) &&
      !(byName.latitude === 0 && byName.longitude === 0)
    ) {
      return {
        id: byName.id,
        name: byName.name,
        lat: byName.latitude,
        lon: byName.longitude,
        match: normalizePlaceName(byName.name) === normalized ? "exact" : "fuzzy",
      };
    }
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
  const best = await findNearestLocation(lat, lon, maxKm);
  if (!best) return null;
  return {
    id: best.id,
    name: best.name,
    lat: best.lat,
    lon: best.lon,
    match: "nearest",
    distanceKm: best.distanceKm,
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
  return prisma.location.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
    where: {
      latitude: { not: 0 },
      longitude: { not: 0 },
    },
  });
}
