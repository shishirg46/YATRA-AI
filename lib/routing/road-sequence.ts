import { prisma } from "@/lib/prisma";
import {
  resolveNearestJunction,
  findStablePath as graphFindPath,
  findMultiRoute,
  projectPathOntoPolyline,
  getSubSegments,
  getSubSegmentAtKm,
} from "@/lib/routing/segment-graph";
import type { CostModelOptions, MultiRoutePath } from "@/lib/routing/segment-graph";
import type { GeoPoint } from "@/lib/routing/types";
import { resolveCostModel } from "@/lib/routing/calibration";
import type { CalibrationProfileName } from "@/lib/routing/calibration";

export interface RoadSequenceOptions {
  /** Search radius in meters from polyline to road (default: 1000) */
  radiusMeters?: number;
  /** Sample every N vertices (default: 5) */
  sampleEvery?: number;
  /** Minimum road segment length in km to report (default: 5) */
  minSegmentKm?: number;
  /** Max gap (km) to merge same-road segments across (default: 20) */
  mergeGapKm?: number;
  /** Radius (m) to search for nearby junction nodes (default: 1000) */
  junctionRadiusMeters?: number;
}

export interface RoadSequenceItem {
  roadCode: string | null;
  roadName: string;
  roadType: string;
  /** Cumulative km from start where this road begins */
  fromKm: number;
  /** Cumulative km from start where this road ends */
  toKm: number;
  /** Polyline indices */
  polylineStartIdx: number;
  polylineEndIdx: number;
  /** Junction at the start of this segment (set on roadCode transitions) */
  fromJunction?: string;
  /** Junction at the end of this segment (set on roadCode transitions) */
  toJunction?: string;
  /** Continuity hints — e.g. JUNCTION_CONTINUITY means the gap was bridged by a junction */
  flags?: string[];
  /** Total gap km within segment that was continuity-bridged (0 unless flags includes JUNCTION_CONTINUITY) */
  continuityGapKm?: number;
}

interface RawMatch {
  polylineIndex: number;
  cumulativeKm: number;
  roadCode: string | null;
  roadName: string;
  roadType: string;
  continuityFlags: string[];
}

/**
 * Given a polyline, return the ordered sequence of named roads along it.
 * Uses PostGIS ST_DWithin on the road_segment geometry (LineString) table.
 *
 * Junction anchoring: when a sample point has no road within radius but is
 * within junctionRadiusMeters of a known junction node that contains the
 * previous roadCode, a JUNCTION_CONTINUITY flag is set. The merge phase
 * extends the preceding segment across the gap WITHOUT overriding roadCode
 * — geometry remains the truth source.
 */
