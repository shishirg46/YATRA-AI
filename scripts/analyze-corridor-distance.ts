#!/usr/bin/env npx tsx
/**
 * analyze-corridor-distance.ts — Stage 3.6: Corridor Diagnostics.
 *
 * Measures the geometric distance between each corridor waypoint and the
 * nearest topology edge polyline segment.  Produces a measurement report
 * that drives Stage 4 overrides (densify, radius_override, both, repair).
 *
 * Usage:
 *   npx tsx scripts/analyze-corridor-distance.ts <corridor-id>
 *
 * Default: kaligandaki-corridor
 *
 * Input:
 *   scripts/data/topology-graph.json
 *   scripts/data/corridors/<corridor-id>.json
 *
 * Output: scripts/data/corridor-distance-report.json
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pointToSegmentDistM } from "../lib/routing/geo";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const CORRIDORS_DIR = join(DATA_DIR, "corridors");
const TOPO_PATH = join(DATA_DIR, "topology-graph.json");
const OUTPUT_PATH = join(DATA_DIR, "corridor-distance-report.json");

const CORRIDOR_TO_DOR: Record<string, string> = {
  "east-west-highway": "NH01",
  "mid-hill-highway": "NH04",
  "prithvi-highway": "NH17",
  "kaligandaki-corridor": "NH11",
  "siddhartha-highway": "NH10",
  "bp-highway": "NH03",
};

type RecommendationStrategy =
  | "densify"
  | "radius_override"
  | "both"
  | "repair_waypoints";

interface WaypointDist {
  index: number;
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
  nearestEdgeId: string;
  nearestFcode: number;
  segmentIndex: number;
}

interface CorridorDistanceReport {
  corridor: string;
  dorRoadCode: string;
  waypoints: number;
  distanceStats: {
    meanM: number;
    medianM: number;
    p90M: number;
    p95M: number;
    maxM: number;
  };
  buckets: {
    "0-200m": number;
    "200-500m": number;
    "500-1000m": number;
    "1000m+": number;
  };
  rawDistancesM: number[];
  worstWaypoints: WaypointDist[];
  recommendation: {
    strategy: RecommendationStrategy;
    reason: string;
  };
}

function main() {
  const corridorId = process.argv[2] || "kaligandaki-corridor";
  const dorRoadCode = CORRIDOR_TO_DOR[corridorId] ?? "???";

  console.log(`[analyze-corridor-distance] Loading corridor "${corridorId}" (${dorRoadCode})...`);

  const corridorPath = join(CORRIDORS_DIR, `${corridorId}.json`);
  const corridor: { id: string; name: string; nodes: Array<{ name: string; lat: number; lon: number }> } =
    JSON.parse(readFileSync(corridorPath, "utf-8"));
  console.log(`  ${corridor.nodes.length} waypoints`);

  console.log("[analyze-corridor-distance] Loading topology graph...");
  const topo: { edges: Array<{ id: string; fcode: number; polyline: Array<{ lat: number; lon: number }> }> } =
    JSON.parse(readFileSync(TOPO_PATH, "utf-8"));
  console.log(`  ${topo.edges.length} edges`);

  // ── Measure each waypoint against all edges ──
  const waypointDists: WaypointDist[] = [];
  const rawDistancesM: number[] = [];

  for (let wi = 0; wi < corridor.nodes.length; wi++) {
    const wp = corridor.nodes[wi];
    let bestDist = Infinity;
    let bestEdgeId = "";
    let bestFcode = 0;
    let bestSegIdx = -1;

    for (const edge of topo.edges) {
      const pl = edge.polyline;
      // Use edge midpoint as projection reference (same approach as overlay-dor-labels)
      const avgLat = pl.reduce((s, p) => s + p.lat, 0) / pl.length;
      const cosRef = Math.cos((avgLat * Math.PI) / 180);
      const ppX = wp.lon * 111320 * cosRef;
      const ppY = wp.lat * 111320;

      for (let si = 0; si < pl.length - 1; si++) {
        const d = pointToSegmentDistM(
          ppX, ppY,
          pl[si].lon * 111320 * cosRef,
          pl[si].lat * 111320,
          pl[si + 1].lon * 111320 * cosRef,
          pl[si + 1].lat * 111320,
        );
        if (d < bestDist) {
          bestDist = d;
          bestEdgeId = edge.id;
          bestFcode = edge.fcode;
          bestSegIdx = si;
        }
      }
    }

    const dist = bestDist === Infinity ? -1 : Math.round(bestDist);
    waypointDists.push({
      index: wi,
      name: wp.name,
      lat: wp.lat,
      lon: wp.lon,
      distanceM: dist,
      nearestEdgeId: bestEdgeId,
      nearestFcode: bestFcode,
      segmentIndex: bestSegIdx,
    });
    rawDistancesM.push(dist);
  }

  // ── Statistics ──
  const valid = rawDistancesM.filter((d) => d >= 0);
  const sorted = [...valid].sort((a, b) => a - b);
  const n = sorted.length;
  const meanM = +(valid.reduce((s, d) => s + d, 0) / n).toFixed(1);
  const medianM = n > 0 ? sorted[Math.floor(n / 2)] : -1;
  const p90M = n > 0 ? sorted[Math.floor(n * 0.9)] : -1;
  const p95M = n > 0 ? sorted[Math.floor(n * 0.95)] : -1;
  const maxM = n > 0 ? sorted[n - 1] : -1;

  // ── Buckets ──
  const buckets = { "0-200m": 0, "200-500m": 0, "500-1000m": 0, "1000m+": 0 };
  for (const d of valid) {
    if (d <= 200) buckets["0-200m"]++;
    else if (d <= 500) buckets["200-500m"]++;
    else if (d <= 1000) buckets["500-1000m"]++;
    else buckets["1000m+"]++;
  }

  // ── Worst waypoints ──
  const worstWaypoints = [...waypointDists].sort((a, b) => b.distanceM - a.distanceM).slice(0, 5);

  // ── Recommendation ──
  let strategy: RecommendationStrategy;
  let reason: string;

  if (medianM < 300 && p90M < 500) {
    strategy = "densify";
    reason = `median=${medianM}m < 300m and p90=${p90M}m < 500m — geometry is well-aligned, sampling is sparse`;
  } else if (medianM > 700 && p90M > 1000) {
    strategy = "radius_override";
    reason = `median=${medianM}m > 700m and p90=${p90M}m > 1000m — DOR geometry displaced from topology edges`;
  } else if (medianM > 300 || p90M > 500) {
    // mixed scenario — some near, some far
    const pctFar = +((buckets["1000m+"] / n) * 100).toFixed(0);
    if (pctFar <= 20) {
      strategy = "repair_waypoints";
      reason = `${pctFar}% of waypoints are >1000m away but the rest are close — likely isolated bad points`;
    } else {
      strategy = "both";
      reason = `median=${medianM}m suggests partial alignment — both densification and moderate radius increase needed`;
    }
  } else {
    strategy = "densify";
    reason = `default recommendation based on measured distances`;
  }

  // ── Build report ──
  const report: CorridorDistanceReport = {
    corridor: corridorId,
    dorRoadCode,
    waypoints: n,
    distanceStats: { meanM, medianM, p90M, p95M, maxM },
    buckets,
    rawDistancesM,
    worstWaypoints,
    recommendation: { strategy, reason },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`[analyze-corridor-distance] Report written to ${OUTPUT_PATH}`);
  console.log(`  Distances: mean=${meanM}m median=${medianM}m p90=${p90M}m p95=${p95M}m max=${maxM}m`);
  console.log(`  Buckets: 0-200m=${buckets["0-200m"]} 200-500m=${buckets["200-500m"]} 500-1000m=${buckets["500-1000m"]} 1000m+=${buckets["1000m+"]}`);
  console.log(`  Recommendation: ${strategy} — ${reason}`);
  console.log(`  Worst waypoints: ${worstWaypoints.map(w => `#${w.index} ${w.name}=${w.distanceM}m`).join(", ")}`);
}

main();
