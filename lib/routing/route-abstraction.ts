/**
 * route-abstraction.ts — pure transform layer: graph path → human road narrative.
 *
 * INVARIANT: Pure reduction. MUST NOT:
 *   - import runRoute or any execution engine
 *   - load graph data files
 *   - access databases or external APIs
 *   - perform routing decisions
 *
 * Architecture role:
 *   route-service.ts   = orchestration (execution + mode loops)
 *   route-abstraction.ts = structure (grouping + labeling + formatting)
 *
 * This is a deterministic projection of RouteResult data.
 * Same input always produces identical output.
 */

import type {
  RouteIntent,
  HighwaySegment,
  RouteAbstraction,
  RouteAlternative,
} from "@/lib/routing/types";
import { haversineKm } from "@/lib/routing/geo";

// ─── Types (internal to abstraction layer only) ───────────────────

interface RouteMetricsSnapshot {
  deviationScore: number;
  roadChangeRatePer100km: number;
  continuityScore: number;
  weightEfficiency: number;
}

// ─── Node / Edge shape helpers (avoid import from scripts/route-engine) ──

interface NodeShape {
  id: string;
  roadCode: string;
  startPlace: string;
  endPlace: string;
  startPlaceResolved?: string;
  endPlaceResolved?: string;
  centroidLat: number;
  centroidLon: number;
}

function sanitizePlaceName(name: string): string {
  return name.replace(/-wp\d+$/, '');
}

export interface EdgeShape {
  roadCode?: string;
  distanceKm: number;
  fromNodeId: string;
  toNodeId: string;
  [key: string]: unknown;
}

// ─── Segment Collapse ─────────────────────────────────────────────

/**
 * Group consecutive same-roadCode edges into HighwaySegment[].
 * Cross-road edges (no roadCode) act as group boundaries and are skipped.
 *
 * INVARIANT: edges[i] connects nodes[i] ↔ nodes[i+1] (path order).
 */
export function collapseToSegments(
  nodes: NodeShape[],
  edges: EdgeShape[],
  originLat?: number,
  originLon?: number,
): HighwaySegment[] {
  if (nodes.length < 2 || edges.length === 0) return [];

  const segments: HighwaySegment[] = [];
  let groupStart: number | null = null;
  let groupRoadCode: string | null = null;

  function resolvePlace(
    raw: string,
    resolved: string | undefined,
  ): { place: string; source: "raw" | "sanitized" | "gazetteer" } {
    if (resolved) {
      return { place: resolved, source: "gazetteer" };
    }
    const sanitized = sanitizePlaceName(raw);
    if (sanitized !== raw) {
      return { place: sanitized, source: "sanitized" };
    }
    return { place: raw, source: "raw" };
  }

  function pushGroup(start: number, end: number): void {
    if (start < 0 || end >= edges.length) return;
    const fromNode = nodes[start];
    const toNode = nodes[end + 1];
    if (!fromNode || !toNode) return;

    let from = resolvePlace(fromNode.startPlace, fromNode.startPlaceResolved);
    let to = resolvePlace(toNode.endPlace, toNode.endPlaceResolved);
    let outFromLat = fromNode.centroidLat;
    let outFromLon = fromNode.centroidLon;
    let outToLat = toNode.centroidLat;
    let outToLon = toNode.centroidLon;

    // Ensure direction follows travel path (first node → last node).
    // Use origin coordinates as reference when available (more accurate than nodes[0]
    // when A* snaps to a node far from the true origin).
    const refLat = originLat ?? nodes[0].centroidLat;
    const refLon = originLon ?? nodes[0].centroidLon;
    const dFrom = haversineKm(refLat, refLon, fromNode.centroidLat, fromNode.centroidLon);
    const dTo   = haversineKm(refLat, refLon, toNode.centroidLat, toNode.centroidLon);
    if (dTo < dFrom) {
      const tmpFrom = from; from = to; to = tmpFrom;
      outFromLat = toNode.centroidLat;
      outFromLon = toNode.centroidLon;
      outToLat = fromNode.centroidLat;
      outToLon = fromNode.centroidLon;
    }

    let totalKm = 0;
    for (let i = start; i <= end; i++) {
      totalKm += edges[i].distanceKm;
    }

    segments.push({
      roadCode: groupRoadCode!,
      fromPlace: from.place,
      toPlace: to.place,
      fromPlaceSource: from.source,
      toPlaceSource: to.source,
      distanceKm: +totalKm.toFixed(2),
      nodeCount: end - start + 2,
      fromLat: outFromLat,
      fromLon: outFromLon,
      toLat: outToLat,
      toLon: outToLon,
    });
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];

    // Cross-road / virtual edges have no roadCode — treat as boundary
    if (typeof edge.roadCode !== "string") {
      if (groupStart !== null) {
        pushGroup(groupStart, i - 1);
        groupStart = null;
        groupRoadCode = null;
      }
      continue;
    }

    const rc = edge.roadCode;

    if (groupStart === null) {
      // Start new group
      groupStart = i;
      groupRoadCode = rc;
    } else if (rc !== groupRoadCode) {
      // Road changed — push old group, start new
      pushGroup(groupStart, i - 1);
      groupStart = i;
      groupRoadCode = rc;
    }
    // else: same road — extend group implicitly
  }

  // Push final group
  if (groupStart !== null) {
    pushGroup(groupStart, edges.length - 1);
  }

  return segments;
}

