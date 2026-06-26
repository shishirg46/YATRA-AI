/**
 * route-explanation.ts — deterministic explanation compiler over routing execution trace.
 *
 * INVARIANT: Pure projection + rule evaluation. MUST NOT:
 *   - re-run A* or any routing computation
 *   - re-evaluate graph weights or penalties
 *   - infer geographic semantics
 *   - generate narrative text without metric/trace/config evidence
 *
 * Architecture role:
 *   route-service.ts        = orchestration
 *   route-abstraction.ts     = structure (grouping + labeling)
 *   route-explanation.ts     = reasoning (events → rules → statements)
 *
 * Every ReasonNode cites exactly one source (metric / trace / mode-config / junction).
 * Confidence is deterministic — defined by rule lookup table, never subjective.
 */

import type { RouteAbstraction, RouteIntent, HighwaySegment, RouteAlternative, RouteProvenance } from "@/lib/routing/types";

export const EXPLANATION_VERSION = "1.0";

// ─── Types ───────────────────────────────────────────────────────────────

export type ExecutionEventType = "EDGE_TRAVERSED" | "ROAD_SWITCH" | "VIRTUAL_EDGE_USED" | "NODE_SKIPPED" | "SNAP_CHOICE";

export interface EdgeTraversedEvent {
  type: "EDGE_TRAVERSED";
  roadCode: string;
  distanceKm: number;
  edgeType: "intra" | "cross" | "virtual";
}
export interface RoadSwitchEvent {
  type: "ROAD_SWITCH";
  fromRoad: string;
  toRoad: string;
  junctionId: string;
  cumulativeChanges: number;
}
export interface VirtualEdgeUsedEvent {
  type: "VIRTUAL_EDGE_USED";
  fromRoad: string;
  toRoad: string;
  distanceKm: number;
}
export interface NodeSkippedEvent {
  type: "NODE_SKIPPED";
  nodeId: string;
  skipReason: string;
  g: number;
  h: number;
}
export interface SnapChoiceEvent {
  type: "SNAP_CHOICE";
  nodeId: string;
  roadCode: string;
  confidence: "high" | "medium" | "low";
}

export type ExecutionEvent = EdgeTraversedEvent | RoadSwitchEvent | VirtualEdgeUsedEvent | NodeSkippedEvent | SnapChoiceEvent;

export interface ReasonNode {
  type: "choice" | "metric" | "constraint" | "comparison";
  statement: string;
  evidence: string[];
  confidence: number;
  source: "metric" | "trace" | "mode-config" | "junction";
}

export interface RouteExplanation {
  version: string;
  routeLevel: ReasonNode[];
  segmentLevel: ReasonNode[];
  alternativeComparisons: ReasonNode[];
  intentAlignment: ReasonNode[];
}

export interface StructuredComparisonFields {
  distanceDeltaPct: number;
  roadChangeDelta: number;
  continuityDelta: number;
  label: string;
}

// ─── RouteMetrics (local type — mirrors route-engine for zero coupling) ──

export interface RouteMetrics {
  deviationScore: number;
  roadChangeRatePer100km: number;
  continuityScore: number;
  weightEfficiency: number;
}

// ─── Mode Config (local — mirrors route-engine) ─────────────────────────

interface ModeConfig {
  crossRoadPenalty: number;
  virtualEdgePenalty: number;
  allowCrossRoad: boolean;
}

const MODE_CONFIGS: Record<string, ModeConfig> = {
  "strict-road": { crossRoadPenalty: Infinity, virtualEdgePenalty: Infinity, allowCrossRoad: false },
  balanced: { crossRoadPenalty: 1.1, virtualEdgePenalty: 1.0, allowCrossRoad: true },
  fastest: { crossRoadPenalty: 1.0, virtualEdgePenalty: 1.0, allowCrossRoad: true },
  "highway-preferred": { crossRoadPenalty: 2.0, virtualEdgePenalty: 1.5, allowCrossRoad: true },
};

// ─── Intent Rules (deterministic rule engine) ────────────────────────────

interface IntentRule {
  metric: keyof RouteMetrics;
  operator: ">" | "<" | ">=" | "<=" | "any";
  value: number;
  confidence: number;
}

