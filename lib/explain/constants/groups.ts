export const TEMPLATE_GROUPS = [
  "weather",
  "route",
  "health",
  "budget",
  "seasonal",
  "destination",
  "group",
  "summary",
  "recommendation",
  "intro",
  "top_tip",
  "evidence",
] as const;

export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];
