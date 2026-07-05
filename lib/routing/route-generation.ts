import { haversineKm, haversineM, isPointInNepal } from "@/lib/routing/geo";
import { reverseGeocodeNepal } from "@/lib/routing/nominatim";
import { fetchOsrmRouteThroughNodes } from "@/lib/routing/osrm-client";
import type {
  EnhancedRoad,
  EnhancedRoadResult,
  EnhancedRoadSegment,
  GeneratedRoad,
  NamedCoordinate,
  RoadGenerationResult,
  RouteNode,
} from "@/lib/routing/types";

type RouteCoord = { lat: number; lon: number };

const SETTLEMENT_KEYS = ["city", "town", "village", "municipality"] as const;
const DEFAULT_SAMPLE_INTERVAL_KM = 5;
const MAX_REVERSE_GEOCODE_POINTS = 80;

type SettlementKey = (typeof SETTLEMENT_KEYS)[number];

type SettlementAddress = Partial<Record<SettlementKey, string | undefined>>;

export interface GenerateRoadsInput {
  start: RouteCoord & { name?: string };
  destination: RouteCoord & { name?: string };
  sampleIntervalKm?: number;
  maxReverseGeocodePoints?: number;
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

function extractSettlementName(address?: SettlementAddress | null): string | null {
  if (!address) return null;

  for (const key of SETTLEMENT_KEYS) {
    const raw = address[key];
    if (!raw) continue;
    const normalized = normalizeSettlementName(raw);
    if (normalized) return normalized;
  }

  return null;
}

function appendConsecutiveUnique(sequence: string[], name: string) {
  const normalized = name.trim();
  if (!normalized) return;

  const previous = sequence[sequence.length - 1];
  if (previous && previous.toLowerCase() === normalized.toLowerCase()) return;
  sequence.push(normalized);
}

function buildSegments(sequence: string[]): string[] {
  const segments: string[] = [];
  for (let i = 0; i < sequence.length - 1; i += 1) {
    segments.push(`${sequence[i]} -> ${sequence[i + 1]}`);
  }
  return segments;
}

function sampleRouteCoordinates(
  coordinates: RouteCoord[],
  intervalKm: number,
  maxPoints: number,
): RouteCoord[] {
  if (coordinates.length <= 2) return [];

  const samples: RouteCoord[] = [];
  let distanceSinceLastSample = 0;

  for (let i = 1; i < coordinates.length - 1; i += 1) {
    const previous = coordinates[i - 1];
    const current = coordinates[i];
    distanceSinceLastSample += haversineKm(previous.lat, previous.lon, current.lat, current.lon);

    if (distanceSinceLastSample >= intervalKm) {
      samples.push(current);
      distanceSinceLastSample = 0;
    }
  }

  if (samples.length <= maxPoints) return samples;

  const step = Math.ceil(samples.length / maxPoints);
  return samples.filter((_, index) => index % step === 0).slice(0, maxPoints);
}

/**
 * Check if a place is within a road-aligned rectangle:
 *   ±alongMeters along the road, ±crossMeters perpendicular.
 * Direction is derived from adjacent samples.
 */
function inRoadCorridor(
  lat: number, lon: number,
  placeLat: number, placeLon: number,
  samples: RouteCoord[],
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

async function buildGeneratedRoad(
  id: number,
  coordinates: RouteCoord[],
  distance: number,
  duration: number,
  input: GenerateRoadsInput,
): Promise<GeneratedRoad> {
  const samples = sampleRouteCoordinates(
    coordinates,
    input.sampleIntervalKm ?? DEFAULT_SAMPLE_INTERVAL_KM,
    input.maxReverseGeocodePoints ?? MAX_REVERSE_GEOCODE_POINTS,
  );

  const reverseGeocoded = await Promise.all(
    samples.map((point) => reverseGeocodeNepal(point.lat, point.lon).catch(() => null)),
  );

  const sequence: string[] = [];
  appendConsecutiveUnique(sequence, input.start.name || "User Location");

  for (const result of reverseGeocoded) {
    if (!result) continue;
    const settlement = extractSettlementName(result.address);
    if (!settlement) continue;
    appendConsecutiveUnique(sequence, settlement);
  }

  appendConsecutiveUnique(sequence, input.destination.name || "Destination");

  return {
    id,
    sequence,
    segments: buildSegments(sequence),
    coordinates,
    distance,
    duration,
  };
}

export async function generateRoadsBetween(
  input: GenerateRoadsInput,
): Promise<RoadGenerationResult> {
  const nodes: RouteNode[] = [
    { lat: input.start.lat, lon: input.start.lon, name: input.start.name || "User Location" },
    { lat: input.destination.lat, lon: input.destination.lon, name: input.destination.name || "Destination" },
  ];

  const routes = await fetchOsrmRouteThroughNodes(nodes, true);
  if (!routes?.length) {
    return { roads: [] };
  }

  const roads = await Promise.all(
    routes.map((route, index) =>
      buildGeneratedRoad(index + 1, route.coordinates, route.distance, route.duration, input),
    ),
  );

  return { roads };
}

// ─── Enhanced Road Generation (with named sub-coordinates) ────────

function computeCumulativeDistances(coords: RouteCoord[]): number[] {
  const dists = [0];
  for (let i = 1; i < coords.length; i++) {
    dists.push(dists[i - 1] + haversineKm(coords[i - 1].lat, coords[i - 1].lon, coords[i].lat, coords[i].lon));
  }
  return dists;
}

function findClosestIndex(target: RouteCoord, coords: RouteCoord[]): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineKm(target.lat, target.lon, coords[i].lat, coords[i].lon);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return minIdx;
}

function buildEnhancedSegments(
  namedCoords: NamedCoordinate[],
  fullCoordinates: RouteCoord[],
  totalDistance: number,
  totalDuration: number,
  input: GenerateRoadsInput,
): EnhancedRoadSegment[] {
  if (namedCoords.length === 0) return [];

  const namedIndices: number[] = [];
  for (let i = 0; i < namedCoords.length; i++) {
    if (namedCoords[i].placeName) {
      namedIndices.push(i);
    }
  }

  if (namedIndices.length <= 1) {
    const fromName = namedCoords[0]?.placeName || input.start.name || "Start";
    const toName = namedCoords[namedCoords.length - 1]?.placeName || input.destination.name || "End";
    return [{
      index: 0,
      fromName,
      toName,
      fromCoord: namedCoords[0]?.coord || input.start,
      toCoord: namedCoords[namedCoords.length - 1]?.coord || input.destination,
      subCoords: namedCoords,
      direction: `${fromName} → ${toName}`,
      distance: totalDistance,
      duration: totalDuration,
    }];
  }

  const cumulativeDist = computeCumulativeDistances(fullCoordinates);
  const totalFullDist = cumulativeDist[cumulativeDist.length - 1] || 1;

  const namedFullIndices = namedIndices.map((ni) => findClosestIndex(namedCoords[ni].coord, fullCoordinates));

  const segments: EnhancedRoadSegment[] = [];
  for (let i = 0; i < namedIndices.length; i++) {
    const fromNamedIdx = namedIndices[i];
    const toNamedIdx = i < namedIndices.length - 1 ? namedIndices[i + 1] : namedCoords.length - 1;

    const fromName = namedCoords[fromNamedIdx].placeName
      || (i === 0 ? input.start.name : undefined)
      || "Start";
    const toName = namedCoords[toNamedIdx].placeName
      || (i === namedIndices.length - 1 ? input.destination.name : undefined)
      || "End";
    const subCoords = namedCoords.slice(fromNamedIdx, toNamedIdx + 1);

    const fromFullIdx = namedFullIndices[i];
    const toFullIdx = i < namedFullIndices.length - 1 ? namedFullIndices[i + 1] : cumulativeDist.length - 1;
    const segDist = cumulativeDist[toFullIdx] - cumulativeDist[fromFullIdx];
    const segDuration = totalDuration * (segDist / totalFullDist);

    segments.push({
      index: i,
      fromName,
      toName,
      fromCoord: namedCoords[fromNamedIdx].coord,
      toCoord: namedCoords[toNamedIdx].coord,
      subCoords,
      direction: `${fromName} → ${toName}`,
      distance: Math.round(segDist),
      duration: Math.round(segDuration),
    });
  }

  return segments;
}

async function buildEnhancedRoad(
  id: number,
  coordinates: RouteCoord[],
  distance: number,
  duration: number,
  input: GenerateRoadsInput,
): Promise<EnhancedRoad> {
  const rawSamples = sampleRouteCoordinates(
    coordinates,
    input.sampleIntervalKm ?? DEFAULT_SAMPLE_INTERVAL_KM,
    input.maxReverseGeocodePoints ?? MAX_REVERSE_GEOCODE_POINTS,
  );

  const CONCURRENCY = 10;
  const namedCoords: NamedCoordinate[] = [];
  for (let i = 0; i < rawSamples.length; i += CONCURRENCY) {
    const batch = rawSamples.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (point, batchIdx) => {
        const idx = i + batchIdx;
        if (!isPointInNepal(point.lat, point.lon)) {
          return { coord: point, placeName: null, placeType: null };
        }
        const result = await reverseGeocodeNepal(point.lat, point.lon).catch(() => null);
        if (!result) return { coord: point, placeName: null, placeType: null };
        if (idx > 0 && idx < rawSamples.length - 1) {
          if (!inRoadCorridor(point.lat, point.lon, result.lat, result.lon, rawSamples, idx, 500, 250)) {
            return { coord: point, placeName: null, placeType: null };
          }
        }
        const name = extractSettlementName(result.address);
        return {
          coord: point,
          placeName: name || null,
          placeType: result.placeType ?? null,
        };
      }),
    );
    namedCoords.push(...results);
  }

  const segments = buildEnhancedSegments(namedCoords, coordinates, distance, duration, input);

  const firstNamed = segments[0]?.fromName || input.start.name || "Start";
  const lastNamed = segments[segments.length - 1]?.toName || input.destination.name || "End";
  const roadName = `${firstNamed} → ${lastNamed}`;
  const direction = `${input.start.name || "User Location"} → ${input.destination.name || "Destination"}`;

  return {
    id,
    name: roadName,
    direction,
    distance,
    duration,
    fullCoordinates: coordinates,
    segments,
  };
}

export async function generateEnhancedRoadsBetween(
  input: GenerateRoadsInput,
): Promise<EnhancedRoadResult> {
  const nodes: RouteNode[] = [
    { lat: input.start.lat, lon: input.start.lon, name: input.start.name || "User Location" },
    { lat: input.destination.lat, lon: input.destination.lon, name: input.destination.name || "Destination" },
  ];

  const routes = await fetchOsrmRouteThroughNodes(nodes, true);
  if (!routes?.length) {
    return { roads: [] };
  }

  const roads = await Promise.all(
    routes.map((route, index) =>
      buildEnhancedRoad(index + 1, route.coordinates, route.distance, route.duration, input),
    ),
  );

  return { roads };
}

