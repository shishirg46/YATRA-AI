import type { Template, ExplanationItem, DebugTrace, ExplanationContext, EvaluatorResult } from "../types";
import { formatters } from "../utils/formatters";
import { TemplateCache } from "./cache";

const PLACEHOLDER_RE = /\{\{(\w+)(\?)?(?::(\w+))?\}\}/g;

export interface RenderedItem {
  item: ExplanationItem;
  template: Template;
}

export function renderTemplate(template: string, placeholders: Record<string, string | number>): string {
  const rendered = template.replace(PLACEHOLDER_RE, (_match, key: string, optional: string | undefined, formatHint: string | undefined) => {
    const value = placeholders[key];

    if (value === undefined || value === null) {
      if (optional !== undefined) return "";
      return `{{${key}}}`;
    }

    if (formatHint && formatters[formatHint]) {
      return formatters[formatHint](value);
    }

    if (typeof value === "number") {
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(1);
    }

    return String(value);
  });

  return rendered.replace(/\(month ([A-Z][a-z]+)\)/g, "in $1");
}

export function renderResults(
  results: EvaluatorResult[],
  ctx: ExplanationContext,
  cache: TemplateCache,
): RenderedItem[] {
  const rendered: RenderedItem[] = [];

  for (const result of results) {
    const templates = cache.get(
      result.condition.includes("recommendation") ? "recommendation" : inferGroup(result.condition),
      result.condition,
      result.severity,
      result.audience,
    );

    if (templates.length === 0) continue;

    const selected = cache.getLeastRecentlyUsed(templates);
    const text = renderTemplate(selected.template, result.placeholders);

    cache.markUsed(selected.id);

    const debugTrace: DebugTrace = {
      evaluator: inferGroup(result.condition),
      condition: result.condition,
      priority: result.priority,
      templateId: selected.id,
      renderedText: text,
      durationMs: 0,
    };

    const evidence: string[] = [];
    for (const [k, v] of Object.entries(result.placeholders)) {
      evidence.push(`${k}: ${v}`);
    }

    rendered.push({
      item: {
        condition: result.condition,
        severity: result.severity,
        audience: result.audience,
        priority: result.priority,
        text,
        evidence,
        trace: result.trace,
        debugTrace,
      },
      template: selected,
    });
  }

  return rendered;
}

function inferGroup(condition: string): string {
  if (condition.startsWith("recommendation_")) return "recommendation";
  if (condition.startsWith("intro_")) return "intro";
  if (condition.startsWith("top_tip_")) return "top_tip";
  if (condition.startsWith("evidence_")) return "evidence";
  if (condition.includes("rain") || condition.includes("wind") || condition.includes("temperature") || condition.includes("snow") || condition.includes("weather")) return "weather";
  if (condition.includes("route") || condition.includes("segment") || condition.includes("blocked") || condition.includes("advisory") || condition.includes("landslide")) return "route";
  if (condition.includes("health") || condition.includes("altitude") || condition.includes("fitness") || condition.includes("medical")) return "health";
  if (condition.includes("budget") || condition.includes("cost") || condition.includes("expense")) return "budget";
  if (condition.includes("season") || condition.includes("monsoon") || condition.includes("winter")) return "seasonal";
  if (condition.includes("destination") || condition.includes("location")) return "destination";
  if (condition.includes("group") || condition.includes("member") || condition.includes("team")) return "group";
  return "weather";
}