const INTENT_RULES: Record<RouteIntent, IntentRule[]> = {
  highway: [
    { metric: "continuityScore", operator: ">", value: 0.7, confidence: 0.8 },
    { metric: "roadChangeRatePer100km", operator: "<", value: 6, confidence: 0.8 },
  ],
  fastest: [
    { metric: "weightEfficiency", operator: ">=", value: 0.7, confidence: 0.8 },
  ],
  scenic: [
    { metric: "deviationScore", operator: ">", value: 0.3, confidence: 0.8 },
  ],
  balanced: [],
};

// ─── Confidence Table (deterministic, never subjective) ─────────────────

function lookupConfidence(source: string, condition: string): number {
  const key = `${source}:${condition}`;
  const table: Record<string, number> = {
    "mode-config:disallow-cross-road": 1.0,
    "mode-config:infinity-penalty": 1.0,
    "mode-config:penalty-factors": 1.0,
    "metric:high-continuity": 0.8,
    "metric:low-deviation": 0.8,
    "metric:low-change-rate": 0.8,
    "metric:summary": 0.3,
    "trace:single-road": 1.0,
    "trace:road-switch": 0.7,
    "trace:virtual-edge": 0.7,
    "trace:node-skipped": 0.7,
    "junction:shared-node": 0.7,
    "comparison:large-diff": 0.6,
    "comparison:moderate-diff": 0.5,
    "comparison:small-diff": 0.3,
    "intent:satisfied": 0.8,
    "intent:not-satisfied": 0.8,
    "intent:fallback": 0.3,
    "intent:no-metrics": 0.3,
  };
  return table[key] ?? 0.5;
}

// ─── Event Replay (pure projection, NO recomputation) ──────────────────

/**
 * Project trace + edges into ExecutionEvent[].
 *
 * Guarantees:
 *   - pure mapping of existing data — no re-running A*
 *   - no heuristic reconstruction
 *   - no inferred behavior
 */
export function replayTrace(
  trace: any[],
  edges: any[],
  _mode: string,
): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];

  let prevRoad: string | null = null;
  let cumulativeChanges = 0;

  for (const edge of edges) {
    const roadCode = edge.roadCode ?? edge.fromRoad;
    const dist = edge.distanceKm ?? 0;

    if (!roadCode) continue;

    // Distinguish cross-road edges (real junction) from virtual edges (short connector)
    // CrossRoadEdge: has fromRoad, comes from junction graph — no roadCode on the edge itself
    // Virtual edge: has fromRoad, distance > 0, created on-the-fly by A* — no roadCode, no junctionId
    const isCrossRoad = typeof edge.fromRoad === "string" && edge.roadCode === undefined;
    const isVirtualEdge = typeof edge.fromRoad === "string" && edge.roadCode === undefined && dist > 0 && !edge.junctionId;

    if (isVirtualEdge) {
      events.push({
        type: "VIRTUAL_EDGE_USED",
        fromRoad: edge.fromRoad,
        toRoad: edge.toRoad,
        distanceKm: dist,
      });
    }

    events.push({
      type: "EDGE_TRAVERSED",
      roadCode,
      distanceKm: dist,
      edgeType: isVirtualEdge ? "virtual" : isCrossRoad ? "cross" : edge.linkType === "split" ? "cross" : "intra",
    });

    if (prevRoad !== null && roadCode !== prevRoad) {
      cumulativeChanges++;
      events.push({
        type: "ROAD_SWITCH",
        fromRoad: prevRoad,
        toRoad: roadCode,
        junctionId: edge.junctionId ?? "",
        cumulativeChanges,
      });
    }

    prevRoad = roadCode;
  }

  for (const step of trace) {
    if (step.skipReason) {
      events.push({
        type: "NODE_SKIPPED",
        nodeId: step.nodeId,
        skipReason: step.skipReason,
        g: step.g,
        h: step.h,
      });
    }
  }

  return events;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function evaluateMetric(
  metricName: keyof RouteMetrics,
  operator: ">" | "<" | ">=" | "<=" | "any",
  threshold: number,
  value: number,
): boolean {
  if (operator === "any") return true;
  if (operator === ">") return value > threshold;
  if (operator === "<") return value < threshold;
  if (operator === ">=") return value >= threshold;
  if (operator === "<=") return value <= threshold;
  return false;
}

