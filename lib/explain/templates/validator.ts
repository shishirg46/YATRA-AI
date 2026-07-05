import type { Template } from "../types";
import type { TemplateCache } from "./cache";

const PLACEHOLDER_RE = /\{\{(\w+)(\?)?(?::(\w+))?\}\}/g;

const EXPECTED_PLACEHOLDERS: Record<string, string[]> = {
  weather: ["destination", "date", "district", "season", "segment"],
  route: ["segment", "from", "to", "distance", "road"],
  health: ["destination", "altitude", "condition", "member"],
  budget: ["budget", "cost", "remaining", "destination"],
  seasonal: ["season", "destination", "month", "district"],
  destination: ["destination", "district", "province"],
  group: ["member", "condition", "count"],
  summary: ["destination", "date", "count"],
  recommendation: ["action", "destination", "reason"],
  intro: ["destination", "date", "tripType"],
  top_tip: ["destination", "tip"],
  evidence: ["source", "date", "value"],
};

interface ValidationError {
  templateId: string;
  group: string;
  condition: string;
  message: string;
}

export function validateAll(cache: TemplateCache): void {
  const errors: ValidationError[] = [];
  const templates = cache.getAll();

  const seen = new Set<string>();

  for (const t of templates) {
    const key = `${t.templateGroup}:${t.condition}:${t.audience}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const expectedKeys = EXPECTED_PLACEHOLDERS[t.templateGroup];
    if (!expectedKeys) continue;

    const matches = [...t.template.matchAll(PLACEHOLDER_RE)];
    const usedKeys = matches.map((m) => m[1]);

    for (const used of usedKeys) {
      if (!expectedKeys.includes(used)) {
        errors.push({
          templateId: t.id,
          group: t.templateGroup,
          condition: t.condition,
          message: `Template uses unknown placeholder "{{${used}}}". Expected one of: ${expectedKeys.join(", ")}`,
        });
      }
    }
  }

  const groupConditions = new Map<string, Set<string>>();
  for (const t of templates) {
    if (!groupConditions.has(t.templateGroup)) {
      groupConditions.set(t.templateGroup, new Set());
    }
    groupConditions.get(t.templateGroup)!.add(t.condition);
  }

  for (const t of templates) {
    const matches = [...t.template.matchAll(PLACEHOLDER_RE)];
    const required = matches.filter((m) => !m[2]);

    for (const match of required) {
      const existsInSome = EXPECTED_PLACEHOLDERS[t.templateGroup]?.includes(match[1]);
      if (!existsInSome) {
        errors.push({
          templateId: t.id,
          group: t.templateGroup,
          condition: t.condition,
          message: `Template has required placeholder "{{${match[1]}}}" but no known provider supplies it.`,
        });
      }
    }
  }

  if (errors.length > 0) {
    const grouped = groupErrors(errors);
    const message = formatErrors(grouped);
    throw new Error(`Template validation failed with ${errors.length} error(s):\n\n${message}`);
  }
}

function groupErrors(errors: ValidationError[]): Map<string, ValidationError[]> {
  const grouped = new Map<string, ValidationError[]>();
  for (const e of errors) {
    const key = `${e.group}/${e.condition}`;
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }
  return grouped;
}

function formatErrors(grouped: Map<string, ValidationError[]>): string {
  const lines: string[] = [];
  for (const [key, errs] of grouped) {
    lines.push(`  ${key}:`);
    for (const e of errs) {
      lines.push(`    - ${e.message}`);
    }
  }
  return lines.join("\n");
}
