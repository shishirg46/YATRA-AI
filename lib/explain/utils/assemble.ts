import type {
  ExplanationReport,
  ExplanationItem,
  ConfidenceReport,
  DebugTrace,
  EngineMeta,
  Audience,
  Severity,
} from "../types";
import { severityToLevel } from "../types";
import { SEVERITY_ORDER } from "../constants/severities";

export interface AssembleParams {
  rendered: ExplanationItem[];
  summaryText: string;
  confidence: ConfidenceReport;
  meta: EngineMeta;
  debugTraces: DebugTrace[];
  topTip: string;
}

export function groupByAudience(items: ExplanationItem[]): Record<string, { audience: Audience; items: ExplanationItem[]; severity: Severity }> {
  const groups = new Map<Audience, ExplanationItem[]>();

  for (const item of items) {
    const arr = groups.get(item.audience) ?? [];
    arr.push(item);
    groups.set(item.audience, arr);
  }

  const result: Record<string, { audience: Audience; items: ExplanationItem[]; severity: Severity }> = {};

  for (const [audience, list] of groups) {
    const maxSeverity = list.reduce<Severity>((max, item) => {
      return severityToLevel(item.severity) > severityToLevel(max) ? item.severity : max;
    }, "LOW");

    result[audience.toLowerCase()] = {
      audience,
      items: list.sort((a, b) => b.priority - a.priority),
      severity: maxSeverity,
    };
  }

  return result;
}

export function buildRecommendations(items: ExplanationItem[]): { type: string; text: string; priority: number }[] {
  return items
    .filter((i) => i.condition.startsWith("recommendation_"))
    .map((i) => ({
      type: i.condition.replace("recommendation_", ""),
      text: i.text,
      priority: i.priority,
    }))
    .sort((a, b) => b.priority - a.priority);
}

export function buildSummaryStacks(items: ExplanationItem[]) {
  const positive = items.filter((i) => severityToLevel(i.severity) <= 0);
  const negative = items.filter((i) => severityToLevel(i.severity) >= 1 && i.severity !== "MEDIUM");
  const recommendation = items.filter((i) => i.condition.startsWith("recommendation_"));

  return {
    positive,
    negative,
    recommendation,
  };
}

export function assemble(params: AssembleParams): ExplanationReport {
  const { rendered, summaryText, confidence, meta, debugTraces, topTip } = params;

  const sections = groupByAudience(rendered);
  const recommendations = buildRecommendations(rendered);
  const stacks = buildSummaryStacks(rendered);

  return {
    summary: {
      text: summaryText || "No summary available.",
      stacks,
    },
    sections,
    recommendations,
    confidence,
    topTip: topTip || "No specific tip available.",
    debugTraces,
    meta,
  };
}
