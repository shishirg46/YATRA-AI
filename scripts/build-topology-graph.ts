#!/usr/bin/env npx tsx
/**
 * build-topology-graph.ts — Stage 2: Topology Build.
 *
 * Takes raw-edges.json (46k independent arcs) and builds a clean topology
 * graph with properly connected nodes and split edges.
 *
 * Pipeline:
 *   Phase 2A: FNODE/TNODE topology — connect arcs sharing endpoint IDs
 *   Phase 2B: Geometric intersection detection — RBush + angle filter
 *   Phase 2C: Node creation + dedup (20m snap tolerance)
 *   Phase 2D: Edge splitting — cut polylines at intersection points
 *   Phase 2E: Canonicalization — sort, dedup, validate, write
 *
 * Output is PURE STRUCTURE — no road names, no labels.
 *
 * Usage:
 *   npx tsx scripts/build-topology-graph.ts
 *
 * Output: scripts/data/topology-graph.json
 */
import RBush from "rbush";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const INPUT_PATH = join(DATA_DIR, "raw-edges.json");
const OUTPUT_PATH = join(DATA_DIR, "topology-graph.json");

// Configuration
const NODE_MERGE_M = 20;
const INTERSECTION_SNAP_M = 15;
const MIN_ANGLE_DEG = 20;
const MAX_ANGLE_DEG = 160;
const MIN_EDGE_M = 2;

// ─── Types ─────────────────────────────────────────────────────────────

interface RawEdge {
  id: number | string;
  source?: "DOR" | "OSM";
  sourcePriority?: number;
  fcode: number | null;
  features: string;
  fnode: number | null;
  tnode: number | null;
  polyline: Array<{ lat: number; lon: number }>;
  lengthKm: number;
}

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

interface TopologyGraph {
  version: number;
  generatedAt: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

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

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}

function angleBetweenSegs(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  lat3: number, lon3: number,
  lat4: number, lon4: number,
): number {
  const midLat = (lat1 + lat2 + lat3 + lat4) / 4;
  const c = Math.cos((midLat * Math.PI) / 180);
  const dx1 = (lon2 - lon1) * c;
  const dy1 = (lat2 - lat1);
  const dx2 = (lon4 - lon3) * c;
  const dy2 = (lat4 - lat3);
  const dot = dx1 * dx2 + dy1 * dy2;
  const m1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const m2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  if (m1 < 1e-10 || m2 < 1e-10) return 0;
  const cosA = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return (Math.acos(cosA) * 180) / Math.PI;
}

/**
 * Line-line intersection in projected meter space.
 * Returns intersection point if segments cross, null otherwise.
 * Excludes endpoint intersections (t or u within 1e-6 of 0 or 1).
 */
function segmentIntersection(
  a1: { lat: number; lon: number },
  a2: { lat: number; lon: number },
  b1: { lat: number; lon: number },
  b2: { lat: number; lon: number },
): { lat: number; lon: number } | null {
  const refLat = (a1.lat + a2.lat + b1.lat + b2.lat) / 4;
  const c = Math.cos((refLat * Math.PI) / 180);
  const ax = a1.lon * 111320 * c;
  const ay = a1.lat * 111320;
  const bx = a2.lon * 111320 * c;
  const by = a2.lat * 111320;
  const cx = b1.lon * 111320 * c;
  const cy = b1.lat * 111320;
  const dx = b2.lon * 111320 * c;
  const dy = b2.lat * 111320;

  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;

  if (t < 0 || t > 1) return null;
  if (u < 0 || u > 1) return null;
  // Exclude endpoint intersections (handled by FNODE/TNODE topology)
  if (t < 1e-6 || t > 1 - 1e-6) return null;
  if (u < 1e-6 || u > 1 - 1e-6) return null;

  return {
    lat: +(a1.lat + t * (a2.lat - a1.lat)).toFixed(6),
    lon: +(a1.lon + t * (a2.lon - a1.lon)).toFixed(6),
  };
}

interface SegEntry {
  minX: number; minY: number; maxX: number; maxY: number;
  edgeIdx: number; segIdx: number;
  p1: { lat: number; lon: number };
  p2: { lat: number; lon: number };
  fcode: number;
}

