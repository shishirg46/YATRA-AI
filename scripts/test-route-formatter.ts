import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  formatRouteExplanation,
  mergeRouteExplanation,
  buildFormatterInput,
  isRouteCondition,
} from "../lib/explain/formatters/route-explanation";
import type {
  FormatterInput,
  RiskLevel,
} from "../lib/explain/formatters/route-explanation";
import type { ExplanationReport } from "../lib/explain/types";

// ── Test scenarios ────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  description: string;
  formatterInput: FormatterInput;
  reportItems: { severity: string; condition: string; text: string }[];
}

const NOW = new Date().toISOString();

const scenarios: Scenario[] = [
  {
    name: "low-risk",
    description: "Short intra-district route, low risk, no hazards",
    formatterInput: {
      overallRisk: "LOW",
      corridorFrom: "Kathmandu",
      corridorTo: "Bhaktapur",
      distanceKm: 15,
      durationH: 0.8,
      segments: [
        { from: "Kathmandu", to: "Thimi", riskLevel: "LOW", riskScore: 25, hazards: [] },
        { from: "Thimi", to: "Bhaktapur", riskLevel: "LOW", riskScore: 20, hazards: [] },
      ],
    },
    reportItems: [
      { severity: "MEDIUM", condition: "altitude_concern", text: "Minor altitude adjustment needed for some travellers." },
    ],
  },
  {
    name: "medium-risk",
    description: "Inter-district hilly route with some hazards",
    formatterInput: {
      overallRisk: "MEDIUM",
      corridorFrom: "Kathmandu",
      corridorTo: "Pokhara",
      distanceKm: 200,
      durationH: 6,
      segments: [
        { from: "Kathmandu", to: "Mugling", riskLevel: "MEDIUM", riskScore: 45, hazards: ["Landslide-prone zone", "Narrow road"] },
        { from: "Mugling", to: "Pokhara", riskLevel: "MEDIUM", riskScore: 50, hazards: ["Recent Landslide activity detected"] },
      ],
    },
    reportItems: [
      { severity: "HIGH", condition: "weather_rain", text: "Heavy rain expected during travel hours." },
      { severity: "MEDIUM", condition: "health_fitness", text: "Moderate fitness level required for altitude changes." },
    ],
  },
  {
    name: "high-monsoon",
    description: "Terai flood-prone route during monsoon",
    formatterInput: {
      overallRisk: "HIGH",
      corridorFrom: "Biratnagar",
      corridorTo: "Janakpur",
      distanceKm: 180,
      durationH: 4.5,
      segments: [
        { from: "Biratnagar", to: "Lahan", riskLevel: "HIGH", riskScore: 70, hazards: ["Flood-prone Terai belt", "Recent Flood activity detected"] },
        { from: "Lahan", to: "Janakpur", riskLevel: "HIGH", riskScore: 75, hazards: ["Flood-prone Terai belt", "Heavy rain detected", "Waterlogged road sections"] },
      ],
    },
    reportItems: [
      { severity: "HIGH", condition: "weather_storm", text: "Monsoon storm warning in effect for the region." },
      { severity: "HIGH", condition: "disaster_route_risk", text: "Historic flood frequency indicates high seasonal risk." },
    ],
  },
  {
    name: "multiple-hazards",
    description: "Hill to Terai crossing with flood + landslide + weather",
    formatterInput: {
      overallRisk: "HIGH",
      corridorFrom: "Pokhara",
      corridorTo: "Butwal",
      distanceKm: 280,
      durationH: 7,
      segments: [
        { from: "Pokhara", to: "Syangja", riskLevel: "MEDIUM", riskScore: 55, hazards: ["Landslide-prone zone", "Heavy rain detected"] },
        { from: "Syangja", to: "Butwal", riskLevel: "HIGH", riskScore: 72, hazards: ["Flood-prone Terai belt", "Rain: 15mm/h", "3 notable seismic events nearby"] },
      ],
    },
    reportItems: [
      { severity: "MEDIUM", condition: "budget_cost", text: "Fuel costs may be higher due to detour." },
    ],
  },
  {
    name: "no-segment-details",
    description: "Very short local trip where segmentation didn't produce details",
    formatterInput: {
      overallRisk: "MEDIUM",
      corridorFrom: "Kathmandu",
      corridorTo: "Kathmandu",
      distanceKm: 5,
      durationH: 0.25,
      segments: [],
    },
    reportItems: [
      { severity: "MEDIUM", condition: "health_altitude", text: "No significant altitude concerns for this route." },
    ],
  },
  {
    name: "no-route-intelligence",
    description: "Route exists but no intelligence (outside Nepal or routing unavailable)",
    formatterInput: {
      overallRisk: "MEDIUM",
      corridorFrom: "Origin",
      corridorTo: "Destination",
      distanceKm: 0,
      durationH: 0,
      segments: [],
    },
    reportItems: [
      { severity: "HIGH", condition: "destination_safety", text: "Standard safety precautions recommended." },
    ],
  },
];

