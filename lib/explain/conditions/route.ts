import type { Evaluator, ExplanationContext, EvaluatorResult } from "../types";
import { levelToSeverity, levelToAudience } from "../types";
import { computePriority } from "../priority";

function normalizeRouteDistanceKm(input: ExplanationContext["report"]): number | null {
  const routePlanDistance = input.routePlan?.distanceKm;
  if (typeof routePlanDistance === "number" && Number.isFinite(routePlanDistance) && routePlanDistance > 0) {
    return routePlanDistance;
  }

  const disasterDistance = (input.disasterRouteRisk as any)?.routeDistanceKm;
  if (typeof disasterDistance === "number" && Number.isFinite(disasterDistance) && disasterDistance > 0 && disasterDistance <= 1000) {
    return disasterDistance;
  }

  return null;
}

function sanitizeDisasterRouteReasons(input: ExplanationContext["report"], trace: string[]): string {
  const distanceKm = normalizeRouteDistanceKm(input);
  const cleaned = trace
    .filter((reason) => {
      const match = reason.match(/Long route \((\d+(?:\.\d+)?)km\)/i);
      return !match || Number(match[1]) <= 1000;
    })
    .map((reason) => reason.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (distanceKm && !cleaned.some((reason) => reason.toLowerCase().includes("route distance"))) {
    cleaned.unshift(`Route distance about ${Math.round(distanceKm)} km`);
  }

  return cleaned.slice(0, 3).join("; ");
}

export const routeEvaluator: Evaluator = (ctx: ExplanationContext): EvaluatorResult[] => {
  const results: EvaluatorResult[] = [];
  const input = ctx.report;

  const rr = input.routeRisk;
  const drr = input.disasterRouteRisk;
  const ra = input.routeAssessment;
  const rp = input.routePillar;
  const segs = input.segmentDetails;

  if (rr?.risk && rr.risk !== "LOW") {
    const severity = levelToSeverity(rr.risk);
    const result: EvaluatorResult = {
      condition: "route_risk",
      severity,
      audience: levelToAudience(rr.risk),
      priority: 0,
      placeholders: {
        risk: rr.risk,
        reason: rr.reason ?? "unknown",
      },
      trace: [`routeRisk.risk=${rr.risk}, reason=${rr.reason}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (drr) {
    const drrLevel = (drr as any).routeRiskLevel ?? "SAFE";
    if (drrLevel !== "SAFE") {
      const severity = levelToSeverity(drrLevel);
      const trace = (drr as any).decisionTrace?.reasoning ?? [];
      const reasons = sanitizeDisasterRouteReasons(input, trace);
      const result: EvaluatorResult = {
        condition: "disaster_route_risk",
        severity,
        audience: levelToAudience(drrLevel),
        priority: 0,
        placeholders: {
          riskLevel: drrLevel,
          reasons: reasons || "seasonal and corridor conditions require added caution",
        },
        trace,
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (ra) {
    if (ra.overall !== "LOW") {
      const severity = levelToSeverity(ra.overall);
      const result: EvaluatorResult = {
        condition: "route_assessment",
        severity,
        audience: levelToAudience(ra.overall),
        priority: 0,
        placeholders: {
          overall: ra.overall,
          roadConditions: ra.roadConditions,
          seasonalCorridorRisk: ra.seasonalCorridorRisk,
        },
        trace: [`routeAssessment.overall=${ra.overall}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (rp?.segmentFlags) {
    const blocked = rp.segmentFlags.filter((f) => f.status === "Blocked");
    const advisory = rp.segmentFlags.filter((f) => f.status === "Advisory");

    for (const f of blocked) {
      const result: EvaluatorResult = {
        condition: "route_blocked",
        severity: "EXTREME",
        audience: "EMERGENCY",
        priority: 0,
        placeholders: {
          where: f.where,
          what: f.what,
          effect: f.effect,
        },
        trace: [`segmentFlag blocked: ${f.where} - ${f.what}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }

    for (const f of advisory) {
      const result: EvaluatorResult = {
        condition: "route_advisory",
        severity: "HIGH",
        audience: "PROFESSIONAL",
        priority: 0,
        placeholders: {
          where: f.where,
          what: f.what,
          effect: f.effect,
        },
        trace: [`segmentFlag advisory: ${f.where} - ${f.what}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (segs && segs.length > 0) {
    const highRiskSegs = segs.filter((s) => s.riskLevel === "HIGH" || s.riskLevel === "EXTREME");
    for (const seg of highRiskSegs) {
      const severity = seg.riskLevel === "EXTREME" ? "EXTREME" : "HIGH";
      const result: EvaluatorResult = {
        condition: "segment_risk",
        severity,
        audience: levelToAudience(severity),
        priority: 0,
        placeholders: {
          from: seg.from,
          to: seg.to,
          riskLevel: seg.riskLevel,
          riskScore: seg.riskScore,
          hazards: seg.hazards.length > 0 ? seg.hazards.join(", ") : "none",
        },
        trace: [`segment ${seg.index}: riskLevel=${seg.riskLevel}, score=${seg.riskScore}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  return results;
};
