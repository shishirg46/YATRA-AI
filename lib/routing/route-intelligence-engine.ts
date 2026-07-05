// Route Intelligence Engine — deterministic hazard enrichment + scoring
// Takes ordered route_segments from the matcher + OSRM route geometry,
// produces structured reports. No AI — pure spatial aggregation and scoring.

import { Pool } from "pg";
import type { RouteMatchSegment } from "./route-matcher";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HazardOnRoute {
  hazardId: string;
  hazardType: string;
  severity: string;
  confidence: number | null;
  source: string | null;
  segmentId: string;
  segmentOrderIndex: number;
  roadName: string | null;
  highway: string | null;
  km: number;
  segmentOffsetM: number;
  overlapLengthM: number;
  affectedPercent: number;
}

export interface HazardCluster {
  hazardType: string;
  severity: string;
  startKm: number;
  endKm: number;
  hazardCount: number;
  segmentIds: string[];
  maxConfidence: number;
  avgConfidence: number;
  source: string | null;
}

export interface RouteIntelligenceReport {
  routeTotalKm: number;
  routeDurationMin: number;
  totalHazards: number;
  totalHazardTypes: Record<string, number>;
  highestSeverity: string;
  mostCommonType: string;
  affectedDistanceM: number;
  affectedDistanceKm: number;
  affectedPercent: number;
  estimatedDelayMin: number;
  recommendDetour: boolean;
  severityScore: number;
  clusters: HazardCluster[];
  hazards: HazardOnRoute[];
  segments: RouteIntelligenceSegment[];
}

export interface RouteIntelligenceSegment {
  segmentId: string;
  orderIndex: number;
  roadName: string | null;
  highway: string | null;
  surface: string | null;
  lengthM: number;
  startKm: number;
  endKm: number;
  hazardCount: number;
  affectedPercent: number;
  severityScore: number;
  hazards: HazardOnRoute[];
}

export interface EnrichmentInput {
  segments: RouteMatchSegment[];
  osrmRouteGeojson: { coordinates: [number, number][] };
  totalDistanceM: number;
}

// ─── Severity weights ────────────────────────────────────────────────────────

const SEVERITY_WEIGHTS: Record<string, number> = {
  extreme: 1.0,
  high: 0.75,
  moderate: 0.5,
  low: 0.25,
  unknown: 0.1,
};

const DELAY_PER_HAZARD_MAP: Record<string, number> = {
  landslide: 15,
  flood: 10,
  avalanche: 20,
  earthquake: 30,
  wildlife: 2,
  other: 5,
};

function severityWeight(s: string): number {
  return SEVERITY_WEIGHTS[s.toLowerCase()] ?? 0.1;
}

// ─── Core enrichment ─────────────────────────────────────────────────────────