// ─── Abstraction Builder ─────────────────────────────────────────

/**
 * Build a RouteAbstraction from raw route data.
 * Pure transform — no side effects.
 */
export function abstractionFromRouteResult(
  nodes: NodeShape[],
  edges: EdgeShape[],
  roadSequence: { roadCode: string }[],
  statistics: {
    totalDistanceKm: number;
    totalWeight?: number;
    roadChanges: number;
    metrics?: RouteMetricsSnapshot;
  },
  origin?: string,
  destination?: string,
  intent?: RouteIntent,
  originLat?: number,
  originLon?: number,
): RouteAbstraction {
  const highwaySegments = collapseToSegments(nodes, edges, originLat, originLon);
  const roadChain = roadSequence.map((rs) => rs.roadCode);

  const firstSeg = roadSequence[0];
  const lastSeg = roadSequence[roadSequence.length - 1];

  return {
    origin: origin || firstSeg?.roadCode || "",
    destination: destination || lastSeg?.roadCode || "",
    totalDistanceKm: +statistics.totalDistanceKm.toFixed(2),
    totalWeight: statistics.totalWeight ?? 0,
    highwaySegments,
    roadChain,
    roadChanges: statistics.roadChanges,
    metrics: statistics.metrics,
    intent,
  };
}

// ─── Intent Classification ────────────────────────────────────────

/**
 * Classify route intent based on mode + observed metrics.
 *
 * Ordering guarantees:
 *   1. Mode is the STRONGEST signal (what the user asked for)
 *   2. Metrics refine the classification (what was actually found)
 *   3. Metrics MUST be computed BEFORE calling this function
 */
export function classifyRouteIntent(
  metrics: { continuityScore: number; deviationScore: number } | undefined | null,
  mode: string,
): RouteIntent {
  // Mode-based classification (strongest signal)
  if (mode === "fastest") return "fastest";
  if (mode === "highway-preferred") return "highway";
  if (mode === "strict-road") return "highway";

  // No metrics — default to balanced
  if (!metrics) return "balanced";

  // Metric-based refinement for balanced mode
  if (metrics.continuityScore > 0.8) return "highway";
  if (metrics.deviationScore > 0.5) return "scenic";

  return "balanced";
}

// ─── Road Name Map ─────────────────────────────────────────────────

const ROAD_CODE_NAMES: Record<string, string> = {
  NH01: "Mahendra Highway",
  NH02: "Mechi Highway",
  NH03: "Tribhuvan Highway",
  NH04: "Prithvi Highway",
  NH05: "Hulaki Highway",
  NH06: "B.P. Highway",
  NH07: "Mahakali Highway",
  NH08: "Koshi Highway",
  NH09: "Madan Bhandari Highway",
  NH10: "Sagarmatha Highway",
  NH11: "Rapti Highway",
  NH12: "Karnali Highway",
  NH13: "Seti Highway",
  NH14: "Mahakali Highway",
  NH15: "Sindhuli-Mugling Road",
  NH16: "Sagarmatha Highway",
  NH17: "Mugling–Narayanghat Road",
  NH18: "Pokhara–Baglung Highway",
  NH19: "Jyamrung–Besi Shahar Road",
  NH20: "Besisahar–Jomsom Road",
  NH21: "Ratna Highway",
  NH22: "Bheri Highway",
  NH23: "Mugling–Kushma Road",
  NH24: "Kushma–Beni Road",
  NH25: "Beni–Jomsom Road",
  NH26: "Beni–Darbang Road",
  NH27: "Darbang–Musikot Road",
};

