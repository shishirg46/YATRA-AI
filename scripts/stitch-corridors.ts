#!/usr/bin/env npx tsx
/**
 * stitch-corridors.ts — Stage 3.7: Highway Continuity Reconstruction.
 *
 * Converts fragmented labeled edges into continuous highway chains by
 * walking same-roadCode subgraphs with intent-preserving traversal.
 *
 * Stops (in priority order):
 *   HARD: no outgoing edge, roadCode change, edge already visited
 *   SOFT: degree ≥ 3 with weak continuity score, confidence < 0.65
 *   CONTINUE: degree ≥ 3 with strong continuity score + confidence ≥ 0.65
 *
 * Continuity bias score: 0.4×sameRoadCode + 0.4×straightness + 0.2×confidence
 * Threshold: 0.6, confidence gate: 0.65
 *
 * Output: scripts/data/stitched-corridors.json
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { haversineKm } from "../lib/routing/geo";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const CORRIDORS_DIR = join(DATA_DIR, "corridors");
const ANCHORED_PATH = join(DATA_DIR, "anchored-edges.json");
const DOR_REGISTRY_PATH = join(DATA_DIR, "dor-road-network.json");
const OUTPUT_PATH = join(DATA_DIR, "stitched-corridors.json");

const CONFIDENCE_MIN = 0.5;

// ─── Types ─────────────────────────────────────────────────────────────

interface CandidateLabel {
  roadCode: string;
  roadName: string;
  roadType: string;
  confidence: number;
  meanDistanceM: number;
  alignmentScore: number;
}

interface TopologyNode {
  id: string;
  lat: number;
  lon: number;
  type: "JUNCTION" | "ENDPOINT";
  degree: number;
}

interface AnchoredEdge {
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
  candidates: CandidateLabel[];
}

interface CorridorNode {
  name: string;
  lat: number;
  lon: number;
  type: string;
}

interface CorridorDef {
  id: string;
  name: string;
  highway: string;
  nodes: CorridorNode[];
}

interface DORRoad {
  roadCode: string;
  name: string;
  roadType: string;
  fromPlace: string;
  toPlace: string;
  waypoints: Array<{ lat: number; lon: number }>;
  lengthKm: number;
}

interface CorridorSegment {
  id: string;
  roadCode: string;
  roadName: string;
  fromNode: string;
  toNode: string;
  fromPlace: string;
  toPlace: string;
  edgeIds: string[];
  nodeIds: string[];
  polyline: Array<{ lat: number; lon: number }>;
  lengthKm: number;
  edgeCount: number;
  meanConfidence: number;
}

interface StitchedCorridor {
  roadCode: string;
  roadName: string;
  segments: CorridorSegment[];
  totalKm: number;
  totalEdges: number;
}

interface StitchedCorridorsOutput {
  version: number;
  generatedAt: string;
  corridors: StitchedCorridor[];
}

// ─── Geometry helpers ──────────────────────────────────────────────────

function edgeLengthKm(poly: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    total += haversineKm(poly[i - 1].lat, poly[i - 1].lon, poly[i].lat, poly[i].lon);
  }
  return total;
}

function polylineConcat(
  segments: Array<Array<{ lat: number; lon: number }>>,
): Array<{ lat: number; lon: number }> {
  if (segments.length === 0) return [];
  const result = [...segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const last = result[result.length - 1];
    const first = segments[i][0];
    if (last.lat !== first.lat || last.lon !== first.lon) {
      result.push(first);
    }
    for (let j = 1; j < segments[i].length; j++) {
      result.push(segments[i][j]);
    }
  }
  return result;
}

// ─── BFS component collection ──────────────────────────────────────────
// Replaces the previous chain-walking approach. Finds true topology
// connected components of the same-roadCode subgraph.

// ─── Place naming ──────────────────────────────────────────────────────

// Map from corridor highway name to DOR roadCode(s)
const CORRIDOR_TO_ROADCODE: Record<string, string[]> = {
  mahendra: ["NH01"],
  bp: ["NH03"],
  "mid-hill": ["NH04"],
  siddhartha: ["NH10"],
  prithvi: ["NH17"],
};

function buildPlaceIndex(
  corridorFiles: string[],
): Map<string, Array<{ name: string; lat: number; lon: number; index: number }>> {
  const index = new Map<string, Array<{ name: string; lat: number; lon: number; index: number }>>();

  for (const cf of corridorFiles) {
    const corridor: CorridorDef = JSON.parse(
      readFileSync(join(CORRIDORS_DIR, cf), "utf-8"),
    );
    const corridorName = corridor.highway;
    if (!corridorName) continue;
    const roadCodes = CORRIDOR_TO_ROADCODE[corridorName];
    if (!roadCodes || roadCodes.length === 0) continue;

    const entries = corridor.nodes.map((n, i) => ({
      name: n.name,
      lat: n.lat,
      lon: n.lon,
      index: i,
    }));

    for (const rc of roadCodes) {
      index.set(rc, entries);
    }
  }

  return index;
}

function findPlaceName(
  lat: number,
  lon: number,
  placeIndex: Array<{ name: string; lat: number; lon: number; index: number }>,
): string {
  let best: { name: string; index: number; dist: number } | null = null;
  for (const p of placeIndex) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (!best || d < best.dist) {
      best = { name: p.name, index: p.index, dist: d };
    }
  }
  if (!best) return "unknown";
  if (best.dist < 5) return best.name;
  return `${best.name}-wp${best.index}`;
}

function buildSegmentId(roadCode: string, index: number): string {
  return `${roadCode}_seg_${index}`;
}

// ─── Segment merging ────────────────────────────────────────────────────

interface SegEndpoint {
  index: number;
  node: string;
  isFrom: boolean;
}

function mergeConnectedSegments(
  segs: CorridorSegment[],
  roadCode: string,
): CorridorSegment[] {
  if (segs.length <= 1) return segs;

  // Build node-to-segment adjacency using ALL nodes touched by each segment's edges.
  // Segments that share ANY topology node belong to the same roadCode connected
  // component and should be merged.
  const nodeSegs = new Map<string, number[]>();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (const nodeId of s.nodeIds) {
      if (!nodeSegs.has(nodeId)) nodeSegs.set(nodeId, []);
      nodeSegs.get(nodeId)!.push(i);
    }
  }

  // Find connected components of the segment graph
  const visited = new Set<number>();
  const components: number[][] = [];

  for (let i = 0; i < segs.length; i++) {
    if (visited.has(i)) continue;
    const comp: number[] = [];
    const stack = [i];
    visited.add(i);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      comp.push(idx);
      const s = segs[idx];
    for (const nodeId of s.nodeIds) {
      for (const neighborIdx of (nodeSegs.get(nodeId) ?? [])) {
        if (!visited.has(neighborIdx)) {
          visited.add(neighborIdx);
          stack.push(neighborIdx);
        }
      }
    }
    }
    components.push(comp);
  }

  // Merge each component into one segment
  const merged: CorridorSegment[] = [];
  for (const comp of components) {
    if (comp.length === 1) {
      merged.push(segs[comp[0]]);
      continue;
    }

    const compSegs = comp.map(idx => segs[idx]);
    const allEdgeIds = compSegs.flatMap(s => s.edgeIds);
    const mergedPoly = polylineConcat(compSegs.map(s => s.polyline));
    const lengthKm = +edgeLengthKm(mergedPoly).toFixed(3);
    const meanConfidence = +(
      compSegs.reduce((sum, s) => sum + s.meanConfidence, 0) / compSegs.length
    ).toFixed(3);

    // Use the first segment's fromNode and last segment's toNode (order by east→west)
    compSegs.sort((a, b) => {
      const aLon = a.polyline[Math.floor(a.polyline.length / 2)]?.lon ?? 0;
      const bLon = b.polyline[Math.floor(b.polyline.length / 2)]?.lon ?? 0;
      return bLon - aLon;
    });

    const mergedNodeIds = [...new Set(compSegs.flatMap(s => s.nodeIds))];
    merged.push({
      id: buildSegmentId(roadCode, merged.length),
      roadCode: compSegs[0].roadCode,
      roadName: compSegs[0].roadName,
      fromNode: compSegs[0].fromNode,
      toNode: compSegs[compSegs.length - 1].toNode,
      fromPlace: compSegs[0].fromPlace,
      toPlace: compSegs[compSegs.length - 1].toPlace,
      edgeIds: allEdgeIds,
      nodeIds: mergedNodeIds,
      polyline: mergedPoly,
      lengthKm,
      edgeCount: allEdgeIds.length,
      meanConfidence,
    });
  }

  return merged;
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("[stitch-corridors] Reading anchored edges...");
  const anchored: { nodes: TopologyNode[]; edges: AnchoredEdge[] } = JSON.parse(
    readFileSync(ANCHORED_PATH, "utf-8"),
  );
  console.log(`  ${anchored.edges.length} edges, ${anchored.nodes.length} nodes`);

  // Load DOR road registry for road metadata
  console.log("[stitch-corridors] Reading DOR road registry...");
  const dorRegistry: DORRoad[] = JSON.parse(readFileSync(DOR_REGISTRY_PATH, "utf-8"));
  const roadMeta = new Map<string, { name: string; fromPlace: string; toPlace: string }>();
  for (const r of dorRegistry) {
    roadMeta.set(r.roadCode, { name: r.name, fromPlace: r.fromPlace, toPlace: r.toPlace });
  }

  // Load corridor files for place naming
  console.log("[stitch-corridors] Building place index from corridor files...");
  const corridorFiles = readdirSync(CORRIDORS_DIR).filter(
    (f) => f.endsWith(".json") && f !== "index.ts",
  );
  const placeIndex = buildPlaceIndex(corridorFiles);

  // ── Group edges by best candidate roadCode ─────────────────────────
  console.log("[stitch-corridors] Grouping edges by roadCode...");
  const roadCodeEdges = new Map<string, AnchoredEdge[]>();

  for (const edge of anchored.edges) {
    const top = edge.candidates[0];
    if (!top || top.confidence < CONFIDENCE_MIN) continue;
    if (!roadCodeEdges.has(top.roadCode)) {
      roadCodeEdges.set(top.roadCode, []);
    }
    roadCodeEdges.get(top.roadCode)!.push(edge);
  }

  console.log(`  Found ${roadCodeEdges.size} road codes with labeled edges`);

  // ── Process each roadCode ─────────────────────────────────────────
  const corridors: StitchedCorridor[] = [];
  let totalSegments = 0;

  for (const [roadCode, edges] of roadCodeEdges) {
    if (edges.length < 2) continue;

    console.log(`\n[stitch-corridors] Processing ${roadCode} (${edges.length} edges)...`);

    const meta = roadMeta.get(roadCode);
    const placeEntries = placeIndex.get(roadCode) ?? [];

    // Build subgraph adjacency: nodeId → edges (same roadCode, unvisited)
    const subgraphAtNode = new Map<string, AnchoredEdge[]>();
    const subgraphEdges = new Map<string, AnchoredEdge>();

    for (const e of edges) {
      subgraphEdges.set(e.id, e);
      if (!subgraphAtNode.has(e.fromNode)) subgraphAtNode.set(e.fromNode, []);
      if (!subgraphAtNode.has(e.toNode)) subgraphAtNode.set(e.toNode, []);
      subgraphAtNode.get(e.fromNode)!.push(e);
      subgraphAtNode.get(e.toNode)!.push(e);
    }

    // Find connected components via BFS (true topology components, not branch-traced chains)
    const visited = new Set<string>();
    let segments: CorridorSegment[] = [];
    let segCounter = 0;

    function collectComponent(
      seedId: string,
    ): string[] {
      const comp: string[] = [];
      const queue = [seedId];
      visited.add(seedId);
      while (queue.length > 0) {
        const eid = queue.shift()!;
        comp.push(eid);
        const ce = subgraphEdges.get(eid);
        if (!ce) continue;
        for (const nid of [ce.fromNode, ce.toNode]) {
          for (const neighbor of (subgraphAtNode.get(nid) ?? [])) {
            if (!visited.has(neighbor.id)) {
              visited.add(neighbor.id);
              queue.push(neighbor.id);
            }
          }
        }
      }
      return comp;
    }

    for (const e of edges) {
      if (visited.has(e.id)) continue;

      const component = collectComponent(e.id);
      if (component.length === 0) continue;

      const compEdges = component
        .map((eid) => subgraphEdges.get(eid)!)
        .filter(Boolean);
      if (compEdges.length === 0) continue;

      const firstEdge = compEdges[0];
      const lastEdge = compEdges[compEdges.length - 1];

      // Collect all distinct nodes touched by the component's edges
      const nodeIds = [...new Set(compEdges.flatMap(ce => [ce.fromNode, ce.toNode]))];

      const polyline = polylineConcat(compEdges.map((ce) => ce.polyline));
      const lengthKm = +edgeLengthKm(polyline).toFixed(3);
      const meanConfidence = +(
        compEdges.reduce((s, ce) => s + (ce.candidates[0]?.confidence ?? 0), 0) /
        compEdges.length
      ).toFixed(3);

      // Place naming using component endpoints ordered east→west
      const fromPoint = compEdges[0].polyline[0];
      const toPoint = lastEdge.polyline[lastEdge.polyline.length - 1];
      const fromPlace = findPlaceName(fromPoint.lat, fromPoint.lon, placeEntries)
        || (meta?.fromPlace ?? `Node ${firstEdge.fromNode}`);
      const toPlace = findPlaceName(toPoint.lat, toPoint.lon, placeEntries)
        || (meta?.toPlace ?? `Node ${lastEdge.toNode}`);

      segments.push({
        id: buildSegmentId(roadCode, segCounter),
        roadCode,
        roadName: meta?.name ?? roadCode,
        fromNode: firstEdge.fromNode,
        toNode: lastEdge.toNode,
        fromPlace,
        toPlace,
        edgeIds: component,
        nodeIds,
        polyline,
        lengthKm,
        edgeCount: compEdges.length,
        meanConfidence,
      });

      segCounter++;
    }

    // Sort segments by midpoint longitude as a rough east→west ordering
    segments.sort((a, b) => {
      const aLon =
        a.polyline[Math.floor(a.polyline.length / 2)]?.lon ?? 0;
      const bLon =
        b.polyline[Math.floor(b.polyline.length / 2)]?.lon ?? 0;
      return bLon - aLon; // east to west
    });

    // Merge consecutive segments that connect at shared nodes
    const preMergeCount = segments.length;
    segments = mergeConnectedSegments(segments, roadCode);
    if (segments.length < preMergeCount) {
      console.log(`  merged ${preMergeCount - segments.length} segments via node-connection`);
    }

    const totalKm = +segments.reduce((s, seg) => s + seg.lengthKm, 0).toFixed(1);
    const totalEdges = segments.reduce((s, seg) => s + seg.edgeCount, 0);

    corridors.push({
      roadCode,
      roadName: meta?.name ?? roadCode,
      segments,
      totalKm,
      totalEdges,
    });

    totalSegments += segments.length;

    console.log(
      `  → ${segments.length} segments, ${totalKm} km, ${totalEdges} edges`,
    );
    for (const seg of segments) {
      console.log(`    ${seg.id}: ${seg.fromPlace} → ${seg.toPlace} (${seg.lengthKm} km, conf=${seg.meanConfidence})`);
    }
  }

  // ── Write output ───────────────────────────────────────────────────
  const output: StitchedCorridorsOutput = {
    version: 1,
    generatedAt: new Date().toISOString(),
    corridors,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n[stitch-corridors] Written to ${OUTPUT_PATH}`);
  console.log(`  ${corridors.length} corridors, ${totalSegments} total segments`);
}

main();
