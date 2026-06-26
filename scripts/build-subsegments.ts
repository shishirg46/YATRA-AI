/**
 * build-subsegments.ts — extracts junction-to-junction sub-segments
 * from the densified road registry.
 *
 * Reads:  dor-road-network.densified.json + road-junctions.json
 * Writes: dor-road-network.subsegments.json
 *
 * This is the bridge between "geometry layer" and "graph layer":
 * each sub-segment is an edge between two graph nodes (junctions).
 *
 * Pipeline:
 *   npx tsx scripts/build-subsegments.ts
 *
 * Guarantees:
 *   - Junctions are projected onto the road's LineString (not raw lat/lon)
 *   - Ordered by cumulative km along road (directed chain)
 *   - segmentId is deterministic (stable across rebuilds)
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

const REGISTRY_PATH = join(DATA_DIR, "dor-road-network.densified.json");
const JUNCTIONS_PATH = join(DATA_DIR, "road-junctions.json");
const OUTPUT_PATH = join(DATA_DIR, "dor-road-network.subsegments.json");

// ─── Types ───────────────────────────────────────────────────────
interface Coord {
  lat: number;
  lon: number;
}

interface RegistryRoad {
  roadCode: string;
  name: string;
  roadType: string;
  fromPlace: string;
  toPlace: string;
  waypoints: Coord[];
  lengthKm: number;
}

interface Junction {
  name: string;
  roadCodes: string[];
  type: string;
  latitude: number;
  longitude: number;
}

interface JunctionOnRoad {
  name: string;
  roadCodes: string[];
  posKm: number;
  lat: number;
  lon: number;
}

export interface SubSegment {
  segmentId: string;
  roadCode: string;
  roadName: string;
  roadType: string;
  fromJunction: string;
  toJunction: string;
  fromKm: number;
  toKm: number;
  lengthKm: number;
  /** Projected coordinates of the fromJunction on this road's LineString */
  fromLat: number;
  fromLon: number;
  /** Projected coordinates of the toJunction on this road's LineString */
  toLat: number;
  toLon: number;
}

// ─── Haversine helpers ───────────────────────────────────────────
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
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

// ─── Point-to-segment projection ─────────────────────────────────
interface ProjectionResult {
  /** Index of the segment start vertex */
  segIdx: number;
  /** Fraction along the segment [0, 1] */
  fraction: number;
  /** Cumulative km from road start to projected point */
  posKm: number;
  /** Distance from junction to projected point (km) */
  snapDistKm: number;
  /** Projected latitude on the road's LineString */
  projLat: number;
  /** Projected longitude on the road's LineString */
  projLon: number;
}

function projectPointOnRoad(
  lat: number,
  lon: number,
  waypoints: Coord[],
  cumulatives: number[],
): ProjectionResult | null {
  if (waypoints.length < 2) return null;

  let bestIdx = -1;
  let bestFrac = 0;
  let bestDist = Infinity;
  let bestPos = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const segLen = cumulatives[i + 1] - cumulatives[i];
    if (segLen < 1e-8) continue;

    // Vector AB
    const dx = b.lon - a.lon;
    const dy = b.lat - a.lat;
    const segDeg = Math.sqrt(dx * dx + dy * dy);

    // Project P onto AB line
    let frac = 0;
    if (segDeg > 1e-8) {
      frac = ((lon - a.lon) * dx + (lat - a.lat) * dy) / (segDeg * segDeg);
    }
    frac = Math.max(0, Math.min(1, frac));

    // Projected point
    const projLat = a.lat + frac * dy;
    const projLon = a.lon + frac * dx;
    const dist = haversineKm(lat, lon, projLat, projLon);

    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      bestFrac = frac;
      bestPos = cumulatives[i] + frac * segLen;
    }
  }

  if (bestIdx === -1 || bestDist > 10) return null;

  return {
    segIdx: bestIdx,
    fraction: bestFrac,
    posKm: bestPos,
    snapDistKm: bestDist,
    projLat: waypoints[bestIdx].lat + bestFrac * (waypoints[bestIdx + 1].lat - waypoints[bestIdx].lat),
    projLon: waypoints[bestIdx].lon + bestFrac * (waypoints[bestIdx + 1].lon - waypoints[bestIdx].lon),
  };
}