export function roadCodeName(code: string): string {
  return ROAD_CODE_NAMES[code] ?? code;
}

// ─── Description Generator ────────────────────────────────────────

/**
 * Generate a human-readable route description from highway segments.
 * Dynamic — not hardcoded.
 */
export function generateRouteDescription(segments: HighwaySegment[]): string {
  if (segments.length === 0) return "No highway segments available.";

  const roads = segments.map((s) => {
    const displayName = ROAD_CODE_NAMES[s.roadCode] ?? s.roadCode;
    return `${displayName} (${s.roadCode})`;
  });
  const uniqueRoads = [...new Set(roads)];

  if (uniqueRoads.length === 1) {
    return `Route via ${uniqueRoads[0]}, covering ${segments[0].fromPlace} to ${segments[segments.length - 1].toPlace}.`;
  }
  if (uniqueRoads.length === 2) {
    return `Route via ${uniqueRoads[0]} and ${uniqueRoads[1]}.`;
  }
  return `Route via ${uniqueRoads.slice(0, -1).join(", ")}, and ${uniqueRoads[uniqueRoads.length - 1]}.`;
}

/**
 * Pick a short descriptive name for a route based on its primary highway.
 */
export function pickRouteName(segments: HighwaySegment[], index: number): string {
  if (segments.length === 0) return `Route ${index + 1}`;

  const primaryRoad = segments.reduce((a, b) => (a.distanceKm > b.distanceKm ? a : b));
  const name = ROAD_CODE_NAMES[primaryRoad.roadCode];
  const directional = index === 0 ? "" : index === 1 ? "Alternative " : `Option ${index + 1} `;

  return name
    ? `${directional}via ${name}`
    : `${directional}Route`.trim();
}

// ─── Display Labels ───────────────────────────────────────────────

const INTENT_LABELS: Record<RouteIntent, string> = {
  fastest: "Fastest route",
  scenic: "Scenic route",
  highway: "Highway route",
  balanced: "Balanced route",
};

export function abstractionLabel(intent: RouteIntent): string {
  return INTENT_LABELS[intent];
}

// ─── Formatters ───────────────────────────────────────────────────

/**
 * Format abstraction as human-readable lines.
 *
 * Output:
 *   NH01: Morang → Itahari (45.20 km)
 *   NH08: Itahari → Dharan (12.80 km)
 */
export function formatAbstractionLines(abstraction: RouteAbstraction): string {
  if (abstraction.highwaySegments.length === 0) return "No route segments";

  const lines: string[] = ["Route Summary:"];
  for (const seg of abstraction.highwaySegments) {
    lines.push(
      `  ${seg.roadCode}: ${seg.fromPlace} → ${seg.toPlace} (${seg.distanceKm.toFixed(1)} km)`,
    );
  }

  const chain = abstraction.roadChain.join(" → ");
  lines.push(
    `Total: ${abstraction.totalDistanceKm.toFixed(1)} km via ${chain}`,
  );

  return lines.join("\n");
}

/**
 * Format road chain as arrow-separated string.
 *
 * "NH01 → NH08 → NH09"
 */
export function formatRoadChain(roadChain: string[]): string {
  return roadChain.join(" → ");
}

/**
 * Format alternative routes as labeled list.
 *
 * Output:
 *   Route 1 (Balanced): NH01 → NH08 → NH09 (58.0 km)
 *   Route 2 (Fastest): NH01 → NH08 (52.1 km)
 */
export function formatAlternatives(alternatives: RouteAlternative[]): string {
  if (alternatives.length === 0) return "No alternative routes";

  const lines: string[] = ["Route Options:"];
  for (let i = 0; i < alternatives.length; i++) {
    const alt = alternatives[i];
    const chain = formatRoadChain(alt.abstraction.roadChain);
    const dist = alt.abstraction.totalDistanceKm.toFixed(1);
    lines.push(`  Route ${i + 1} (${alt.label}): ${chain} (${dist} km)`);
  }

  return lines.join("\n");
}
