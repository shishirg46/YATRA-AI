import type { Evaluator, ExplanationContext, EvaluatorResult } from "../types";
import { levelToSeverity, levelToAudience } from "../types";
import { computePriority } from "../priority";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const seasonalEvaluator: Evaluator = (ctx: ExplanationContext): EvaluatorResult[] => {
  const results: EvaluatorResult[] = [];
  const input = ctx.report;

  const dest = input.destination.name;
  const sm = input.seasonalModifier;
  const month = new Date(input.startDate).getMonth() + 1;
  const monthName = MONTH_NAMES[month - 1] ?? String(month);

  const isMonsoon = month >= 6 && month <= 9;
  const isWinter = month >= 12 || month <= 2;
  const isPeak = month >= 10 && month <= 11 || month >= 3 && month <= 5;

  if (isMonsoon) {
    const severity: EvaluatorResult["severity"] = "MEDIUM";
    const result: EvaluatorResult = {
      condition: "monsoon_active",
      severity,
      audience: "TRAVELER",
      priority: 0,
      placeholders: {
        destination: dest,
        season: "monsoon",
        month: monthName,
      },
      trace: [`monsoon: month=${month}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (isWinter) {
    const result: EvaluatorResult = {
      condition: "winter_season",
      severity: "MEDIUM",
      audience: "TRAVELER",
      priority: 0,
      placeholders: {
        destination: dest,
        season: "winter",
        month: monthName,
      },
      trace: [`winter season: month=${month}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (isPeak) {
    const result: EvaluatorResult = {
      condition: "peak_travel_season",
      severity: "LOW",
      audience: "TRAVELER",
      priority: 0,
      placeholders: {
        destination: dest,
        season: "peak",
        month: monthName,
      },
      trace: [`peak travel season: month=${month}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (sm && sm.total > 0 && sm.factors.length > 0) {
    const totalModifier = sm.total;
    const severity: EvaluatorResult["severity"] =
      totalModifier > 30 ? "HIGH" : totalModifier > 15 ? "MEDIUM" : "LOW";
    const result: EvaluatorResult = {
      condition: "seasonal_penalty",
      severity,
      audience: severity === "LOW" ? "TRAVELER" : "PROFESSIONAL",
      priority: 0,
      placeholders: {
        destination: dest,
        modifier: Math.round(totalModifier),
        factors: sm.factors.map((f) => f.factor).join(", "),
      },
      trace: [`seasonal modifier total: ${totalModifier}, factors: ${sm.factors.map((f) => f.factor).join(",")}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  return results;
};