// ─── Normalize junction name for hashing ─────────────────────────
function normalizeJunctionName(name: string): string {
  return name
    .trim()
    .replace(/\s+(Junction|Central|Hub|Chowk)$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// ─── Deterministic segmentId ─────────────────────────────────────
function makeSegmentId(
  roadCode: string,
  fromJunction: string,
  toJunction: string,
  fromKm: number,
): string {
  const from = normalizeJunctionName(fromJunction);
  const to = normalizeJunctionName(toJunction);
  const pos = Math.floor(fromKm);
  const seed = `${roadCode}|${from}|${to}|${pos}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

// ─── Deduplicate junctions near same road position ───────────────
function dedupJunctionsOnRoad(
  junctions: JunctionOnRoad[],
): JunctionOnRoad[] {
  if (junctions.length < 2) return junctions;
  const sorted = [...junctions].sort((a, b) => a.posKm - b.posKm);
  const result: JunctionOnRoad[] = [];
  for (const j of sorted) {
    const last = result[result.length - 1];
    if (last && Math.abs(j.posKm - last.posKm) < 1) {
      // Keep the one with more roadCodes (more significant junction)
      if (j.roadCodes.length > last.roadCodes.length) {
        result[result.length - 1] = j;
      }
    } else {
      result.push(j);
    }
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────
function main() {
  console.log("=== Build Subsegments ===\n");

  const registry: RegistryRoad[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  const junctions: Junction[] = JSON.parse(readFileSync(JUNCTIONS_PATH, "utf-8"));
  console.log(`  Registry: ${registry.length} roads`);
  console.log(`  Junctions: ${junctions.length}\n`);

  const allSubSegments: SubSegment[] = [];
  let totalSegments = 0;
  let roadsWithJunctions = 0;

  for (const road of registry) {
    const waypoints = road.waypoints;
    if (waypoints.length < 2) continue;

    // Precompute cumulative km along road
    const cumulatives: number[] = [0];
    for (let i = 1; i < waypoints.length; i++) {
      const d = haversineKm(
        waypoints[i - 1].lat, waypoints[i - 1].lon,
        waypoints[i].lat, waypoints[i].lon,
      );
      cumulatives.push(cumulatives[i - 1] + d);
    }
    const roadLen = cumulatives[cumulatives.length - 1];

    // Project each junction onto this road
    const onRoad: JunctionOnRoad[] = [];
    for (const j of junctions) {
      // Quick filter: skip if no roadCode match
      if (!j.roadCodes.includes(road.roadCode)) continue;

      const proj = projectPointOnRoad(j.latitude, j.longitude, waypoints, cumulatives);
      if (!proj) continue;

      // Skip junctions within 0.5 km of road endpoints (belongs to connecting road)
      if (proj.posKm < 0.5 || proj.posKm > roadLen - 0.5) continue;

      onRoad.push({
        name: j.name,
        roadCodes: j.roadCodes,
        posKm: proj.posKm,
        lat: proj.projLat,
        lon: proj.projLon,
      });
    }

    // Deduplicate nearby junctions
    const deduped = dedupJunctionsOnRoad(onRoad);

    // Build node list with coordinates: implicit fromPlace → sorted junctions → implicit toPlace
    const nodes: Array<{ name: string; posKm: number; lat: number; lon: number }> = [
      { name: road.fromPlace, posKm: 0, lat: waypoints[0].lat, lon: waypoints[0].lon },
      ...deduped.map((j) => ({ name: j.name, posKm: j.posKm, lat: j.lat, lon: j.lon })),
      { name: road.toPlace, posKm: roadLen, lat: waypoints[waypoints.length - 1].lat, lon: waypoints[waypoints.length - 1].lon },
    ];

    // Generate sub-segments
    let roadSegmentCount = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i];
      const to = nodes[i + 1];
      const segLen = to.posKm - from.posKm;
      if (segLen < 0.1) continue;

      allSubSegments.push({
        segmentId: makeSegmentId(road.roadCode, from.name, to.name, from.posKm),
        roadCode: road.roadCode,
        roadName: road.name,
        roadType: road.roadType,
        fromJunction: from.name,
        toJunction: to.name,
        fromKm: +from.posKm.toFixed(3),
        toKm: +to.posKm.toFixed(3),
        lengthKm: +segLen.toFixed(3),
        fromLat: +from.lat.toFixed(6),
        fromLon: +from.lon.toFixed(6),
        toLat: +to.lat.toFixed(6),
        toLon: +to.lon.toFixed(6),
      });
      roadSegmentCount++;
    }

    totalSegments += roadSegmentCount;
    if (deduped.length > 0) roadsWithJunctions++;

    console.log(
      `  ${road.roadCode} ${road.name}: ${roadLen.toFixed(1)} km, ${deduped.length} junctions → ${roadSegmentCount} subsegments`,
    );
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(allSubSegments, null, 2));
  console.log(`\n  Total: ${allSubSegments.length} subsegments (${roadsWithJunctions} roads have junctions)`);
  console.log(`  Written: ${OUTPUT_PATH}`);

  // Validation
  const ids = new Set(allSubSegments.map((s) => s.segmentId));
  if (ids.size !== allSubSegments.length) {
    console.warn(`  ⚠ Duplicate segmentId detected! ${allSubSegments.length - ids.size} duplicates`);
  }
}

main();
