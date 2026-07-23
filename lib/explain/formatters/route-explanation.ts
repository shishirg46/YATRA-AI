import type { ExplanationReport } from "@/lib/explain/types";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

const RISK_LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "EXTREME"];

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && RISK_LEVELS.includes(value as RiskLevel);
}

export function toRiskLevel(value: unknown): RiskLevel {
  return isRiskLevel(value) ? value : "MEDIUM";
}

const ROUTE_CONDITIONS = new Set(["disaster_route_risk"]);

export function isRouteCondition(condition: string): boolean {
  return (
    condition.startsWith("route_") ||
    condition.startsWith("segment_") ||
    ROUTE_CONDITIONS.has(condition)
  );
}

export interface FormatterInput {
  overallRisk: RiskLevel;
  corridorFrom: string;
  corridorTo: string;
  distanceKm: number;
  durationH: number;
  segments: {
    from: string;
    to: string;
    riskLevel: string;
    riskScore: number;
    hazards: string[];
  }[];
}

export interface FormattedRouteExplanation {
  riskExplanation: string;
  routeAdvice: string;
}

const HazardCategory = {
  Flood: "flood",
  Landslide: "landslide",
  Weather: "weather",
  Seismic: "seismic",
} as const;

const HAZARD_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /flood/i, category: HazardCategory.Flood },
  { pattern: /landslide/i, category: HazardCategory.Landslide },
  { pattern: /earthquake|seismic/i, category: HazardCategory.Seismic },
  { pattern: /rain/i, category: HazardCategory.Weather },
];

function categorizeHazard(hazard: string): string {
  for (const rule of HAZARD_RULES) {
    if (rule.pattern.test(hazard)) return rule.category;
  }
  return "other";
}

function summarizeCategory(category: string, count: number): string | null {
  if (count === 0) return null;
  switch (category) {
    case HazardCategory.Flood:
      return count > 1 ? "Flood risk: elevated (multiple sources)" : "Flood risk detected";
    case HazardCategory.Landslide:
      return count > 1 ? "Landslide risk: elevated (terrain and recent activity)" : "Landslide risk detected";
    case HazardCategory.Seismic:
      return "Seismic activity recorded in the region";
    case HazardCategory.Weather:
      return "Rainfall affecting travel conditions";
    default:
      return null;
  }
}

function formatSegmentDetail(seg: FormatterInput["segments"][number]): string {
  const groups: Record<string, number> = {};
  for (const h of seg.hazards) {
    const cat = categorizeHazard(h);
    groups[cat] = (groups[cat] ?? 0) + 1;
  }
  const summaries: string[] = [];
  for (const [cat, count] of Object.entries(groups)) {
    const s = summarizeCategory(cat, count);
    if (s) summaries.push(s);
  }
  const riskLine = `${seg.from} → ${seg.to} — Risk ${seg.riskScore} (${seg.riskLevel})`;
  if (summaries.length === 0) return `${riskLine}.`;
  return `${riskLine}. ${summaries.join(". ")}.`;
}

function formatSegmentDetails(segments: FormatterInput["segments"]): string[] {
  if (segments.length === 0) return [];
  return segments.map(formatSegmentDetail);
}

function buildRouteAdvice(overallRisk: RiskLevel, corridorFrom: string, corridorTo: string, distanceKm: number, durationH: number, segmentDetails: string[]): string {
  const lines: string[] = [];
  const status = overallRisk === "HIGH" || overallRisk === "EXTREME" ? "HIGH" : overallRisk;
  lines.push(`Route status: ${status}`);
  lines.push(`Corridor: ${corridorFrom} → ${corridorTo} (${distanceKm} km, ~${durationH}h)`);
  if (segmentDetails.length > 0) {
    lines.push("");
    lines.push("Segments:");
    for (const d of segmentDetails) {
      lines.push(`  ${d}`);
    }
  }
  if (overallRisk === "HIGH" || overallRisk === "EXTREME") {
    lines.push("");
    lines.push("Recommendation: Consider alternative routing or extra precautions.");
  }
  return lines.join("\n");
}

