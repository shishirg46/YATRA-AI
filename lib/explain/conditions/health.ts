import type { Evaluator, ExplanationContext, EvaluatorResult } from "../types";
import { levelToSeverity, levelToAudience, severityToLevel } from "../types";
import { computePriority } from "../priority";

export const healthEvaluator: Evaluator = (ctx: ExplanationContext): EvaluatorResult[] => {
  const results: EvaluatorResult[] = [];
  const input = ctx.report;

  const health = input.healthAdvisories;
  const members = input.memberAnalyses;
  const mostVulnerable = input.mostVulnerableMember;
  const dest = input.destination.name;

  if (health && health.length > 0) {
    for (const advisory of health) {
      const severity = levelToSeverity(advisory.risk ?? "MEDIUM");
      const result: EvaluatorResult = {
        condition: "health_advisory",
        severity,
        audience: levelToAudience(advisory.risk ?? "MEDIUM"),
        priority: 0,
        placeholders: {
          destination: dest,
          advisory: advisory.detail ?? advisory.condition ?? "health concern",
          condition: advisory.condition,
          risk: advisory.risk,
        },
        trace: [`healthAdvisory: ${advisory.condition} - ${advisory.risk}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (mostVulnerable) {
    const risks = mostVulnerable.risks ?? [];
    if (risks.length > 0) {
      const result: EvaluatorResult = {
        condition: "vulnerable_member_health",
        severity: "HIGH",
        audience: "PROFESSIONAL",
        priority: 0,
        placeholders: {
          destination: dest,
          member: mostVulnerable.name ?? "a group member",
          conditions: risks.join(", "),
          count: risks.length,
        },
        trace: [`mostVulnerableMember: ${mostVulnerable.name}, risks: ${risks.join(",")}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (members && members.length > 0) {
    const altSensitive = members.filter((m) => (m as any).altitudeRisk);
    if (altSensitive.length > 0) {
      for (const m of altSensitive) {
        const result: EvaluatorResult = {
          condition: "altitude_risk_member",
          severity: "MEDIUM",
          audience: "TRAVELER",
          priority: 0,
          placeholders: {
            destination: dest,
            member: m.name ?? "A group member",
            condition: (m as any).altitudeRisk ?? "altitude sensitivity",
          },
          trace: [`altitudeRisk member: ${m.name}`],
        };
        result.priority = computePriority(result);
        results.push(result);
      }
    }
  }

  const altitude = input.locationInfo.altitude ?? 0;
  if (altitude > 3000) {
    const result: EvaluatorResult = {
      condition: "high_altitude",
      severity: altitude > 4000 ? "HIGH" : "MEDIUM",
      audience: "TRAVELER",
      priority: 0,
      placeholders: {
        destination: dest,
        altitude,
      },
      trace: [`altitude: ${altitude}m`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  return results;
};
