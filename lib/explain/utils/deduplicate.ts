import type { EvaluatorResult } from "../types";

export function deduplicate(results: EvaluatorResult[]): EvaluatorResult[] {
  const seen = new Map<string, EvaluatorResult>();

  for (const r of results) {
    const key = r.condition;
    const existing = seen.get(key);
    if (!existing || r.priority > existing.priority) {
      seen.set(key, r);
    }
  }

  return [...seen.values()];
}