export async function buildRoadSequence(
  polyline: Array<{ lat: number; lon: number }>,
  options: RoadSequenceOptions = {},
): Promise<RoadSequenceItem[]> {
  const {
    radiusMeters = 1000,
    sampleEvery = 5,
    minSegmentKm = 5,
    mergeGapKm = 20,
    junctionRadiusMeters = 1000,
  } = options;

  if (polyline.length < 2) return [];

  const rawMatches: RawMatch[] = [];

  let cumulativeKm = 0;
  let prevLat = polyline[0].lat;
  let prevLon = polyline[0].lon;
  let prevRoadCode: string | null = null;

  for (let i = 0; i < polyline.length; i += sampleEvery) {
    const pt = polyline[i];
    if (i > 0) {
      cumulativeKm += haversineKm(prevLat, prevLon, pt.lat, pt.lon);
    }
    prevLat = pt.lat;
    prevLon = pt.lon;

    const adaptiveRadius = getAdaptiveRadius(pt.lat, pt.lon, prevRoadCode, radiusMeters);
    const road = await findNearestRoad(pt.lat, pt.lon, adaptiveRadius);
    let roadCode = road?.roadCode ?? null;
    const flags: string[] = [];

// Junction anchoring layer:
//   1. Continuity voucher — if no road found but a known junction is nearby
//      that contains the previous road, mark as JUNCTION_CONTINUITY.
//      Note: roadCode stays null — we do NOT override geometry truth.
//   2. KNN tie-breaking — when multiple roads are at distance 0 (same
//      coordinate), prefer the previous roadCode to prevent identity
//      oscillation at shared waypoints (e.g., NH01 vs NH17 at Mugling).
if (!road && prevRoadCode) {
  const junction = await findNearestJunction(pt.lon, pt.lat, junctionRadiusMeters);
  if (junction?.roadCodes.includes(prevRoadCode)) {
    flags.push("JUNCTION_CONTINUITY");
  }
} else if (road && prevRoadCode && roadCode !== prevRoadCode) {
  // KNN tie-breaking: check if prev road also exists at distance 0
  const prevStillValid = await isRoadAtPoint(prevRoadCode, pt.lon, pt.lat);
  if (prevStillValid) {
    roadCode = prevRoadCode;
  }
}

rawMatches.push({
      polylineIndex: i,
      cumulativeKm,
      roadCode,
      roadName: road?.name ?? "(unknown road)",
      roadType: road?.roadType ?? "OTHER",
      continuityFlags: flags,
    });

    if (roadCode) prevRoadCode = roadCode;
  }

  // Merge consecutive same-road matches into ranges
  const merged: RoadSequenceItem[] = [];

  for (const match of rawMatches) {
    const last = merged[merged.length - 1];

    if (last && last.roadCode === match.roadCode) {
      // Extend current segment
      last.toKm = match.cumulativeKm;
      last.polylineEndIdx = match.polylineIndex;
    } else if (last && match.roadCode === null && match.continuityFlags.includes("JUNCTION_CONTINUITY")) {
      // Continuity anchor: extend preceding segment's range WITHOUT setting roadCode.
      // The segment honestly reflects that no geometry was found here, but
      // the junction confirms the road identity continues.
      last.toKm = match.cumulativeKm;
      last.polylineEndIdx = match.polylineIndex;
      if (!last.flags) last.flags = [];
      if (!last.flags.includes("JUNCTION_CONTINUITY")) {
        last.flags.push("JUNCTION_CONTINUITY");
      }
      // Track accumulated continuity gap
      const gapContribution = last.continuityGapKm ?? 0;
      last.continuityGapKm = gapContribution + 1; // ~1 sample interval
    } else {
      // Start new segment
      merged.push({
        roadCode: match.roadCode,
        roadName: match.roadName,
        roadType: match.roadType,
        fromKm: match.cumulativeKm,
        toKm: match.cumulativeKm,
        polylineStartIdx: match.polylineIndex,
        polylineEndIdx: match.polylineIndex,
        flags: match.continuityFlags.length > 0 ? [...match.continuityFlags] : undefined,
        continuityGapKm: 0,
      });
    }
  }

  // Filter out short segments (roadCode must be non-null — continuity-flagged
  // null entries were merged into preceding segments, not emitted separately)
  let result = merged.filter(
    (seg) => seg.roadCode != null && seg.toKm - seg.fromKm >= minSegmentKm / (sampleEvery || 1),
  );

  // Merge same-road segments separated by short gaps
  if (mergeGapKm > 0 && result.length > 1) {
    const merged2: RoadSequenceItem[] = [result[0]];
    for (let i = 1; i < result.length; i++) {
      const prev = merged2[merged2.length - 1];
      const curr = result[i];
      const gap = curr.fromKm - prev.toKm;
      if (prev.roadCode === curr.roadCode && gap <= mergeGapKm) {
        prev.toKm = curr.toKm;
        prev.polylineEndIdx = curr.polylineEndIdx;
        if (curr.toKm - curr.fromKm > prev.toKm - prev.fromKm) {
          prev.roadName = curr.roadName;
        }
      } else {
        merged2.push(curr);
      }
    }
    result = merged2;
  }

  // Populate fromJunction/toJunction from road transitions
  // Queries PostGIS road_junction table at each boundary where roadCode changes
  for (let i = 0; i < result.length; i++) {
    const seg = result[i];
    if (i === 0) {
      // First segment — junction at start
      const coord = polyline[seg.polylineStartIdx];
      if (coord) {
        const j = await findNearestJunction(coord.lon, coord.lat, junctionRadiusMeters * 1.5);
        if (j) seg.fromJunction = j.name;
      }
    }
    if (i === result.length - 1) {
      // Last segment — junction at end
      const coord = polyline[seg.polylineEndIdx];
      if (coord) {
        const j = await findNearestJunction(coord.lon, coord.lat, junctionRadiusMeters * 1.5);
        if (j) seg.toJunction = j.name;
      }
    }
    if (i > 0) {
      const prev = result[i - 1];
      if (prev.roadCode !== seg.roadCode) {
        const coord = polyline[seg.polylineStartIdx];
        if (coord) {
          const j = await findNearestJunction(coord.lon, coord.lat, junctionRadiusMeters * 1.5);
          if (j) {
            prev.toJunction = j.name;
            seg.fromJunction = j.name;
          }
        }
      }
    }
  }

  return result;
}

