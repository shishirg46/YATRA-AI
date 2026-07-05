import type { Evaluator, ExplanationContext, EvaluatorResult } from "../types";
import { levelToSeverity, levelToAudience } from "../types";
import { computePriority } from "../priority";

export const budgetEvaluator: Evaluator = (ctx: ExplanationContext): EvaluatorResult[] => {
  const results: EvaluatorResult[] = [];
  const input = ctx.report;

  const budget = input.budget;
  const dest = input.destination.name;

  if (!budget) return results;

  const specified = budget.specified;
  const estimated = budget.estimatedTotal;
  const remaining = budget.remainingBudget;
  const shortfall = budget.shortfall;

  if (shortfall > 0) {
    const result: EvaluatorResult = {
      condition: "budget_overrun",
      severity: "HIGH",
      audience: "PROFESSIONAL",
      priority: 0,
      placeholders: {
        destination: dest,
        budget: specified,
        estimated,
        shortfall,
      },
      trace: [`budget overrun: estimated=${estimated}, specified=${specified}, shortfall=${shortfall}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  const remainingRatio = specified > 0 ? remaining / specified : 1;
  if (remainingRatio < 0.15 && specified > 0) {
    const remainingPct = Math.round(remainingRatio * 100);
    const result: EvaluatorResult = {
      condition: "budget_tight",
      severity: "MEDIUM",
      audience: "TRAVELER",
      priority: 0,
      placeholders: {
        destination: dest,
        budget: specified,
        remaining,
        remainingPercent: remainingPct,
      },
      trace: [`budget tight: ${remainingPct}% remaining`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (remainingRatio > 0.5 && specified > 0) {
    const remainingPct = Math.round(remainingRatio * 100);
    const result: EvaluatorResult = {
      condition: "budget_sufficient",
      severity: "LOW",
      audience: "TRAVELER",
      priority: 0,
      placeholders: {
        destination: dest,
        budget: specified,
        remaining,
        remainingPercent: remainingPct,
      },
      trace: [`budget sufficient: ${remainingPct}% remaining`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  return results;
};
