import type { VehicleType, TravelStyle } from "./trip-types";
import type {
  DestinationResult,
  WeatherSnapshot,
  HazardSnapshot,
  MemberAnalysis,
  BudgetSummary,
  Alternative,
  RouteRisk,
} from "@/lib/types/plan-report";
import type { HistoricalHazardStats } from "@/lib/collectors/historical-hazard";
import type { HistoricalWeatherStats } from "@/lib/collectors/historical-weather";
import type { DisasterType } from "@/lib/disaster/types";

export const ANALYSIS_PIPELINE_VERSION = 2;

export interface StageTiming {
  stage: StageName;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export class FatalAnalysisError extends Error {
  constructor(message: string, public statusCode = 500) {
    super(message);
    this.name = "FatalAnalysisError";
  }
}

export type StageName =
  | "destination" | "route" | "evidence" | "travellers"
  | "pillars" | "budget" | "alternatives" | "ai" | "response";

export type PhaseStatus = "pending" | "running" | "completed" | "warning" | "failed";

export type StageResult = "completed" | "warning" | "failed" | "skipped";

export interface StageWarning {
  stage: StageName;
  message: string;
  code?: string;
  cause?: unknown;
}

export interface ForecastDay {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  rainProb: number;
  windMax: number;
  isTravelDate: boolean;
}

export interface PlacePoint {
  name: string;
  lat: number;
  lon: number;
}

export interface RouteHistoricalIncident {
  type: "flood" | "landslide";
  lat: number;
  lon: number;
  count: number;
}

export interface RouteRealtimeIncident {
  type: DisasterType;
  lat: number;
  lon: number;
}

export interface ImpactSummary {
  dead: number;
  injured: number;
  missing: number;
  affected: number;
  displaced: number;
}

export interface PillarEvidence {
  routeHistorical: RouteHistoricalIncident[];
  routeRealtime: RouteRealtimeIncident[];
  impactSummary: ImpactSummary;
  destinationHistorical: HistoricalHazardStats | null;
  destinationWeather: HistoricalWeatherStats | null;
  homeWeather: WeatherSnapshot | null;
  destinationLiveHazard: HazardSnapshot | null;
  destinationLiveWeather: WeatherSnapshot | null;
  forecastWeek: ForecastDay[];
  places: PlacePoint[];
}

export type PhaseData =
  | { destination: DestinationResult }
  | { routePlan: unknown; routeRisk: RouteRisk | null }
  | { liveWeather: WeatherSnapshot; liveHazard: HazardSnapshot }
  | { memberCount: number }
  | { totalScore: number; overallLevel: string }
  | { feasible: boolean; estimatedTotal: number }
  | { count: number }
  | Record<string, never>
  | Record<string, never>;

export interface AnalysisPhase {
  step: number;
  total: number;
  stageName: StageName;
  label: string;
  detail?: string;
  message?: string;
  status: PhaseStatus;
  result?: StageResult;
  data?: PhaseData;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
}

export interface AnalysisContext {
  session: { user: { id: string; name?: string } };
  destinationId: string;
  startDate: string;
  endDate: string;
  tripType: "SOLO" | "GROUP";
  budgetNPR: number;
  memberUsernames: string[];
  originLat: number | null;
  originLon: number | null;
  vehicle: VehicleType;
  travelStyle: TravelStyle;
}

export interface AnalysisOptions {
  debug?: boolean;
  signal?: AbortSignal;
  onProgress?: (phase: AnalysisPhase) => void;
}

export interface StageContext {
  signal?: AbortSignal;
  debug: boolean;
}

export interface PromptFacts {
  destination: { name: string; district: string; province: string; altitude: number | null };
  travelDate: string;
  season: string;
  tripType: string;
  groupScore: number;
  groupLevel: string;
  groupAvgScore: number;
  conflict: boolean;
  mostVulnerable?: { name: string; score: number };
  memberAnalyses: Pick<MemberAnalysis, "name" | "isLeader" | "score" | "level" | "healthFlags">[];
  leaderAnalysis: {
    name: string;
    topRisks: string[];
    healthFlags: string[];
    riskReport: {
      season: string;
      seasonalContext: string;
      riskFactors: { name: string; severity: string }[];
      healthAdvisories: { condition: string }[];
      recommendations: unknown[];
      notableEvents: unknown[];
      weatherStats: unknown;
      confidence: number;
    };
  };
  budget: Pick<BudgetSummary, "specified" | "estimatedTotal" | "feasible" | "shortfall" | "perPerson">;
  alternatives: { name: string; district: string; safetyScore: number; estimatedNPR: number }[];

  pillarDetails: {
    routeHistoric:    { score: number; maxPoints: number; level: string };
    routeRealtime:    { score: number; maxPoints: number; level: string };
    destinationSafety:{ score: number; maxPoints: number; level: string };
    weatherSafety:    { score: number; maxPoints: number; level: string };
    personalSafety:   { score: number; maxPoints: number; level: string };
  };
  routeFlags: Array<{ where: string; what: string; status: string }>;
  evidenceSummary: {
    routeHistoricalCount: number;
    routeRealtimeCount: number;
    destinationFloodRisk: number;
    destinationLandslideRisk: number;
    liveTemperature: number;
    liveRainfall: number;
    forecastRainRisk: "LOW" | "MODERATE" | "HIGH";
  };
}

export interface AiResult {
  verdict: string;
  whyUnsafe: string;
  groupConflict: string;
  riskExplanation: string;
  healthWarning: string;
  budgetAdvice: string;
  alternativeReason: string;
  topTip: string;
}

export interface AiDiagnostics {
  provider: string;
  model: string;
  durationMs: number;
  fallbackUsed: boolean;
  cacheHit?: boolean;
  promptVersion?: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
  totalTokens?: number;
  finishReason?: string;
  errors?: Array<{ provider: string; code: string }>;
}