interface NodeEntry {
  minX: number; minY: number; maxX: number; maxY: number;
  nodeIdx: number;
  lat: number;
  lon: number;
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("[build-topology-graph] Reading raw edges...");
  const rawEdges: RawEdge[] = JSON.parse(readFileSync(INPUT_PATH, "utf-8"));
  console.log(`  ${rawEdges.length} raw edges loaded`);

  // ── Phase 2A: Collect node positions from FNODE/TNODE ────────────
  console.log("[build-topology-graph] Phase 2A: Building FNODE/TNODE node set...");

  const rawNodePositions: Map<string, { lat: number; lon: number; count: number }> = new Map();

  for (const e of rawEdges) {
    const first = e.polyline[0];
    const last = e.polyline[e.polyline.length - 1];
    const k1 = `${first.lat.toFixed(6)}|${first.lon.toFixed(6)}`;
    const k2 = `${last.lat.toFixed(6)}|${last.lon.toFixed(6)}`;
    if (!rawNodePositions.has(k1)) rawNodePositions.set(k1, { lat: first.lat, lon: first.lon, count: 0 });
    if (!rawNodePositions.has(k2)) rawNodePositions.set(k2, { lat: last.lat, lon: last.lon, count: 0 });
    rawNodePositions.get(k1)!.count++;
    rawNodePositions.get(k2)!.count++;
  }

  console.log(`  ${rawNodePositions.size} unique endpoint positions from shapefile topology`);

  // ── Phase 2B: Geometric intersection detection ────────────────────
  console.log("[build-topology-graph] Phase 2B: Detecting geometric intersections...");

  // Build RBush of all segments
  const segTree = new RBush<SegEntry>();
  const allSegs: SegEntry[] = [];

  for (let ei = 0; ei < rawEdges.length; ei++) {
    const e = rawEdges[ei];
    for (let si = 0; si < e.polyline.length - 1; si++) {
      const p1 = e.polyline[si];
      const p2 = e.polyline[si + 1];
      const minLat = Math.min(p1.lat, p2.lat);
      const maxLat = Math.max(p1.lat, p2.lat);
      const minLon = Math.min(p1.lon, p2.lon);
      const maxLon = Math.max(p1.lon, p2.lon);
      const sd = INTERSECTION_SNAP_M / 111320;
      allSegs.push({
        minX: minLon - sd, minY: minLat - sd,
        maxX: maxLon + sd, maxY: maxLat + sd,
        edgeIdx: ei, segIdx: si,         p1, p2, fcode: e.fcode ?? 0,
      });
    }
  }
  segTree.load(allSegs);
  console.log(`  ${allSegs.length} segments indexed`);

  // Detect intersections — only check each edge against newer edges (j > i)
  const intersectionPts: Array<{ lat: number; lon: number }> = [];
  let checked = 0;

  for (let ei = 0; ei < rawEdges.length; ei++) {
    const e = rawEdges[ei];
    for (let si = 0; si < e.polyline.length - 1; si++) {
      const p1 = e.polyline[si];
      const p2 = e.polyline[si + 1];

      const sd = INTERSECTION_SNAP_M / 111320;
      const candidates = segTree.search({
        minX: Math.min(p1.lon, p2.lon) - sd,
        minY: Math.min(p1.lat, p2.lat) - sd,
        maxX: Math.max(p1.lon, p2.lon) + sd,
        maxY: Math.max(p1.lat, p2.lat) + sd,
      });

      for (const cand of candidates) {
        // Only check each unordered pair once (j > i)
        if (cand.edgeIdx <= ei) continue;
        checked++;

        const pt = segmentIntersection(p1, p2, cand.p1, cand.p2);
        if (!pt) continue;

        // Angle filter
        const angle = angleBetweenSegs(
          p1.lat, p1.lon, p2.lat, p2.lon,
          cand.p1.lat, cand.p1.lon, cand.p2.lat, cand.p2.lon,
        );
        if (angle < MIN_ANGLE_DEG || angle > MAX_ANGLE_DEG) continue;

        // Same FCODE + small angle → likely same road continuation, skip
        if (e.fcode === cand.fcode && angle < 45) continue;

        intersectionPts.push(pt);
      }
    }
    if (ei % 5000 === 0) {
      console.log(`    processed ${ei}/${rawEdges.length} edges, ${intersectionPts.length} intersections found...`);
    }
  }

  console.log(`  ${intersectionPts.length} geometric intersections detected (${checked} candidate pairs checked)`);

