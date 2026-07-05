import type { PlanReport } from "@/lib/types/plan-report";
import type { PillarEvidence } from "@/lib/plan/pipeline-types";
import type { HistoricalWeatherStats } from "@/lib/collectors/historical-weather";
import type { HistoricalHazardStats } from "@/lib/collectors/historical-hazard";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
export type Audience = "TRAVELER" | "PROFESSIONAL" | "EMERGENCY";

export interface EvaluatorResult {
  condition: string;
  severity: Severity;
  audience: Audience;
  priority: number;
  placeholders: Record<string, string | number>;
  trace: string[];
}

export interface ExplanationItem {
  condition: string;
  severity: Severity;
  audience: Audience;
  priority: number;
  text: string;
  evidence: string[];
  trace: string[];
  debugTrace: DebugTrace;
}

export interface SectionResult {
  audience: Audience;
  items: ExplanationItem[];
  severity: Severity;
}

export interface SummaryStacks {
  positive: ExplanationItem[];
  negative: ExplanationItem[];
  recommendation: ExplanationItem[];
}

export interface ConfidencePillars {
  weather: number;
  disaster: number;
  route: number;
  health: number;
  historical: number;
}

export interface ConfidenceProviders {
  weather: string;
  routing: string;
  disaster: string[];
  airQuality: string;
}

export interface ConfidenceFreshness {
  weatherMinutes: number;
  disasterMinutes: number;
}

export interface ConfidenceReport {
  score: number;
  pillars: ConfidencePillars;
  freshness: ConfidenceFreshness;
  providers: ConfidenceProviders;
  fallbacks: string[];
  reasons: string[];
}

export interface DebugTrace {
  evaluator: string;
  condition: string;
  priority: number;
  templateId: string;
  renderedText: string;
  durationMs: number;
}

export interface EngineMeta {
  engineVersion: string;
  templateVersion: number;
  generationTimeMs: number;
  templatesUsed: number;
  evaluatedConditions: number;
}

export interface ExplanationReport {
  summary: {
    text: string;
    stacks: SummaryStacks;
  };
  sections: Record<string, SectionResult>;
  recommendations: { type: string; text: string; priority: number }[];
  confidence: ConfidenceReport;
  topTip: string;
  debugTraces: DebugTrace[];
  meta: EngineMeta;
}

export interface EvaluatorInput {
  destination: PlanReport["destination"];
  locationInfo: { name: string; district: string; province: string; lat: number; lon: number; altitude: number | null };
  travelDate: string;
  startDate: string;
  endDate: string;
  vehicle: string;
  travelStyle: string;
  tripType: string;
  season: string;
  overallScore: number;
  overallLevel: PlanReport["overallLevel"];
  baselineScore: number;
  seasonalModifier?: PlanReport["seasonalModifier"];
  groupAvgScore: number;
  confidence: number;
  conflict: boolean;
  mostVulnerableMember: PlanReport["mostVulnerableMember"];
  memberAnalyses: PlanReport["memberAnalyses"];
  riskFactors: PlanReport["riskFactors"];
  healthAdvisories: PlanReport["healthAdvisories"];
  recommendations: PlanReport["recommendations"];
  notableEvents: PlanReport["notableEvents"];
  seasonalContext: string;
  weatherStats: PlanReport["weatherStats"];
  budget: PlanReport["budget"];
  alternatives: PlanReport["alternatives"];
  liveWeather?: PlanReport["liveWeather"];
  liveHazard?: PlanReport["liveHazard"];
  routeRisk?: PlanReport["routeRisk"];
  disasterRouteRisk?: PlanReport["disasterRouteRisk"];
  routeAssessment?: PlanReport["routeAssessment"];
  routePlan?: PlanReport["routePlan"];
  routePillar?: PlanReport["routePillar"];
  segmentDetails?: PlanReport["segmentDetails"];
  destinationPillar?: PlanReport["destinationPillar"];
  weatherPillar?: PlanReport["weatherPillar"];
  personalPillar?: PlanReport["personalPillar"];
  pillarScores?: PlanReport["pillarScores"];
  stopAnalyses?: PlanReport["stopAnalyses"];
  evidence?: PillarEvidence | null;
}

export interface ExplanationContext {
  report: EvaluatorInput;
  now: Date;
  debug: boolean;
}

export type Evaluator = (ctx: ExplanationContext) => EvaluatorResult[];

export interface Template {
  id: string;
  templateGroup: string;
  condition: string;
  severity: Severity | null;
  audience: Audience;
  variant: number;
  template: string;
  priority: number;
  templateVersion: number;
}

export function severityToLevel(s: Severity): number {
  const map: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXTREME: 3 };
  return map[s] ?? 0;
}

export function levelToSeverity(level: string): Severity {
  if (level === "SAFE") return "LOW";
  if (level === "CAUTION") return "MEDIUM";
  if (level === "HIGH_RISK") return "HIGH";
  if (level === "EXTREME") return "EXTREME";
  return "MEDIUM";
}

export function levelToAudience(level: string): Audience {
  if (level === "SAFE" || level === "CAUTION") return "TRAVELER";
  if (level === "HIGH_RISK") return "PROFESSIONAL";
  return "EMERGENCY";
}
