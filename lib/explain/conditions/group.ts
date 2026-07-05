import type { Evaluator, ExplanationContext, EvaluatorResult } from "../types";
import { levelToSeverity, levelToAudience, severityToLevel } from "../types";
import { computePriority } from "../priority";

export const groupEvaluator: Evaluator = (ctx: ExplanationContext): EvaluatorResult[] => {
  const results: EvaluatorResult[] = [];
  const input = ctx.report;

  const members = input.memberAnalyses;
  const mostVulnerable = input.mostVulnerableMember;
  const groupAvg = input.groupAvgScore;
  const overall = input.overallScore;

  if (members && members.length > 1) {
    const fitnessLevels = members.map((m) => {
      const health = (m as any).health;
      return health?.fitnessLevel ?? "MODERATE";
    });

    const hasLowFitness = fitnessLevels.some((f) => f === "LOW");
    const hasHighFitness = fitnessLevels.some((f) => f === "HIGH");

    if (hasLowFitness && hasHighFitness) {
      const result: EvaluatorResult = {
        condition: "mixed_fitness_group",
        severity: "MEDIUM",
        audience: "PROFESSIONAL",
        priority: 0,
        placeholders: {
          count: members.length,
          lowCount: fitnessLevels.filter((f) => f === "LOW").length,
          highCount: fitnessLevels.filter((f) => f === "HIGH").length,
        },
        trace: [`mixed fitness: ${fitnessLevels.join(",")}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (mostVulnerable && members && members.length > 1) {
    const risks = mostVulnerable.risks ?? [];
    if (risks.length > 0) {
      const result: EvaluatorResult = {
        condition: "vulnerable_member_in_group",
        severity: "HIGH",
        audience: "PROFESSIONAL",
        priority: 0,
        placeholders: {
          member: mostVulnerable.name ?? "A group member",
          risks: risks.join(", "),
        },
        trace: [`vulnerable member: ${mostVulnerable.name}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (groupAvg > 0 && overall > 0 && Math.abs(groupAvg - overall) > 20) {
    const gap = Math.round(Math.abs(groupAvg - overall));
    const result: EvaluatorResult = {
      condition: "group_avg_diverges",
      severity: "MEDIUM",
      audience: "PROFESSIONAL",
      priority: 0,
      placeholders: {
        groupScore: Math.round(groupAvg),
        overallScore: Math.round(overall),
        gap,
      },
      trace: [`groupAvg ${Math.round(groupAvg)} diverges from overall ${Math.round(overall)}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (input.conflict) {
    const result: EvaluatorResult = {
      condition: "group_conflict",
      severity: "MEDIUM",
      audience: "PROFESSIONAL",
      priority: 0,
      placeholders: {
        destination: input.destination.name,
      },
      trace: ["group conflict detected"],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  return results;
};