function fmt(val: number, decimals: number = 3): string {
  return val.toFixed(decimals);
}

// ─── Route-Level Reasoning ──────────────────────────────────────────────

function buildRouteLevelReasons(
  metrics: RouteMetrics | undefined,
  mode: string,
  roadChanges: number,
  totalDistanceKm: number,
): ReasonNode[] {
  const reasons: ReasonNode[] = [];
  const config = MODE_CONFIGS[mode];

  if (config) {
    if (!config.allowCrossRoad) {
      reasons.push({
        type: "constraint",
        statement: `${mode} mode disallows cross-road transitions — route is locked to a single road`,
        evidence: ["allowCrossRoad:false"],
        confidence: lookupConfidence("mode-config", "disallow-cross-road"),
        source: "mode-config",
      });
    }
    if (config.crossRoadPenalty === Infinity) {
      reasons.push({
        type: "constraint",
        statement: `${mode} mode applies infinite cross-road penalty — no road switches possible`,
        evidence: ["crossRoadPenalty:Infinity"],
        confidence: lookupConfidence("mode-config", "infinity-penalty"),
        source: "mode-config",
      });
    } else if (config.crossRoadPenalty > 1) {
      reasons.push({
        type: "constraint",
        statement: `${mode} mode penalizes each road switch ×${fmt(config.crossRoadPenalty, 1)} distance cost`,
        evidence: [`crossRoadPenalty:${config.crossRoadPenalty}`],
        confidence: lookupConfidence("mode-config", "penalty-factors"),
        source: "mode-config",
      });
    }
  }

  if (metrics) {
    if (metrics.continuityScore > 0.7) {
      reasons.push({
        type: "metric",
        statement: `High continuity (${fmt(metrics.continuityScore)}) — strong preference for staying on the same road`,
        evidence: [`continuityScore:${metrics.continuityScore}`],
        confidence: lookupConfidence("metric", "high-continuity"),
        source: "metric",
      });
    }
    if (metrics.deviationScore < 0.05) {
      reasons.push({
        type: "metric",
        statement: `Low deviation (${fmt(metrics.deviationScore, 4)}) — route stays close to the direct line`,
        evidence: [`deviationScore:${metrics.deviationScore}`],
        confidence: lookupConfidence("metric", "low-deviation"),
        source: "metric",
      });
    }
    if (metrics.roadChangeRatePer100km < 3) {
      reasons.push({
        type: "metric",
        statement: `Low change rate (${fmt(metrics.roadChangeRatePer100km, 1)} per 100 km) — stable road sequence`,
        evidence: [`roadChangeRatePer100km:${metrics.roadChangeRatePer100km}`],
        confidence: lookupConfidence("metric", "low-change-rate"),
        source: "metric",
      });
    }
  }

  const perKm = totalDistanceKm > 0 ? (roadChanges / totalDistanceKm * 100).toFixed(2) : "0";
  reasons.push({
    type: "metric",
    statement: `${roadChanges} road changes over ${totalDistanceKm.toFixed(0)} km (${perKm} per 100 km)`,
    evidence: [`roadChanges:${roadChanges}`, `totalDistanceKm:${totalDistanceKm}`],
    confidence: lookupConfidence("metric", "summary"),
    source: "metric",
  });

  return reasons;
}

// ─── Segment-Level Reasoning ────────────────────────────────────────────