// ─── Graph-First Routing (Phase 5.7A) ─────────────────────────────

export interface FindRouteOptions {
  /** Junction resolution radius in km (default: 20) */
  junctionRadiusKm?: number;
  /** Fallback to legacy buildRoadSequence if graph fails (default: true) */
  fallbackEnabled?: boolean;
  /** Calibration profile name (default: "balanced_default") */
  profile?: CalibrationProfileName;
  /** Cost model overrides (Phase 5.7B) — defaults from DEFAULT_COST_MODEL */
  costModel?: Partial<CostModelOptions>;
}

/**
 * Find the road sequence between origin and destination using the segment
 * graph as the primary routing source.
 *
 * Pipeline:
 *   resolveEndpoints()   → nearest junctions via segment-graph
 *   graph.findPath()     → Dijkstra on subsegment graph
 *   validatePath()       → reject null/partial paths
 *   fallbackResolver()   → legacy buildRoadSequence if graph fails
 *   attachGeometry()     → project junction chain onto polyline
 *   emit RoadSequenceItem[]
 *
 * Returns the same interface as buildRoadSequence for backward compatibility.
 */
export async function findRoute(
  coordinates: Array<{ lat: number; lon: number }>,
  origin: GeoPoint,
  destination: GeoPoint,
  options: FindRouteOptions = {},
): Promise<RoadSequenceItem[]> {
  const { junctionRadiusKm = 20, fallbackEnabled = true, profile, costModel } = options;

  if (coordinates.length < 2) return [];

  // Precompute cumulative km along polyline
  const cumulatives: number[] = [0];
  for (let i = 1; i < coordinates.length; i++) {
    cumulatives.push(
      cumulatives[i - 1] + haversineKm(
        coordinates[i - 1].lat, coordinates[i - 1].lon,
        coordinates[i].lat, coordinates[i].lon,
      ),
    );
  }
  const totalKm = cumulatives[cumulatives.length - 1];

  // ── resolveEndpoints ──
  const startJunction = resolveNearestJunction(origin.lat, origin.lon, junctionRadiusKm, origin.name);
  const endJunction = resolveNearestJunction(destination.lat, destination.lon, junctionRadiusKm, destination.name);

  if (!startJunction || !endJunction) {
    if (fallbackEnabled) {
      console.warn("[ROUTING_FALLBACK]", {
        reason: !startJunction ? "start_junction_unresolved" : "end_junction_unresolved",
        origin: `${origin.lat},${origin.lon}`,
        destination: `${destination.lat},${destination.lon}`,
        stage: "findRoute.resolveEndpoints",
        timestamp: Date.now(),
      });
      return legacyFallback(coordinates, origin, destination);
    }
    return [];
  }

  // ── graph.findPath (cost-aware, Phase 5.7B) ──
  const resolvedCostModel = resolveCostModel(profile, costModel);
  const path = graphFindPath(startJunction.id, endJunction.id,
    startJunction.junctionName, endJunction.junctionName,
    resolvedCostModel);

  // ── validatePath (NEVER return partial paths) ──
  if (!path || path.length === 0) {
    if (fallbackEnabled) {
      console.warn("[ROUTING_FALLBACK]", {
        reason: !path ? "graph_path_null" : "graph_path_empty",
        startJunction: startJunction.id,
        endJunction: endJunction.id,
        stage: "findRoute.validatePath",
        timestamp: Date.now(),
      });
      return legacyFallback(coordinates, origin, destination);
    }
    return [];
  }

  // ── attachJunctionGeometry ──
  const projections = projectPathOntoPolyline(path, coordinates, cumulatives);

  // ── Build RoadSequenceItem[] from projections ──
  const result: RoadSequenceItem[] = [];

  for (let i = 0; i < projections.length; i++) {
    const { fromProjection, toProjection, edge } = projections[i];

    const fromIdx = fromProjection.polylineIdx;
    const toIdx = toProjection.polylineIdx;
    const fromKm = fromProjection.cumulativeKm;
    const toKm = toProjection.cumulativeKm;

    // Skip if no span on polyline (possible for very short segments)
    if (Math.abs(toIdx - fromIdx) < 1 && Math.abs(toKm - fromKm) < 0.1) continue;

    result.push({
      roadCode: edge.roadCode,
      roadName: edge.roadName,
      roadType: getRoadTypeCode(edge.roadCode),
      fromKm: +fromKm.toFixed(3),
      toKm: +toKm.toFixed(3),
      polylineStartIdx: fromIdx,
      polylineEndIdx: toIdx,
      fromJunction: edge.fromJunction,
      toJunction: edge.toJunction,
    });
  }

  // Merge consecutive same-road segments (e.g., NH01 splits at intermediate junctions)
  const merged = mergeSameRoadSegments(result, totalKm);
  return merged;
}

