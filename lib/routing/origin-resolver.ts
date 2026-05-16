import { prisma } from "@/lib/prisma";
import { isPointInNepal, isValidLatLon } from "@/lib/routing/geo";
import { reverseGeocodeNepal } from "@/lib/routing/nominatim";
import { findNearestRouteNode } from "@/lib/routing/node-graph";
import {
  findNearestKnownPlace,
  resolvePlaceByName,
} from "@/lib/routing/place-resolver";
import type { ResolvedPlace } from "@/lib/routing/types";

export const GPS_ACCURACY_GOOD_M = 80;
export const GPS_ACCURACY_POOR_M = 300;

export interface ResolveOriginInput {
  lat?: number;
  lon?: number;
  accuracyMeters?: number;
  name?: string;
  userId?: string;
  preferSavedHome?: boolean;
}

export interface ResolvedOrigin {
  place: ResolvedPlace;
  routeNodeId: string | null;
  routeNodeName: string | null;
  source: "saved-home" | "gps-snapped" | "manual-snapped" | "gps-poor-fallback" | "nearest-known";
  note?: string;
  rawLat?: number;
  rawLon?: number;
  accuracyMeters?: number;
}

async function getSavedHome(userId: string): Promise<ResolvedOrigin | null> {
  const saved = await prisma.userSavedLocation.findUnique({
    where: { userId },
    include: { nearestRouteNode: true },
  });

  if (saved) {
    const node = saved.nearestRouteNode;
    return {
      place: {
        id: null,
        name: saved.placeName,
        lat: node?.latitude ?? saved.latitude,
        lon: node?.longitude ?? saved.longitude,
        displayLat: saved.latitude,
        displayLon: saved.longitude,
        match: "exact",
      },
      routeNodeId: saved.nearestRouteNodeId,
      routeNodeName: node?.name ?? null,
      source: "saved-home",
      note: node
        ? `Home: ${saved.placeName} · route via ${node.name}`
        : `Using saved home: ${saved.placeName}`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      homeLocation: true,
      preference: true,
    },
  });

  if (user?.preference?.locationLat != null && user.preference.locationLng != null) {
    const lat = user.preference.locationLat;
    const lon = user.preference.locationLng;
    if (isValidLatLon(lat, lon) && isPointInNepal(lat, lon)) {
      const node = await findNearestRouteNode(lat, lon, 40);
      return {
        place: {
          id: user.homeLocation?.id ?? null,
          name: user.homeLocation?.name ?? "Home",
          lat: node?.lat ?? lat,
          lon: node?.lon ?? lon,
          match: "exact",
        },
        routeNodeId: node?.id ?? null,
        routeNodeName: node?.name ?? null,
        source: "saved-home",
        note: `Using profile home location`,
      };
    }
  }

  if (user?.homeLocation) {
    const hl = user.homeLocation;
    const node = await findNearestRouteNode(hl.latitude, hl.longitude, 40);
    return {
      place: {
        id: hl.id,
        name: hl.name,
        lat: node?.lat ?? hl.latitude,
        lon: node?.lon ?? hl.longitude,
        match: "exact",
      },
      routeNodeId: node?.id ?? null,
      routeNodeName: node?.name ?? null,
      source: "saved-home",
      note: `Using home district: ${hl.name}`,
    };
  }

  return null;
}

