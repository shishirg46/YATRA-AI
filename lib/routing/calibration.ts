/**
 * calibration.ts — routing parameter profile registry (Phase 5.9).
 *
 * This is the ONLY place where routing behavior differences are defined.
 * All behavioral changes must go through CalibrationProfile — NOT in:
 *   - segment-graph.ts  (graph engine — no tuning)
 *   - road-sequence.ts  (execution trace — no overrides)
 *   - route-explain.ts  (interpretation — no heuristics)
 *
 * Calibration is purely deterministic parameter selection.
 * No randomness, no ML, no graph logic.
 *
 * Architecture:
 *   road-sequence.ts (findRoute) → calibration.ts → CostModelOptions (type only from segment-graph.ts)
 */
import type { CostModelOptions } from "@/lib/routing/segment-graph";

// ─── Types ────────────────────────────────────────────────────────

export type CalibrationProfileName =
  | "balanced_default"
  | "strict_highway"
  | "exploratory";

export interface CalibrationProfile {
  name: CalibrationProfileName;
  label: string;
  description: string;
  roadSwitchPenaltyKm: number;
  sameRoadMultiplier: number;
  junctionMultiplier: Record<string, number>;
  hardStabilityThreshold: number;
}

// ─── Profile Registry ─────────────────────────────────────────────

/**
 * Three profiles calibrated for different routing behaviors.
 *
 * balanced_default matches current DEFAULT_COST_MODEL exactly —
 *   all existing callers get identical behavior without changes.
 *
 * strict_highway penalizes road switches heavily —
 *   for routes where highway continuity is paramount.
 *
 * exploratory allows more road transitions —
 *   for routes where alternative road usage is acceptable.
 */
export const CALIBRATION_PROFILES: Record<CalibrationProfileName, CalibrationProfile> = {
  balanced_default: {
    name: "balanced_default",
    label: "Balanced Default",
    description: "Standard routing with moderate road continuity bias",
    roadSwitchPenaltyKm: 15,
    sameRoadMultiplier: 0.6,
    junctionMultiplier: {
      INTERCHANGE: 1.0,
      JUNCTION: 1.5,
      HIGHWAY_SPLIT: 2.0,
      UNKNOWN: 2.5,
    },
    hardStabilityThreshold: 1.2,
  },
  strict_highway: {
    name: "strict_highway",
    label: "Strict Highway Mode",
    description: "Strong road continuity preference — penalizes most switches heavily",
    roadSwitchPenaltyKm: 30,
    sameRoadMultiplier: 0.4,
    junctionMultiplier: {
      INTERCHANGE: 1.0,
      JUNCTION: 2.0,
      HIGHWAY_SPLIT: 3.0,
      UNKNOWN: 4.0,
    },
    hardStabilityThreshold: 1.1,
  },
  exploratory: {
    name: "exploratory",
    label: "Exploratory Mode",
    description: "Allows more road transitions — lower switch penalties",
    roadSwitchPenaltyKm: 5,
    sameRoadMultiplier: 0.8,
    junctionMultiplier: {
      INTERCHANGE: 1.0,
      JUNCTION: 1.0,
      HIGHWAY_SPLIT: 1.5,
      UNKNOWN: 2.0,
    },
    hardStabilityThreshold: 1.5,
  },
};

// ─── Profile Resolution ───────────────────────────────────────────

/**
 * Resolve a full CostModelOptions from an optional profile name and
 * optional field-level overrides.
 *
 * Resolution order (last wins):
 *   1. balanced_default profile values
 *   2. Selected profile values (if profile given)
 *   3. Field-level overrides (if provided)
 *
 * @param profile   - Named profile (defaults to balanced_default)
 * @param overrides - Individual field overrides (partial)
 * @returns Complete CostModelOptions
 */
export function resolveCostModel(
  profile?: CalibrationProfileName,
  overrides?: Partial<CostModelOptions>,
): CostModelOptions {
  const base = profile ? CALIBRATION_PROFILES[profile] : CALIBRATION_PROFILES.balanced_default;

  const result: CostModelOptions = {
    sameRoadMultiplier: base.sameRoadMultiplier,
    roadSwitchPenaltyKm: base.roadSwitchPenaltyKm,
    junctionMultiplier: { ...base.junctionMultiplier },
    hardStabilityThreshold: base.hardStabilityThreshold,
  };

  if (overrides) {
    if (overrides.sameRoadMultiplier !== undefined) result.sameRoadMultiplier = overrides.sameRoadMultiplier;
    if (overrides.roadSwitchPenaltyKm !== undefined) result.roadSwitchPenaltyKm = overrides.roadSwitchPenaltyKm;
    if (overrides.junctionMultiplier) {
      result.junctionMultiplier = { ...result.junctionMultiplier, ...overrides.junctionMultiplier };
    }
    if (overrides.hardStabilityThreshold !== undefined) result.hardStabilityThreshold = overrides.hardStabilityThreshold;
  }

  return result;
}

/**
 * Get a profile by name.
 */
export function getProfile(name: CalibrationProfileName): CalibrationProfile {
  return CALIBRATION_PROFILES[name];
}
