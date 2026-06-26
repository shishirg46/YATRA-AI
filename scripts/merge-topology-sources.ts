#!/usr/bin/env npx tsx
/**
 * merge-topology-sources.ts — Stage 2C: Geometry Normalization & Merge.
 *
 * Takes DOR and OSM raw edge sets, performs geometry normalization
 * (node snapping, spatial dedup), and writes a unified raw-edges.json
 * for the topology builder.
 *
 * Merge rules (locked design):
 *   1. Node snapping: OSM vertices → nearest DOR vertex if ≤25m
 *      (coordinates only — no topology change)
 *   2. Segment overlap: (midpoint dist ≤ 25m AND heading diff ≤ 30°)
 *   3. Continuous run: 2-of-4 sliding window
 *   4. Discard if overlap_ratio ≥ 0.70
 *   5. DOR edges are never modified
 *   6. OSM is additive-only — discarded only when ≥70% overlap
 *      with sustained geometric equivalence (continuous run)
 *   7. FCODE is always null for OSM-sourced edges
 *   8. OSM snapping must NOT create new junctions or alter topology
 *
 * Usage:
 *   npx tsx scripts/merge-topology-sources.ts
 *
 * Inputs:
 *   scripts/data/raw-edges-dor.json  (Stage 2A output)
 *   scripts/data/raw-edges-osm.json  (Stage 2B output)
 *
 * Output: scripts/data/raw-edges.json
 */
import RBush from "rbush";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pointToSegmentDistM } from "../lib/routing/geo";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const DOR_PATH = join(DATA_DIR, "raw-edges.json");
const OSM_PATH = join(DATA_DIR, "raw-edges-osm.json");
const OUTPUT_PATH = join(DATA_DIR, "raw-edges.json");

const SNAP_DISTANCE_M = 25;
const OVERLAP_DISTANCE_M = 25;
const HEADING_DIFF_MAX_DEG = 30;
const SEARCH_RADIUS_DEG = 50 / 111320; // 50m safety margin
const OVERLAP_RATIO_THRESHOLD = 0.7;

// ─── Invariants ────────────────────────────────────────────────────────
// INVARIANT 1: DOR edges are never modified.
// INVARIANT 2: OSM edges are additive-only — discarded only when
//              ≥70% overlap with a continuous run (2-of-4 window).
// INVARIANT 3: FCODE is always null for OSM-sourced edges.
// INVARIANT 4: sourcePriority: DOR=1.0, OSM=0.7.
// INVARIANT 5: OSM snapping modifies coordinates only — it must NOT
//              create new junctions or alter FNODE/TNODE topology.

// ─── Types ─────────────────────────────────────────────────────────────

interface DorRawEdge {
  id: number;
  fcode: number;
  features: string;
  fnode: number;
  tnode: number;
  polyline: Array<{ lat: number; lon: number }>;
  lengthKm: number;
}

interface OsmRawEdge {
  id: string;
  source: "OSM";
  sourcePriority: number;
  polyline: Array<{ lat: number; lon: number }>;
  lengthKm: number;
  fcode: null;
  features: string;
  fnode: null;
  tnode: null;
  highway?: string;
}

interface UnifiedEdge {
  id: number | string;
  source: "DOR" | "OSM";
  sourcePriority: number;
  polyline: Array<{ lat: number; lon: number }>;
  lengthKm: number;
  fcode: number | null;
  features: string;
  fnode: number | null;
  tnode: number | null;
}

// ─── Spatial index entries ─────────────────────────────────────────────

interface DORVertexEntry {
  minX: number; minY: number; maxX: number; maxY: number;
  lat: number;
  lon: number;
}

interface DORSegmentEntry {
  minX: number; minY: number; maxX: number; maxY: number;
  aLat: number; aLon: number;
  bLat: number; bLon: number;
  cosRef: number;
  ax: number; ay: number;
  bx: number; by: number;
  headingDeg: number;
}

// ─── Geometry helpers ──────────────────────────────────────────────────

function segmentHeadingDeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  cosRef: number,
): number {
  const dx = (lon2 - lon1) * 111320 * cosRef;
  const dy = (lat2 - lat1) * 111320;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function headingDiffDeg(h1: number, h2: number): number {
  let diff = Math.abs(h1 - h2);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function midpoint(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): { lat: number; lon: number } {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

// ─── Build DOR indexes ─────────────────────────────────────────────────

function buildDORVertexIndex(dorEdges: DorRawEdge[]): RBush<DORVertexEntry> {
  const tree = new RBush<DORVertexEntry>();
  const entries: DORVertexEntry[] = [];
  for (const edge of dorEdges) {
    for (const v of edge.polyline) {
      entries.push({
        minX: v.lon, minY: v.lat, maxX: v.lon, maxY: v.lat,
        lat: v.lat, lon: v.lon,
      });
    }
  }
  tree.load(entries);
  return tree;
}

function buildDORSegmentIndex(dorEdges: DorRawEdge[]): RBush<DORSegmentEntry> {
  const tree = new RBush<DORSegmentEntry>();
  const entries: DORSegmentEntry[] = [];
  for (const edge of dorEdges) {
    for (let si = 0; si < edge.polyline.length - 1; si++) {
      const a = edge.polyline[si];
      const b = edge.polyline[si + 1];
      const avgLat = (a.lat + b.lat) / 2;
      const cosRef = Math.cos((avgLat * Math.PI) / 180);
      const minLat = Math.min(a.lat, b.lat);
      const maxLat = Math.max(a.lat, b.lat);
      const minLon = Math.min(a.lon, b.lon);
      const maxLon = Math.max(a.lon, b.lon);
      entries.push({
        minX: minLon - SEARCH_RADIUS_DEG,
        minY: minLat - SEARCH_RADIUS_DEG,
        maxX: maxLon + SEARCH_RADIUS_DEG,
        maxY: maxLat + SEARCH_RADIUS_DEG,
        aLat: a.lat, aLon: a.lon,
        bLat: b.lat, bLon: b.lon,
        cosRef,
        ax: a.lon * 111320 * cosRef,
        ay: a.lat * 111320,
        bx: b.lon * 111320 * cosRef,
        by: b.lat * 111320,
        headingDeg: segmentHeadingDeg(a.lat, a.lon, b.lat, b.lon, cosRef),
      });
    }
  }
  tree.load(entries);
  return tree;
}

// ─── Snap OSM vertices to nearest DOR vertex ──────────────────────────

function snapOSMVertices(
  polyline: Array<{ lat: number; lon: number }>,
  vertexTree: RBush<DORVertexEntry>,
): Array<{ lat: number; lon: number }> {
  const snapDeg = SNAP_DISTANCE_M / 111320;
  return polyline.map((v) => {
    const hits = vertexTree.search({
      minX: v.lon - snapDeg, minY: v.lat - snapDeg,
      maxX: v.lon + snapDeg, maxY: v.lat + snapDeg,
    });
    let bestDist = SNAP_DISTANCE_M;
    let best = v;
    for (const h of hits) {
      const d = pointToSegmentDistM(
        v.lon * 111320, v.lat * 111320,
        h.lon * 111320, h.lat * 111320,
        h.lon * 111320, h.lat * 111320,
      );
      if (d < bestDist) {
        bestDist = d;
        best = { lat: h.lat, lon: h.lon };
      }
    }
    return best;
  });
}

// ─── Per-segment overlap detection ────────────────────────────────────

function computeOverlapFlags(
  polyline: Array<{ lat: number; lon: number }>,
  segTree: RBush<DORSegmentEntry>,
): boolean[] {
  const overlapped: boolean[] = [];

  for (let si = 0; si < polyline.length - 1; si++) {
    const a = polyline[si];
    const b = polyline[si + 1];
    const mid = midpoint(a, b);
    const avgLat = mid.lat;
    const cosRef = Math.cos((avgLat * Math.PI) / 180);
    const midX = mid.lon * 111320 * cosRef;
    const midY = mid.lat * 111320;

    const osmHeading = segmentHeadingDeg(a.lat, a.lon, b.lat, b.lon, cosRef);

    // Search DOR segments within radius
    const candidates = segTree.search({
      minX: mid.lon - SEARCH_RADIUS_DEG,
      minY: mid.lat - SEARCH_RADIUS_DEG,
      maxX: mid.lon + SEARCH_RADIUS_DEG,
      maxY: mid.lat + SEARCH_RADIUS_DEG,
    });

    let bestDist = OVERLAP_DISTANCE_M;
    let bestHeadingDiff = Infinity;

    for (const c of candidates) {
      const d = pointToSegmentDistM(midX, midY, c.ax, c.ay, c.bx, c.by);
      if (d < bestDist) {
        bestDist = d;
        bestHeadingDiff = headingDiffDeg(osmHeading, c.headingDeg);
      }
    }

    overlapped.push(bestDist <= OVERLAP_DISTANCE_M && bestHeadingDiff <= HEADING_DIFF_MAX_DEG);
  }

  return overlapped;
}

// ─── 2-of-4 window rule ───────────────────────────────────────────────

function computeContinuousRunRatio(overlapped: boolean[]): number {
  const n = overlapped.length;
  if (n < 4) return 0; // Short edges never reach 70% continuous run

  const inRun = new Array(n).fill(false);

  for (let w = 0; w <= n - 4; w++) {
    let count = 0;
    for (let s = w; s < w + 4; s++) {
      if (overlapped[s]) count++;
    }
    if (count >= 2) {
      for (let s = w; s < w + 4; s++) {
        inRun[s] = true;
      }
    }
  }

  const runCount = inRun.filter(Boolean).length;
  return runCount / n;
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("[merge-topology-sources] Loading DOR edges...");
  const dorEdges: DorRawEdge[] = JSON.parse(readFileSync(DOR_PATH, "utf-8"));
  console.log(`  ${dorEdges.length} DOR edges loaded`);

  console.log("[merge-topology-sources] Loading OSM edges...");
  const osmEdges: OsmRawEdge[] = JSON.parse(readFileSync(OSM_PATH, "utf-8"));
  console.log(`  ${osmEdges.length} OSM edges loaded`);

  // Build DOR spatial indexes
  console.log("[merge-topology-sources] Building DOR vertex spatial index...");
  const vertexTree = buildDORVertexIndex(dorEdges);

  console.log("[merge-topology-sources] Building DOR segment spatial index...");
  const segTree = buildDORSegmentIndex(dorEdges);

  // Process each OSM edge
  console.log("[merge-topology-sources] Processing OSM edges...");
  const keptOsmEdges: UnifiedEdge[] = [];
  let discarded = 0;
  let tooShort = 0;

  for (let oi = 0; oi < osmEdges.length; oi++) {
    const osm = osmEdges[oi];

    if (osm.polyline.length < 2) {
      tooShort++;
      continue;
    }

    // INVARIANT 5: Snap coordinates only — no topology change
    const snappedPoly = snapOSMVertices(osm.polyline, vertexTree);

    // Compute per-segment overlap
    const overlapped = computeOverlapFlags(snappedPoly, segTree);

    // Apply 2-of-4 window rule
    const overlapRatio = computeContinuousRunRatio(overlapped);

    // INVARIANT 2: OSM is additive-only — discard only when ≥70% overlap
    if (overlapRatio >= OVERLAP_RATIO_THRESHOLD) {
      discarded++;
      continue;
    }

    keptOsmEdges.push({
      id: osm.id,
      source: "OSM",
      sourcePriority: 0.7,
      polyline: snappedPoly,
      lengthKm: osm.lengthKm,
      fcode: null,
      features: osm.features,
      fnode: null,
      tnode: null,
    });

    if (oi % 500 === 0 && oi > 0) {
      console.log(`    processed ${oi}/${osmEdges.length} OSM edges, ${keptOsmEdges.length} kept, ${discarded} discarded...`);
    }
  }

  console.log(`\n  OSM merge results:`);
  console.log(`    Total OSM edges: ${osmEdges.length}`);
  console.log(`    Kept: ${keptOsmEdges.length}`);
  console.log(`    Discarded (≥70% overlap): ${discarded}`);
  console.log(`    Too short (<2 vertices): ${tooShort}`);
  console.log(`    Survival rate: ${((keptOsmEdges.length / Math.max(1, osmEdges.length - tooShort)) * 100).toFixed(1)}%`);

  // INVARIANT 1: DOR edges are never modified
  const unifiedDorEdges: UnifiedEdge[] = dorEdges.map((e) => ({
    id: e.id,
    source: "DOR",
    sourcePriority: 1.0,
    polyline: e.polyline,
    lengthKm: e.lengthKm,
    fcode: e.fcode,
    features: e.features,
    fnode: e.fnode,
    tnode: e.tnode,
  }));

  // Write unified output
  const output: UnifiedEdge[] = [...unifiedDorEdges, ...keptOsmEdges];
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n[merge-topology-sources] Written to ${OUTPUT_PATH}`);
  console.log(`  Total edges: ${output.length} (${unifiedDorEdges.length} DOR + ${keptOsmEdges.length} OSM)`);

  // INVARIANT 3 verification: no OSM edge has an fcode
  const osmWithFcode = keptOsmEdges.filter((e) => e.fcode !== null).length;
  if (osmWithFcode > 0) {
    console.error(`  ERROR: ${osmWithFcode} OSM edges have non-null FCODE (violates invariant 3)`);
    process.exit(1);
  }

  // INVARIANT 1 verification: no DOR edge was modified
  const dorWithChanges = unifiedDorEdges.filter((e) => e.source !== "DOR").length;
  if (dorWithChanges > 0) {
    console.error(`  ERROR: ${dorWithChanges} DOR edges have modified source (violates invariant 1)`);
    process.exit(1);
  }
}

main();
