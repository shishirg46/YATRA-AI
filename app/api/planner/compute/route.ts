export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { plannerComputeRequestSchema, plannerRouteInputSchema } from "@/lib/planner/types";
import { generatePlannerOutputSafe } from "@/lib/planner/planner";
import { withRateLimit } from "@/lib/rate-limit";

async function handler(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parsed = plannerComputeRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid request", errors: parsed.error.issues },
        { status: 400 },
      );
    }

    const { route, preferences } = parsed.data;

    // Validate route input
    const routeValid = plannerRouteInputSchema.safeParse(route);
    if (!routeValid.success) {
      return NextResponse.json(
        { message: "Invalid route data", errors: routeValid.error.issues },
        { status: 400 },
      );
    }

    const planner = generatePlannerOutputSafe(routeValid.data);

    return NextResponse.json({
      planner,
      route: {
        origin: route.origin,
        destination: route.destination,
        totalDistanceKm: route.totalDistanceKm,
        totalDurationMin: route.totalDurationMin,
        confidence: route.confidence,
        osmWayCount: route.osmWayCount,
      },
    });
  } catch (err) {
    console.error("[planner-compute] Error:", err);
    return NextResponse.json(
      { message: "Failed to compute planner assessment", error: String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, { max: 10, windowSeconds: 60 });
