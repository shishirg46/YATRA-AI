import { describe, it, expect } from "vitest";
import { computePriority } from "@/lib/explain/priority";
import type { EvaluatorResult } from "@/lib/explain/types";

function makeResult(overrides: Partial<EvaluatorResult>): EvaluatorResult {
  return {
    condition: "test",
    severity: "MEDIUM",
    audience: "TRAVELER",
    priority: 0,
    placeholders: {},
    trace: [],
    ...overrides,
  };
}

describe("computePriority", () => {
  it("returns higher priority for EXTREME severity", () => {
    const low = computePriority(makeResult({ severity: "LOW" }));
    const extreme = computePriority(makeResult({ severity: "EXTREME" }));
    expect(extreme).toBeGreaterThan(low);
  });

  it("returns ordered priorities by severity", () => {
    const low = computePriority(makeResult({ severity: "LOW" }));
    const med = computePriority(makeResult({ severity: "MEDIUM" }));
    const high = computePriority(makeResult({ severity: "HIGH" }));
    const extreme = computePriority(makeResult({ severity: "EXTREME" }));
    expect(extreme).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(med);
    expect(med).toBeGreaterThan(low);
  });

  it("adds relevance bonus for placeholders", () => {
    const noPlaceholders = computePriority(makeResult({ severity: "HIGH", placeholders: {} }));
    const withPlaceholders = computePriority(makeResult({ severity: "HIGH", placeholders: { a: 1, b: 2 } }));
    expect(withPlaceholders).toBeGreaterThanOrEqual(noPlaceholders);
  });

  it("returns a number between 0 and 100", () => {
    const result = computePriority(makeResult({ severity: "EXTREME", placeholders: { a: 1, b: 2, c: 3 } }));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});
