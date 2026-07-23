import { z } from "zod";

export const AiNarrativeResultSchema = z.object({
  verdict: z.string(),
  whyUnsafe: z.string(),
  groupConflict: z.string(),
  riskExplanation: z.string(),
  healthWarning: z.string(),
  budgetAdvice: z.string(),
  alternativeReason: z.string(),
  topTip: z.string(),
});

export type AiNarrativeResult = z.infer<typeof AiNarrativeResultSchema>;

export function emptyAiNarrativeResult(): AiNarrativeResult {
  return {
    verdict: "",
    whyUnsafe: "",
    groupConflict: "",
    riskExplanation: "",
    healthWarning: "",
    budgetAdvice: "",
    alternativeReason: "",
    topTip: "",
  };
}

export type ProviderErrorCode =
  | "timeout"
  | "429"
  | "json"
  | "network"
  | "auth"
  | "bad_request"
  | "server_error"
  | "unexpected";

export interface ProviderError {
  provider: string;
  code: ProviderErrorCode;
}

export interface AiNarrativeDiagnostics {
  provider: "groq" | "deterministic" | "none";
  model: string;
  durationMs: number;
  fallbackUsed: boolean;
  cacheHit: boolean;
  promptVersion?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  errors?: ProviderError[];
}

export interface CondensedNarrativeInput {
  destination: string;
  travelDates: string;
  tripType: string;
  season: string;
  overallScore: number;
  overallLevel: string;
  riskFactors: Array<{ name: string; severity: string }>;
  weatherSummary: string;
  routeSummary: string;
  budget: { specified: number; estimated: number; feasible: boolean };
  healthSummary: string;
  groupSummary: string;
}

export interface AiNarrativeProvider<TInput> {
  name: string;
  isAvailable(): boolean;
  generate(
    input: TInput,
    signal?: AbortSignal,
  ): Promise<{
    result: AiNarrativeResult;
    diagnostics: Partial<AiNarrativeDiagnostics>;
  }>;
}

export interface CacheEntry {
  result: AiNarrativeResult;
  diagnostics: Partial<AiNarrativeDiagnostics>;
  createdAt: number;
}