export async function enrichRouteWithHazards(
  pool: Pool,
  input: EnrichmentInput,
  graphVersion: string = "v3-kathmandu",
): Promise<RouteIntelligenceReport> {
  const { segments, osrmRouteGeojson, totalDistanceM } = input;

  if (segments.length === 0) {
    return emptyReport(segments, totalDistanceM);
  }

  const totalKm = totalDistanceM / 1000;
  const segIds = segments.map((s) => s.segmentId);

  // Build route WKT for PostGIS queries
  const pts = osrmRouteGeojson.coordinates.map(([lon, lat]) => `${lon} ${lat}`).join(", ");
  const routeWkt = `SRID=4326;LINESTRING(${pts})`;

  // 1. Batch query segment_hazard with route position projection
  const hazardRows = await batchQueryHazards(pool, segIds, routeWkt, totalDistanceM);

  // 2. Build hazard list with route position
  const segMap = new Map(segments.map((s) => [s.segmentId, s]));
  const hazards: HazardOnRoute[] = [];

  for (const row of hazardRows) {
    const seg = segMap.get(row.segment_id);
    if (!seg) continue;

    const km = row.route_km !== null ? Number(row.route_km) : seg.cumulativeEndM / 1000;

    hazards.push({
      hazardId: row.hazard_id,
      hazardType: row.hazard_type,
      severity: row.severity,
      confidence: row.confidence ? Number(row.confidence) : null,
      source: row.source,
      segmentId: row.segment_id,
      segmentOrderIndex: seg.orderIndex,
      roadName: seg.roadName,
      highway: seg.highway,
      km: Math.round(km * 1000) / 1000,
      segmentOffsetM: Number(row.start_offset_m) ?? 0,
      overlapLengthM: Number(row.overlap_length_m) ?? 0,
      affectedPercent: Number(row.affected_percent) ?? 0,
    });
  }

  // 3. Build per-segment enrichment
  const segmentReports: RouteIntelligenceSegment[] = segments.map((seg) => {
    const segHazards = hazards.filter((h) => h.segmentId === seg.segmentId);
    const totalAffected = segHazards.length > 0
      ? Math.max(segHazards.length * 50, segHazards.reduce((s, h) => s + h.overlapLengthM, 0))
      : 0;
    const maxSeverity = segHazards.reduce(
      (m, h) => Math.max(m, severityWeight(h.severity)),
      0,
    );

    return {
      segmentId: seg.segmentId,
      orderIndex: seg.orderIndex,
      roadName: seg.roadName,
      highway: seg.highway,
      surface: seg.surface,
      lengthM: seg.distanceTraveledM,
      startKm: seg.cumulativeStartM / 1000,
      endKm: seg.cumulativeEndM / 1000,
      hazardCount: segHazards.length,
      affectedPercent: seg.distanceTraveledM > 0
        ? Math.round((totalAffected / seg.distanceTraveledM) * 1000) / 10
        : 0,
      severityScore: Math.round(maxSeverity * 100),
      hazards: segHazards,
    };
  });

  // 4. Cluster nearby hazards (same type, adjacent or overlapping)
  const clusters = buildClusters(hazards);

  // 5. Compute aggregate metrics
  const totalHazards = hazards.length;
  const totalAffectedM = hazards.length > 0
    ? hazards.reduce((s, h) => s + Math.max(h.overlapLengthM, 50), 0)
    : 0;

  const byType: Record<string, number> = {};
  for (const h of hazards) {
    byType[h.hazardType] = (byType[h.hazardType] ?? 0) + 1;
  }

  const highestSeverity = hazards.reduce(
    (m, h) => {
      const w = severityWeight(h.severity);
      return w > severityWeight(m) ? h.severity : m;
    },
    "unknown",
  );

  const mostCommonType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";

  // 6. Severity score (0–100)
  const severityScore = hazards.length > 0
    ? Math.round(
        hazards.reduce((s, h) => s + severityWeight(h.severity) * (h.confidence ?? 0.5), 0) /
          hazards.length *
          100,
      )
    : 0;

  // 7. Delay estimate
  const estimatedDelayMin = estimateDelay(hazards);
  const recommendDetour = severityScore >= 50 || estimatedDelayMin >= 30;

  return {
    routeTotalKm: Math.round(totalKm * 100) / 100,
    routeDurationMin: Math.round(
      segments.length > 0 ? input.totalDistanceM / (1000 / 60) : 0,
    ),
    totalHazards,
    totalHazardTypes: byType,
    highestSeverity,
    mostCommonType,
    affectedDistanceM: Math.round(totalAffectedM * 10) / 10,
    affectedDistanceKm: Math.round((totalAffectedM / 1000) * 1000) / 1000,
    affectedPercent: totalKm > 0
      ? Math.round((totalAffectedM / 1000 / totalKm) * 1000) / 10
      : 0,
    estimatedDelayMin,
    recommendDetour,
    severityScore,
    clusters,
    hazards,
    segments: segmentReports,
  };
}

// ─── Batch hazard query ─────────────────────────────────────────────────────

interface HazardRow {
  segment_id: string;
  hazard_id: string;
  start_offset_m: number;
  end_offset_m: number;
  overlap_length_m: number;
  affected_percent: number;
  hazard_type: string;
  severity: string;
  confidence: number | null;
  source: string | null;
  route_km: number | null;
}

async function batchQueryHazards(
  pool: Pool,
  segmentIds: string[],
  routeWkt: string,
  routeDistanceM: number,
): Promise<HazardRow[]> {
  if (segmentIds.length === 0) return [];

  const BATCH = 500;
  const allRows: HazardRow[] = [];

  for (let i = 0; i < segmentIds.length; i += BATCH) {
    const batch = segmentIds.slice(i, i + BATCH);
    const ids = batch.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");

    const result = await pool.query(`
      SELECT
        sh.segment_id,
        sh.hazard_id,
        sh.start_offset_m,
        sh.end_offset_m,
        sh.overlap_length_m,
        sh.affected_percent,
        h.hazard_type,
        h.severity,
        h.confidence,
        h.source,
        CASE
          WHEN h.geometry IS NOT NULL AND GeometryType(h.geometry) = 'POINT'
          THEN ST_LineLocatePoint(
            '${routeWkt}'::geometry,
            h.geometry::geometry
          ) * ${routeDistanceM} / 1000
          ELSE sh.start_offset_m / 1000 + NULL
        END AS route_km
      FROM segment_hazard sh
      JOIN hazard h ON h.id = sh.hazard_id
      WHERE sh.segment_id IN (${ids})
    `);

    allRows.push(...(result.rows as HazardRow[]));
  }

  return allRows;
}

// ─── Clustering ─────────────────────────────────────────────────────────────

function buildClusters(hazards: HazardOnRoute[]): HazardCluster[] {
  if (hazards.length === 0) return [];

  const sorted = [...hazards].sort((a, b) => a.km - b.km);
  const clusters: HazardCluster[] = [];
  let current: HazardCluster | null = null;

  for (const h of sorted) {
    if (
      current &&
      current.hazardType === h.hazardType &&
      h.km - current.endKm <= 0.5
    ) {
      current.endKm = Math.max(current.endKm, h.km);
      current.hazardCount++;
      current.maxConfidence = Math.max(current.maxConfidence, h.confidence ?? 0);
      current.avgConfidence =
        (current.avgConfidence * (current.hazardCount - 1) + (h.confidence ?? 0)) /
        current.hazardCount;
      if (!current.segmentIds.includes(h.segmentId)) {
        current.segmentIds.push(h.segmentId);
      }
    } else {
      current = {
        hazardType: h.hazardType,
        severity: h.severity,
        startKm: h.km,
        endKm: h.km,
        hazardCount: 1,
        segmentIds: [h.segmentId],
        maxConfidence: h.confidence ?? 0,
        avgConfidence: h.confidence ?? 0,
        source: h.source,
      };
      clusters.push(current);
    }
  }

  return clusters;
}

