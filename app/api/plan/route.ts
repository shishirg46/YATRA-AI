/**
 * FILE: route.ts
 * LOCATION: /app/api/plan/route.ts
 *
 * POST /api/plan
 * Body: {
 *   destinationId:   string        — required
 *   travelDate:      string        — required (YYYY-MM-DD)
 *   tripType:        "SOLO"|"GROUP"
 *   budgetNPR:       number        — optional
 *   memberUsernames: string[]      — required for GROUP (usernames of partners)
 * }
 *
 * GROUP CONFLICT ALGORITHM (conservative):
 *   1. Run analyzeTemporalRisk() for every member individually
 *   2. groupScore = min(all member scores)   ← worst-case rule
 *   3. groupLevel = level of that min score
 *   4. conflict   = any member is HIGH_RISK or EXTREME
 *   5. If conflict → find alternatives safe for ALL members
 *   6. Claude explains the conflict and alternatives in plain language
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { PrismaClient }              from "@/app/generated/prisma/client";
import { PrismaPg }                  from "@prisma/adapter-pg";
import { Pool }                      from "pg";
import { analyzeTemporalRisk }       from "@/lib/analysis/temporal-risk";
import { assessRouteSegment }        from "@/lib/analysis/group-risk";
import { fetchWeather }              from "@/lib/collectors/weather";
import { fetchHazard }               from "@/lib/collectors/hazard";
import { computePillarModel }        from "@/lib/analysis/pillar-score";
import { resolveTravelOrigin }       from "@/lib/routing/origin-resolver";
import { buildSegmentedRoute }       from "@/lib/routing/route-service";
import { resolveDestination }        from "@/lib/routing/place-resolver";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type OriginLocation = {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  district: { name: string; province: { name: string } };
};

// ── Cost estimates (NPR per person per day) ───────────────────────────────────

const COST_TABLE: Record<string, { accommodation: number; food: number; transport: number; label: string }> = {
  "kathmandu": { accommodation: 1500, food: 800,  transport: 500,  label: "Kathmandu Valley" },
  "pokhara":   { accommodation: 1800, food: 700,  transport: 400,  label: "Pokhara city" },
  "chitwan":   { accommodation: 2500, food: 900,  transport: 600,  label: "National park" },
  "high_trek": { accommodation: 800,  food: 1200, transport: 3000, label: "High-altitude trek" },
  "mid_trek":  { accommodation: 600,  food: 900,  transport: 1500, label: "Mid-altitude trek" },
  "default":   { accommodation: 800,  food: 600,  transport: 600,  label: "General Nepal travel" },
};

function getCosts(name: string, alt: number | null) {
  const n = name.toLowerCase();
  if (n.includes("kathmandu") || n.includes("bhaktapur") || n.includes("lalitpur")) return COST_TABLE["kathmandu"];
  if (n.includes("pokhara") || n.includes("lakeside") || n.includes("phewa"))       return COST_TABLE["pokhara"];
  if (n.includes("chitwan") || n.includes("sauraha"))                                return COST_TABLE["chitwan"];
  if ((alt ?? 0) > 3500) return COST_TABLE["high_trek"];
  if ((alt ?? 0) > 1500) return COST_TABLE["mid_trek"];
  return COST_TABLE["default"];
}

// ── Claude AI ─────────────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system: `You are a Nepal travel safety advisor. Be honest, specific, and compassionate. 
No generic filler. Short paragraphs. Always prioritise safety.
Respond ONLY with valid JSON. No markdown, no backticks, no preamble.`,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { content?: { type: string; text: string }[] };
    return data.content?.find((b) => b.type === "text")?.text ?? "";
  } catch { return ""; }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    destinationId:   string;
    travelDate:      string;
    tripType:        "SOLO" | "GROUP";
    budgetNPR:       number;
    memberUsernames: string[];
    originLat?:      number | null;
    originLon?:      number | null;
  };

  const {
    destinationId,
    travelDate,
    tripType       = "SOLO",
    budgetNPR      = 0,
    memberUsernames = [],
    originLat = null,
    originLon = null,
  } = body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!destinationId)
    return NextResponse.json({ message: "Destination is required." }, { status: 400 });
  if (!travelDate)
    return NextResponse.json({ message: "Travel date is required." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate))
    return NextResponse.json({ message: "Travel date must be YYYY-MM-DD." }, { status: 400 });
  if (new Date(travelDate) < new Date(new Date().toDateString()))
    return NextResponse.json({ message: "Travel date must be today or in the future." }, { status: 400 });
  if (tripType === "GROUP" && memberUsernames.length === 0)
    return NextResponse.json({ message: "Group trips require at least one partner." }, { status: 400 });

  // ── Load destination ──────────────────────────────────────────────────────
  const location = await prisma.location.findUnique({
    where:   { id: destinationId },
    include: { district: { include: { province: true } } },
  });
  if (!location) return NextResponse.json({ message: "Destination not found." }, { status: 404 });

  // ── Load leader (current user) ────────────────────────────────────────────
  const [leaderHealth, leaderUser, profileNotif] = await Promise.all([
    prisma.userHealth.findUnique({
      where:  { userId: session.user.id },
      select: { fitnessLevel: true, mobilityLimited: true, chronicConditions: true, allergies: true, bloodType: true },
    }),
    prisma.user.findUnique({
      where:   { id: session.user.id },
      include: {
        homeLocation: { include: { district: { include: { province: true } } } },
        preference: true,
      },
    }),
    prisma.notification.findFirst({
      where: { userId: session.user.id, message: { contains: '"_type":"PROFILE"' } },
    }),
  ]);

  const profile        = profileNotif ? JSON.parse(profileNotif.message) : null;
  const travelPurposes = (profile?.travelPurposes ?? []) as string[];

  const [weatherResult, rawHazard] = await Promise.all([
    fetchWeather(location.latitude, location.longitude),
    fetchHazard(location.district.name, location.latitude, location.longitude),
  ]);
  const liveWeather = weatherResult ?? {
    temperature: 18,
    humidity:    60,
    rainfall:    0,
    windSpeed:   3,
    pressure:    1013,
    description: "fallback:weather",
    source:      "fallback",
    sourceLabel: "Nepal estimate",
    officialSource: false,
  };
  const liveHazard = {
    ...rawHazard,
    heatIndex: Math.max(0, Math.min((liveWeather.temperature - 25) / 20, 1)),
  };

  // ── Load group members ────────────────────────────────────────────────────
  let groupMembers: {
    id: string; name: string; username: string | null;
    health: typeof leaderHealth;
    homeAltitude: number;
    homeProvince: string;
  }[] = [];

  if (tripType === "GROUP" && memberUsernames.length > 0) {
    const memberUsers = await prisma.user.findMany({
      where:   { username: { in: memberUsernames.map((u) => u.replace(/^@/, "")) } },
      include: {
        health:       true,
        homeLocation: { include: { district: { include: { province: true } } } },
      },
    });

    groupMembers = memberUsers.map((u) => ({
      id:           u.id,
      name:         u.name ?? u.username ?? "Unknown",
      username:     u.username,
      health:       u.health,
      homeAltitude: u.homeLocation?.altitude ?? 0,
      homeProvince: u.homeLocation?.district?.province?.name ?? "",
    }));
  }

  // ── Build all travellers (leader + members) ───────────────────────────────
  const allTravellers = [
    {
      id:           session.user.id,
      name:         leaderUser?.name ?? "You",
      username:     leaderUser?.username ?? null,
      health:       leaderHealth,
      homeAltitude: leaderUser?.homeLocation?.altitude ?? 0,
      homeProvince: leaderUser?.homeLocation?.district?.province?.name ?? "",
      homeLocation: leaderUser?.homeLocation,
      isLeader:     true,
    },
    ...groupMembers.map((m) => ({ ...m, isLeader: false })),
  ];

  const home = leaderUser?.homeLocation;
  const hasClientOrigin = Number.isFinite(originLat) && Number.isFinite(originLon);
  const hasPreferenceOrigin =
    Number.isFinite(leaderUser?.preference?.locationLat) &&
    Number.isFinite(leaderUser?.preference?.locationLng);

  let effectiveHome: OriginLocation | null = null;
  let routePlan: Awaited<ReturnType<typeof buildSegmentedRoute>> | null = null;
  let originResolutionNote: string | undefined;

  try {
    const resolved = await resolveTravelOrigin({
      lat: hasClientOrigin ? Number(originLat) : leaderUser?.preference?.locationLat ?? undefined,
      lon: hasClientOrigin ? Number(originLon) : leaderUser?.preference?.locationLng ?? undefined,
      userId: session.user.id,
      preferSavedHome: !hasClientOrigin,
    });

    const destResolved = await resolveDestination({
      destinationId: location.id,
      destinationName: location.name,
      destinationLat: location.latitude,
      destinationLon: location.longitude,
    });

    routePlan = await buildSegmentedRoute({
      originLat: resolved.place.lat,
      originLon: resolved.place.lon,
      originName: resolved.place.name,
      originRouteNodeId: resolved.routeNodeId,
      destinationLat: destResolved.place.lat,
      destinationLon: destResolved.place.lon,
      destinationName: destResolved.place.name,
      destinationId: location.id,
    });

    originResolutionNote = [resolved.note, destResolved.note, routePlan.resolutionNote]
      .filter(Boolean)
      .join("; ");

    const districtRow = home?.district ?? location.district;
    effectiveHome = {
      id: resolved.place.id ?? home?.id,
      name: resolved.place.name,
      latitude: resolved.place.lat,
      longitude: resolved.place.lon,
      altitude: home?.altitude ?? null,
      district: districtRow,
    } as OriginLocation;
  } catch {
    if (home) {
      effectiveHome = home as OriginLocation;
    }
  }

  let routeRisk = null;
  if (effectiveHome && effectiveHome.latitude !== 0 && effectiveHome.longitude !== 0) {
    const latDiff = effectiveHome.latitude - location.latitude;
    const lonDiff = effectiveHome.longitude - location.longitude;
    const isSamePoint = (latDiff * latDiff + lonDiff * lonDiff) < 1e-10;
    if (!isSamePoint) {
    routeRisk = await assessRouteSegment(
      {
        locationId:    effectiveHome.id ?? `origin:${effectiveHome.latitude.toFixed(5)},${effectiveHome.longitude.toFixed(5)}`,
        locationName:  effectiveHome.name,
        district:      effectiveHome.district.name,
        province:      effectiveHome.district.province.name,
        lat:           effectiveHome.latitude,
        lon:           effectiveHome.longitude,
        altitude:      effectiveHome.altitude,
        arrivalDate:   travelDate,
        departureDate: travelDate,
      },
      {
        locationId:    location.id,
        locationName:  location.name,
        district:      location.district.name,
        province:      location.district.province.name,
        lat:           location.latitude,
        lon:           location.longitude,
        altitude:      location.altitude,
        arrivalDate:   travelDate,
        departureDate: travelDate,
      }
    ).catch(() => null);
    }
  }

  // ── Run temporal risk analysis for each traveller ─────────────────────────
  const memberAnalyses = await Promise.all(
    allTravellers.map(async (t) => {
      const report = await analyzeTemporalRisk({
        destinationName: location.name,
        district:        location.district.name,
        province:        location.district.province.name,
        lat:             location.latitude,
        lon:             location.longitude,
        altitude:        location.altitude,
        travelDate,
        userHealth: t.health ? {
          fitnessLevel:      t.health.fitnessLevel as "LOW" | "MODERATE" | "HIGH",
          mobilityLimited:   t.health.mobilityLimited,
          chronicConditions: t.health.chronicConditions,
          allergies:         t.health.allergies,
          homeAltitude:      t.homeAltitude,
          homeProvince:      t.homeProvince,
        } : null,
        tripType,
      });
      return {
        userId:      t.id,
        name:        t.name,
        username:    t.username,
        isLeader:    t.isLeader,
        score:       report.overallScore,
        level:       report.overallLevel,
        topRisks:    report.riskFactors.slice(0, 2).map((r) => r.name),
        healthFlags: report.healthAdvisories.map((h) => h.condition),
        riskReport:  report,
      };
    })
  );

  const fallbackHome = {
    name: "Kathmandu",
    district: "Kathmandu",
    province: "Bagmati",
    lat: 27.7172,
    lon: 85.3240,
    altitude: 1400,
  };
  const resolvedHome = effectiveHome && effectiveHome.latitude !== 0 && effectiveHome.longitude !== 0
    ? {
        name: effectiveHome.name,
        district: effectiveHome.district.name,
        province: effectiveHome.district.province.name,
        lat: effectiveHome.latitude,
        lon: effectiveHome.longitude,
        altitude: effectiveHome.altitude ?? 1400,
      }
    : fallbackHome;

  const pillarModel = await computePillarModel({
    destination: {
      id: location.id,
      name: location.name,
      district: location.district.name,
      province: location.district.province.name,
      lat: location.latitude,
      lon: location.longitude,
      altitude: location.altitude,
    },
    home: resolvedHome,
    travelDate,
    tripType,
    userHealth: leaderHealth ? {
      fitnessLevel: leaderHealth.fitnessLevel as "LOW" | "MODERATE" | "HIGH",
      mobilityLimited: leaderHealth.mobilityLimited,
      chronicConditions: leaderHealth.chronicConditions,
    } : null,
  });

  // ── Conservative group scoring ────────────────────────────────────────────
  // Worst-case: the group is only as safe as its most vulnerable member
  const leaderAnalysis  = memberAnalyses[0];
  const scores          = memberAnalyses.map((m) => m.score);
  const groupMinScore   = Math.min(...scores);
  const groupAvgScore   = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const groupScore      = tripType === "GROUP" ? Math.min(groupMinScore, pillarModel.totalScore) : pillarModel.totalScore;
  const groupLevel      = scoreToLevel(groupScore);
  const conflict        = memberAnalyses.some((m) => m.level === "HIGH_RISK" || m.level === "EXTREME");
  const mostVulnerable  = memberAnalyses.find((m) => m.score === groupMinScore);

  // ── Budget ────────────────────────────────────────────────────────────────
  const costs        = getCosts(location.name, location.altitude);
  const dailyCost    = costs.accommodation + costs.food + costs.transport;
  const estDays      = (location.altitude ?? 0) > 3000 ? 7 : (location.altitude ?? 0) > 1500 ? 4 : 2;
  const estTotal     = dailyCost * estDays;
  const perPerson    = budgetNPR > 0 ? Math.round(budgetNPR / allTravellers.length) : 0;
  const budgetFeasible   = budgetNPR === 0 || budgetNPR >= estTotal;
  const budgetShortfall  = budgetNPR > 0 ? Math.max(0, estTotal - budgetNPR) : 0;

  // ── Find alternatives ─────────────────────────────────────────────────────
  // Only fetch alternatives if destination is risky OR group has conflict
  const needsAlternatives = groupLevel !== "SAFE" || conflict;

  const rawAlternatives = needsAlternatives
    ? await prisma.location.findMany({
        where: {
          id:          { not: destinationId },
          district:    { province: { name: location.district.province.name } },
          riskReports: { some: { safetyLevel: { in: ["SAFE", "CAUTION"] } } },
        },
        include: {
          district:    { include: { province: true } },
          riskReports: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        take: 10,
      })
    : [];

  // For group trips — re-score each alternative using the most vulnerable member's profile
  const alternatives = await Promise.all(
    rawAlternatives
      .filter((a) => a.riskReports.length > 0)
      .map(async (a) => {
        const altCosts   = getCosts(a.name, a.altitude);
        const altDaily   = altCosts.accommodation + altCosts.food + altCosts.transport;
        const altTotal   = altDaily * estDays;
        const budgetOk   = budgetNPR === 0 || altTotal <= budgetNPR * 1.1;

        // For group: check if this alternative is safe for ALL members
        let minAltScore = a.riskReports[0].safetyScore;
        if (tripType === "GROUP" && allTravellers.length > 1) {
          const altScores = await Promise.all(
            allTravellers.map(async (t) => {
              const r = await analyzeTemporalRisk({
                destinationName: a.name,
                district:        a.district.name,
                province:        a.district.province.name,
                lat:             a.latitude,
                lon:             a.longitude,
                altitude:        a.altitude,
                travelDate,
                userHealth: t.health ? {
                  fitnessLevel:      (t.health as typeof leaderHealth)?.fitnessLevel as "LOW" | "MODERATE" | "HIGH",
                  mobilityLimited:   (t.health as typeof leaderHealth)?.mobilityLimited ?? false,
                  chronicConditions: (t.health as typeof leaderHealth)?.chronicConditions ?? [],
                  allergies:         (t.health as typeof leaderHealth)?.allergies ?? [],
                  homeAltitude:      t.homeAltitude,
                  homeProvince:      t.homeProvince,
                } : null,
                tripType,
              });
              return r.overallScore;
            })
          );
          minAltScore = Math.min(...altScores);
        }

        return {
          id:            a.id,
          name:          a.name,
          district:      a.district.name,
          province:      a.district.province.name,
          altitude:      a.altitude,
          safetyScore:   minAltScore, // group-adjusted score
          safetyLevel:   a.riskReports[0].safetyLevel,
          estimatedNPR:  altTotal,
          budgetFeasible: budgetOk,
        };
      })
  );

  // Sort: safest first, then budget-feasible first within same safety level
  const sortedAlternatives = alternatives
    .filter((a) => a.safetyScore >= 60) // only SAFE/CAUTION for alternatives
    .sort((a, b) => b.safetyScore - a.safetyScore)
    .slice(0, 4);

  const actionablePillarRecommendations = [
    ...pillarModel.route.segmentFlags.map((f) => ({
      type: "ROUTE" as const,
      text: `${f.where}: ${f.effect} (${f.when}).`,
    })),
    ...(pillarModel.personal.guideRequired
      ? [{ type: "ROUTE" as const, text: "Hire a licensed guide for this itinerary due to terrain/risk profile." }]
      : []),
    ...(pillarModel.personal.flags.some((x) => x.toLowerCase().includes("solo"))
      ? [{ type: "MEDICAL" as const, text: "Carry a first-aid kit and share live location check-ins every 4-6 hours." }]
      : []),
    {
      type: "MEDICAL" as const,
      text: `Nearest emergency facility: ${pillarModel.personal.emergencyPreparedness.hospital}.`,
    },
    ...(location.name.toLowerCase().includes("palpa") || location.name.toLowerCase().includes("tansen")
      ? [{
          type: "ROUTE" as const,
          text: "Drive carefully after Butwal on Siddhartha Highway; sharp bends and variable mountain visibility are common.",
        }]
      : []),
  ];

  // ── Claude prompt ─────────────────────────────────────────────────────────
  const memberSummary = memberAnalyses.map((m) =>
    `${m.name}${m.isLeader ? " (leader)" : ""}: score ${m.score}/100 (${m.level})${m.healthFlags.length > 0 ? ` — ${m.healthFlags.slice(0, 2).join(", ")}` : ""}`
  ).join("\n");

  const altSummary = sortedAlternatives.slice(0, 3).map((a) =>
    `${a.name} (${a.district}): ${a.safetyScore}/100 — est. NPR ${a.estimatedNPR.toLocaleString()}`
  ).join("\n");

  const isUnsafe = groupLevel === "HIGH_RISK" || groupLevel === "EXTREME";

  const prompt = `Nepal travel safety analysis. Be specific and honest.

Destination: ${location.name}, ${location.district.name}, ${location.district.province.name} Province${location.altitude ? ` (${location.altitude}m)` : ""}
Travel date: ${travelDate} (${leaderAnalysis.riskReport.season})
Trip type: ${tripType}

${tripType === "GROUP" ? `GROUP ANALYSIS (conservative — uses WORST member score):
Group score: ${groupScore}/100 (${groupLevel}) — avg: ${groupAvgScore}/100
${conflict ? `⚠️ CONFLICT: ${mostVulnerable?.name} is the most vulnerable member (${mostVulnerable?.score}/100)` : "No conflict detected."}
Members:
${memberSummary}` : `SOLO ANALYSIS:
Score: ${groupScore}/100 (${groupLevel})
Top risks: ${leaderAnalysis.topRisks.join(", ") || "none"}`}

Seasonal context: ${leaderAnalysis.riskReport.seasonalContext}
Top risk factors: ${leaderAnalysis.riskReport.riskFactors.slice(0, 3).map((f) => `${f.name} (${f.severity})`).join(", ") || "none"}
Health advisories: ${leaderAnalysis.riskReport.healthAdvisories.map((h) => h.condition).join(", ") || "none"}

Budget: ${budgetNPR > 0 ? `NPR ${budgetNPR.toLocaleString()} total (NPR ${perPerson.toLocaleString()} per person). Est. trip cost: NPR ${estTotal.toLocaleString()}. ${budgetFeasible ? "Budget sufficient." : `Shortfall: NPR ${budgetShortfall.toLocaleString()}.`}` : "Not specified."}

${sortedAlternatives.length > 0 ? `Safer alternatives in same province:
${altSummary}` : "No safer alternatives found."}

Respond with this exact JSON structure:
{
  "verdict": "2-3 sentences: is this trip advisable? Be direct.",
  "whyUnsafe": "${isUnsafe ? "2-3 sentences explaining exactly why this destination is unsafe for this date/group" : ""}",
  "groupConflict": "${conflict ? "2 sentences about which member is at risk and why, using their name" : ""}",
  "riskExplanation": "3-4 sentences: specific risks for this destination on this date in plain language",
  "healthWarning": "1-2 sentences about health-specific risks (skip if no health conditions)",
  "budgetAdvice": "1 sentence about budget feasibility (skip if no budget)",
  "alternativeReason": "${isUnsafe || conflict ? "2-3 sentences: why the alternatives are better and which one you specifically recommend" : ""}",
  "topTip": "Single most important actionable tip for this specific trip"
}`;

  let ai = {
    verdict:           "",
    whyUnsafe:         "",
    groupConflict:     "",
    riskExplanation:   "",
    healthWarning:     "",
    budgetAdvice:      "",
    alternativeReason: "",
    topTip:            "",
  };

  const aiRaw = await callClaude(prompt);
  if (aiRaw) {
    try {
      const cleaned = aiRaw.replace(/```json|```/g, "").trim();
      ai = { ...ai, ...JSON.parse(cleaned) };
    } catch {
      ai.verdict = aiRaw.slice(0, 300);
    }
  }

  // ── Response ──────────────────────────────────────────────────────────────
  return NextResponse.json({
    destination: {
      id:       location.id,
      name:     location.name,
      district: location.district.name,
      province: location.district.province.name,
      altitude: location.altitude,
    },
    travelDate,
    tripType,
    season:   leaderAnalysis.riskReport.season,

    // Solo: leader's score / Group: conservative min score
    overallScore: groupScore,
    overallLevel: groupLevel,
    groupAvgScore,
    confidence:   leaderAnalysis.riskReport.confidence,
    conflict,
    mostVulnerableMember: conflict ? {
      name:  mostVulnerable?.name,
      score: mostVulnerable?.score,
      level: mostVulnerable?.level,
      risks: mostVulnerable?.topRisks,
    } : null,

    // Per-member breakdown
    memberAnalyses: memberAnalyses.map((m) => ({
      userId:      m.userId,
      name:        m.name,
      username:    m.username,
      isLeader:    m.isLeader,
      score:       m.score,
      level:       m.level,
      topRisks:    m.topRisks,
      healthFlags: m.healthFlags,
    })),

    // Risk details from leader's analysis
    riskFactors:      leaderAnalysis.riskReport.riskFactors,
    healthAdvisories: leaderAnalysis.riskReport.healthAdvisories,
    recommendations:  [...leaderAnalysis.riskReport.recommendations, ...actionablePillarRecommendations],
    notableEvents:    leaderAnalysis.riskReport.notableEvents,
    seasonalContext:  leaderAnalysis.riskReport.seasonalContext,
    weatherStats:     leaderAnalysis.riskReport.weatherStats,
    liveWeather,
    liveHazard,
    routeRisk,
    routePlan: routePlan
      ? {
          nodes: routePlan.nodes.map((n) => ({ name: n.name, lat: n.lat, lon: n.lon })),
          segments: routePlan.segments.map((s) => ({
            from: s.from.name,
            to: s.to.name,
            distanceKm: Math.round((s.distance / 1000) * 10) / 10,
            riskLevel: s.riskLevel,
          })),
          distanceKm: Math.round((routePlan.distance / 1000) * 10) / 10,
          durationHours: Math.round((routePlan.duration / 3600) * 10) / 10,
          corridor: routePlan.nodes.map((n) => n.name).join(" → "),
          source: routePlan.source,
          resolutionNote: originResolutionNote,
        }
      : null,
    routePillar: pillarModel.route,
    destinationPillar: pillarModel.destination,
    weatherPillar: pillarModel.weather,
    personalPillar: pillarModel.personal,
    pillarScores: pillarModel.pillars,

    // Budget
    budget: {
      specified:     budgetNPR,
      estimatedTotal: estTotal,
      estimatedDays: estDays,
      perPerson,
      breakdown:     costs,
      feasible:      budgetFeasible,
      shortfall:     budgetShortfall,
    },

    // Alternatives (only when destination is unsafe)
    alternatives: sortedAlternatives,

    // AI insights
    ai,

    analyzedAt: new Date().toISOString(),
  });
}

function scoreToLevel(score: number) {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}