function buildSegmentLevelReasons(
  segments: HighwaySegment[],
  events: ExecutionEvent[],
): ReasonNode[] {
  const reasons: ReasonNode[] = [];
  const switchEvents = events.filter((e): e is RoadSwitchEvent => e.type === "ROAD_SWITCH");

  if (segments.length === 1 && switchEvents.length === 0) {
    reasons.push({
      type: "choice",
      statement: "Single-road route — no road switches",
      evidence: ["roadChanges:0"],
      confidence: lookupConfidence("trace", "single-road"),
      source: "trace",
    });
    return reasons;
  }

  for (const sw of switchEvents) {
    reasons.push({
      type: "choice",
      statement: `Switch ${sw.fromRoad} → ${sw.toRoad} (change #${sw.cumulativeChanges})`,
      evidence: [`from:${sw.fromRoad}`, `to:${sw.toRoad}`, `junction:${sw.junctionId || "unknown"}`],
      confidence: lookupConfidence("trace", "road-switch"),
      source: "trace",
    });
  }

  const virtualEvents = events.filter((e): e is VirtualEdgeUsedEvent => e.type === "VIRTUAL_EDGE_USED");
  for (const v of virtualEvents) {
    reasons.push({
      type: "choice",
      statement: `Virtual connector: ${v.fromRoad} → ${v.toRoad} (${v.distanceKm.toFixed(1)} km)`,
      evidence: [`from:${v.fromRoad}`, `to:${v.toRoad}`, `distance:${v.distanceKm}`],
      confidence: lookupConfidence("trace", "virtual-edge"),
      source: "trace",
    });
  }

  return reasons;
}

// ─── Alternative Comparison ─────────────────────────────────────────────

/**
 * Compare primary route against alternatives.
 *
 * All diffs use the same baseline: (alternative - primary) / primary.
 */
export function compareAlternatives(
  primary: RouteAbstraction,
  alternatives: RouteAlternative[],
): { fields: StructuredComparisonFields[]; reasons: ReasonNode[] } {
  const fields: StructuredComparisonFields[] = [];
  const reasons: ReasonNode[] = [];

  for (const alt of alternatives) {
    const distDelta = primary.totalDistanceKm > 0
      ? ((alt.abstraction.totalDistanceKm - primary.totalDistanceKm) / primary.totalDistanceKm) * 100
      : 0;
    const roadChangeDelta = alt.abstraction.roadChanges - primary.roadChanges;
    const contDelta = (alt.abstraction.metrics?.continuityScore ?? 0) - (primary.metrics?.continuityScore ?? 0);

    fields.push({
      label: alt.label,
      distanceDeltaPct: +distDelta.toFixed(1),
      roadChangeDelta,
      continuityDelta: +contDelta.toFixed(3),
    });

    const parts: string[] = [];
    if (Math.abs(distDelta) > 0.5) {
      parts.push(`${distDelta > 0 ? "+" : ""}${distDelta.toFixed(0)}% distance`);
    }
    if (roadChangeDelta !== 0) {
      parts.push(`${roadChangeDelta > 0 ? "+" : ""}${roadChangeDelta} road changes`);
    }

    const absDelta = Math.abs(distDelta);
    const conf = absDelta > 20
      ? lookupConfidence("comparison", "large-diff")
      : absDelta > 5
        ? lookupConfidence("comparison", "moderate-diff")
        : lookupConfidence("comparison", "small-diff");

    reasons.push({
      type: "comparison",
      statement: `${alt.label}: ${parts.length > 0 ? parts.join(", ") : "comparable to primary"}`,
      evidence: [
        `distanceDeltaPct:${distDelta.toFixed(1)}`,
        `roadChangeDelta:${roadChangeDelta}`,
        `continuityDelta:${contDelta.toFixed(3)}`,
      ],
      confidence: conf,
      source: "metric",
    });
  }

  return { fields, reasons };
}

// ─── Intent Alignment ────────────────────────────────────────────────────

/**
 * Evaluate route intent against achieved metrics using deterministic rules.
 *
 * Returns one ReasonNode per rule — each with confidence from the lookup table.
 */
