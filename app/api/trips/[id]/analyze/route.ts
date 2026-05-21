/**
 * FILE: route.ts
 * LOCATION: /app/api/trips/[id]/analyze/route.ts
 * PURPOSE: Runs full group route risk analysis for a trip plan
 *
 * POST /api/trips/[id]/analyze
 * - Loads all stops + all accepted members + their health profiles
 * - Runs per-member risk analysis for each stop in parallel
 * - Applies group conflict detection + consensus scoring
 * - Finds alternatives for conflicted stops
 * - Calls Claude to generate a natural language group summary
 * - Saves result back to TravelPlan.groupRiskResult
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { Prisma }                    from "@/app/generated/prisma/client";
import { prisma }                    from "@/lib/prisma";
import { analyzeGroupRoute, StopInput, MemberProfile, AlternativeStop } from "@/lib/analysis/group-risk";
import { callAI } from "@/lib/ai/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const plan = await prisma.travelPlan.findUnique({
    where:   { id },
    include: {
      stops: {
        orderBy: { stopOrder: "asc" },
        include: { location: { include: { district: { include: { province: true } } } } },
      },
      members: {
        where:   { status: "ACCEPTED" },
        include: {
          user: {
            include: {
              health:       true,
              homeLocation: { include: { district: { include: { province: true } } } },
            },
          },
        },
      },
      leader: {
        include: {
          health:       true,
          homeLocation: { include: { district: { include: { province: true } } } },
        },
      },
    },
  });

  if (!plan) return NextResponse.json({ message: "Plan not found." }, { status: 404 });
  if (plan.leaderId !== session.user.id) return NextResponse.json({ message: "Only the leader can run analysis." }, { status: 403 });

  // ── Build stops input ────────────────────────────────────────────────────────
  const stops: StopInput[] = plan.stops.map((s) => ({
    locationId:    s.locationId,
    locationName:  s.location.name,
    district:      s.location.district.name,
    province:      s.location.district.province.name,
    lat:           s.location.latitude,
    lon:           s.location.longitude,
    altitude:      s.location.altitude,
    arrivalDate:   s.arrivalDate.toISOString().split("T")[0],
    departureDate: s.departureDate.toISOString().split("T")[0],
  }));

  // ── Build member profiles (leader always included) ────────────────────────
  const allUsers = [
    plan.leader,
    ...plan.members.map((m) => m.user),
  ];

  const members: MemberProfile[] = allUsers.map((u) => ({
    userId:   u.id,
    name:     u.name ?? "Unknown",
    username: u.username ?? null,
    health:   u.health ? {
      fitnessLevel:      u.health.fitnessLevel as "LOW" | "MODERATE" | "HIGH",
      mobilityLimited:   u.health.mobilityLimited,
      chronicConditions: u.health.chronicConditions,
      allergies:         u.health.allergies,
    } : null,
    homeAltitude: u.homeLocation?.altitude ?? 0,
    homeProvince: u.homeLocation?.district?.province?.name ?? "",
  }));

  // ── Pre-fetch alternatives for each stop (same province, SAFE/CAUTION) ─────
  const alternatives: AlternativeStop[][] = await Promise.all(
    stops.map(async (stop) => {
      const locs = await prisma.location.findMany({
        where: {
          id:      { not: stop.locationId },
          district: { province: { name: stop.province } },
          riskReports: { some: { safetyLevel: { in: ["SAFE", "CAUTION"] } } },
        },
        include: {
          district:    { include: { province: true } },
          riskReports: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        take: 5,
      });

      return locs
        .filter((l) => l.riskReports.length > 0)
        .map((l): AlternativeStop => ({
          locationId:  l.id,
          name:        l.name,
          district:    l.district.name,
          province:    l.district.province.name,
          altitude:    l.altitude,
          safetyScore: l.riskReports[0].safetyScore,
          safetyLevel: l.riskReports[0].safetyLevel as "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME",
          reason:      `${l.riskReports[0].safetyScore}/100 safety score — safer option in ${l.district.name}`,
        }))
        .sort((a, b) => b.safetyScore - a.safetyScore)
        .slice(0, 3);
    })
  );

  // ── Run group route analysis ──────────────────────────────────────────────
  const analysis = await analyzeGroupRoute({
    stops,
    members,
    tripType:  plan.tripType as "SOLO" | "GROUP",
    budgetNPR: plan.budgetNPR ?? null,
    alternatives,
  });

  // ── Claude summary ────────────────────────────────────────────────────────
  const conflictedStops = analysis.stopAnalyses.filter((s) => s.conflict);
  const highSegments    = analysis.routeSegments.filter((s) => s.risk === "HIGH");

  const prompt = `You are a Nepal travel safety advisor. Analyse this group trip:

Group: ${members.length} travellers — ${members.map((m) => {
  const conditions = m.health?.chronicConditions.join(", ") || "no conditions";
  return `${m.name} (${conditions}, ${m.health?.fitnessLevel ?? "unknown"} fitness, from ${m.homeProvince || "unknown"})`;
}).join("; ")}

Route: ${stops.map((s, i) => `Stop ${i + 1}: ${s.locationName} (${s.altitude ?? "?"}m), ${s.arrivalDate} to ${s.departureDate}`).join(" → ")}

Overall group safety: ${analysis.overallGroupLevel} (score: ${analysis.overallGroupScore}/100)
${conflictedStops.length > 0 ? `Conflicted stops (${conflictedStops.length}): ${conflictedStops.map((s) => `${s.stop.locationName} — ${s.conflictReason}`).join("; ")}` : "No conflicts detected."}
${highSegments.length > 0 ? `High-risk route segments: ${highSegments.map((s) => `${s.from}→${s.to}: ${s.reason}`).join("; ")}` : "No high-risk route segments."}
${plan.budgetNPR ? `Total budget: NPR ${plan.budgetNPR.toLocaleString()} (NPR ${Math.round(plan.budgetNPR / members.length).toLocaleString()} per person)` : "No budget specified."}

Respond ONLY with a JSON object (no markdown):
{
  "groupVerdict": "2-3 sentences: honest group trip assessment",
  "conflictSummary": "1-2 sentences about health/safety conflicts between members (skip if none)",
  "routeWarning": "1-2 sentences about the most dangerous route segment (skip if none)",
  "budgetNote": "1 sentence about budget per person feasibility (skip if no budget)",
  "topGroupTip": "Single most important tip for this specific group travelling this specific route"
}`;

  let aiSummary = {
    groupVerdict:    "",
    conflictSummary: "",
    routeWarning:    "",
    budgetNote:      "",
    topGroupTip:     "",
  };

  const raw = await callAI(prompt, {
    system: "You are a Nepal travel safety advisor. Always respond with valid JSON only.",
    maxTokens: 600,
  });
  if (raw) {
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      aiSummary = { ...aiSummary, ...JSON.parse(cleaned) };
    } catch {
      console.warn("[trips/analyze] AI JSON parse failed, raw:", raw.slice(0, 200));
    }
  }

  analysis.aiSummary = aiSummary.groupVerdict;

  // ── Save result ───────────────────────────────────────────────────────────
  const result = { ...analysis, ai: aiSummary };
  await prisma.travelPlan.update({
    where: { id },
    data:  {
      groupRiskResult: result as unknown as Prisma.InputJsonValue,
      status:          "ANALYZED",
    },
  });

  return NextResponse.json(result);
}
