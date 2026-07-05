import { describe, it, expect } from "vitest";
import { deduplicate } from "@/lib/explain/utils/deduplicate";
import type { EvaluatorResult } from "@/lib/explain/types";

describe("deduplicate", () => {
  it("removes duplicates by condition, keeping highest priority", () => {
    const results: EvaluatorResult[] = [
      { condition: "heavy_rain", severity: "MEDIUM", audience: "TRAVELER", priority: 50, placeholders: {}, trace: [] },
      { condition: "heavy_rain", severity: "HIGH", audience: "TRAVELER", priority: 80, placeholders: {}, trace: [] },
      { condition: "high_winds", severity: "MEDIUM", audience: "TRAVELER", priority: 40, placeholders: {}, trace: [] },
    ];

    const deduped = deduplicate(results);
    expect(deduped).toHaveLength(2);

    const heavyRain = deduped.find((r) => r.condition === "heavy_rain");
    expect(heavyRain?.priority).toBe(80);
    expect(heavyRain?.severity).toBe("HIGH");
  });

  it("returns empty array for empty input", () => {
    expect(deduplicate([])).toEqual([]);
  });

  it("preserves unique conditions", () => {
    const results: EvaluatorResult[] = [
      { condition: "a", severity: "LOW", audience: "TRAVELER", priority: 10, placeholders: {}, trace: [] },
      { condition: "b", severity: "MEDIUM", audience: "TRAVELER", priority: 20, placeholders: {}, trace: [] },
      { condition: "c", severity: "HIGH", audience: "PROFESSIONAL", priority: 30, placeholders: {}, trace: [] },
    ];
    expect(deduplicate(results)).toHaveLength(3);
  });
});
