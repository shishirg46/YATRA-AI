import type { EvaluatorResult } from "../types";

/**
 * Filter and collapse segment-level evaluator results:
 * - Collapse by condition+sectionKey (prefer higher priority)
 * - If a `highway` placeholder exists, keep only major highways to reduce noise
 */
export function filterSegments(results: EvaluatorResult[]): EvaluatorResult[] {
  const seen = new Map<string, EvaluatorResult>();
  const allowedMajorHighways = new Set(["motorway", "trunk", "primary"]);

  for (const r of results) {
    const placeholders: Record<string, any> = (r.placeholders as any) ?? {};

    const sectionKey = (placeholders.sectionKey as string)
      || (placeholders.section as string)
      || (placeholders.road as string)
      || (placeholders.from && placeholders.to ? `${placeholders.from}->${placeholders.to}` : undefined)
      || "<global>";

    const hw = typeof placeholders.highway === "string" ? placeholders.highway.toLowerCase() : undefined;
    if (hw && !allowedMajorHighways.has(hw)) {
      // Skip minor roads to reduce explanation noise
      continue;
    }

    const key = `${r.condition}|${sectionKey}`;
    const existing = seen.get(key);
    if (!existing || r.priority > existing.priority) {
      seen.set(key, r);
    }
  }

  return [...seen.values()];
}

export default filterSegments;
