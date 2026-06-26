#!/usr/bin/env npx tsx
/**
 * overlay-dor-labels.ts — Stage 3: Semantic Anchoring.
 *
 * Takes topology-graph.json (pure structure, no labels) and overlays DOR
 * road network labels as candidateLabels[] on each edge.
 *
 * Matching uses point-to-polyline-segment distance (not point-to-point)
 * so edges between sparse DOR waypoints still match correctly.
 *
 * Topology is READ-ONLY — no edge splits, no new nodes.
 * Labels are CANDIDATES — never final roadCode.
 *
 * Usage:
 *   npx tsx scripts/overlay-dor-labels.ts
 *
 * Input:
 *   topology-graph.json
 *   dor-road-network.densified.json
 *   dor-road-network.json
 *
 * Output: scripts/data/anchored-edges.json
 */
import RBush from "rbush";
import { readFileSync, writeFileSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pointToSegmentDistM } from "../lib/routing/geo";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const TOPO_PATH = join(DATA_DIR, "topology-graph.json");
const DOR_DENSIFIED_PATH = join(DATA_DIR, "dor-road-network.densified.json");
const DOR_REGISTRY_PATH = join(DATA_DIR, "dor-road-network.json");
const OUTPUT_PATH = join(DATA_DIR, "anchored-edges.json");
const DEBUG_LOG_PATH = join(DATA_DIR, "anchored-edges.debug.jsonl");
const CONFLICT_DUMP_PATH = join(DATA_DIR, "anchored-edges.conflicts.json");

const MATCH_DISTANCE_M = 850;
const ALIGNMENT_ANGLE_MAX = 60;

// ─── Types ─────────────────────────────────────────────────────────────

interface TopologyNode {
  id: string;
  lat: number;
  lon: number;
  type: "JUNCTION" | "ENDPOINT";
  degree: number;
}

interface TopologyEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fcode: number;
  features: string;
  lengthKm: number;
  polyline: Array<{ lat: number; lon: number }>;
  sourceIds: (number | string)[];
  source: "DOR" | "OSM";
  sourcePriority: number;
}

interface DORWaypoint {
  lat: number;
  lon: number;
}

interface DORRoad {
  roadCode: string;
  name: string;
  roadType: string;
  fromPlace: string;
  toPlace: string;
  waypoints: DORWaypoint[];
  lengthKm: number;
}

interface CandidateLabel {
  roadCode: string;
  roadName: string;
  roadType: string;
  confidence: number;
  meanDistanceM: number;
  alignmentScore: number;
}

interface AnchoredEdge extends TopologyEdge {
  candidates: CandidateLabel[];
  frozen?: boolean;
}

interface AnchoredGraph {
  version: number;
  generatedAt: string;
  nodes: TopologyNode[];
  edges: AnchoredEdge[];
}

// ─── DOR segment spatial index ─────────────────────────────────────────

interface DORSegEntry {
  minX: number; minY: number; maxX: number; maxY: number;
  roadIdx: number;
  segIdx: number;
  ax: number; ay: number;
  bx: number; by: number;
  aLat: number; aLon: number;
  bLat: number; bLon: number;
}

function buildDORIndex(
  dorRoads: DORRoad[],
): { tree: RBush<DORSegEntry>; meta: Map<number, { roadCode: string; name: string; roadType: string; cosRef: number }> } {
  const meta = new Map();
  const entries: DORSegEntry[] = [];

  for (let ri = 0; ri < dorRoads.length; ri++) {
    const road = dorRoads[ri];
    const avgLat = road.waypoints.reduce((s, w) => s + w.lat, 0) / road.waypoints.length;
    const cosRef = Math.cos((avgLat * Math.PI) / 180);
    meta.set(ri, { roadCode: road.roadCode, name: road.name, roadType: road.roadType, cosRef });

    for (let si = 0; si < road.waypoints.length - 1; si++) {
      const a = road.waypoints[si];
      const b = road.waypoints[si + 1];
      const minLat = Math.min(a.lat, b.lat);
      const maxLat = Math.max(a.lat, b.lat);
      const minLon = Math.min(a.lon, b.lon);
      const maxLon = Math.max(a.lon, b.lon);
      const sd = MATCH_DISTANCE_M / 111320;

      entries.push({
        minX: minLon - sd, minY: minLat - sd,
        maxX: maxLon + sd, maxY: maxLat + sd,
        roadIdx: ri, segIdx: si,
        ax: a.lon * 111320 * cosRef,
        ay: a.lat * 111320,
        bx: b.lon * 111320 * cosRef,
        by: b.lat * 111320,
        aLat: a.lat, aLon: a.lon,
        bLat: b.lat, bLon: b.lon,
      });
    }
  }

  const tree = new RBush<DORSegEntry>();
  tree.load(entries);
  return { tree, meta };
}