/** Full origin resolution: GPS → validate → geocode → snap to route node → fallback home. */
export async function resolveTravelOrigin(
  input: ResolveOriginInput
): Promise<ResolvedOrigin> {
  const { lat, lon, accuracyMeters, name, userId, preferSavedHome } = input;

  if (preferSavedHome && userId) {
    const home = await getSavedHome(userId);
    if (home) return home;
  }

  const poorGps =
    lat == null ||
    lon == null ||
    !isValidLatLon(lat, lon) ||
    !isPointInNepal(lat, lon) ||
    (accuracyMeters != null && accuracyMeters > GPS_ACCURACY_POOR_M);

  if (poorGps) {
    if (userId) {
      const home = await getSavedHome(userId);
      if (home) {
        return {
          ...home,
          source: "gps-poor-fallback",
          note: `GPS unavailable or inaccurate (${accuracyMeters ? Math.round(accuracyMeters) + "m" : "no signal"}). ${home.note}`,
          rawLat: lat,
          rawLon: lon,
          accuracyMeters,
        };
      }
    }

    if (lat != null && lon != null && isValidLatLon(lat, lon)) {
      const nearest = await findNearestKnownPlace(lat, lon, 60);
      if (nearest) {
        const node = await findNearestRouteNode(nearest.lat, nearest.lon, 40);
        return {
          place: {
            ...nearest,
            lat: node?.lat ?? nearest.lat,
            lon: node?.lon ?? nearest.lon,
          },
          routeNodeId: node?.id ?? null,
          routeNodeName: node?.name ?? null,
          source: "nearest-known",
          note: `Snapped to nearest known place: ${nearest.name}`,
          rawLat: lat,
          rawLon: lon,
          accuracyMeters,
        };
      }
    }

    throw new Error(
      "Could not determine your location. Set your home location in profile or enable GPS."
    );
  }

  let placeName = name;
  let geocodedLat = lat!;
  let geocodedLon = lon!;

  if (!placeName || accuracyMeters == null || accuracyMeters > GPS_ACCURACY_GOOD_M) {
    const geo = await reverseGeocodeNepal(lat!, lon!);
    if (geo) {
      placeName = geo.displayName.split(",")[0].trim();
      geocodedLat = geo.lat;
      geocodedLon = geo.lon;
    }
  }

  const byName = placeName
    ? await resolvePlaceByName(placeName, geocodedLat, geocodedLon)
    : null;

  const snapBase = byName ?? (await findNearestKnownPlace(geocodedLat, geocodedLon, 25));
  const snapLat = snapBase?.lat ?? geocodedLat;
  const snapLon = snapBase?.lon ?? geocodedLon;

  const routeNode = await findNearestRouteNode(snapLat, snapLon, 30);

  const source =
    accuracyMeters != null && accuracyMeters > GPS_ACCURACY_GOOD_M
      ? "gps-snapped"
      : name
        ? "manual-snapped"
        : "gps-snapped";

  const notes: string[] = [];
  if (snapBase && snapBase.match === "nearest") {
    notes.push(`Snapped to ${snapBase.name} (${snapBase.distanceKm?.toFixed(1)} km)`);
  }
  if (routeNode && routeNode.distanceKm > 0.5) {
    notes.push(`Route hub: ${routeNode.name}`);
  }
  if (accuracyMeters != null && accuracyMeters > GPS_ACCURACY_GOOD_M) {
    notes.push(`GPS accuracy ±${Math.round(accuracyMeters)}m`);
  }

  const routingLat = routeNode?.lat ?? snapLat;
  const routingLon = routeNode?.lon ?? snapLon;

  return {
    place: {
      id: snapBase?.id ?? byName?.id ?? null,
      name: placeName ?? snapBase?.name ?? routeNode?.name ?? "Your location",
      lat: routingLat,
      lon: routingLon,
      displayLat: lat,
      displayLon: lon,
      match: snapBase?.match ?? byName?.match ?? "nearest",
      distanceKm: routeNode?.distanceKm,
    },
    routeNodeId: routeNode?.id ?? null,
    routeNodeName: routeNode?.name ?? null,
    source,
    note: notes.join("; ") || undefined,
    rawLat: lat,
    rawLon: lon,
    accuracyMeters,
  };
}

/** Save or update user home with nearest route node snap. */
export async function saveUserHomeLocation(
  userId: string,
  placeName: string,
  lat: number,
  lon: number,
  source: string = "manual",
  accuracyMeters?: number
): Promise<ResolvedOrigin> {
  if (!isPointInNepal(lat, lon)) {
    throw new Error("Location must be within Nepal");
  }

  const routeNode = await findNearestRouteNode(lat, lon, 40);
  const snappedLat = routeNode?.lat ?? lat;
  const snappedLon = routeNode?.lon ?? lon;

  await prisma.userSavedLocation.upsert({
    where: { userId },
    create: {
      userId,
      placeName,
      latitude: lat,
      longitude: lon,
      nearestRouteNodeId: routeNode?.id ?? null,
      accuracyMeters: accuracyMeters ?? null,
      source,
    },
    update: {
      placeName,
      latitude: lat,
      longitude: lon,
      nearestRouteNodeId: routeNode?.id ?? null,
      accuracyMeters: accuracyMeters ?? null,
      source,
    },
  });

  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, locationLat: lat, locationLng: lon, interests: [], riskTolerance: "MEDIUM", travelStyle: [] },
    update: { locationLat: lat, locationLng: lon },
  });

  return {
    place: {
      id: null,
      name: placeName,
      lat: snappedLat,
      lon: snappedLon,
      displayLat: lat,
      displayLon: lon,
      match: "exact",
    },
    routeNodeId: routeNode?.id ?? null,
    routeNodeName: routeNode?.name ?? null,
    source: "saved-home",
    note: routeNode ? `Home saved · route via ${routeNode.name}` : undefined,
  };
}