// ── Build fake report for mergeRouteExplanation test ───────────────────────

function buildFakeReport(items: { severity: string; condition: string; text: string }[]): ExplanationReport {
  return {
    summary: { text: "Test summary", stacks: {} },
    sections: {
      test: {
        items: items.map((i) => ({
          severity: i.severity as any,
          condition: i.condition,
          text: i.text,
          id: i.condition,
        })),
        score: 0,
        maxScore: 100,
        weight: 1,
      },
    },
    recommendations: [],
    confidence: { overall: 0.8, dataQuality: 0.8, dataFreshness: 0.8, providerReliability: 0.8 },
    topTip: "Test",
    debugTraces: [],
    meta: { engineVersion: "test", templateVersion: 1, generationTimeMs: 0, templatesUsed: 0, evaluatedConditions: 0 },
  };
}

// ── Automated checks ──────────────────────────────────────────────────────

interface CheckResult {
  check: string;
  passed: boolean;
  detail?: string;
}

function runChecks(scenario: Scenario, formatted: { riskExplanation: string; routeAdvice: string }, report: ExplanationReport): CheckResult[] {
  const results: CheckResult[] = [];

  // 1. No "0 segments"
  results.push({
    check: "No '0 segments' in output",
    passed: !formatted.riskExplanation.includes("0 segments"),
  });

  // 2. No "undefined" or "null"
  results.push({
    check: "No undefined/null in output",
    passed: !formatted.riskExplanation.includes("undefined") && !formatted.riskExplanation.includes("null"),
  });

  // 3. Length ≤ 600 chars
  results.push({
    check: `Length ≤ 600 (actual: ${formatted.riskExplanation.length})`,
    passed: formatted.riskExplanation.length <= 600,
    detail: `${formatted.riskExplanation.length} chars`,
  });

  // 4. Check hazard deduplication within same-segment detail
  // The formatter summarizes category repeats (e.g. "Flood risk" + "Flood" → "elevated (multiple sources)")
  // Cross-segment repetition is intentional; only flag if a category label repeats in the merged summary
  const mergedSummary = mergeRouteExplanation(report, formatted).split(".").slice(0, 3).join(".");
  const categoriesFound = ["Flood", "Landslide", "Seismic activity", "Rainfall"];
  const repeated = categoriesFound.filter((c) => (mergedSummary.match(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length > 1);
  results.push({
    check: "No repeated category in summary section",
    passed: repeated.length === 0,
    detail: repeated.length > 0 ? `Repeated: ${repeated.join(", ")}` : undefined,
  });

  // 5. Recommendation present on HIGH/EXTREME
  if (scenario.formatterInput.overallRisk === "HIGH" || scenario.formatterInput.overallRisk === "EXTREME") {
    results.push({
      check: "Recommendation present on HIGH/EXTREME",
      passed: formatted.routeAdvice.toLowerCase().includes("recommendation") || formatted.routeAdvice.toLowerCase().includes("consider"),
    });
  }

  // 6. Worst segment mentioned when segments exist
  if (scenario.formatterInput.segments.length > 0) {
    const worstScore = Math.max(...scenario.formatterInput.segments.map((s) => s.riskScore));
    const worstIndex = scenario.formatterInput.segments.findIndex((s) => s.riskScore === worstScore);
    const worstName = `${scenario.formatterInput.segments[worstIndex]?.from} → ${scenario.formatterInput.segments[worstIndex]?.to}`;
    results.push({
      check: `Worst segment mentioned: ${worstName} (score ${worstScore})`,
      passed: formatted.riskExplanation.includes(worstName.split(" → ")[1] ?? worstName),
      detail: worstName,
    });
  }

  // 7. No sentence > 180 chars (readability)
  const sentences = formatted.riskExplanation.split(/[.?!]/).filter(Boolean);
  const longSentences = sentences.filter((s) => s.trim().length > 180);
  results.push({
    check: `No sentence exceeds 180 chars (longest: ${Math.max(...sentences.map((s) => s.trim().length), 0)})`,
    passed: longSentences.length === 0,
    detail: longSentences.length > 0 ? `Long: ${longSentences[0].trim().slice(0, 100)}...` : undefined,
  });

  // 8. Empty corridor names
  results.push({
    check: "Corridor names not empty",
    passed: scenario.formatterInput.corridorFrom.trim().length > 0 && scenario.formatterInput.corridorTo.trim().length > 0,
  });

  // 9. mergeRouteExplanation preserves ordering
  const merged = mergeRouteExplanation(report, { riskExplanation: formatted.riskExplanation, routeAdvice: formatted.routeAdvice });
  const hasFormattedText = merged.includes(formatted.riskExplanation);
  results.push({
    check: "Merge includes formatter output",
    passed: hasFormattedText,
  });

  // 10. routeAdvice has content
  results.push({
    check: "routeAdvice has content",
    passed: formatted.routeAdvice.trim().length > 0,
    detail: `${formatted.routeAdvice.trim().length} chars`,
  });

  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const outDir = join(__dirname, "test-outputs");
  mkdirSync(outDir, { recursive: true });

  const reportLines: string[] = [];
  reportLines.push("# Route Formatter Test Report");
  reportLines.push(`Generated: ${NOW}\n`);

  let allPassed = true;

  for (const scenario of scenarios) {
    const scenarioDir = join(outDir, scenario.name);
    mkdirSync(scenarioDir, { recursive: true });

    // Run formatter
    const formatted = formatRouteExplanation(scenario.formatterInput);
    const fakeReport = buildFakeReport(scenario.reportItems);
    const merged = mergeRouteExplanation(fakeReport, formatted);

    // Save artifacts
    writeFileSync(join(scenarioDir, "formatter-input.json"), JSON.stringify(scenario.formatterInput, null, 2));
    writeFileSync(join(scenarioDir, "output.json"), JSON.stringify({ riskExplanation: formatted.riskExplanation, routeAdvice: formatted.routeAdvice, merged }, null, 2));

    // Run checks
    const checks = runChecks(scenario, formatted, fakeReport);
    const passed = checks.every((c) => c.passed);
    if (!passed) allPassed = false;

    // Build report section
    reportLines.push(`## ${scenario.name}`);
    reportLines.push(`*${scenario.description}*`);
    reportLines.push("");
    reportLines.push(`**Overall risk:** ${scenario.formatterInput.overallRisk} | **Segments:** ${scenario.formatterInput.segments.length}`);
    reportLines.push("");
    reportLines.push("### riskExplanation");
    reportLines.push(`\`\`\`\n${formatted.riskExplanation}\n\`\`\``);
    reportLines.push("");
    reportLines.push("### routeAdvice");
    reportLines.push(`\`\`\`\n${formatted.routeAdvice}\n\`\`\``);
    reportLines.push("");
    reportLines.push("### Merged");
    reportLines.push(`\`\`\`\n${merged}\n\`\`\``);
    reportLines.push("");
    reportLines.push("### Checks");
    for (const c of checks) {
      reportLines.push(`- ${c.passed ? "✅" : "❌"} ${c.check}${c.detail ? ` (${c.detail})` : ""}`);
    }
    reportLines.push("");
  }

  reportLines.push("---");
  reportLines.push(`**Overall: ${allPassed ? "ALL PASSED ✅" : "SOME FAILED ❌"}**`);

  const md = reportLines.join("\n");
  writeFileSync(join(outDir, "report.md"), md);
  console.log(md);
}

main();
