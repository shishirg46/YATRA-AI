import type { EvaluatorResult } from "./types";

export function computePriority(result: EvaluatorResult): number {
  const severityWeights: Record<string, number> = {
    LOW: 0.3,
    MEDIUM: 0.5,
    HIGH: 0.75,
    EXTREME: 1.0,
  };

  const sw = severityWeights[result.severity] ?? 0.5;
  const base = sw * 100;
  const relevance = result.placeholders ? Object.keys(result.placeholders).length * 5 : 0;

  return Math.round(Math.min(base + relevance, 100));
}
