import { describe, it, expect } from "vitest";
import { assemble, buildRecommendations, groupByAudience } from "@/lib/explain/utils/assemble";
import type { ExplanationItem, ConfidenceReport, DebugTrace, EngineMeta } from "@/lib/explain/types";

const sampleItem = (overrides: Partial<ExplanationItem>): ExplanationItem => ({
  condition: "test",
  severity: "LOW",
  audience: "TRAVELER",
  priority: 50,
  text: "Test item",
  evidence: [],
  trace: [],
  debugTrace: {
    evaluator: "test",
    condition: "test",
    priority: 50,
    templateId: "tpl-1",
    renderedText: "Test item",
    durationMs: 0,
  },
  ...overrides,
});

const sampleConfidence: ConfidenceReport = {
  score: 85,
  pillars: { weather: 90, disaster: 80, route: 85, health: 75, historical: 95 },
  freshness: { weatherMinutes: 15, disasterMinutes: 30 },
  providers: { weather: "DHM", routing: "OpenRouteService", disaster: ["BIPAD"], airQuality: "OpenAQ" },
  fallbacks: [],
  reasons: ["Live data available"],
};

const sampleMeta: EngineMeta = {
  engineVersion: "2.0.0",
  templateVersion: 1,
  generationTimeMs: 45,
  templatesUsed: 5,
  evaluatedConditions: 7,
};

describe("assemble", () => {
  it("returns a well-formed ExplanationReport", () => {
    const report = assemble({
      rendered: [sampleItem({ condition: "heavy_rain", severity: "HIGH" })],
      summaryText: "Test summary.",
      confidence: sampleConfidence,
      meta: sampleMeta,
      debugTraces: [],
      topTip: "Stay safe.",
    });

    expect(report.summary.text).toBe("Test summary.");
    expect(report.confidence.score).toBe(85);
    expect(report.meta.templatesUsed).toBe(5);
    expect(report.topTip).toBe("Stay safe.");
  });

  it("groups items by audience", () => {
    const items = [
      sampleItem({ audience: "TRAVELER", condition: "weather" }),
      sampleItem({ audience: "PROFESSIONAL", condition: "route" }),
    ];

    const report = assemble({
      rendered: items,
      summaryText: "",
      confidence: sampleConfidence,
      meta: sampleMeta,
      debugTraces: [],
      topTip: "",
    });

    expect(report.sections).toHaveProperty("traveler");
    expect(report.sections).toHaveProperty("professional");
  });

  it("assigns max severity per audience section", () => {
    const items = [
      sampleItem({ audience: "TRAVELER", severity: "LOW", condition: "a" }),
      sampleItem({ audience: "TRAVELER", severity: "HIGH", condition: "b" }),
    ];

    const report = assemble({
      rendered: items,
      summaryText: "",
      confidence: sampleConfidence,
      meta: sampleMeta,
      debugTraces: [],
      topTip: "",
    });

    expect(report.sections["traveler"].severity).toBe("HIGH");
  });

  it("provides fallback values for empty inputs", () => {
    const report = assemble({
      rendered: [],
      summaryText: "",
      confidence: sampleConfidence,
      meta: sampleMeta,
      debugTraces: [],
      topTip: "",
    });

    expect(report.summary.text).toBe("No summary available.");
    expect(report.topTip).toBe("No specific tip available.");
    expect(report.recommendations).toEqual([]);
  });
});

describe("groupByAudience", () => {
  it("sorts items by priority descending within groups", () => {
    const items = [
      sampleItem({ audience: "TRAVELER", priority: 30, condition: "low" }),
      sampleItem({ audience: "TRAVELER", priority: 90, condition: "high" }),
    ];

    const grouped = groupByAudience(items);
    expect(grouped["traveler"].items[0].priority).toBe(90);
    expect(grouped["traveler"].items[1].priority).toBe(30);
  });
});

describe("buildRecommendations", () => {
  it("extracts recommendation_ prefixed items", () => {
    const items = [
      sampleItem({ condition: "recommendation_carry_umbrella", text: "Carry umbrella", priority: 70 }),
      sampleItem({ condition: "weather", text: "Weather info", priority: 50 }),
    ];

    const recs = buildRecommendations(items);
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("carry_umbrella");
    expect(recs[0].text).toBe("Carry umbrella");
  });
});