  // ── Phase 2C: Merge all node positions + dedup ────────────────────
  console.log("[build-topology-graph] Phase 2C: Merging and deduplicating nodes...");

  // Collect all candidate positions
  const allPositions: Array<{ lat: number; lon: number }> = [];
  for (const { lat, lon } of rawNodePositions.values()) {
    allPositions.push({ lat, lon });
  }
  for (const pt of intersectionPts) {
    allPositions.push(pt);
  }

  // Dedup with RBush
  const nodeRTree = new RBush<NodeEntry>();
  const deduped: Array<{ lat: number; lon: number }> = [];

  for (const pos of allPositions) {
    const sd = NODE_MERGE_M / 111320;
    const hits = nodeRTree.search({
      minX: pos.lon - sd, minY: pos.lat - sd,
      maxX: pos.lon + sd, maxY: pos.lat + sd,
    });
    let merged = false;
    for (const h of hits) {
      const d = haversineM(pos.lat, pos.lon, h.lat, h.lon);
      if (d < NODE_MERGE_M) {
        merged = true;
        break;
      }
    }
    if (!merged) {
      const idx = deduped.length;
      deduped.push(pos);
      nodeRTree.insert({
        minX: pos.lon, minY: pos.lat, maxX: pos.lon, maxY: pos.lat,
        nodeIdx: idx, lat: pos.lat, lon: pos.lon,
      });
    }
  }

  console.log(`  ${deduped.length} unique nodes after dedup (${allPositions.length} candidates)`);

  // Assign node IDs
  const nodes: TopologyNode[] = deduped.map((p, i) => ({
    id: `nd_${i.toString(16).padStart(4, "0")}`,
    lat: p.lat,
    lon: p.lon,
    type: "ENDPOINT" as const,
    degree: 0,
  }));

  // Build RBush index of nodes for fast lookup
  const nodeTree = new RBush<NodeEntry>();
  for (let i = 0; i < nodes.length; i++) {
    nodeTree.insert({
      minX: nodes[i].lon, minY: nodes[i].lat,
      maxX: nodes[i].lon, maxY: nodes[i].lat,
      nodeIdx: i, lat: nodes[i].lat, lon: nodes[i].lon,
    });
  }

  // ── Phase 2D: Edge splitting ──────────────────────────────────────
  console.log("[build-topology-graph] Phase 2D: Splitting edges at node positions...");

  const edges: TopologyEdge[] = [];
  let edgeCounter = 0;

  for (let ei = 0; ei < rawEdges.length; ei++) {
    const e = rawEdges[ei];
    const poly = e.polyline;
    if (poly.length < 2) continue;

    // Walk along polyline, split when we pass near a node
    let segStartIdx = 0;
    let segStartPos = poly[0];
    let currentFromNode = findNearestNodeIdx(poly[0].lat, poly[0].lon, nodeTree, nodes, 30);
    if (currentFromNode < 0) continue;

    for (let vi = 0; vi < poly.length; vi++) {
      const nodeIdx = findNearestNodeIdx(poly[vi].lat, poly[vi].lon, nodeTree, nodes, NODE_MERGE_M);
      if (nodeIdx < 0) continue;
      if (nodeIdx === currentFromNode) continue;

      // Found a new node — finalize the previous segment
      const fromNodeId = nodes[currentFromNode].id;
      const toNodeId = nodes[nodeIdx].id;

      if (fromNodeId !== toNodeId) {
        const segPoly = poly.slice(segStartIdx, vi + 1);
        if (segPoly.length >= 2) {
          const segLen = polylineKm(segPoly);
          if (segLen > MIN_EDGE_M / 1000) {
            const eid = `eg_${edgeCounter.toString(16).padStart(4, "0")}`;
            edgeCounter++;
            edges.push({
              id: eid,
              fromNode: fromNodeId,
              toNode: toNodeId,
              fcode: e.fcode ?? 0,
              features: e.features,
              lengthKm: segLen,
              polyline: segPoly,
              sourceIds: [e.id],
              source: e.source ?? "DOR",
              sourcePriority: e.sourcePriority ?? 1.0,
            });
          }
        }
      }

      segStartIdx = vi;
      segStartPos = poly[vi];
      currentFromNode = nodeIdx;
    }

    // Final segment to end
    if (segStartIdx < poly.length - 1) {
      const endNodeIdx = findNearestNodeIdx(poly[poly.length - 1].lat, poly[poly.length - 1].lon, nodeTree, nodes, 30);
      if (endNodeIdx >= 0 && endNodeIdx !== currentFromNode) {
        const fromNodeId = nodes[currentFromNode].id;
        const toNodeId = nodes[endNodeIdx].id;
        const segPoly = poly.slice(segStartIdx);
        if (segPoly.length >= 2) {
          const segLen = polylineKm(segPoly);
          if (segLen > MIN_EDGE_M / 1000) {
            const eid = `eg_${edgeCounter.toString(16).padStart(4, "0")}`;
            edgeCounter++;
            edges.push({
              id: eid,
              fromNode: fromNodeId,
              toNode: toNodeId,
              fcode: e.fcode ?? 0,
              features: e.features,
              lengthKm: segLen,
              polyline: segPoly,
              sourceIds: [e.id],
              source: e.source ?? "DOR",
              sourcePriority: e.sourcePriority ?? 1.0,
            });
          }
        }
      }
    }

    if (ei % 5000 === 0) {
      console.log(`    split ${ei}/${rawEdges.length} edges, ${edges.length} topology edges created so far...`);
    }
  }

