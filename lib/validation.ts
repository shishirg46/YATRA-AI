import { z } from "zod";

// ─── Common ───────────────────────────────────────────────────────────────────

export const latSchema = z.number().min(-90).max(90);
export const lonSchema = z.number().min(-180).max(180);
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

// ─── POST /api/plan ───────────────────────────────────────────────────────────

export const planRequestSchema = z.object({
  destinationId: z.string().min(1, "Destination is required"),
  startDate: dateString,
  endDate: dateString,
  tripType: z.enum(["SOLO", "GROUP"]).default("SOLO"),
  budgetNPR: z.number().nonnegative("Budget must be a non-negative number"),
  memberUsernames: z.array(z.string()).default([]),
  originLat: z.number().nullable().optional().default(null),
  originLon: z.number().nullable().optional().default(null),
  vehicle: z.enum(["car", "motorcycle", "jeep", "bus"]),
  travelStyle: z.enum(["budget", "standard", "luxury"]),
});

// ─── POST /api/analyze ────────────────────────────────────────────────────────

export const analyzeRequestSchema = z.object({
  destinationId: z.string().min(1, "destinationId is required"),
  travelDate: dateString,
  tripType: z.enum(["SOLO", "GROUP"]).default("SOLO"),
});

// ─── POST /api/route-intelligence ─────────────────────────────────────────────

export const geoPointSchema = z.object({
  lat: latSchema,
  lon: lonSchema,
  name: z.string().optional(),
});

export const routeIntelligenceRequestSchema = z.object({
  origin: geoPointSchema,
  destination: geoPointSchema,
  departureDate: dateString,
  destinationId: z.string().optional(),
  vehicle: z.enum(["car", "motorcycle", "jeep"]).default("car"),
});

// ─── GET /api/route-intelligence ──────────────────────────────────────────────

export const routeIntelligenceQuerySchema = z.object({
  originLat: z.coerce.number(),
  originLon: z.coerce.number(),
  destLat: z.coerce.number(),
  destLon: z.coerce.number(),
  date: dateString.optional(),
});

// ─── POST /api/routes ─────────────────────────────────────────────────────────

export const routeRequestSchema = z.object({
  startLat: latSchema,
  startLon: lonSchema,
  endLat: latSchema,
  endLon: lonSchema,
  destinationId: z.string().optional(),
  destinationName: z.string().optional(),
  originName: z.string().optional(),
  vehicle: z.enum(["car", "motorcycle", "jeep"]).default("car"),
});

// ─── GET /api/destinations/search ─────────────────────────────────────────────

export const destinationSearchSchema = z.object({
  q: z.string().min(2, "Query must be at least 2 characters"),
});

// ─── GET /api/destinations/nearby ─────────────────────────────────────────────

export const nearbyDestinationsSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().default(10),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Auth / user routes ───────────────────────────────────────────────────────

export const onboardingSchema = z.object({
  travelPurposes: z.array(z.string()).min(1, "At least one travel purpose required"),
  homeLocation: z.string().optional(),
  homeLat: z.number().optional(),
  homeLon: z.number().optional(),
});

export const healthProfileSchema = z.object({
  bloodType: z.string().optional(),
  fitnessLevel: z.enum(["LOW", "MODERATE", "HIGH"]),
  mobilityLimited: z.boolean(),
  chronicConditions: z.array(z.string()),
  allergies: z.array(z.string()),
});

// ─── POST /api/assess ─────────────────────────────────────────────────────────

export const assessRequestSchema = z.object({
  locationIds: z.array(z.string()).optional(),
  force: z.boolean().optional().default(false),
});

export function validatePlanBusinessRules(
  data: z.infer<typeof planRequestSchema>
): { ok: true } | { ok: false; message: string; status: number } {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);

  if (start >= end) {
    return { ok: false, message: "Start date must be before end date", status: 400 };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start < today) {
    return { ok: false, message: "Start date cannot be in the past", status: 400 };
  }

  if (data.budgetNPR <= 0) {
    return { ok: false, message: "Budget must be greater than 0", status: 400 };
  }

  if (data.tripType === "GROUP" && data.memberUsernames.length === 0) {
    return { ok: false, message: "Group trips require at least one member", status: 400 };
  }

  const hasOriginLat = data.originLat != null;
  const hasOriginLon = data.originLon != null;
  if (hasOriginLat !== hasOriginLon) {
    return { ok: false, message: "Both origin coordinates must be provided or neither", status: 400 };
  }

  return { ok: true };
}

/**
 * Validates request body against a Zod schema.
 * Returns `{ success: true, data }` or `{ success: false, error: string }`.
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown
): { success: true; data: T } | { success: false; error: string; status: number } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
      : "Validation failed";
    return { success: false, error: message, status: 400 };
  }
  return { success: true, data: result.data };
}