/**
 * Find multiple distinct route sequences between origin and destination
 * using the segment graph's K-shortest paths algorithm (Phase 5.10).
 *
 * Returns up to K routes, each with a label and RoadSequenceItem[].
 * Route 0 is always "Recommended" (findStablePath).
 * Routes 1+ are alternatives found via Yen's edge-deviation.
 *
 * If < K distinct routes exist, returns what's available.
 * If graph routing fails entirely with no fallback, returns [].
 */
export interface MultiRouteSequence {
  label: string;
  route: RoadSequenceItem[];
}

export async function findMultiRouteInSequence(
  coordinates: Array<{ lat: number; lon: number }>,
  origin: GeoPoint,
  destination: GeoPoint,
  options: FindRouteOptions = {},
  K: number = 3,
): Promise<MultiRouteSequence[]> {
  const { junctionRadiusKm = 20, costModel, profile } = options;

  if (coordinates.length < 2) return [];

  const cumulatives: number[] = [0];
  for (let i = 1; i < coordinates.length; i++) {
    cumulatives.push(
      cumulatives[i - 1] + haversineKm(
        coordinates[i - 1].lat, coordinates[i - 1].lon,
        coordinates[i].lat, coordinates[i].lon,
      ),
    );
  }

  const startJunction = resolveNearestJunction(origin.lat, origin.lon, junctionRadiusKm, origin.name);
  const endJunction = resolveNearestJunction(destination.lat, destination.lon, junctionRadiusKm, destination.name);

  if (!startJunction || !endJunction) return [];

  const resolvedCostModel = resolveCostModel(profile, costModel);
  const multiPaths = findMultiRoute(
    startJunction.id, endJunction.id,
    startJunction.junctionName, endJunction.junctionName,
    K, resolvedCostModel,
  );

  const result: MultiRouteSequence[] = [];
  for (const mp of multiPaths) {
    const projections = projectPathOntoPolyline(mp.path, coordinates, cumulatives);
    const seq: RoadSequenceItem[] = [];

    for (let i = 0; i < projections.length; i++) {
      const { fromProjection, toProjection, edge } = projections[i];
      const fromIdx = fromProjection.polylineIdx;
      const toIdx = toProjection.polylineIdx;
      const fromKm = fromProjection.cumulativeKm;
      const toKm = toProjection.cumulativeKm;

      if (Math.abs(toIdx - fromIdx) < 1 && Math.abs(toKm - fromKm) < 0.1) continue;

      seq.push({
        roadCode: edge.roadCode,
        roadName: edge.roadName,
        roadType: getRoadTypeCode(edge.roadCode),
        fromKm: +fromKm.toFixed(3),
        toKm: +toKm.toFixed(3),
        polylineStartIdx: fromIdx,
        polylineEndIdx: toIdx,
        fromJunction: edge.fromJunction,
        toJunction: edge.toJunction,
      });
    }

    const merged = mergeSameRoadSegments(seq, cumulatives[cumulatives.length - 1]);
    result.push({ label: mp.label, route: merged });
  }

  return result;
}