// ─── Delay estimation ───────────────────────────────────────────────────────

function estimateDelay(hazards: HazardOnRoute[]): number {
  let totalDelay = 0;
  const seen = new Set<string>();

  for (const h of hazards) {
    const key = `${h.hazardType}-${h.segmentId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const baseDelay = DELAY_PER_HAZARD_MAP[h.hazardType] ?? 5;
    const confidenceFactor = (h.confidence ?? 0.5);
    const severityFactor = severityWeight(h.severity);

    totalDelay += baseDelay * confidenceFactor * severityFactor;
  }

  return Math.round(totalDelay * 10) / 10;
}

// ─── Empty report ───────────────────────────────────────────────────────────

function emptyReport(segments: RouteMatchSegment[], totalDistanceM: number): RouteIntelligenceReport {
  return {
    routeTotalKm: totalDistanceM / 1000,
    routeDurationMin: 0,
    totalHazards: 0,
    totalHazardTypes: {},
    highestSeverity: "unknown",
    mostCommonType: "none",
    affectedDistanceM: 0,
    affectedDistanceKm: 0,
    affectedPercent: 0,
    estimatedDelayMin: 0,
    recommendDetour: false,
    severityScore: 0,
    clusters: [],
    hazards: [],
    segments: segments.map((s) => ({
      segmentId: s.segmentId,
      orderIndex: s.orderIndex,
      roadName: s.roadName,
      highway: s.highway,
      surface: s.surface,
      lengthM: s.distanceTraveledM,
      startKm: s.cumulativeStartM / 1000,
      endKm: s.cumulativeEndM / 1000,
      hazardCount: 0,
      affectedPercent: 0,
      severityScore: 0,
      hazards: [],
    })),
  };
}

// ─── Standalone demo ────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const { Pool } = require("pg");
    const pool = new Pool({
      host: "localhost",
      port: 5432,
      database: "yatraai",
      user: "yatra",
      password: "yatra123",
      max: 2,
    });

    const { matchRouteToSegments } = await import("./route-matcher");

    const result = await matchRouteToSegments(
      pool,
      [85.2865, 27.6786],
      [85.2920, 27.6797],
    );

    if (!result || result.segments.length === 0) {
      console.log("No route found");
      await pool.end();
      return;
    }

    console.log(`Route: ${result.totalDistanceM.toFixed(0)}m, ${result.segments.length} segments`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);

    // Fetch full OSRM route geometry for hazard projection
    const osrmRes = await fetch(
      `http://localhost:5000/route/v1/driving/85.2865,27.6786;85.2920,27.6797?overview=full&geometries=geojson`
    );
    const osrmData = await osrmRes.json();

    const report = await enrichRouteWithHazards(pool, {
      segments: result.segments,
      osrmRouteGeojson: osrmData.routes[0].geometry,
      totalDistanceM: result.totalDistanceM,
    });

    console.log(`\n=== Route Intelligence Report ===`);
    console.log(`Total hazards: ${report.totalHazards}`);
    console.log(`Highest severity: ${report.highestSeverity}`);
    console.log(`Most common type: ${report.mostCommonType}`);
    console.log(`Types: ${JSON.stringify(report.totalHazardTypes)}`);
    console.log(`Affected: ${report.affectedDistanceM.toFixed(0)}m (${report.affectedPercent.toFixed(1)}%)`);
    console.log(`Estimated delay: ${report.estimatedDelayMin} min`);
    console.log(`Severity score: ${report.severityScore}/100`);
    console.log(`Recommend detour: ${report.recommendDetour}`);
    console.log(`Clusters: ${report.clusters.length}`);

    if (report.hazards.length > 0) {
      console.log("\nHazard details:");
      for (const h of report.hazards) {
        console.log(
          `  km ${h.km.toFixed(3)} ` +
          `| ${h.hazardType.padEnd(10)} ${h.severity.padEnd(8)} ` +
          `| ${h.roadName || "(unnamed)"} ` +
          `| conf=${h.confidence ?? "N/A"}`
        );
      }
    }

    if (report.clusters.length > 0) {
      console.log("\nHazard clusters:");
      for (const c of report.clusters) {
        console.log(
          `  km ${c.startKm.toFixed(3)}–${c.endKm.toFixed(3)} ` +
          `| ${c.hazardType.padEnd(10)} ${c.severity.padEnd(8)} ` +
          `| ${c.hazardCount} events ` +
          `| conf=${c.avgConfidence.toFixed(2)}`
        );
      }
    }

    await pool.end();
  })();
}
