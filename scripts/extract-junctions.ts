/**
 * extract-junctions.ts — builds road-junctions.json from dor-road-network.json.
 *
 * Pipeline:
 *   1. Load canonical road registry (26 roads, ~254 waypoints)
 *   2. Cluster waypoints across different roads within 1 km
 *   3. Merge with 7 manual seed junctions (Naubise, Mugling, etc.)
 *   4. Deduplicate clusters within 500 m
 *   5. Assign type by road count: ≥4=INTERCHANGE, 3=JUNCTION, 2=HIGHWAY_SPLIT
 *   6. Write scripts/data/road-junctions.json
 *
 * Deterministic + idempotent.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { RegistryRoad } from "@/scripts/build-road-registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

const REGISTRY_PATH = join(DATA_DIR, "dor-road-network.json");
const OUTPUT_PATH = join(DATA_DIR, "road-junctions.json");

// ─── Constants ──────────────────────────────────────────────────
const CLUSTER_RADIUS_KM = 1; // merge waypoints within 1 km into same junction
const DEDUP_RADIUS_KM = 0.5; // merge nearby junction centroids

// ─── Types ──────────────────────────────────────────────────────
type JunctionType = "JUNCTION" | "INTERCHANGE" | "HIGHWAY_SPLIT";

interface RawJunction {
  name: string;
  roadCodes: string[];
  type: JunctionType;
  latitude: number;
  longitude: number;
}

// ─── Manual seed junctions (graph backbone anchors) ────────────
const MANUAL_SEEDS: RawJunction[] = [
  { name: "Naubise", roadCodes: ["NH02", "NH17"], type: "JUNCTION", latitude: 27.617, longitude: 85.133 },
  { name: "Mugling", roadCodes: ["NH01", "NH17", "NH15"], type: "INTERCHANGE", latitude: 27.817, longitude: 84.770 },
  { name: "Narayanghat", roadCodes: ["NH01", "NH05"], type: "JUNCTION", latitude: 27.700, longitude: 84.433 },
  { name: "Butwal", roadCodes: ["NH01", "NH05", "NH10", "FR01", "FR10"], type: "INTERCHANGE", latitude: 27.700, longitude: 83.450 },
  { name: "Hetauda", roadCodes: ["NH01", "NH02", "NH14"], type: "JUNCTION", latitude: 27.428, longitude: 85.032 },
  { name: "Dharan", roadCodes: ["FR02", "NH09"], type: "JUNCTION", latitude: 26.814, longitude: 87.279 },
  { name: "Thankot-Kalanki", roadCodes: ["NH02", "NH14", "NH17"], type: "INTERCHANGE", latitude: 27.700, longitude: 85.300 },
];

// ─── Helpers ────────────────────────────────────────────────────
function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aVal =
    sinDLat * sinDLat +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

function centroid(points: Array<{ latitude: number; longitude: number }>): { latitude: number; longitude: number } {
  const lat = points.reduce((s, p) => s + p.latitude, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.longitude, 0) / points.length;
  return { latitude: lat, longitude: lon };
}

function junctionType(roadCount: number): JunctionType {
  if (roadCount >= 4) return "INTERCHANGE";
  if (roadCount >= 3) return "JUNCTION";
  return "HIGHWAY_SPLIT";
}

// ─── Main ───────────────────────────────────────────────────────
function main() {
  console.log("=== Extracting Road Junctions ===\n");

  const registry: RegistryRoad[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

  // ── Step 1: Build waypoint→road map ──
  // Index every waypoint by its road code for fast cross-reference
  interface IndexedWaypoint {
    roadCode: string;
    latitude: number;
    longitude: number;
    name: string;
  }

  const allWaypoints: IndexedWaypoint[] = [];
  for (const road of registry) {
    for (const wp of road.waypoints) {
      allWaypoints.push({
        roadCode: road.roadCode,
        latitude: wp.lat,
        longitude: wp.lon,
        name: road.name,
      });
    }
  }

  // ── Step 2: Cluster waypoints by proximity across different roads ──
  // Union-find approach: waypoints that are within CLUSTER_RADIUS_KM
  // and are on DIFFERENT roads belong to the same junction cluster
  const n = allWaypoints.length;
  const parent = new Array(n).fill(0).map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  // Only union waypoints on DIFFERENT roads within CLUSTER_RADIUS_KM
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (allWaypoints[i].roadCode === allWaypoints[j].roadCode) continue;
      const dist = haversineKm(allWaypoints[i], allWaypoints[j]);
      if (dist <= CLUSTER_RADIUS_KM) {
        union(i, j);
      }
    }
  }

  // ── Step 3: Group by cluster ──
  const clusters = new Map<number, IndexedWaypoint[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(allWaypoints[i]);
  }

  // ── Step 4: Build junction records from clusters ──
  const extracted: RawJunction[] = [];

  for (const [, members] of clusters) {
    // Only keep clusters with ≥2 DIFFERENT roads
    const uniqueRoads = new Set(members.map((m) => m.roadCode));
    if (uniqueRoads.size < 2) continue;

    // Compute centroid
    const center = centroid(members);

    // Determine name: use the shortest unique name from the cluster's roads
    const clusterNames = [...new Set(members.map((m) => m.name.replace(/ \(.*\)$/, "")))];
    const name = clusterNames.sort((a, b) => a.length - b.length)[0] || `${[...uniqueRoads].join("+")}`;

    extracted.push({
      name,
      roadCodes: [...uniqueRoads].sort(),
      type: junctionType(uniqueRoads.size),
      latitude: Math.round(center.latitude * 10000) / 10000,
      longitude: Math.round(center.longitude * 10000) / 10000,
    });
  }

  console.log(`  Auto-extracted: ${extracted.length} junction clusters from ${allWaypoints.length} waypoints\n`);

  // ── Step 5: Merge manual seeds ──
  for (const seed of MANUAL_SEEDS) {
    // Check if any existing cluster is within DEDUP_RADIUS_KM of this seed
    const existing = extracted.find(
      (j) => haversineKm(j, seed) <= DEDUP_RADIUS_KM,
    );

    if (existing) {
      // Merge road codes and keep the manual name (more precise)
      const mergedRoads = [...new Set([...existing.roadCodes, ...seed.roadCodes])].sort();
      existing.name = seed.name;
      existing.roadCodes = mergedRoads;
      existing.type = junctionType(mergedRoads.length);
      // Keep auto-extracted lat/lon (more accurate as centroid of multiple points)
      console.log(`  Merged manual seed "${seed.name}" into existing cluster (${existing.roadCodes.join(", ")})`);
    } else {
      extracted.push(seed);
      console.log(`  Added manual seed "${seed.name}" (${seed.roadCodes.join(", ")})`);
    }
  }

  // ── Step 6: Final deduplication — merge clusters within DEDUP_RADIUS_KM ──
  const deduped: RawJunction[] = [];
  for (const j of extracted) {
    const existing = deduped.find(
      (d) => haversineKm(d, j) <= DEDUP_RADIUS_KM,
    );
    if (existing) {
      const mergedRoads = [...new Set([...existing.roadCodes, ...j.roadCodes])].sort();
      existing.roadCodes = mergedRoads;
      existing.type = junctionType(mergedRoads.length);
      // Recompute centroid as weighted average
      const total = deduped.filter(
        (d) => haversineKm(d, j) <= DEDUP_RADIUS_KM || d === existing,
      ).length;
      existing.latitude = Math.round(
        ((existing.latitude + j.latitude) / 2) * 10000,
      ) / 10000;
      existing.longitude = Math.round(
        ((existing.longitude + j.longitude) / 2) * 10000,
      ) / 10000;
    } else {
      deduped.push(j);
    }
  }

  // ── Step 7: Sort by longitude (west to east) ──
  deduped.sort((a, b) => a.longitude - b.longitude);

  // ── Step 8: Write output ──
  writeFileSync(OUTPUT_PATH, JSON.stringify(deduped, null, 2));
  console.log(`\nWrote ${deduped.length} junctions to ${OUTPUT_PATH}`);

  // ── Summary ──
  const byType: Record<string, number> = {};
  for (const j of deduped) {
    byType[j.type] = (byType[j.type] || 0) + 1;
  }
  console.log(`\n=== Junction Summary ===`);
  for (const [t, c] of Object.entries(byType)) {
    console.log(`  ${t}: ${c}`);
  }
  console.log(`\nJunctions:`);
  for (const j of deduped) {
    console.log(
      `  ${j.name.padEnd(30)} ${j.latitude.toFixed(4).padStart(9)}, ${j.longitude.toFixed(4).padStart(9)}  ${j.type.padEnd(14)} ${j.roadCodes.join(", ")}`,
    );
  }
}

main();
