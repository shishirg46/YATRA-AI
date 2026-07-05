import type { EvaluatorResult } from "../types";
import { TemplateCache } from "./cache";

export interface SelectorOptions {
  cache: TemplateCache;
}

export interface SelectedMatch {
  result: EvaluatorResult;
  templateId: string;
  templateText: string;
}

export function selectTemplates(results: EvaluatorResult[], cache: TemplateCache): SelectedMatch[] {
  const matches: SelectedMatch[] = [];

  for (const result of results) {
    const group = inferGroup(result.condition);
    const templates = cache.get(group, result.condition, result.severity, result.audience);

    if (templates.length === 0) {
      const fallbackTemplates = cache.get(group, result.condition);
      if (fallbackTemplates.length === 0) continue;
      const t = cache.getLeastRecentlyUsed(fallbackTemplates);
      cache.markUsed(t.id);
      matches.push({ result, templateId: t.id, templateText: t.template });
      continue;
    }

    const selected = cache.getLeastRecentlyUsed(templates);
    cache.markUsed(selected.id);
    matches.push({ result, templateId: selected.id, templateText: selected.template });
  }

  return matches;
}

function inferGroup(condition: string): string {
  if (condition.startsWith("recommendation_")) return "recommendation";
  if (condition.includes("rain") || condition.includes("wind") || condition.includes("temperature") || condition.includes("snow") || condition.includes("weather")) return "weather";
  if (condition.includes("route") || condition.includes("segment") || condition.includes("blocked") || condition.includes("advisory") || condition.includes("landslide")) return "route";
  if (condition.includes("health") || condition.includes("altitude") || condition.includes("fitness") || condition.includes("medical")) return "health";
  if (condition.includes("budget") || condition.includes("cost") || condition.includes("expense")) return "budget";
  if (condition.includes("season") || condition.includes("monsoon") || condition.includes("winter")) return "seasonal";
  if (condition.includes("destination") || condition.includes("location")) return "destination";
  if (condition.includes("group") || condition.includes("member") || condition.includes("team")) return "group";
  return "weather";
}