export function checkIntentAlignment(
  intent: RouteIntent,
  metrics: RouteMetrics | undefined,
): ReasonNode[] {
  const reasons: ReasonNode[] = [];
  const rules = INTENT_RULES[intent];

  if (!metrics) {
    reasons.push({
      type: "metric",
      statement: "No metrics available for intent alignment check",
      evidence: ["metrics:undefined"],
      confidence: lookupConfidence("intent", "no-metrics"),
      source: "metric",
    });
    return reasons;
  }

  if (rules.length === 0) {
    reasons.push({
      type: "metric",
      statement: `${intent} intent: no hard constraints — default fallback`,
      evidence: [`intent:${intent}`],
      confidence: lookupConfidence("intent", "fallback"),
      source: "metric",
    });
    return reasons;
  }

  for (const rule of rules) {
    const actual = metrics[rule.metric] ?? 0;
    const passed = evaluateMetric(rule.metric, rule.operator, rule.value, actual);

    if (passed) {
      reasons.push({
        type: "metric",
        statement: `${intent} ✓ ${rule.metric} ${rule.operator} ${rule.value} (actual: ${fmt(actual)})`,
        evidence: [`${rule.metric}:${actual}`, `threshold:${rule.value}`],
        confidence: lookupConfidence("intent", "satisfied"),
        source: "metric",
      });
    } else {
      reasons.push({
        type: "metric",
        statement: `${intent} ✗ ${rule.metric} ${rule.operator} ${rule.value} (actual: ${fmt(actual)})`,
        evidence: [`${rule.metric}:${actual}`, `threshold:${rule.value}`],
        confidence: lookupConfidence("intent", "not-satisfied"),
        source: "metric",
      });
    }
  }

  return reasons;
}

// ─── Main Entry Point ───────────────────────────────────────────────────

export function explainRoute(
  result: {
    trace: any[];
    path: { edges: any[] };
    statistics: {
      totalDistanceKm: number;
      totalWeight: number;
      roadChanges: number;
      metrics?: RouteMetrics;
    };
    roadSequence: { roadCode: string }[];
  },
  abstraction: RouteAbstraction,
  mode: string,
  provenance?: RouteProvenance,
): RouteExplanation {
  if (provenance && !(provenance.engine === "dor" && provenance.isTraceValid && provenance.isMetricComplete)) {
    return {
      version: EXPLANATION_VERSION,
      routeLevel: [],
      segmentLevel: [],
      alternativeComparisons: [],
      intentAlignment: [
        {
          type: "metric",
          statement: `Explanation unavailable — no valid trace (engine: ${provenance.engine}, traceValid: ${provenance.isTraceValid})`,
          evidence: [`engine:${provenance.engine}`, `traceValid:${provenance.isTraceValid}`],
          confidence: 1.0,
          source: "metric",
        },
      ],
    };
  }

  const events = replayTrace(result.trace, result.path.edges, mode);

  const routeLevel = buildRouteLevelReasons(
    result.statistics.metrics,
    mode,
    result.statistics.roadChanges,
    result.statistics.totalDistanceKm,
  );
  const segmentLevel = buildSegmentLevelReasons(abstraction.highwaySegments, events);
  const alternativeComparisons: ReasonNode[] = [];
  const intentAlignment = checkIntentAlignment(
    abstraction.intent ?? "balanced",
    result.statistics.metrics,
  );

  return {
    version: EXPLANATION_VERSION,
    routeLevel,
    segmentLevel,
    alternativeComparisons,
    intentAlignment,
  };
}

// ─── Formatters (pure render only — NO computation or filtering) ───────

function renderReasons(label: string, nodes: ReasonNode[]): string[] {
  if (nodes.length === 0) return [];
  const lines: string[] = [label];
  for (const r of nodes) {
    lines.push(`  [${r.source}] ${r.confidence.toFixed(1)} ${r.statement}`);
  }
  return lines;
}

export function formatExplanation(explanation: RouteExplanation): string {
  const sections = [
    `Route Explanation (v${explanation.version})`,
    "─".repeat(50),
    ...renderReasons("Route-Level Decisions:", explanation.routeLevel),
    ...renderReasons("Segment-Level Decisions:", explanation.segmentLevel),
    ...renderReasons("Alternative Comparisons:", explanation.alternativeComparisons),
    ...renderReasons("Intent Alignment:", explanation.intentAlignment),
  ];

  return sections.join("\n");
}

export function formatReasonTree(nodes: ReasonNode[], indent: number = 0): string {
  return nodes
    .map((n) => `${"  ".repeat(indent)}• [${n.source}] ${n.statement} (conf: ${n.confidence})`)
    .join("\n");
}
