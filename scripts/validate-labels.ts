#!/usr/bin/env npx tsx
/**
 * validate-labels.ts — Stage 3.5: Frozen Measurement System.
 *
 * Evaluates anchored-edges.json (candidate labels) against known ground
 * truth (corridor files) and global structural metrics.
 *
 * INVARIANTS (MUST NEVER VIOLATE):
 *   ❌ No label mutation
 *   ❌ No topology correction
 *   ❌ No heuristic "fixing"
 *   ❌ No smoothing of failures
 *   ✅ Only scoring + reporting + gating
 *
 * If this suggests a fix, that fix belongs to Stage 2 or Stage 3.
 *
 * Usage:
 *   npx tsx scripts/validate-labels.ts
 *
 * Input:
 *   anchored-edges.json (from Stage 3)
 *   corridors/*.json (6 manually-curated highway corridor definitions)
 *
 * Output: scripts/data/validation-report.json (read-only report)
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const CORRIDORS_DIR = join(DATA_DIR, "corridors");
const ANCHORED_PATH = join(DATA_DIR, "anchored-edges.json");
const OUTPUT_PATH = join(DATA_DIR, "validation-report.json");

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

// ─── Report types ─────────────────────────────────────────────────────

interface CorridorResult {
  corridorId: string;
  corridorName: string;
  dorRoadCode: string | null;
  totalWaypoints: number;
  matchedWaypoints: number;
  recall: number;
  precision: number;
  continuityKm: number;
  totalKm: number;
  continuityRatio: number;
  meanConfidence: number;
  status: "PASS" | "FAIL";
}

interface GlobalMetrics {
  totalNodes: number;
  totalEdges: number;
  edgesWithLabels: number;
  edgesWithLabelsPct: number;
  unresolvedLabelRate: number;
  avgCandidateCount: number;
  avgTopCandidateConfidence: number;
  junctionConflictRate: number;
  avgCandidateEntropy: number;
  avgJunctionLabelInstability: number;
  highConflictJunctions: number;
}

interface PerRoadScore {
  roadCode: string;
  roadName: string;
  totalEdges: number;
  totalKm: number;
  highConfEdges: number;
  components: number;
  longestComponentKm: number;
  fragmentationScore: number;
  oscillations: number;
  oscillationRate: number;
  meanConfidence: number;
}

interface ValidationReport {
  version: number;
  generatedAt: string;
  gatingDecision: "PASS" | "FAIL" | "CONDITIONAL";
  summary: {
    corridorHighways: { passed: number; total: number };
    globalGates: { passed: number; total: number };
    corridorResults: CorridorResult[];
    globalMetrics: GlobalMetrics;
    perRoadScores: PerRoadScore[];
  };
  gates: {
    corridorRecall: boolean;
    corridorPrecision: boolean;
    corridorContinuity: boolean;
    unresolvedLabelRate: boolean;
    junctionConflictRate: boolean;
    junctionLabelInstability: boolean;
  };
}

// ─── Gate thresholds ──────────────────────────────────────────────────

const THRESHOLDS = {
  corridorRecall: 0.50,        // 50% of corridor waypoints on matched edges
  corridorPrecision: 0.70,     // 70% of matched edges correct
  corridorContinuity: 0.40,    // 40% of corridor length in contiguous labeled segments
  unresolvedLabelRate: 0.85,   // < 85% unresolved is OK (15%+ labeled is okay for sparse seeds)
  junctionConflictRate: 0.30,  // < 30% of junctions have label conflicts
  junctionLabelInstability: 0.50, // < 0.5 average instability
};

// ─── DOR road code mapping for corridors ──────────────────────────────

const CORRIDOR_TO_DOR: Record<string, string> = {
  "east-west-highway": "NH01",
  "mid-hill-highway": "NH04",
  "prithvi-highway": "NH17",
  "kaligandaki-corridor": "NH11",
  "siddhartha-highway": "NH10",
  "bp-highway": "NH03",
};

// ─── Helpers ──────────────────────────────────────────────────────────

import { haversineM } from "../lib/routing/geo";

function findNearestEdge(
  lat: number,
  lon: number,
  edges: AnchoredEdge[],
  maxM: number,
): AnchoredEdge | null {
  let best: AnchoredEdge | null = null;
  let bestDist = maxM;
  for (const e of edges) {
    for (const v of e.polyline) {
      const d = haversineM(lat, lon, v.lat, v.lon);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
  }
  return best;
}

function entropy(probs: number[]): number {
  let e = 0;
  for (const p of probs) {
    if (p > 0) e -= p * Math.log2(p);
  }
  return e;
}

// ─── Main ─────────────────────────────────────────────────────────────

function main() {
  console.log("[validate-labels] Reading anchored edges...");
  const anchored: { nodes: TopologyNode[]; edges: AnchoredEdge[] } = JSON.parse(
    readFileSync(ANCHORED_PATH, "utf-8"),
  );
  console.log(`  ${anchored.edges.length} edges, ${anchored.nodes.length} nodes`);

  // Build node lookup
  const nodeMap = new Map<string, TopologyNode>();
  for (const n of anchored.nodes) nodeMap.set(n.id, n);

  // Build edge adjacency: nodeId → outgoing edges
  const adjFrom = new Map<string, string[]>();
  for (const e of anchored.edges) {
    if (!adjFrom.has(e.fromNode)) adjFrom.set(e.fromNode, []);
    adjFrom.get(e.fromNode)!.push(e.id);
  }

  // ── A. Corridor validation ───────────────────────────────────────
  console.log("[validate-labels] Evaluating corridor highways...");
  const corridorFiles = readdirSync(CORRIDORS_DIR).filter((f) => f.endsWith(".json") && f !== "index.ts");
  const corridorResults: CorridorResult[] = [];

  for (const cf of corridorFiles) {
    const corridor: CorridorDef = JSON.parse(
      readFileSync(join(CORRIDORS_DIR, cf), "utf-8"),
    );
    const dorCode = CORRIDOR_TO_DOR[corridor.id] ?? null;

    let matchedWp = 0;
    let totalConf = 0;
    let matchedConfCount = 0;
    let correctLabelCount = 0;
    let totalLabeledEdgesInCorridor = 0;

    // For continuity tracking
    interface SegSpan { edgeId: string; roadCode: string; km: number }
    const continuitySegs: SegSpan[] = [];

    for (const wp of corridor.nodes) {
      const nearest = findNearestEdge(wp.lat, wp.lon, anchored.edges, 5000);
      if (!nearest) continue;

      const topCandidate = nearest.candidates[0];
      if (topCandidate && topCandidate.confidence > 0.5) {
        matchedWp++;
        totalConf += topCandidate.confidence;
        matchedConfCount++;

        if (dorCode && topCandidate.roadCode === dorCode) {
          correctLabelCount++;
        }

        continuitySegs.push({
          edgeId: nearest.id,
          roadCode: topCandidate.roadCode,
          km: nearest.lengthKm,
        });
      }
    }

    // Compute continuity: longest run of consecutive same-roadCode segments
    let longestRunKm = 0;
    let currentRunKm = 0;
    let currentRoadCode = "";
    for (const seg of continuitySegs) {
      if (seg.roadCode === currentRoadCode) {
        currentRunKm += seg.km;
      } else {
        currentRunKm = seg.km;
        currentRoadCode = seg.roadCode;
      }
      if (currentRunKm > longestRunKm) longestRunKm = currentRunKm;
    }

    const totalKm = continuitySegs.reduce((s, seg) => s + seg.km, 0);
    const recall = corridor.nodes.length > 0 ? matchedWp / corridor.nodes.length : 0;
    const precision = matchedConfCount > 0 ? correctLabelCount / matchedConfCount : 0;
    const continuityRatio = totalKm > 0 ? longestRunKm / totalKm : 0;

    const meanConf = matchedConfCount > 0 ? totalConf / matchedConfCount : 0;

    corridorResults.push({
      corridorId: corridor.id,
      corridorName: corridor.name,
      dorRoadCode: dorCode,
      totalWaypoints: corridor.nodes.length,
      matchedWaypoints: matchedWp,
      recall: +recall.toFixed(3),
      precision: +precision.toFixed(3),
      continuityKm: +longestRunKm.toFixed(1),
      totalKm: +totalKm.toFixed(1),
      continuityRatio: +continuityRatio.toFixed(3),
      meanConfidence: +meanConf.toFixed(3),
      status: recall >= THRESHOLDS.corridorRecall && precision >= THRESHOLDS.corridorPrecision ? "PASS" : "FAIL",
    });

    const statusIcon = corridorResults[corridorResults.length - 1].status === "PASS" ? "✔" : "✗";
    console.log(`  ${statusIcon} ${corridor.id}: recall=${recall.toFixed(3)} precision=${precision.toFixed(3)} continuity=${continuityRatio.toFixed(3)}`);
  }

  // ── B. Global structural metrics ─────────────────────────────────
  console.log("[validate-labels] Computing global structural metrics...");

  const edgesWithLabels = anchored.edges.filter((e) => e.candidates.length > 0).length;
  const unresolvedLabelRate = 1 - edgesWithLabels / anchored.edges.length;

  // Candidate entropy per edge
  let totalEntropy = 0;
  let entropyCount = 0;
  for (const e of anchored.edges) {
    if (e.candidates.length > 1) {
      const total = e.candidates.reduce((s, c) => s + c.confidence, 0);
      const probs = e.candidates.map((c) => c.confidence / total);
      totalEntropy += entropy(probs);
      entropyCount++;
    }
  }
  const avgEntropy = entropyCount > 0 ? totalEntropy / entropyCount : 0;

  // Average top candidate confidence
  let totalTopConf = 0;
  let topConfCount = 0;
  for (const e of anchored.edges) {
    if (e.candidates.length > 0) {
      totalTopConf += e.candidates[0].confidence;
      topConfCount++;
    }
  }
  const avgTopConf = topConfCount > 0 ? totalTopConf / topConfCount : 0;

  // Junction conflict rate: junctions where incident edges have multiple high-confidence labels
  let junctionConflictCount = 0;
  let junctionCount = 0;
  let totalInstability = 0;
  let instabilityCount = 0;
  let highConflictJunctions = 0;

  for (const node of anchored.nodes) {
    if (node.degree < 2) continue;
    junctionCount++;

    const incidentEdges = adjFrom.get(node.id) ?? [];
    const roadCodesAtNode = new Set<string>();
    for (const eid of incidentEdges) {
      const edge = anchored.edges.find((e) => e.id === eid);
      if (!edge) continue;
      for (const c of edge.candidates) {
        if (c.confidence > 0.8) {
          roadCodesAtNode.add(c.roadCode);
        }
      }
    }

    if (roadCodesAtNode.size > 1) junctionConflictCount++;
    if (roadCodesAtNode.size > 2) highConflictJunctions++;

    // Junction label instability: distinct outgoing roadCode transitions / degree
    const outgoingEdges = adjFrom.get(node.id) ?? [];
    const outgoingRoadCodes = new Set<string>();
    for (const eid of outgoingEdges) {
      const edge = anchored.edges.find((e) => e.id === eid);
      if (!edge || edge.candidates.length === 0) continue;
      outgoingRoadCodes.add(edge.candidates[0].roadCode);
    }
    if (node.degree > 0 && outgoingRoadCodes.size > 0) {
      totalInstability += outgoingRoadCodes.size / node.degree;
      instabilityCount++;
    }
  }

  const junctionConflictRate = junctionCount > 0 ? junctionConflictCount / junctionCount : 0;
  const avgInstability = instabilityCount > 0 ? totalInstability / instabilityCount : 0;

  const globalMetrics: GlobalMetrics = {
    totalNodes: anchored.nodes.length,
    totalEdges: anchored.edges.length,
    edgesWithLabels,
    edgesWithLabelsPct: +((edgesWithLabels / anchored.edges.length) * 100).toFixed(1),
    unresolvedLabelRate: +unresolvedLabelRate.toFixed(4),
    avgCandidateCount: +(anchored.edges.reduce((s, e) => s + e.candidates.length, 0) / anchored.edges.length).toFixed(2),
    avgTopCandidateConfidence: +avgTopConf.toFixed(3),
    junctionConflictRate: +junctionConflictRate.toFixed(4),
    avgCandidateEntropy: +avgEntropy.toFixed(3),
    avgJunctionLabelInstability: +avgInstability.toFixed(3),
    highConflictJunctions,
  };

  console.log(`  Unresolved label rate: ${(unresolvedLabelRate * 100).toFixed(1)}%`);
  console.log(`  Junction conflict rate: ${(junctionConflictRate * 100).toFixed(1)}%`);
  console.log(`  Avg instability: ${avgInstability.toFixed(3)}`);

  // ── C. Per-road scores ───────────────────────────────────────────
  console.log("[validate-labels] Computing per-road scores...");

  const roadEdges = new Map<string, AnchoredEdge[]>();
  for (const e of anchored.edges) {
    if (e.candidates.length === 0) continue;
    const rc = e.candidates[0].roadCode;
    if (!roadEdges.has(rc)) roadEdges.set(rc, []);
    roadEdges.get(rc)!.push(e);
  }

  const perRoadScores: PerRoadScore[] = [];

  for (const [roadCode, edges] of roadEdges) {
    const totalKm = edges.reduce((s, e) => s + e.lengthKm, 0);
    const highConfEdges = edges.filter((e) => e.candidates[0].confidence > 0.8).length;
    const meanConf = edges.reduce((s, e) => s + e.candidates[0].confidence, 0) / edges.length;

    // Count connected components via node adjacency
    const visited = new Set<string>();
    const components: number[][] = [];

    for (const e of edges) {
      if (visited.has(e.id)) continue;
      const comp: string[] = [];
      const queue = [e.id];
      visited.add(e.id);
      while (queue.length > 0) {
        const curId = queue.shift()!;
        comp.push(curId);
        const cur = edges.find((x) => x.id === curId);
        if (!cur) continue;
        const neighbors = edges.filter(
          (x) =>
            x.id !== curId &&
            (x.fromNode === cur.fromNode ||
              x.toNode === cur.toNode ||
              x.fromNode === cur.toNode ||
              x.toNode === cur.fromNode),
        );
        for (const n of neighbors) {
          if (!visited.has(n.id)) {
            visited.add(n.id);
            queue.push(n.id);
          }
        }
      }
      components.push(comp);
    }

    // Longest component
    let longestKm = 0;
    for (const comp of components) {
      const km = comp.reduce((s, eid) => {
        const e = edges.find((x) => x.id === eid);
        return s + (e?.lengthKm ?? 0);
      }, 0);
      if (km > longestKm) longestKm = km;
    }

    // Oscillations: count roadCode changes in connected sequence
    let oscillations = 0;
    for (const comp of components) {
      const compEdges = comp
        .map((eid) => edges.find((e) => e.id === eid)!)
        .filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id));
      for (let i = 1; i < compEdges.length; i++) {
        if (compEdges[i].candidates[0]?.roadCode !== compEdges[i - 1].candidates[0]?.roadCode) {
          oscillations++;
        }
      }
    }

    perRoadScores.push({
      roadCode,
      roadName: edges[0]?.candidates[0]?.roadName ?? "",
      totalEdges: edges.length,
      totalKm: +totalKm.toFixed(1),
      highConfEdges,
      components: components.length,
      longestComponentKm: +longestKm.toFixed(1),
      fragmentationScore: +((components.length / Math.max(1, edges.length)) * 100).toFixed(1),
      oscillations,
      oscillationRate: +(oscillations / Math.max(1, edges.length)).toFixed(3),
      meanConfidence: +meanConf.toFixed(3),
    });

    console.log(`  ${roadCode}: ${edges.length} edges, ${components.length} components, ${oscillations} oscillations`);
  }

  // ── Gate evaluation ──────────────────────────────────────────────
  console.log("[validate-labels] Evaluating gates...");

  const avgCorridorRecall = corridorResults.reduce((s, r) => s + r.recall, 0) / corridorResults.length;
  const avgCorridorPrecision = corridorResults.reduce((s, r) => s + r.precision, 0) / corridorResults.length;
  const avgCorridorContinuity = corridorResults.reduce((s, r) => s + r.continuityRatio, 0) / corridorResults.length;

  const gates = {
    corridorRecall: avgCorridorRecall >= THRESHOLDS.corridorRecall,
    corridorPrecision: avgCorridorPrecision >= THRESHOLDS.corridorPrecision,
    corridorContinuity: avgCorridorContinuity >= THRESHOLDS.corridorContinuity,
    unresolvedLabelRate: unresolvedLabelRate <= THRESHOLDS.unresolvedLabelRate,
    junctionConflictRate: junctionConflictRate <= THRESHOLDS.junctionConflictRate,
    junctionLabelInstability: avgInstability <= THRESHOLDS.junctionLabelInstability,
  };

  const gatesPassed = Object.values(gates).filter(Boolean).length;
  const gatesTotal = Object.values(gates).length;
  const allPassed = gatesPassed === gatesTotal;

  console.log(`  Gates: ${gatesPassed}/${gatesTotal} passed`);
  for (const [gate, passed] of Object.entries(gates)) {
    console.log(`    ${passed ? "✔" : "✗"} ${gate}`);
  }

  // ── Build report ─────────────────────────────────────────────────
  const report: ValidationReport = {
    version: 2,
    generatedAt: new Date().toISOString(),
    gatingDecision: allPassed ? "PASS" : gatesPassed >= gatesTotal - 1 ? "CONDITIONAL" : "FAIL",
    summary: {
      corridorHighways: {
        passed: corridorResults.filter((r) => r.status === "PASS").length,
        total: corridorResults.length,
      },
      globalGates: {
        passed: gatesPassed,
        total: gatesTotal,
      },
      corridorResults,
      globalMetrics,
      perRoadScores,
    },
    gates,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`[validate-labels] Report written to ${OUTPUT_PATH}`);
  console.log(`[validate-labels] Gating decision: ${report.gatingDecision}`);
}

main();