function buildRiskExplanation(overallRisk: RiskLevel, corridorFrom: string, corridorTo: string, distanceKm: number, durationH: number, segmentCount: number, worstSegment: string | null, segmentDetails: string[]): string {
  const parts: string[] = [];
  const level = overallRisk === "HIGH" ? "HIGH" : overallRisk === "EXTREME" ? "HIGH" : overallRisk;
  parts.push(`Overall route risk: ${level}.`);
  parts.push(`The ${corridorFrom} → ${corridorTo} corridor (${distanceKm} km, ~${durationH}h) has ${segmentCount} segment${segmentCount !== 1 ? "s" : ""} requiring extra caution.`);
  if (worstSegment) {
    parts.push(`Highest-risk: ${worstSegment}.`);
  }
  if (segmentDetails.length > 0) {
    const topDetails = segmentDetails.slice(0, 2);
    for (const d of topDetails) {
      parts.push(d);
    }
    if (segmentDetails.length > 2) {
      const remaining = segmentDetails.length - 2;
      parts.push(`${remaining} more segment${remaining > 1 ? "s" : ""} with moderate risk.`);
    }
  }
  return parts.join(" ");
}

export function mergeRouteExplanation(
  report: ExplanationReport,
  formatted: FormattedRouteExplanation,
): string {
  const allItems = Object.values(report.sections).flatMap((s) => s.items);
  const eligibleItems = allItems
    .filter((i) => i.severity === "EXTREME" || i.severity === "HIGH" || i.severity === "MEDIUM")
    .slice(0, 5);

  const nonRouteText = eligibleItems
    .filter((i) => !isRouteCondition(i.condition))
    .map((i) => i.text)
    .filter(Boolean)
    .join(" ");

  return [formatted.riskExplanation, nonRouteText]
    .filter(Boolean)
    .join(" ");
}

export function buildFormatterInput(
  routePlan: { from?: string; to?: string; corridor?: string; distanceKm: number; durationHours: number },
  segmentDetails: Array<{ from: string; to: string; riskLevel: string; riskScore: number; hazards?: string[] }>,
  routeRisk?: { risk?: string } | null,
): FormatterInput {
  return {
    overallRisk: toRiskLevel(routeRisk?.risk),
    corridorFrom:
      routePlan.from ??
      routePlan.corridor?.split(" → ")[0] ??
      "",
    corridorTo:
      routePlan.to ??
      routePlan.corridor?.split(" → ").at(-1) ??
      "",
    distanceKm: routePlan.distanceKm,
    durationH: routePlan.durationHours,
    segments: segmentDetails.map((s) => ({
      from: s.from,
      to: s.to,
      riskLevel: s.riskLevel,
      riskScore: s.riskScore,
      hazards: s.hazards ?? [],
    })),
  };
}

export function formatRouteExplanation(input: FormatterInput): FormattedRouteExplanation {
  if (input.segments.length === 0) {
    const level = input.overallRisk;
    return {
      riskExplanation:
        `Overall route risk: ${level}. The ${input.corridorFrom} → ${input.corridorTo} corridor ` +
        `(${input.distanceKm} km, ~${input.durationH} hours) could not be assessed at the segment level. ` +
        `Travel conditions may still change due to weather, road conditions, and local hazards.`,
      routeAdvice: [
        `Route assessment: ${level}`,
        ``,
        `Corridor: ${input.corridorFrom} → ${input.corridorTo}`,
        `Distance: ${input.distanceKm} km (~${input.durationH} hours)`,
        ``,
        `Detailed segment analysis is unavailable for this route.`,
        `Monitor weather forecasts and local road conditions before departure.`,
      ].join("\n"),
    };
  }

  const segmentDetails = formatSegmentDetails(input.segments);
  const worstSegment = input.segments.length > 0
    ? formatSegmentDetail(input.segments.reduce((a, b) =>
        Number(a.riskScore) > Number(b.riskScore) ? a : b
      ))
    : null;

  return {
    riskExplanation: buildRiskExplanation(
      input.overallRisk,
      input.corridorFrom,
      input.corridorTo,
      input.distanceKm,
      input.durationH,
      input.segments.length,
      worstSegment,
      segmentDetails,
    ),
    routeAdvice: buildRouteAdvice(
      input.overallRisk,
      input.corridorFrom,
      input.corridorTo,
      input.distanceKm,
      input.durationH,
      segmentDetails,
    ),
  };
}
