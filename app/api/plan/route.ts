export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { withRateLimit } from "@/lib/rate-limit";
import { planRequestSchema, validateBody } from "@/lib/validation";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import { getCosts, computeBudget } from "@/lib/plan/config";
import { loadDestination, loadLeaderData, loadGroupMembers } from "@/lib/plan/loader";
import { resolveOriginAndRoute, assessRoute, resolveHome } from "@/lib/plan/resolver";
import { analyzeTravellers, computePillar, computeGroupScore, gatherRecommendations } from "@/lib/plan/scorer";
import { findAlternatives } from "@/lib/plan/alternatives";
import { buildPrompt, callAiAnalysis } from "@/lib/plan/ai";

async function planHandler(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const rawBody = await req.json();
    const parsed = validateBody(planRequestSchema, rawBody);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error }, { status: parsed.status });
    }

    const { destinationId, travelDate, tripType, budgetNPR, memberUsernames, originLat, originLon } = parsed.data;

    if (new Date(travelDate) < new Date(new Date().toDateString()))
      return NextResponse.json({ message: "Travel date must be today or in the future." }, { status: 400 });
    if (tripType === "GROUP" && memberUsernames.length === 0)
      return NextResponse.json({ message: "Group trips require at least one partner." }, { status: 400 });

    const destination = await loadDestination(destinationId);
    if (!destination) return NextResponse.json({ message: "Destination not found." }, { status: 404 });

    const { health: leaderHealth, user: leaderUser } = await loadLeaderData(session.user.id);

    const [weatherResult, rawHazard] = await Promise.all([
      fetchWeather(destination.latitude, destination.longitude),
      fetchHazard(destination.district.name, destination.latitude, destination.longitude),
    ]);

    const liveWeather = weatherResult ?? {
      temperature: 18, humidity: 60, rainfall: 0, windSpeed: 3, pressure: 1013,
      description: "fallback:weather", source: "fallback", sourceLabel: "Nepal estimate", officialSource: false,
    };
    const liveHazard = { ...rawHazard, heatIndex: Math.max(0, Math.min((liveWeather.temperature - 25) / 20, 1)) };

    const groupMembers = tripType === "GROUP" ? await loadGroupMembers(memberUsernames) : [];

    const allTravellers = [
      {
        id: session.user.id,
        name: leaderUser?.name ?? "You",
        username: leaderUser?.username ?? null,
        health: leaderHealth,
        homeAltitude: leaderUser?.homeLocation?.altitude ?? 0,
        homeProvince: leaderUser?.homeLocation?.district?.province?.name ?? "",
        isLeader: true,
      },
      ...groupMembers.map((m) => ({ ...m, isLeader: false })),
    ];

    const { effectiveHome, routePlan, originResolutionNote } = await resolveOriginAndRoute(
      originLat, originLon, session.user.id, destination, leaderUser?.homeLocation as any, travelDate,
    );

    const routeRisk = await assessRoute(effectiveHome, destination as any, travelDate);

    const locationInfo = {
      name: destination.name,
      district: destination.district.name,
      province: destination.district.province.name,
      lat: destination.latitude,
      lon: destination.longitude,
      altitude: destination.altitude,
    };

    const memberAnalyses = await analyzeTravellers(allTravellers, locationInfo, travelDate, tripType);
    const leaderAnalysis = memberAnalyses[0];

    const resolvedHome = resolveHome(effectiveHome);

    const pillarModel = await computePillar(
      { ...locationInfo, id: destination.id },
      resolvedHome,
      travelDate,
      tripType,
      leaderHealth ? { fitnessLevel: leaderHealth.fitnessLevel as "LOW" | "MODERATE" | "HIGH", mobilityLimited: leaderHealth.mobilityLimited, chronicConditions: leaderHealth.chronicConditions } : null,
    );

    const { groupScore, groupLevel, groupAvgScore, conflict, mostVulnerable } = computeGroupScore(memberAnalyses, pillarModel.totalScore, tripType);

    const costs = getCosts(destination.name, destination.altitude);
    const budget = computeBudget(costs, destination.altitude, budgetNPR, allTravellers.length);

    const sortedAlternatives = await findAlternatives(
      destinationId, destination, travelDate, tripType, allTravellers, budgetNPR, destination.altitude,
    );

    const actionableRecommendations = gatherRecommendations(pillarModel, destination.name);

    const prompt = buildPrompt(
      destination, travelDate, tripType, memberAnalyses, leaderAnalysis,
      groupScore, groupLevel, groupAvgScore, conflict, mostVulnerable, budget, sortedAlternatives,
      { verdict: "", whyUnsafe: "", groupConflict: "", riskExplanation: "", healthWarning: "", budgetAdvice: "", alternativeReason: "", topTip: "" },
    );

    const ai = await callAiAnalysis(prompt);

    return NextResponse.json({
      destination: {
        id: destination.id,
        name: destination.name,
        district: destination.district.name,
        province: destination.district.province.name,
        latitude: destination.latitude,
        longitude: destination.longitude,
        altitude: destination.altitude,
      },
      travelDate,
      tripType,
      season: leaderAnalysis.riskReport.season,
      overallScore: groupScore,
      overallLevel: groupLevel,
      groupAvgScore,
      confidence: leaderAnalysis.riskReport.confidence,
      conflict,
      mostVulnerableMember: conflict ? { name: mostVulnerable?.name, score: mostVulnerable?.score, level: mostVulnerable?.level, risks: mostVulnerable?.topRisks } : null,
      memberAnalyses: memberAnalyses.map((m) => ({
        userId: m.userId, name: m.name, username: m.username, isLeader: m.isLeader,
        score: m.score, level: m.level, topRisks: m.topRisks, healthFlags: m.healthFlags,
      })),
      riskFactors: leaderAnalysis.riskReport.riskFactors,
      healthAdvisories: leaderAnalysis.riskReport.healthAdvisories,
      recommendations: [...leaderAnalysis.riskReport.recommendations, ...actionableRecommendations],
      notableEvents: leaderAnalysis.riskReport.notableEvents,
      seasonalContext: leaderAnalysis.riskReport.seasonalContext,
      weatherStats: leaderAnalysis.riskReport.weatherStats,
      liveWeather,
      liveHazard,
      routeRisk,
      routePlan: routePlan ? {
        nodes: routePlan.nodes.map((n: any) => ({ name: n.name, lat: n.lat, lon: n.lon })),
        segments: routePlan.segments.map((s: any) => ({
          from: s.from.name, to: s.to.name,
          distanceKm: Math.round((s.distance / 1000) * 10) / 10,
          riskLevel: s.riskLevel,
        })),
        distanceKm: Math.round((routePlan.distance / 1000) * 10) / 10,
        durationHours: Math.round((routePlan.duration / 3600) * 10) / 10,
        corridor: routePlan.nodes.map((n: any) => n.name).join(" \u2192 "),
        source: routePlan.source,
        resolutionNote: originResolutionNote,
      } : null,
      routePillar: pillarModel.route,
      destinationPillar: pillarModel.destination,
      weatherPillar: pillarModel.weather,
      personalPillar: pillarModel.personal,
      pillarScores: pillarModel.pillars,
      budget: { specified: budgetNPR, estimatedTotal: budget.estimatedTotal, estimatedDays: budget.estDays, perPerson: budget.perPerson, breakdown: costs, feasible: budget.feasible, shortfall: budget.shortfall },
      alternatives: sortedAlternatives,
      ai,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/plan] Unhandled error:", err);
    return NextResponse.json(
      { message: "An unexpected error occurred during analysis." },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(planHandler, { max: 10, windowSeconds: 60 });
