import type { Evaluator, ExplanationContext, EvaluatorResult } from "../types";
import { levelToSeverity, levelToAudience } from "../types";
import { computePriority } from "../priority";

export const destinationEvaluator: Evaluator = (ctx: ExplanationContext): EvaluatorResult[] => {
  const results: EvaluatorResult[] = [];
  const input = ctx.report;

  const dest = input.destination;
  const destName = dest.name;
  const district = dest.district;
  const province = dest.province;

  const score = input.overallScore;
  const level = input.overallLevel;

  if (level === "EXTREME" || level === "HIGH_RISK") {
    const severity = level === "EXTREME" ? "EXTREME" : "HIGH";
    const result: EvaluatorResult = {
      condition: "destination_high_risk",
      severity,
      audience: levelToAudience(severity),
      priority: 0,
      placeholders: {
        destination: destName,
        district,
        province,
        score,
        level,
      },
      trace: [`destination high risk: level=${level}, score=${score}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  const pillarScores = input.pillarScores;
  if (pillarScores) {
    const destPillar = pillarScores.find((p) => p.id === "destination_safety");
    if (destPillar && destPillar.score < 50) {
      const severity = destPillar.level === "HIGH" ? "MEDIUM" : "LOW";
      const result: EvaluatorResult = {
        condition: "destination_low_accessibility",
        severity: severity as any,
        audience: "TRAVELER",
        priority: 0,
        placeholders: {
          destination: destName,
          accessibilityScore: destPillar.score,
        },
        trace: [`destination pillar score: ${destPillar.score}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  return results;
};
