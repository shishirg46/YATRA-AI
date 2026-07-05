// ─── AI Planner Types ─────────────────────────────────────────────────────────
// The AI (LLM) must NEVER perform spatial reasoning. It receives pre-computed
// structured facts and only summarizes, prioritizes, explains, and compares.

import { z } from "zod";

// ─── Planner Input (from deterministic route intelligence) ──────────────────

export const plannerSegmentInputSchema = z.object({
  segmentId: z.string(),
  orderIndex: z.number(),
  roadName: z.string().nullable(),
  highway: z.string().nullable(),
  surface: z.string().nullable(),
  lengthM: z.number(),
  startKm: z.number(),
  endKm: z.number(),
  hazardCount: z.number(),
  affectedPercent: z.number(),
  severityScore: z.number(),
});

export const plannerHazardInputSchema = z.object({
  hazardId: z.string(),
  hazardType: z.string(),
  severity: z.string(),
  km: z.number(),
  segmentId: z.string(),
  roadName: z.string().nullable(),
  highway: z.string().nullable(),
  confidence: z.number().nullable(),
  source: z.string().nullable(),
});

export const plannerClusterInputSchema = z.object({
  hazardType: z.string(),
  severity: z.string(),
  startKm: z.number(),
  endKm: z.number(),
  hazardCount: z.number(),
  avgConfidence: z.number(),
  segmentIds: z.array(z.string()),
});

export const plannerSummaryInputSchema = z.object({
  highestSeverity: z.string(),
  mostCommonType: z.string(),
  totalHazards: z.number(),
  totalHazardTypes: z.record(z.string(), z.number()),
  estimatedDelayMin: z.number(),
  affectedDistanceM: z.number(),
  affectedPercent: z.number(),
  severityScore: z.number(),
  recommendDetour: z.boolean(),
  confidence: z.number(),
});

export const plannerRouteInputSchema = z.object({
  origin: z.array(z.number()).length(2),
  destination: z.array(z.number()).length(2),
  totalDistanceKm: z.number(),
  totalDurationMin: z.number(),
  confidence: z.number(),
  osmWayCount: z.number(),
  segments: z.array(plannerSegmentInputSchema),
  hazards: z.array(plannerHazardInputSchema),
  clusters: z.array(plannerClusterInputSchema),
  summary: plannerSummaryInputSchema,
});

export type PlannerSegmentInput = z.infer<typeof plannerSegmentInputSchema>;
export type PlannerHazardInput = z.infer<typeof plannerHazardInputSchema>;
export type PlannerClusterInput = z.infer<typeof plannerClusterInputSchema>;
export type PlannerSummaryInput = z.infer<typeof plannerSummaryInputSchema>;
export type PlannerRouteInput = z.infer<typeof plannerRouteInputSchema>;

// ─── User Preferences ───────────────────────────────────────────────────────

export const plannerPreferencesSchema = z.object({
  departureTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format").optional(),
  vehicle: z.enum(["car", "motorcycle", "jeep", "bus"]).optional(),
  riskTolerance: z.enum(["low", "medium", "high"]).optional(),
  priority: z.enum(["speed", "safety", "balanced"]).optional(),
  notes: z.string().optional(),
});

export type PlannerPreferences = z.infer<typeof plannerPreferencesSchema>;

// ─── Planner Output (LLM response) ─────────────────────────────────────────

export const plannerOutputSchema = z.object({
  assessment: z.enum(["safe", "caution", "high_risk", "avoid"]),
  severityScore: z.number().min(0).max(100),
  summary: z.string(),
  hazardHotspots: z.array(
    z.object({
      km: z.number(),
      type: z.string(),
      description: z.string(),
      advice: z.string(),
    }),
  ),
  timingAdvice: z.object({
    bestDepartureWindow: z.string().nullable(),
    avoidNightDriving: z.boolean(),
    estimatedDelayMin: z.number(),
  }),
  recommendations: z.array(z.string()),
  alternativeRoutes: z.array(
    z.object({
      description: z.string(),
      reason: z.string(),
    }),
  ),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

// ─── API Request / Response Schemas ─────────────────────────────────────────

export const plannerComputeRequestSchema = z.object({
  route: plannerRouteInputSchema,
  preferences: plannerPreferencesSchema.optional(),
});

export const plannerRequestSchema = z.object({
  origin: z.array(z.number()).length(2),
  destination: z.array(z.number()).length(2),
  preferences: plannerPreferencesSchema.optional(),
  graphVersion: z.string().default("v3-kathmandu"),
});

export type PlannerComputeRequest = z.infer<typeof plannerComputeRequestSchema>;
export type PlannerRequest = z.infer<typeof plannerRequestSchema>;

export interface PlannerComputeResponse {
  planner: PlannerOutput;
  route: {
    origin: [number, number];
    destination: [number, number];
    totalDistanceKm: number;
    totalDurationMin: number;
    confidence: number;
    osmWayCount: number;
  };
  segments: PlannerSegmentInput[];
  hazards: PlannerHazardInput[];
  clusters: PlannerClusterInput[];
  summary: PlannerSummaryInput;
}
