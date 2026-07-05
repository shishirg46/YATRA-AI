// OSRM Route → RouteSegment matching engine
// Strategy: buffer the full OSRM route geometry, find intersecting segments,
// order by route progression. Single SQL query for the whole route.

import { Pool } from "pg";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RouteMatchSegment {
  segmentId: string;
  orderIndex: number;
  osmWayId: string;
  roadName: string | null;
  highway: string | null;
  surface: string | null;
  distanceTraveledM: number;
  startOffsetM: number;
  endOffsetM: number;
  cumulativeStartM: number;
  cumulativeEndM: number;
  segmentTotalLengthM: number;
  matchPortion: number;
  stepIndex: number;
  stepName: string;
}

export interface RouteMatchResult {
  origin: [number, number];
  destination: [number, number];
  totalDistanceM: number;
  totalDurationS: number;
  matchedDistanceM: number;
  unmatchedDistanceM: number;
  confidence: number;
  segments: RouteMatchSegment[];
  segmentsByWay: Record<string, RouteMatchSegment[]>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function coordsToWkt(coords: [number, number][]): string {
  const pts = coords.map(([lon, lat]) => `${lon} ${lat}`).join(", ");
  return `SRID=4326;LINESTRING(${pts})`;
}

// ─── OSRM types ─────────────────────────────────────────────────────────────

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  mode: string;
  geometry?: { coordinates: [number, number][] };
}

// ─── Core matcher ───────────────────────────────────────────────────────────

