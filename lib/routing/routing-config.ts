/**
 * Multi-cost routing coefficients.
 *
 * Balanced routing cost (internal only — no user-facing modes yet):
 *
 *   edgeWeight = α·distance
 *              + β·riskPenalty
 *              + γ·roadQualityPenalty
 *              + δ·directionPenalty
 *              + ε·monsoonPenalty
 *
 * This is NOT a "safest" mode. It is a balanced cost that guides the
 * routing engine away from obviously dangerous roads using the edge's
 * intrinsic risk attributes, without replacing the separate safety layer.
 *
 * The graph answers "Can I travel there?"
 * The safety layer answers "How safe is that travel right now?"
 *
 * Monsoon penalty uses a graded approach:
 *   Open road                    cost += 0
 *   High monsoon risk            cost += 50
 *   Very high risk               cost += 200
 *   Confirmed blocked            Exclude from graph
 *
 * Only remove a road when:
 *   - officially closed
 *   - landslide blockage confirmed
 *   - bridge failure
 *   - road inaccessible
 */
export const ROUTING_COEFFICIENTS = {
  alpha: 1.0,          // distance weight
  beta: 0.3,           // risk penalty weight (landslide + flood + monsoon)
  gamma: 1.5,          // road quality penalty weight
  delta: 0.8,          // direction penalty weight
  epsilon: 0.5,        // monsoon season weight (applied during Jun-Sep)
} as const;

export type RoutingConfig = typeof ROUTING_COEFFICIENTS;

export function roadQualityPenalty(reliabilityScore: number | null): number {
  if (reliabilityScore == null) return 0.5;
  return 1 - reliabilityScore;
}

/** Accessibility penalty: poor-condition roads add cost */
export function accessibilityPenalty(roadCondition: string | null): number {
  switch (roadCondition) {
    case "GOOD": return 0;
    case "FAIR": return 1;
    case "POOR": return 3;
    case "DIRT_TRACK": return 6;
    case "IMPASSABLE": return 50;
    default: return 2;
  }
}

/**
 * Risk penalty based on edge-level hazard attributes.
 * Higher values for landslide-prone mountain roads and flood-prone river corridors.
 */
export function riskPenalty(params: {
  landslideRisk: number | null;
  floodRisk: number | null;
  monsoonVulnerability: number | null;
}): number {
  const l = params.landslideRisk ?? 0.1;
  const f = params.floodRisk ?? 0.1;
  const m = params.monsoonVulnerability ?? 0.1;
  // Weighed: landslide 40%, flood 30%, monsoon vulnerability 30%
  return (l * 0.4 + f * 0.3 + m * 0.3) * 5;
}

/**
 * Monsoon season penalty — graded approach.
 *
 *   score 0.0–0.3  →  0      (open road)
 *   score 0.3–0.6  →  50     (high monsoon risk)
 *   score 0.6–0.8  →  200    (very high risk)
 *   score >0.8     →  Infinity (exclude — blocked/confirmed closed)
 */
export function monsoonPenalty(monsoonVulnerability: number | null): number {
  const m = monsoonVulnerability ?? 0;
  if (m > 0.8) return Infinity;
  if (m > 0.6) return 200;
  if (m > 0.3) return 50;
  return 0;
}

/**
 * Direction penalty for an edge.
 * closingRatio = (distToDest_current - distToDest_next) / edgeDistanceKm
 *   → 1.0  = directly toward destination
 *   → 0.0  = perpendicular
 *   → -1.0 = directly away
 * Returns 0 (perfect heading) … 2 (heading away).
 */
export function directionPenalty(
  distToDestCurrentKm: number,
  distToDestNextKm: number,
  edgeDistanceKm: number,
): number {
  if (edgeDistanceKm <= 0) return 0;
  const closingRatio = (distToDestCurrentKm - distToDestNextKm) / edgeDistanceKm;
  return Math.max(0, 1 - closingRatio);
}

/**
 * Balanced routing weight.
 * Cost = α·distance + β·riskPenalty + γ·roadQualityPenalty + δ·directionPenalty + ε·monsoonPenalty
 */
export function computeEdgeWeight(params: {
  distanceKm: number;
  reliabilityScore: number | null;
  landslideRisk: number | null;
  floodRisk: number | null;
  monsoonVulnerability: number | null;
  roadCondition: string | null;
  distToDestCurrentKm: number;
  distToDestNextKm: number;
  isMonsoon?: boolean;
  coefficients?: Partial<RoutingConfig>;
}): number {
  const c = { ...ROUTING_COEFFICIENTS, ...params.coefficients };

  const distCost = c.alpha * params.distanceKm;
  const riskCost = c.beta * riskPenalty({
    landslideRisk: params.landslideRisk,
    floodRisk: params.floodRisk,
    monsoonVulnerability: params.monsoonVulnerability,
  });
  const roadCost = c.gamma * roadQualityPenalty(params.reliabilityScore);
  const dirCost = c.delta * directionPenalty(
    params.distToDestCurrentKm,
    params.distToDestNextKm,
    params.distanceKm,
  );
  const monsoonCost = params.isMonsoon
    ? c.epsilon * monsoonPenalty(params.monsoonVulnerability)
    : 0;

  const total = distCost + riskCost + roadCost + dirCost + monsoonCost;

  // If monsoon penalty returns Infinity, the edge is impassable
  if (!Number.isFinite(total)) return Infinity;

  return total;
}

/** Safety-only score per edge. Call this as a post-processing overlay. */
export function computeEdgeSafetyScore(params: {
  distanceKm: number;
  landslideRisk: number | null;
  floodRisk: number | null;
  weatherSensitivity: number | null;
  monsoonVulnerability: number | null;
}): {
  landslideScore: number;
  floodScore: number;
  weatherScore: number;
  monsoonScore: number;
  composite: number;
} {
  const l = params.landslideRisk ?? 0;
  const f = params.floodRisk ?? 0;
  const w = params.weatherSensitivity ?? 0;
  const m = params.monsoonVulnerability ?? 0;
  const composite = (l + f + w + m) / 4;

  return {
    landslideScore: Math.round(l * 100) / 100,
    floodScore: Math.round(f * 100) / 100,
    weatherScore: Math.round(w * 100) / 100,
    monsoonScore: Math.round(m * 100) / 100,
    composite: Math.round(composite * 100) / 100,
  };
}
