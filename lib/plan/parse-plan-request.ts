import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { planRequestSchema, validateBody, validatePlanBusinessRules } from "@/lib/validation";
import type { AnalysisContext } from "./pipeline-types";

type ParseResult =
  | { ok: true; ctx: AnalysisContext }
  | { ok: false; response: NextResponse };

export async function parsePlanRequest(req: NextRequest): Promise<ParseResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }

  const rawBody = await req.json();
  const parsed = validateBody(planRequestSchema, rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json({ message: parsed.error }, { status: parsed.status }),
    };
  }

  const business = validatePlanBusinessRules(parsed.data);
  if (!business.ok) {
    return {
      ok: false,
      response: NextResponse.json({ message: business.message }, { status: business.status }),
    };
  }

  const { destinationId, startDate, endDate, tripType, budgetNPR, memberUsernames, originLat, originLon, vehicle, travelStyle } = parsed.data;

  return {
    ok: true,
    ctx: {
      session, destinationId, startDate, endDate, tripType,
      budgetNPR, memberUsernames, originLat, originLon,
      vehicle, travelStyle,
    },
  };
}
