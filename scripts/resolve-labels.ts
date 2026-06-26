#!/usr/bin/env npx tsx
/**
 * resolve-labels.ts — Stage 4: Label Resolution.
 *
 * Takes anchored-edges.json (edges with candidateLabels[]) and produces
 * the final canonical real-road-graph.json with resolved roadCode.
 *
 * Resolution rules:
 *   1. HIGH-CONF ANCHOR (conf > 0.8): roadCode is LOCKED
 *   2. MEDIUM-CONF PROPAGATION (0.5–0.8): propagate from adjacent anchors
 *      through degree-2 nodes with same FCODE
 *   3. LOW-CONF PROPAGATION (0.3–0.5): propagate only if degree-2 AND
 *      adjacent anchor exists with same roadCode in candidates
 *   4. FCODE FALLBACK: all remaining edges get FCODE-based codes
 *
 * Propagation constraints:
 *   ─ degree-2 node → safe to propagate (simple road continuation)
 *   ─ degree-3+ node → STOP (junction — road identity can change)
 *   ─ FCODE changes → STOP (road type changed)
 *   ─ candidate confidence < 0.3 → STOP (uncertain)
 *
 * Usage:
 *   npx tsx scripts/resolve-labels.ts
 *
 * Input: scripts/data/anchored-edges.json
 * Output: scripts/data/real-road-graph.json
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const ANCHORED_PATH = join(DATA_DIR, "anchored-edges.json");
const OUTPUT_PATH = join(DATA_DIR, "real-road-graph.json");
const DOR_REGISTRY_PATH = join(DATA_DIR, "dor-road-network.json");

const FCODE_TO_TYPE: Record<number, string> = {
  10111: "NATIONAL_HIGHWAY",
  10121: "FEEDER",
  10131: "DISTRICT_ROAD",
  10141: "OTHER_ROAD",
  10511: "BRIDGE",
};

const FCODE_TO_PREFIX: Record<number, string> = {
  10111: "NH",
  10121: "FR",
  10131: "DR",
  10141: "OR",
  10511: "BR",
};

// ─── Types ─────────────────────────────────────────────────────────────

interface TopologyNode {
  id: string;
  lat: number;
  lon: number;
  type: "JUNCTION" | "ENDPOINT";
  degree: number;
}

interface CandidateLabel {
  roadCode: string;
  roadName: string;
  roadType: string;
  confidence: number;
  meanDistanceM: number;
  alignmentScore: number;
}

interface AnchoredEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fcode: number;
  features: string;
  lengthKm: number;
  polyline: Array<{ lat: number; lon: number }>;
  sourceIds: number[];
  candidates: CandidateLabel[];
}

// ─── Output types (real-road-graph.json) ───────────────────────────────

interface ResolvedNode {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: "JUNCTION" | "ENDPOINT";
  degree: number;
  roads: string[];
}

interface ResolvedEdge {
  id: string;
  fromNode: string;
  toNode: string;
  roadCode: string;
  roadName: string;
  roadType: string;
  fcode: number;
  lengthKm: number;
  labelSource: "dor_anchor" | "dor_propagated" | "fcode_fallback";
  labelConfidence: number;
  polyline: Array<{ lat: number; lon: number }>;
}

interface RealRoadGraph {
  version: number;
  generatedAt: string;
  statistics: {
    totalNodes: number;
    totalEdges: number;
    totalKm: number;
    dorAnchored: number;
    dorPropagated: number;
    fcodeFallback: number;
    junctionNodes: number;
    endpointNodes: number;
  };
  nodes: ResolvedNode[];
  edges: ResolvedEdge[];
}

// ─── Helpers ───────────────────────────────────────────────────────────

function getRoadTypeFromFcode(fcode: number): string {
  return FCODE_TO_TYPE[fcode] ?? "OTHER";
}

function getFcodePrefix(fcode: number): string {
  return FCODE_TO_PREFIX[fcode] ?? "XX";
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("[resolve-labels] Reading anchored edges...");
  const anchored: { nodes: TopologyNode[]; edges: AnchoredEdge[] } = JSON.parse(
    readFileSync(ANCHORED_PATH, "utf-8"),
  );
  console.log(`  ${anchored.edges.length} edges, ${anchored.nodes.length} nodes`);

  // Load DOR registry for road metadata
  const dorRegistry: Array<{ roadCode: string; name: string; roadType: string }> = JSON.parse(
    readFileSync(DOR_REGISTRY_PATH, "utf-8"),
  );
  const roadMeta = new Map<string, { name: string; roadType: string }>();
  for (const r of dorRegistry) {
    roadMeta.set(r.roadCode, { name: r.name, roadType: r.roadType });
  }

  // Build adjacency: nodeId → incident edge IDs
  const nodeEdges = new Map<string, string[]>();
  for (const e of anchored.edges) {
    if (!nodeEdges.has(e.fromNode)) nodeEdges.set(e.fromNode, []);
    if (!nodeEdges.has(e.toNode)) nodeEdges.set(e.toNode, []);
    nodeEdges.get(e.fromNode)!.push(e.id);
    nodeEdges.get(e.toNode)!.push(e.id);
  }

  // ── Phase 1: Lock high-confidence anchors ─────────────────────────
  console.log("[resolve-labels] Phase 1: Locking high-confidence anchors...");

  const resolvedLabels = new Map<string, { roadCode: string; roadName: string; roadType: string; source: "dor_anchor" | "dor_propagated" | "fcode_fallback"; confidence: number }>();

  for (const e of anchored.edges) {
    const top = e.candidates[0];
    if (top && top.confidence > 0.8) {
      const meta = roadMeta.get(top.roadCode);
      resolvedLabels.set(e.id, {
        roadCode: top.roadCode,
        roadName: meta?.name ?? top.roadName,
        roadType: meta?.roadType ?? top.roadType,
        source: "dor_anchor",
        confidence: top.confidence,
      });
    }
  }

  console.log(`  ${resolvedLabels.size} high-confidence anchors locked`);

  // ── Phase 2: Propagate labels through degree-2 nodes ──────────────
  console.log("[resolve-labels] Phase 2: Propagating labels...");

  const nodeMap = new Map<string, TopologyNode>();
  for (const n of anchored.nodes) nodeMap.set(n.id, n);

  let propagated = 0;
  let changed = true;

  // Iterative propagation until stable
  while (changed) {
    changed = false;

    for (const e of anchored.edges) {
      if (resolvedLabels.has(e.id)) continue; // already resolved
      if (e.candidates.length === 0) continue; // no candidates

      const topCandidate = e.candidates[0];
      if (topCandidate.confidence < 0.3) continue; // too uncertain

      // Check if either endpoint is degree-2 and has a resolved neighbor
      for (const nodeId of [e.fromNode, e.toNode]) {
        const node = nodeMap.get(nodeId);
        if (!node || node.degree !== 2) continue;

        const incident = nodeEdges.get(nodeId) ?? [];
        if (incident.length !== 2) continue;

        const otherEdgeId = incident.find((id) => id !== e.id);
        if (!otherEdgeId) continue;

        const otherLabel = resolvedLabels.get(otherEdgeId);
        if (!otherLabel) continue;

        // Only propagate if same roadCode appears in THIS edge's candidates
        const matchingCandidate = e.candidates.find(
          (c) => c.roadCode === otherLabel.roadCode,
        );
        if (!matchingCandidate) continue;

        // Check FCODE consistency
        const otherEdge = anchored.edges.find((x) => x.id === otherEdgeId);
        if (otherEdge && otherEdge.fcode !== e.fcode) continue;

        const meta = roadMeta.get(otherLabel.roadCode);
        resolvedLabels.set(e.id, {
          roadCode: otherLabel.roadCode,
          roadName: meta?.name ?? otherLabel.roadName,
          roadType: meta?.roadType ?? otherLabel.roadType,
          source: "dor_propagated",
          confidence: matchingCandidate.confidence,
        });
        propagated++;
        changed = true;
        break;
      }
    }
  }

  console.log(`  ${propagated} labels propagated through degree-2 nodes`);

  // ── Phase 3: Assign FCODE fallbacks (share roadCode by type, not per-edge) ──
  console.log("[resolve-labels] Phase 3: Assigning FCODE fallbacks...");

  const fcodeCounts = new Map<string, number>();

  for (const e of anchored.edges) {
    if (resolvedLabels.has(e.id)) continue;

    const prefix = getFcodePrefix(e.fcode);
    const count = (fcodeCounts.get(prefix) ?? 0) + 1;
    fcodeCounts.set(prefix, count);

    const roadCode = prefix;
    resolvedLabels.set(e.id, {
      roadCode,
      roadName: `${e.features} (${prefix})`,
      roadType: getRoadTypeFromFcode(e.fcode),
      source: "fcode_fallback",
      confidence: 0.3,
    });
  }

  console.log(`  ${anchored.edges.length - resolvedLabels.size} edges remain unresolved (should be 0)`);
  console.log(`  FCODE fallbacks:`);
  for (const [prefix, count] of fcodeCounts) {
    console.log(`    ${prefix}: ${count}`);
  }

  // ── Build resolved graph ──────────────────────────────────────────
  console.log("[resolve-labels] Building final graph...");

  // Determine which roads serve each node
  const nodeRoads = new Map<string, Set<string>>();
  for (const e of anchored.edges) {
    const label = resolvedLabels.get(e.id);
    if (!label) continue;
    if (!nodeRoads.has(e.fromNode)) nodeRoads.set(e.fromNode, new Set());
    if (!nodeRoads.has(e.toNode)) nodeRoads.set(e.toNode, new Set());
    nodeRoads.get(e.fromNode)!.add(label.roadCode);
    nodeRoads.get(e.toNode)!.add(label.roadCode);
  }

  // Build resolved nodes
  const resolvedNodes: ResolvedNode[] = [];
  const nodeNameMap = new Map<string, string>(); // nodeId → name

  // Name nodes: use "J_{n}" for junctions, "E_{n}" for endpoints
  let junctionIdx = 0;
  let endpointIdx = 0;
  for (const n of anchored.nodes) {
    const roads = [...(nodeRoads.get(n.id) ?? new Set())].sort();
    const name =
      n.type === "JUNCTION"
        ? `J_${junctionIdx++}`
        : `E_${endpointIdx++}`;

    nodeNameMap.set(n.id, name);
    resolvedNodes.push({
      id: n.id,
      name,
      lat: n.lat,
      lon: n.lon,
      type: n.type,
      degree: n.degree,
      roads,
    });
  }

  // Build resolved edges
  const resolvedEdges: ResolvedEdge[] = [];
  for (const e of anchored.edges) {
    const label = resolvedLabels.get(e.id);
    if (!label) continue;

    resolvedEdges.push({
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
      roadCode: label.roadCode,
      roadName: label.roadName,
      roadType: label.roadType,
      fcode: e.fcode,
      lengthKm: e.lengthKm,
      labelSource: label.source,
      labelConfidence: label.confidence,
      polyline: e.polyline,
    });
  }

  // ── Statistics ────────────────────────────────────────────────────
  const stats = {
    totalNodes: resolvedNodes.length,
    totalEdges: resolvedEdges.length,
    totalKm: +resolvedEdges.reduce((s, e) => s + e.lengthKm, 0).toFixed(1),
    dorAnchored: resolvedEdges.filter((e) => e.labelSource === "dor_anchor").length,
    dorPropagated: resolvedEdges.filter((e) => e.labelSource === "dor_propagated").length,
    fcodeFallback: resolvedEdges.filter((e) => e.labelSource === "fcode_fallback").length,
    junctionNodes: resolvedNodes.filter((n) => n.type === "JUNCTION").length,
    endpointNodes: resolvedNodes.filter((n) => n.type === "ENDPOINT").length,
  };

  console.log(`  Nodes: ${stats.totalNodes} (${stats.junctionNodes} junctions, ${stats.endpointNodes} endpoints)`);
  console.log(`  Edges: ${stats.totalEdges}`);
  console.log(`  Total km: ${stats.totalKm}`);
  console.log(`  Labels: ${stats.dorAnchored} anchors, ${stats.dorPropagated} propagated, ${stats.fcodeFallback} FCODE fallbacks`);

  // Sort for determinism
  resolvedNodes.sort((a, b) => a.id.localeCompare(b.id));
  resolvedEdges.sort((a, b) => a.id.localeCompare(b.id));

  const graph: RealRoadGraph = {
    version: 2,
    generatedAt: new Date().toISOString(),
    statistics: stats,
    nodes: resolvedNodes,
    edges: resolvedEdges,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(graph, null, 2));
  console.log(`[resolve-labels] Written to ${OUTPUT_PATH}`);
}

main();