/**
 * Compute the mean distance from each vertex of a topology edge's polyline
 * to the nearest segment of a given DOR road (using precomputed spatial index).
 */
function computeMeanDistanceToRoad(
  polyline: Array<{ lat: number; lon: number }>,
  roadIdx: number,
  tree: RBush<DORSegEntry>,
  meta: Map<number, { cosRef: number }>,
  thresholdM: number,
): number | null {
  if (polyline.length === 0) return null;

  const roadMeta = meta.get(roadIdx);
  if (!roadMeta) return null;
  const cosRef = roadMeta.cosRef;
  const sd = thresholdM / 111320;

  let totalDist = 0;
  let validVerts = 0;

  for (const v of polyline) {
    const px = v.lon * 111320 * cosRef;
    const py = v.lat * 111320;

    const candidates = tree.search({
      minX: v.lon - sd, minY: v.lat - sd,
      maxX: v.lon + sd, maxY: v.lat + sd,
    });

    let minD = thresholdM;
    for (const c of candidates) {
      if (c.roadIdx !== roadIdx) continue;
      const d = pointToSegmentDistM(px, py, c.ax, c.ay, c.bx, c.by);
      if (d < minD) minD = d;
    }

    totalDist += minD;
    validVerts++;
  }

  if (validVerts === 0) return null;
  return totalDist / validVerts;
}

/**
 * Direction alignment between edge and DOR road (overall start→end).
 */
