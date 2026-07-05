// ─── Planner — Deterministic Route Safety Assessment ──────────────────────────

import {
  type PlannerRouteInput,
  type PlannerOutput,
} from "./types";

export function generatePlannerOutput(
  input: PlannerRouteInput,
): PlannerOutput {
  const sv = input.summary.severityScore;
  return {
    assessment: sv >= 75 ? "avoid" : sv >= 50 ? "high_risk" : sv >= 25 ? "caution" : "safe",
    severityScore: sv,
    summary: `Route assessment based on pre-computed intelligence. ${input.summary.totalHazards} hazards detected across ${input.summary.affectedPercent.toFixed(1)}% of the route. Estimated delay: ${input.summary.estimatedDelayMin} min.`,
    hazardHotspots: input.clusters.map((c) => ({
      km: Math.round((c.startKm + c.endKm) / 2 * 1000) / 1000,
      type: c.hazardType,
      description: `${c.hazardCount} ${c.hazardType} event(s) from km ${c.startKm.toFixed(1)} to ${c.endKm.toFixed(1)}`,
      advice: `Exercise caution through this ${c.severity} ${c.hazardType} zone`,
    })),
    timingAdvice: {
      bestDepartureWindow: null,
      avoidNightDriving: input.summary.highestSeverity !== "low",
      estimatedDelayMin: input.summary.estimatedDelayMin,
    },
    recommendations: [
      sv >= 50 ? "Consider an alternative route due to significant hazards" : "Route appears passable with normal caution",
      ...(input.summary.estimatedDelayMin > 30 ? [`Allow extra ${input.summary.estimatedDelayMin} min for hazard-related delays`] : []),
      "Check local weather and road conditions before departure",
    ],
    alternativeRoutes: sv >= 50
      ? [{ description: "Seek alternative route", reason: "Current route has significant hazard exposure" }]
      : [],
  };
}

export const generatePlannerOutputSafe = generatePlannerOutput;
