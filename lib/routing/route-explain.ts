/**
 * route-explain.ts — deterministic explainability layer above RoadSequenceItem[].
 *
 * INVARIANT: Pure reduction layer. MUST NOT:
 *   - import from segment-graph.ts (no graph coupling)
 *   - access graph data files
 *   - perform routing decisions
 *   - recompute costs or geometry
 *
 * RouteExplanation is a deterministic projection of RoadSequenceItem[] and
 * must remain valid for offline regeneration without graph access.
 *
 * Architecture role (after Phase 5.8):
 *   segment-graph.ts  = decision engine (cost-aware Dijkstra)
 *   road-sequence.ts  = execution trace (enriched RoadSequenceItem[])
 *   route-explain.ts  = deterministic compiler output (human-readable)
 */
import type { RoadSequenceItem } from "@/lib/routing/road-sequence";

// ─── Types ────────────────────────────────────────────────────────

export interface RoadSummary {
  roadCode: string;
  roadName: string;
  roadType: string;
  fromJunction: string;
  toJunction: string;
  totalKm: number;
  fromKm: number;
  toKm: number;
}

export interface TransitionEvent {
  fromRoad: string;
  toRoad: string;
  viaJunction: string;
  atKm: number;
}

export interface RouteSegment {
  index: number;
  roadCode: string;
  roadName: string;
  roadType: string;
  fromJunction: string;
  toJunction: string;
  fromKm: number;
  toKm: number;
  lengthKm: number;
}

export interface RouteExplanation {
  origin: string;
  destination: string;
  totalKm: number;
  totalRoads: number;
  roadSummaries: RoadSummary[];
  transitions: TransitionEvent[];
  segmentChain: RouteSegment[];
  narrative: string;
}

// ─── Builder ──────────────────────────────────────────────────────

/**
 * Build a RouteExplanation from a merged RoadSequenceItem[].
 *
 * Pure reduction — no side effects, no graph calls, no geometry.
 * Deterministic: same input always produces identical output.
 */
export function buildRouteExplanation(
  segments: RoadSequenceItem[],
  origin?: string,
  destination?: string,
): RouteExplanation {
  if (segments.length === 0) {
    return {
      origin: origin ?? "",
      destination: destination ?? "",
      totalKm: 0,
      totalRoads: 0,
      roadSummaries: [],
      transitions: [],
      segmentChain: [],
      narrative: "",
    };
  }

  const totalKm = +(segments[segments.length - 1].toKm - segments[0].fromKm).toFixed(1);

  // ── Road summaries: group by roadCode ──
  const roadMap = new Map<string, RoadSequenceItem[]>();
  for (const seg of segments) {
    const code = seg.roadCode ?? "(unknown)";
    if (!roadMap.has(code)) roadMap.set(code, []);
    roadMap.get(code)!.push(seg);
  }

  const roadSummaries: RoadSummary[] = [];
  for (const [code, segs] of roadMap) {
    const first = segs[0];
    const last = segs[segs.length - 1];
    roadSummaries.push({
      roadCode: code,
      roadName: first.roadName,
      roadType: first.roadType,
      fromJunction: first.fromJunction ?? "-",
      toJunction: last.toJunction ?? "-",
      totalKm: +segs.reduce((s, seg) => s + (seg.toKm - seg.fromKm), 0).toFixed(1),
      fromKm: first.fromKm,
      toKm: last.toKm,
    });
  }

  // ── Transitions: detect roadCode changes ──
  const transitions: TransitionEvent[] = [];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    if (prev.roadCode !== curr.roadCode) {
      transitions.push({
        fromRoad: prev.roadCode ?? "(unknown)",
        toRoad: curr.roadCode ?? "(unknown)",
        viaJunction: prev.toJunction ?? curr.fromJunction ?? "-",
        atKm: +prev.toKm.toFixed(1),
      });
    }
  }

  // ── Segment chain ──
  const segmentChain: RouteSegment[] = segments.map((seg, i) => ({
    index: i,
    roadCode: seg.roadCode ?? "(unknown)",
    roadName: seg.roadName,
    roadType: seg.roadType,
    fromJunction: seg.fromJunction ?? "-",
    toJunction: seg.toJunction ?? "-",
    fromKm: +seg.fromKm.toFixed(1),
    toKm: +seg.toKm.toFixed(1),
    lengthKm: +(seg.toKm - seg.fromKm).toFixed(1),
  }));

  // ── Narrative ──
  const narrative = buildRouteNarrative(
    roadSummaries,
    transitions,
    totalKm,
    origin ?? "",
    destination ?? "",
  );

  return {
    origin: origin ?? "",
    destination: destination ?? "",
    totalKm,
    totalRoads: roadSummaries.length,
    roadSummaries,
    transitions,
    segmentChain,
    narrative,
  };
}

// ─── Narrative builder ────────────────────────────────────────────

/**
 * Deterministic string formatter. Template-switches on road count.
 * No branching on graph state, no ambiguous phrasing.
 */
export function buildRouteNarrative(
  summaries: RoadSummary[],
  transitions: TransitionEvent[],
  totalKm: number,
  origin: string,
  destination: string,
): string {
  if (summaries.length === 0) return "";
  if (summaries.length === 1) {
    const r = summaries[0];
    const fromLabel = origin || r.fromJunction;
    const toLabel = destination || r.toJunction;
    return `Stay on ${r.roadCode} (${r.roadName}) from ${fromLabel} to ${toLabel} (${totalKm} km).`;
  }

  const parts: string[] = [];
  for (let i = 0; i < summaries.length; i++) {
    const r = summaries[i];
    const fromLabel = i === 0 ? (origin || r.fromJunction) : transitions[i - 1].viaJunction;
    const toLabel = i === summaries.length - 1
      ? (destination || r.toJunction)
      : transitions[i].viaJunction;
    const instruction = i === 0 ? "Take" : "then switch at " + transitions[i - 1].viaJunction + " to";
    parts.push(`${instruction} ${r.roadCode} (${r.roadName}) from ${fromLabel} to ${toLabel} (${r.totalKm} km)`);
  }

  const roadList = summaries.map((r) => r.roadCode).join(", ");
  parts.push(`Total: ${totalKm} km via ${summaries.length} roads (${roadList}).`);

  const first = parts[0];
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1));

  if (summaries.length === 2) {
    return `Take ${summaries[0].roadCode} (${summaries[0].roadName}) from ${origin || summaries[0].fromJunction} to ${transitions[0].viaJunction} (${summaries[0].totalKm} km), then switch at ${transitions[0].viaJunction} to ${summaries[1].roadCode} (${summaries[1].roadName}) and continue to ${destination || summaries[1].toJunction} (${summaries[1].totalKm} km). Total: ${totalKm} km via 2 roads.`;
  }

  return [first, ...rest].join(". ");
}