function computeAlignment(
  polyline: Array<{ lat: number; lon: number }>,
  dorRoad: DORRoad,
): number {
  if (polyline.length < 2 || dorRoad.waypoints.length < 2) return 0;

  const e1 = polyline[0];
  const e2 = polyline[polyline.length - 1];
  const d1 = dorRoad.waypoints[0];
  const d2 = dorRoad.waypoints[dorRoad.waypoints.length - 1];

  const midLat1 = (e1.lat + e2.lat) / 2;
  const c1 = Math.cos((midLat1 * Math.PI) / 180);
  const ex = (e2.lon - e1.lon) * c1;
  const ey = e2.lat - e1.lat;

  const midLat2 = (d1.lat + d2.lat) / 2;
  const c2 = Math.cos((midLat2 * Math.PI) / 180);
  const dx = (d2.lon - d1.lon) * c2;
  const dy = d2.lat - d1.lat;

  const eMag = Math.sqrt(ex * ex + ey * ey);
  const dMag = Math.sqrt(dx * dx + dy * dy);
  if (eMag < 1e-10 || dMag < 1e-10) return 0;

  const dot = ex * dx + ey * dy;
  const cosA = Math.max(-1, Math.min(1, dot / (eMag * dMag)));
  return (cosA + 1) / 2;
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("[overlay-dor-labels] Reading topology graph...");
  const topo: { nodes: TopologyNode[]; edges: TopologyEdge[] } = JSON.parse(
    readFileSync(TOPO_PATH, "utf-8"),
  );
  console.log(`  ${topo.nodes.length} nodes, ${topo.edges.length} edges`);

  console.log("[overlay-dor-labels] Reading DOR road data...");
  const dorRoads: DORRoad[] = JSON.parse(readFileSync(DOR_DENSIFIED_PATH, "utf-8"));
  console.log(`  ${dorRoads.length} DOR roads loaded`);

  // Extract total DOR segment count
  let totalSegs = 0;
  for (const r of dorRoads) totalSegs += Math.max(0, r.waypoints.length - 1);
  console.log(`  ${totalSegs} DOR polyline segments`);

  // Build spatial index of DOR polyline segments
  console.log("[overlay-dor-labels] Building DOR segment spatial index...");
  const { tree: dorIndex, meta: dorMeta } = buildDORIndex(dorRoads);

  // Load road metadata
  const dorRegistry: Array<{ roadCode: string; name: string; roadType: string }> = JSON.parse(
    readFileSync(DOR_REGISTRY_PATH, "utf-8"),
  );
  const roadMeta = new Map<string, { name: string; roadType: string }>();
  for (const r of dorRegistry) {
    roadMeta.set(r.roadCode, { name: r.name, roadType: r.roadType });
  }

  // ── Trace collectors ──────────────────────────────────────────────
  const debugStream = createWriteStream(DEBUG_LOG_PATH);
  const topConfident: { edgeId: string; fcode: number; roadCode: string; confidence: number; distanceM: number; alignment: number }[] = [];
  const conflicts: { edgeId: string; fcode: number; c1: CandidateLabel; c2: CandidateLabel; margin: number }[] = [];

  // ── Match each topology edge against DOR roads ────────────────────
  console.log("[overlay-dor-labels] Matching edges against DOR road segments...");

  const anchoredEdges: AnchoredEdge[] = [];
  let matched = 0;
  let total = 0;

  for (const edge of topo.edges) {
    total++;
    let candidates: CandidateLabel[] = [];

    for (let ri = 0; ri < dorRoads.length; ri++) {
      const dor = dorRoads[ri];

      const meanDist = computeMeanDistanceToRoad(
        edge.polyline, ri, dorIndex, dorMeta, MATCH_DISTANCE_M,
      );
      if (meanDist === null || meanDist > MATCH_DISTANCE_M) continue;

      const alignment = computeAlignment(edge.polyline, dor);
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, alignment * 2 - 1))) * (180 / Math.PI);
      if (angleDeg > ALIGNMENT_ANGLE_MAX) continue;

      const distConfidence = Math.max(0, 1 - meanDist / MATCH_DISTANCE_M);
      const alignConfidence = alignment;
      const confidence = +(distConfidence * alignConfidence).toFixed(3);

      const meta = roadMeta.get(dor.roadCode);
      candidates.push({
        roadCode: dor.roadCode,
        roadName: meta?.name ?? dor.name,
        roadType: meta?.roadType ?? dor.roadType,
        confidence,
        meanDistanceM: +meanDist.toFixed(1),
        alignmentScore: +alignment.toFixed(3),
      });
    }

    // Deduplicate: keep only best candidate per roadCode
    const seen = new Map<string, CandidateLabel>();
    for (const c of candidates) {
      const existing = seen.get(c.roadCode);
      if (!existing || c.confidence > existing.confidence) {
        seen.set(c.roadCode, c);
      }
    }
    candidates = Array.from(seen.values());

    candidates.sort((a, b) => b.confidence - a.confidence);

    anchoredEdges.push({
      ...edge,
      candidates: candidates.filter((c) => c.confidence > 0.3).slice(0, 3),
    });

    // ── Trace logging ──
    const selected = candidates.length > 0 ? candidates[0] : null;
    debugStream.write(JSON.stringify({
      edgeId: edge.id,
      fcode: edge.fcode,
      candidates: candidates.map(c => ({
        roadCode: c.roadCode,
        confidence: c.confidence,
        distanceM: +c.meanDistanceM.toFixed(1),
        alignment: c.alignmentScore,
      })),
      selected: selected ? {
        roadCode: selected.roadCode,
        confidence: selected.confidence,
        distanceM: +selected.meanDistanceM.toFixed(1),
        alignment: selected.alignmentScore,
        rankGap: candidates.length > 1
          ? +(candidates[0].confidence - candidates[1].confidence).toFixed(3)
          : 1,
      } : null,
    }) + "\n");

    if (selected && selected.confidence > 0.5) {
      topConfident.push({
        edgeId: String(edge.id),
        fcode: edge.fcode,
        roadCode: selected.roadCode,
        confidence: selected.confidence,
        distanceM: +selected.meanDistanceM.toFixed(1),
        alignment: selected.alignmentScore,
      });
    }

    if (
      candidates.length >= 2 &&
      candidates[0].confidence > 0.3 &&
      candidates[1].confidence > 0.3 &&
      (candidates[0].confidence - candidates[1].confidence) < 0.15
    ) {
      conflicts.push({
        edgeId: String(edge.id),
        fcode: edge.fcode,
        c1: candidates[0],
        c2: candidates[1],
        margin: +(candidates[0].confidence - candidates[1].confidence).toFixed(3),
      });
    }

    if (candidates.length > 0 && candidates[0].confidence > 0.5) {
      matched++;
    }

    if (total % 10000 === 0) {
      console.log(`    processed ${total}/${topo.edges.length} edges, ${matched} matched so far...`);
    }
  }

  // ── Pass 2: BFS chain propagation along degree-2 paths ──
  console.log("[overlay-dor-labels] Propagating labels along degree-2 chains...");
  const edgeById = new Map(anchoredEdges.map(e => [e.id, e]));
  const nodeToEdges = new Map<string, string[]>();
  for (const e of anchoredEdges) {
    if (!nodeToEdges.has(e.fromNode)) nodeToEdges.set(e.fromNode, []);
    if (!nodeToEdges.has(e.toNode)) nodeToEdges.set(e.toNode, []);
    nodeToEdges.get(e.fromNode)!.push(e.id);
    nodeToEdges.get(e.toNode)!.push(e.id);
  }

  const nodeDegree = new Map<string, number>();
  for (const n of topo.nodes) {
    nodeDegree.set(n.id, n.degree);
  }

  const stopCounts = { junction: 0, fcodeChange: 0, noCandidate: 0, ambiguity: 0, drift: 0, frozen: 0 };
  let propagated = 0;

  function getOtherNode(edge: AnchoredEdge, nodeId: string): string {
    return edge.fromNode === nodeId ? edge.toNode : edge.fromNode;
  }

  function traverseChain(
    edge: AnchoredEdge, startNode: string,
    roadCode: string, anchorFcode: number, anchorConf: number,
  ) {
    let currEdge = edge;
    let currNode = startNode;
    let prevConf = anchorConf;
    let dropStreak = 0;

    for (let step = 0; step < 500; step++) {
      const tipNode = getOtherNode(currEdge, currNode);

      const deg = nodeDegree.get(tipNode) ?? 0;
      if (deg !== 2) {
        stopCounts.junction++;
        break;
      }

      const neighborIds = nodeToEdges.get(tipNode) ?? [];
      let nextEdge: AnchoredEdge | null = null;
      for (const nid of neighborIds) {
        if (nid !== currEdge.id) { nextEdge = edgeById.get(nid) ?? null; break; }
      }
      if (!nextEdge) { stopCounts.junction++; break; }
      if (nextEdge.frozen) { stopCounts.frozen++; break; }

      // Allow propagation across OSM-sourced edges (fcode=0).
      // FCODE boundaries only stop propagation between DOR edges.
      if (nextEdge.fcode !== 0 && anchorFcode !== 0 && nextEdge.fcode !== anchorFcode) {
        stopCounts.fcodeChange++; break;
      }

      const nc = nextEdge.candidates.find(c => c.roadCode === roadCode);
      if (!nc) { stopCounts.noCandidate++; break; }

      const competitor = nextEdge.candidates.find(
        c => c.roadCode !== roadCode && c.confidence > nc.confidence - 0.2,
      );
      if (competitor) { stopCounts.ambiguity++; break; }

      if (nc.confidence < prevConf) {
        dropStreak++;
        if (dropStreak >= 2) { stopCounts.drift++; break; }
      } else {
        dropStreak = 0;
      }

      nc.confidence = Math.min(1.0, +(nc.confidence + 0.15).toFixed(3));
      propagated++;

      currEdge = nextEdge;
      currNode = tipNode;
      prevConf = nc.confidence;
    }
  }

  for (const edge of anchoredEdges) {
    const self = edge.candidates[0];
    if (!self || self.confidence < 0.7) continue;
    if (edge.frozen) continue;

    traverseChain(edge, edge.toNode, self.roadCode, edge.fcode, self.confidence);
    traverseChain(edge, edge.fromNode, self.roadCode, edge.fcode, self.confidence);
  }

  // Re-sort candidates after propagation
  for (const edge of anchoredEdges) {
    edge.candidates.sort((a, b) => b.confidence - a.confidence);
  }
  console.log(`  propagated ${propagated} edges`);
  console.log(`  stop causes: junction=${stopCounts.junction} fcode=${stopCounts.fcodeChange} noCandidate=${stopCounts.noCandidate} ambiguity=${stopCounts.ambiguity} drift=${stopCounts.drift}`);

  // ── Confidence freeze ─────────────────────────────────────────────
  // Edges with confidence > 0.85 where all neighbors share the same roadCode
  // are frozen — their label is settled and won't propagate further.
  let frozenCount = 0;
  const neighborCache = new Map<string, AnchoredEdge[]>();

  function getNeighbors(edgeId: string): AnchoredEdge[] {
    if (neighborCache.has(edgeId)) return neighborCache.get(edgeId)!;
    const e = edgeById.get(edgeId);
    if (!e) return [];
    const result: AnchoredEdge[] = [];
    const seen = new Set<string>();
    for (const nid of (nodeToEdges.get(e.fromNode) ?? [])) {
      if (nid !== edgeId && !seen.has(nid)) { seen.add(nid); const ne = edgeById.get(nid); if (ne) result.push(ne); }
    }
    for (const nid of (nodeToEdges.get(e.toNode) ?? [])) {
      if (nid !== edgeId && !seen.has(nid)) { seen.add(nid); const ne = edgeById.get(nid); if (ne) result.push(ne); }
    }
    neighborCache.set(edgeId, result);
    return result;
  }

  for (const edge of anchoredEdges) {
    const top = edge.candidates[0];
    if (!top || top.confidence <= 0.85) continue;
    const neighbors = getNeighbors(edge.id);
    const allStable = neighbors.length > 0 && neighbors.every(n => {
      const nt = n.candidates[0];
      return nt && nt.roadCode === top.roadCode && nt.confidence > 0.85;
    });
    if (allStable) {
      edge.frozen = true;
      frozenCount++;
    }
  }
  console.log(`  frozen ${frozenCount} high-confidence edges`);

  // Stats
  const withCandidates = anchoredEdges.filter((e) => e.candidates.length > 0).length;
  const highConf = anchoredEdges.filter(
    (e) => e.candidates.length > 0 && e.candidates[0].confidence > 0.8,
  ).length;

  console.log(`  ${withCandidates} edges have ≥1 candidate label (${((withCandidates / total) * 100).toFixed(1)}%)`);
  console.log(`  ${highConf} edges have high-confidence match (> 0.8)`);

  const byFcode: Record<number, { total: number; matched: number }> = {};
  for (const e of anchoredEdges) {
    if (!byFcode[e.fcode]) byFcode[e.fcode] = { total: 0, matched: 0 };
    byFcode[e.fcode].total++;
    if (e.candidates.length > 0 && e.candidates[0].confidence > 0.5) {
      byFcode[e.fcode].matched++;
    }
  }
  for (const [fcode, stats] of Object.entries(byFcode).sort((a, b) => +a[0] - +b[0])) {
    console.log(`  FCODE ${fcode}: ${stats.matched}/${stats.total} matched (${((stats.matched / stats.total) * 100).toFixed(1)}%)`);
  }

  // ── End-of-run reporting ─────────────────────────────────────────
  debugStream.close();

  topConfident.sort((a, b) => b.confidence - a.confidence);
  console.log("\n[overlay-dor-labels] Top 30 most confident matches:");
  for (const m of topConfident.slice(0, 30)) {
    console.log(`  ${m.edgeId} (FCODE ${m.fcode}) → ${m.roadCode} @ ${m.confidence}  dist=${m.distanceM}m align=${m.alignment}`);
  }

  conflicts.sort((a, b) => a.margin - b.margin);
  console.log("\n[overlay-dor-labels] Top 30 most ambiguous edges (closest margins):");
  for (const c of conflicts.slice(0, 30)) {
    console.log(`  ${c.edgeId} (FCODE ${c.fcode}) ${c.c1.roadCode}=${c.c1.confidence} vs ${c.c2.roadCode}=${c.c2.confidence}  gap=${c.margin}`);
  }

  writeFileSync(CONFLICT_DUMP_PATH, JSON.stringify(conflicts, null, 2));
  console.log(`[overlay-dor-labels] Conflict dump written to ${CONFLICT_DUMP_PATH}`);

  const output: AnchoredGraph = {
    version: 2,
    generatedAt: new Date().toISOString(),
    nodes: topo.nodes,
    edges: anchoredEdges,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[overlay-dor-labels] Written to ${OUTPUT_PATH}`);
}

main();