export async function matchRouteToSegments(
  pool: Pool,
  origin: [number, number],
  destination: [number, number],
  graphVersion: string = "v3-kathmandu",
  osrmUrl: string = "http://localhost:5000",
): Promise<RouteMatchResult | null> {
  // ── 1. Fetch OSRM route ──────────────────────────────────────────────
  const coordStr = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const url = `${osrmUrl}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;

  let osrmResponse: Response;
  try {
    osrmResponse = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
  if (!osrmResponse.ok) return null;

  const osrmData = await osrmResponse.json() as {
    code?: string;
    routes?: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
      legs: Array<{ steps: OsrmStep[] }>;
    }>;
  };
  if (osrmData.code !== "Ok" || !osrmData.routes?.length) return null;

  const route = osrmData.routes[0];
  const fullGeom = coordsToWkt(route.geometry.coordinates);

  // Build step index for reference: which step covers which route positions
  interface StepCoverage {
    index: number;
    name: string;
    startCoordIdx: number;
    endCoordIdx: number;
    distance: number;
  }

  const stepCoverage: StepCoverage[] = [];
  let coordIdx = 0;
  for (let si = 0; si < route.legs.length; si++) {
    for (const step of route.legs[si].steps) {
      if (step.distance <= 0 || !step.geometry?.coordinates?.length) continue;
      const coords = step.geometry.coordinates;
      stepCoverage.push({
        index: si,
        name: step.name,
        startCoordIdx: coordIdx,
        endCoordIdx: coordIdx + coords.length - 1,
        distance: step.distance,
      });
      coordIdx += coords.length - 1;
    }
  }

  // ── 2. Find all segments intersected by the route ─────────────────────
  // Buffer the route by 5m (~0.00005°), find intersecting segments,
  // ordered by route progression (ST_LineLocatePoint of segment midpoint).

  const matchSql = `
    WITH route_geom AS (
      SELECT '${fullGeom}'::geometry AS geom
    ),
    -- Find all route_segments that intersect the route buffer
    candidates AS (
      SELECT DISTINCT
        rs.id AS segment_id,
        rs.osm_way_id,
        rs.name AS road_name,
        rs.highway,
        rs.surface,
        rs.length_m,
        rs.vertex_count,
        rs.geometry AS seg_geom,
        -- How far along the route is the segment? Use the midpoint.
        ST_LineLocatePoint(
          rg.geom,
          ST_LineInterpolatePoint(rs.geometry, 0.5)
        ) AS route_order
      FROM route_geom rg
      JOIN route_segment rs
        ON ST_DWithin(rs.geometry, rg.geom, 0.00005)
        AND rs.graph_version = '${graphVersion.replace(/'/g, "''")}'
    )
    SELECT * FROM candidates ORDER BY route_order
  `;

  const result = await pool.query(matchSql);
  const rows = result.rows as Array<{
    segment_id: string;
    osm_way_id: string;
    road_name: string | null;
    highway: string | null;
    surface: string | null;
    length_m: number;
    vertex_count: number;
    route_order: number;
  }>;

  if (rows.length === 0) {
    return {
      origin,
      destination,
      totalDistanceM: route.distance,
      totalDurationS: route.duration,
      matchedDistanceM: 0,
      unmatchedDistanceM: route.distance,
      confidence: 0,
      segments: [],
      segmentsByWay: {},
    };
  }

  // ── 3. Deduplicate consecutive same-segments ──────────────────────────
  interface RawSeg {
    segment_id: string;
    osm_way_id: string;
    road_name: string | null;
    highway: string | null;
    surface: string | null;
    length_m: number;
    vertex_count: number;
  }

  const deduped: RawSeg[] = [];
  for (const row of rows) {
    const last = deduped[deduped.length - 1];
    if (!last || last.segment_id !== row.segment_id) {
      deduped.push({
        segment_id: row.segment_id,
        osm_way_id: row.osm_way_id,
        road_name: row.road_name,
        highway: row.highway,
        surface: row.surface,
        length_m: Number(row.length_m),
        vertex_count: Number(row.vertex_count),
      });
    }
  }

  // ── 4. Assign step info and compute distances ─────────────────────────
  // For each deduped segment, find which step it belongs to by matching
  // the step's coordinate range to the segment's position.

  const segments: RouteMatchSegment[] = [];
  let cumulativeM = 0;

  for (let i = 0; i < deduped.length; i++) {
    const seg = deduped[i];

    // Estimate distance traveled: use the segment's route coverage.
    // In the buffer intersection approach, we know the segment is ON the route.
    // Use the segment length as the best estimate (snap to road network).
    const traveledM = Math.min(seg.length_m, route.distance - cumulativeM);

    // Find covering step
    let stepIdx = -1;
    let stepName = "";
    // Simple heuristic: assign steps in order, distributing distance
    const stepFrac = i / Math.max(1, deduped.length);
    const stepPos = Math.floor(stepFrac * stepCoverage.length);
    if (stepCoverage[stepPos]) {
      stepIdx = stepCoverage[stepPos].index;
      stepName = stepCoverage[stepPos].name;
    }

    segments.push({
      segmentId: seg.segment_id,
      orderIndex: i,
      osmWayId: seg.osm_way_id,
      roadName: seg.road_name,
      highway: seg.highway,
      surface: seg.surface,
      distanceTraveledM: Math.round(traveledM * 10) / 10,
      startOffsetM: 0,
      endOffsetM: Math.round(traveledM * 10) / 10,
      cumulativeStartM: Math.round(cumulativeM * 10) / 10,
      cumulativeEndM: Math.round((cumulativeM + traveledM) * 10) / 10,
      segmentTotalLengthM: Math.round(seg.length_m * 10) / 10,
      matchPortion: seg.length_m > 0
        ? Math.round((traveledM / seg.length_m) * 1000) / 1000
        : 0,
      stepIndex: stepIdx,
      stepName,
    });

    cumulativeM += traveledM;
    if (cumulativeM >= route.distance) break;
  }

  // ── 5. Build result ──────────────────────────────────────────────────
  const matchedDistanceM = segments.reduce((s, seg) => s + seg.distanceTraveledM, 0);
  const totalRouteDist = route.distance;
  const confidence = totalRouteDist > 0
    ? Math.min(matchedDistanceM / totalRouteDist, 1)
    : 0;

  const segmentsByWay: Record<string, RouteMatchSegment[]> = {};
  for (const seg of segments) {
    if (!segmentsByWay[seg.osmWayId]) segmentsByWay[seg.osmWayId] = [];
    segmentsByWay[seg.osmWayId].push(seg);
  }

  return {
    origin,
    destination,
    totalDistanceM: Math.round(totalRouteDist * 10) / 10,
    totalDurationS: Math.round(route.duration),
    matchedDistanceM: Math.round(matchedDistanceM * 10) / 10,
    unmatchedDistanceM: Math.round(Math.max(0, totalRouteDist - matchedDistanceM) * 10) / 10,
    confidence: Math.round(confidence * 1000) / 1000,
    segments,
    segmentsByWay,
  };
}

// ─── High-level API ─────────────────────────────────────────────────────────

export async function createPool(): Promise<Pool> {
  const { Pool: PgPool } = await import("pg");
  return new PgPool({
    host: "localhost",
    port: 5432,
    database: "yatraai",
    user: "yatra",
    password: "yatra123",
    max: 2,
  });
}