/**
 * Fallback to legacy geometry-based road matching.
 */
async function legacyFallback(
  coordinates: Array<{ lat: number; lon: number }>,
  _origin: GeoPoint,
  _destination: GeoPoint,
): Promise<RoadSequenceItem[]> {
  return buildRoadSequence(coordinates, {
    sampleEvery: Math.max(3, Math.min(10, Math.floor(coordinates.length / 50))),
    radiusMeters: 5000,
    mergeGapKm: 20,
    minSegmentKm: 1,
  });
}

/**
 * Infer road type from roadCode prefix.
 */
function getRoadTypeCode(roadCode: string): string {
  if (roadCode.startsWith("NH")) return "NATIONAL_HIGHWAY";
  if (roadCode.startsWith("FR")) return "FEEDER";
  return "OTHER";
}

/**
 * Merge consecutive segments with the same roadCode.
 * This handles the case where a road has intermediate junctions (subsegments)
 * that should be presented as a single road segment in the display chain.
 */
function mergeSameRoadSegments(
  segments: RoadSequenceItem[],
  _totalKm: number,
): RoadSequenceItem[] {
  if (segments.length <= 1) return segments;

  const merged: RoadSequenceItem[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];
    if (prev.roadCode === curr.roadCode) {
      // Extend previous segment
      prev.toKm = curr.toKm;
      prev.polylineEndIdx = curr.polylineEndIdx;
      prev.toJunction = curr.toJunction;
    } else {
      merged.push(curr);
    }
  }
  return merged;
}
/**
 * Returns a context-aware radius for ST_DWithin.
 * Caps at baseRadius to prevent over-expansion in sparse geometry areas.
 * Uses the last-known road type to inform the radius.
 */
function getAdaptiveRadius(
  _lat: number,
  _lon: number,
  lastRoadType: string | null,
  defaultRadius: number,
): number {
  if (!lastRoadType) return defaultRadius;
  switch (lastRoadType) {
    case "NATIONAL_HIGHWAY":
      return Math.min(defaultRadius, 5000);
    case "FEEDER":
      return Math.min(defaultRadius, 3000);
    default:
      return Math.min(defaultRadius, 2000);
  }
}

// ─── Nearest road lookup ────────────────────────────────────────
interface RoadRow {
  roadCode: string;
  name: string;
  roadType: string;
}

async function findNearestRoad(
  lat: number,
  lon: number,
  radiusMeters: number,
): Promise<RoadRow | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    const rows = await prisma.$queryRawUnsafe<RoadRow[]>(
      `SELECT "roadCode", name, "roadType"::text
       FROM road_segment
       WHERE "isActive" = true
         AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2)::geography, 4326)::geography, $3)
       ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2)::geography, 4326)::geography
       LIMIT 1`,
      lon,
      lat,
      radiusMeters,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Nearest junction lookup ────────────────────────────────────
interface JunctionRow {
  name: string;
  roadCodes: string[];
}

async function findNearestJunction(
  lon: number,
  lat: number,
  radiusMeters: number,
): Promise<JunctionRow | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    const rows = await prisma.$queryRawUnsafe<JunctionRow[]>(
      `SELECT name, "roadCodes"
       FROM road_junction
       WHERE "isActive" = true
         AND ST_DWithin(
           geom,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )
       ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
       LIMIT 1`,
      lon,
      lat,
      radiusMeters,
    );
    if (rows.length > 0) {
      return { name: rows[0].name, roadCodes: rows[0].roadCodes };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── KNN tie-breaking: check if a specific road passes through this point ──
async function isRoadAtPoint(
  roadCode: string,
  lon: number,
  lat: number,
): Promise<boolean> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ found: boolean }>>(
      `SELECT ST_DWithin(
         geom,
         ST_SetSRID(ST_MakePoint($1, $2)::geography, 4326)::geography,
         1  -- 1 meter tolerance
       ) as found
       FROM road_segment
       WHERE "roadCode" = $3 AND "isActive" = true
       LIMIT 1`,
      lon,
      lat,
      roadCode,
    );
    return rows.length > 0 && rows[0].found;
  } catch {
    return false;
  }
}

// ─── Haversine for cumulative distance ──────────────────────────
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