  console.log(`  ${edges.length} topology edges created`);

  // ── Compute node degrees ─────────────────────────────────────────
  const degMap = new Map<string, number>();
  for (const edge of edges) {
    degMap.set(edge.fromNode, (degMap.get(edge.fromNode) ?? 0) + 1);
    degMap.set(edge.toNode, (degMap.get(edge.toNode) ?? 0) + 1);
  }
  for (const node of nodes) {
    node.degree = degMap.get(node.id) ?? 0;
    if (node.degree >= 3) node.type = "JUNCTION";
  }

  // ── Phase 2E: Canonicalization ────────────────────────────────────
  console.log("[build-topology-graph] Phase 2E: Canonicalizing...");

  // Remove zero-degree nodes
  const validNodeIds = new Set<string>();
  for (const node of nodes) {
    if (node.degree > 0) validNodeIds.add(node.id);
  }
  const filteredNodes = nodes.filter((n) => validNodeIds.has(n.id));
  const filteredEdges = edges.filter(
    (e) => validNodeIds.has(e.fromNode) && validNodeIds.has(e.toNode),
  );

  console.log(`  Removed ${nodes.length - filteredNodes.length} zero-degree nodes`);
  console.log(`  Removed ${edges.length - filteredEdges.length} edges with missing nodes`);

  // Sort for determinism
  filteredNodes.sort((a, b) => a.id.localeCompare(b.id));
  filteredEdges.sort((a, b) => a.id.localeCompare(b.id));

  const graph: TopologyGraph = {
    version: 2,
    generatedAt: new Date().toISOString(),
    nodes: filteredNodes,
    edges: filteredEdges,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(graph, null, 2));
  console.log(`[build-topology-graph] Written to ${OUTPUT_PATH}`);

  const jn = filteredNodes.filter((n) => n.type === "JUNCTION").length;
  const en = filteredNodes.filter((n) => n.type === "ENDPOINT").length;
  const totalKm = filteredEdges.reduce((s, e) => s + e.lengthKm, 0);
  console.log(`  Nodes: ${filteredNodes.length} (${jn} junctions, ${en} endpoints)`);
  console.log(`  Edges: ${filteredEdges.length}`);
  console.log(`  Total km: ${totalKm.toFixed(1)}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function findNearestNodeIdx(
  lat: number,
  lon: number,
  tree: RBush<NodeEntry>,
  nodes: TopologyNode[],
  maxM: number,
): number {
  const sd = maxM / 111320;
  const hits = tree.search({
    minX: lon - sd, minY: lat - sd,
    maxX: lon + sd, maxY: lat + sd,
  });
  if (hits.length === 0) return -1;

  let best = -1;
  let bestDist = maxM;
  for (const h of hits) {
    const d = haversineM(lat, lon, h.lat, h.lon);
    if (d < bestDist) {
      bestDist = d;
      best = h.nodeIdx;
    }
  }
  return best;
}

function polylineKm(poly: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    total += haversineKm(poly[i - 1].lat, poly[i - 1].lon, poly[i].lat, poly[i].lon);
  }
  return +total.toFixed(4);
}

main();
