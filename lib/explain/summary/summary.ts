import type { ExplanationItem, ExplanationContext } from "../types";
import { TemplateCache } from "../templates/cache";
import { renderTemplate } from "../templates/renderer";

export function buildSummary(
  items: ExplanationItem[],
  ctx: ExplanationContext,
  cache: TemplateCache,
): string {
  const dest = ctx.report.destination.name;

  const highItems = items.filter((i) => i.severity === "EXTREME" || i.severity === "HIGH");
  const medItems = items.filter((i) => i.severity === "MEDIUM");
  const lowItems = items.filter((i) => i.severity === "LOW");

  const templates = cache.get("summary", "summary_text");
  if (templates.length === 0) {
    const highText = highItems.length > 0
      ? `${highItems.length} significant risk${highItems.length > 1 ? "s" : ""} identified`
      : "";
    const medText = medItems.length > 0
      ? `${medItems.length} moderate concern${medItems.length > 1 ? "s" : ""}`
      : "";
    const parts = [highText, medText].filter(Boolean);
    return parts.length > 0
      ? `${dest}: ${parts.join(", ")}.`
      : `${dest}: Conditions appear favorable for travel.`;
  }

  const selected = cache.getLeastRecentlyUsed(templates);
  cache.markUsed(selected.id);

  return renderTemplate(selected.template, {
    destination: dest,
    highCount: highItems.length,
    medCount: medItems.length,
    lowCount: lowItems.length,
    totalCount: items.length,
  });
}
