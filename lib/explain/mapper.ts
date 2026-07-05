import type { AiResult } from "@/lib/plan/pipeline-types";
import type { ExplanationReport, EvaluatorInput } from "./types";
import { ExplanationEngine } from "./engine";
import { TemplateCache } from "./templates/cache";

export interface MappedAiOutput {
  ai: AiResult;
  routeAdvice: string;
}

export function explanationToAiResult(
  er: ExplanationReport,
  hasAlternatives: boolean,
  topAlt?: { name: string; district: string; safetyScore: number },
): MappedAiOutput {
  const highSeverityItems = Object.values(er.sections)
    .flatMap((s) => s.items)
    .filter((i) => i.severity === "EXTREME" || i.severity === "HIGH");

  const medSeverityItems = Object.values(er.sections)
    .flatMap((s) => s.items)
    .filter((i) => i.severity === "MEDIUM");

  const healthItems = Object.values(er.sections)
    .flatMap((s) => s.items)
    .filter((i) =>
      i.condition.includes("health") ||
      i.condition.includes("altitude") ||
      i.condition.includes("fitness") ||
      i.condition.includes("vulnerable"),
    );

  const budgetItems = Object.values(er.sections)
    .flatMap((s) => s.items)
    .filter((i) => i.condition.includes("budget") || i.condition.includes("cost"));

  const groupConflictItems = Object.values(er.sections)
    .flatMap((s) => s.items)
    .filter((i) =>
      i.condition.includes("group") ||
      i.condition.includes("conflict") ||
      i.condition.includes("mixed_fitness"),
    );

  const routeItems = Object.values(er.sections)
    .flatMap((s) => s.items)
    .filter((i) =>
      i.condition.includes("route") ||
      i.condition.includes("segment") ||
      i.condition.includes("blocked") ||
      i.condition.includes("disaster"),
    );

  const verdict = er.summary.text || `Conditions assessed: ${highSeverityItems.length} significant concern(s).`;
  const topTip = er.topTip;

  const riskExplanationParts: string[] = [];
  for (const item of highSeverityItems) {
    if (item.text) riskExplanationParts.push(item.text);
  }
  for (const item of medSeverityItems) {
    if (item.text) riskExplanationParts.push(item.text);
  }
  const riskExplanation = riskExplanationParts.slice(0, 5).join(" ");

  const whyUnsafe = highSeverityItems.length > 0
    ? highSeverityItems.slice(0, 2).map((i) => i.text).join(" ")
    : "";

  const budgetAdvice = budgetItems.length > 0
    ? budgetItems.slice(0, 2).map((i) => i.text).join(" ")
    : "";

  const healthWarning = healthItems.length > 0
    ? healthItems.slice(0, 2).map((i) => i.text).join(" ")
    : "";

  const groupConflict = groupConflictItems.length > 0
    ? groupConflictItems.slice(0, 2).map((i) => i.text).join(" ")
    : "";

  let alternativeReason = "";
  if (hasAlternatives && topAlt) {
    alternativeReason = `Consider ${topAlt.name} (${topAlt.district}) as a safer alternative (score: ${topAlt.safetyScore}/100).`;
  }

  const routeAdvice = routeItems.length > 0
    ? routeItems.slice(0, 3).map((i) => i.text).join(" ")
    : "";

  return {
    ai: {
      verdict,
      whyUnsafe,
      groupConflict,
      riskExplanation,
      healthWarning,
      budgetAdvice,
      alternativeReason,
      topTip,
    },
    routeAdvice,
  };
}

export async function runExplanationEngine(
  input: EvaluatorInput,
): Promise<{ report: ExplanationReport; output: MappedAiOutput }> {
  const engine = new ExplanationEngine(TemplateCache.instance);
  const report = await engine.run(input);

  const hasAlternatives = (input.alternatives?.length ?? 0) > 0;
  const topAlt = hasAlternatives && input.alternatives?.[0]
    ? { name: input.alternatives[0].name, district: input.alternatives[0].district, safetyScore: input.alternatives[0].safetyScore }
    : undefined;

  const output = explanationToAiResult(report, hasAlternatives, topAlt);

  return { report, output };
}
