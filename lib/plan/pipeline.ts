import type {
  StageName, StageContext, AnalysisPhase, AnalysisContext, AnalysisOptions,
  PillarEvidence, ForecastDay, PlacePoint, AiResult, AiDiagnostics,
  StageWarning, StageTiming,
} from "./pipeline-types";
import { FatalAnalysisError, ANALYSIS_PIPELINE_VERSION } from "./pipeline-types";
import type { Traveller } from "./scorer";
import { analyzeTravellers, computeGroupScore, gatherRecommendations } from "./scorer";
import { loadDestination, loadLeaderData, loadGroupMembers } from "./loader";
import { resolveOriginAndRoute, assessRoute, resolveHome, computeRouteOutlook, tryGenerateRouteIntelligence } from "./resolver";
import { computeBudget } from "./config";
import { findAlternatives, shouldRunAlternativeAnalysis } from "./alternatives";
import type { PillarModelResult } from "@/lib/analysis/pillar-score";
import { computePillarModel } from "@/lib/analysis/pillar-score";
import { generateRouteIntelligence } from "@/lib/route-intelligence";
import { computeRouteRisk } from "@/lib/scoring/route-risk";
import type { RouteRiskResult } from "@/lib/scoring/route-risk";
import { TemplateCache } from "@/lib/explain/templates/cache";
import { runExplanationEngine } from "@/lib/explain/mapper";
import type { EvaluatorInput } from "@/lib/explain/types";
import { fetchDisasterCounts, buildCorridorLookup } from "@/lib/scoring/disaster-data";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import type { HazardSnapshot } from "@/lib/collectors/hazard";
import { buildSegmentedRoute } from "@/lib/routing/route-service";
import { fetchHistoricalHazard } from "@/lib/collectors/historical-hazard";
import { fetchHistoricalWeather } from "@/lib/collectors/historical-weather";
import {
  fetchHistoricalDisastersNearRoute,
  fetchRealtimeDisastersNearRoute,
  getDisasterImpactSummary,
} from "@/lib/disaster-pipeline";
import { prisma } from "@/lib/prisma";

// ── Internal types ──────────────────────────────────────────────────────────

interface PipelineExecution {
  timings: StageTiming[];
  warnings: StageWarning[];
}

interface PipelineState {
  ctx: AnalysisContext;
  execution: PipelineExecution;

  destination?: NonNullable<Awaited<ReturnType<typeof loadDestination>>>;
  leaderHealth?: Awaited<ReturnType<typeof loadLeaderData>>["health"];
  leaderUser?: Awaited<ReturnType<typeof loadLeaderData>>["user"];
  locationInfo?: {
    name: string;
    district: string;
    province: string;
    lat: number;
    lon: number;
    altitude: number | null;
  };
  allTravellers?: Traveller[];
  routePlan?: Awaited<ReturnType<typeof buildSegmentedRoute>> | null;
  routeRisk?: Awaited<ReturnType<typeof assessRoute>>;
  routeIntelligence?: Awaited<ReturnType<typeof generateRouteIntelligence>> | null;
  disasterRouteRisk?: RouteRiskResult | null;
  resolvedHome?: ReturnType<typeof resolveHome>;
  originResolutionNote?: string;

  liveWeather?: Awaited<ReturnType<typeof fetchWeather>>;
  liveHazard?: HazardSnapshot;
  evidence?: PillarEvidence;

  memberAnalyses?: Awaited<ReturnType<typeof analyzeTravellers>>;
  leaderAnalysis?: Awaited<ReturnType<typeof analyzeTravellers>>[number];

  pillarModel?: PillarModelResult;
  groupScore?: number;
  groupLevel?: string;
  groupAvgScore?: number;
  conflict?: boolean;
  mostVulnerable?: { name: string; score: number; level: string; topRisks: string[] };
  actionableRecommendations?: ReturnType<typeof gatherRecommendations>;

  budget?: Awaited<ReturnType<typeof computeBudget>>;
  alternatives?: Awaited<ReturnType<typeof findAlternatives>>;

  ai?: AiResult;
  routeAdvice?: string;
  aiDiagnostics?: AiDiagnostics;
}

interface StageOutputMap {
  destination: {
    destination: NonNullable<Awaited<ReturnType<typeof loadDestination>>>;
    leaderHealth: Awaited<ReturnType<typeof loadLeaderData>>["health"];
    leaderUser: Awaited<ReturnType<typeof loadLeaderData>>["user"];
    locationInfo: NonNullable<PipelineState["locationInfo"]>;
  };
  route: {
    routePlan: Awaited<ReturnType<typeof buildSegmentedRoute>> | null;
    routeRisk: Awaited<ReturnType<typeof assessRoute>>;
    routeIntelligence: Awaited<ReturnType<typeof generateRouteIntelligence>> | null;
    disasterRouteRisk: RouteRiskResult | null;
    resolvedHome: ReturnType<typeof resolveHome>;
    originResolutionNote?: string;
  };
  evidence: {
    liveWeather: NonNullable<PipelineState["liveWeather"]>;
    liveHazard: NonNullable<PipelineState["liveHazard"]>;
    evidence: PillarEvidence;
  };
  travellers: {
    memberAnalyses: NonNullable<PipelineState["memberAnalyses"]>;
    leaderAnalysis: NonNullable<PipelineState["leaderAnalysis"]>;
    allTravellers: NonNullable<PipelineState["allTravellers"]>;
  };
  pillars: {
    pillarModel: PillarModelResult;
    groupScore: number;
    groupLevel: string;
    groupAvgScore: number;
    conflict: boolean;
    mostVulnerable: { name: string; score: number; level: string; topRisks: string[] };
    actionableRecommendations: ReturnType<typeof gatherRecommendations>;
  };
  budget: {
    budget: NonNullable<PipelineState["budget"]>;
  };
  alternatives: {
    alternatives: NonNullable<PipelineState["alternatives"]>;
  };
  ai: {
    ai: AiResult;
    routeAdvice: string;
    aiDiagnostics: AiDiagnostics;
  };
  response: Record<string, never>;
}

type StageHandler<T extends StageName> = (
  state: PipelineState,
  ctx: StageContext,
) => Promise<StageOutputMap[T]>;

interface StageDef<T extends StageName> {
  name: T;
  label: string;
  fatal: boolean;
  run: StageHandler<T>;
}

// ── Stage 1: destination (FATAL) ────────────────────────────────────────────

async function stageLoadDestination(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["destination"]> {
  const destination = await loadDestination(state.ctx.destinationId);
  if (!destination) {
    throw new FatalAnalysisError("Destination not found.", 404);
  }

  const { health: leaderHealth, user: leaderUser } = await loadLeaderData(state.ctx.session.user.id);

  const locationInfo = {
    name: destination.name,
    district: destination.district.name,
    province: destination.district.province.name,
    lat: destination.latitude,
    lon: destination.longitude,
    altitude: destination.altitude,
  };

  return { destination, leaderHealth, leaderUser, locationInfo };
}

// ── Stage 2: route (recoverable) ───────────────────────────────────────────

async function stageResolveRoute(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["route"]> {
  const { leaderUser, ctx } = state;
  const destination = state.destination!;

  const { effectiveHome, routePlan, originResolutionNote } = await resolveOriginAndRoute(
    ctx.originLat, ctx.originLon, ctx.session.user.id,
    destination, leaderUser?.homeLocation as any, ctx.startDate,
  );

  const routeIntelligence = await tryGenerateRouteIntelligence(
    { lat: effectiveHome?.latitude ?? destination.latitude, lon: effectiveHome?.longitude ?? destination.longitude, name: effectiveHome?.name ?? destination.name },
    { lat: destination.latitude, lon: destination.longitude, name: destination.name },
    ctx.startDate,
    { destinationId: destination.id },
  );

  const routeRisk = await assessRoute(
    effectiveHome, destination as any, ctx.startDate,
    { routeIntelligence },
  );

  const currentMonth = new Date(ctx.startDate).getMonth() + 1;
  const isMonsoon = currentMonth >= 6 && currentMonth <= 9;
  const { historicDisasters, recentDisasters } = await fetchDisasterCounts(prisma);
  const corridorDistrictLookup = buildCorridorLookup(
    [
      effectiveHome
        ? { lat: effectiveHome.latitude, lon: effectiveHome.longitude, district: effectiveHome.district.name }
        : null,
      { lat: destination.latitude, lon: destination.longitude, district: destination.district.name },
    ].filter(Boolean) as { lat: number; lon: number; district: string }[],
  );
  const disasterRouteRisk = effectiveHome
    ? computeRouteRisk({
        originLat: effectiveHome.latitude,
        originLon: effectiveHome.longitude,
        originAlt: effectiveHome.altitude ?? null,
        originDistrict: effectiveHome.district.name,
        destLat: destination.latitude,
        destLon: destination.longitude,
        destAlt: destination.altitude ?? null,
        destDistrict: destination.district.name,
        isMonsoon,
        currentMonth,
        purposes: [],
        corridorDistrictLookup,
        historicDisasters,
        recentDisasters,
      })
    : null;

  const resolvedHome = resolveHome(effectiveHome);

  return {
    routePlan: routePlan ?? null,
    routeRisk: routeRisk ?? null,
    routeIntelligence,
    disasterRouteRisk: disasterRouteRisk ?? null,
    resolvedHome,
    originResolutionNote,
  };
}

// ── Stage 3: evidence (recoverable) ─────────────────────────────────────────

async function stageCollectEvidence(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["evidence"]> {
  const { locationInfo, destination, resolvedHome, routePlan, ctx } = state;

  const [weatherResult, rawHazard] = await Promise.all([
    fetchWeather(locationInfo!.lat, locationInfo!.lon),
    fetchHazard(locationInfo!.lat, locationInfo!.lon, prisma),
  ]);

  const liveWeather = weatherResult ?? {
    temperature: 18, humidity: 60, rainfall: 0, windSpeed: 3, pressure: 1013,
    description: "fallback:weather", source: "fallback", sourceLabel: "Nepal estimate", officialSource: false,
  } as any;

  const liveHazard = {
    ...rawHazard,
    heatIndex: Math.max(0, Math.min((liveWeather.temperature - 25) / 20, 1)),
  } as any;

  const routePoints = (routePlan as any)?.nodes
    ? (routePlan as any).nodes.map((n: any) => ({ lat: n.lat, lon: n.lon }))
    : [];

  const [routeHistorical, routeRealtime, impactSummary, destinationHistorical, destinationWeather, homeWeather, destinationLiveHazard, destinationLiveWeather, forecastWeek, places] =
    await Promise.all([
      routePoints.length ? fetchHistoricalDisastersNearRoute(routePoints, 8).catch(() => []) : Promise.resolve([]),
      routePoints.length ? fetchRealtimeDisastersNearRoute(routePoints, 8, 7).catch(() => []) : Promise.resolve([]),
      routePoints.length ? getDisasterImpactSummary(routePoints, 12).catch(() => ({ dead: 0, injured: 0, missing: 0, affected: 0, displaced: 0 })) : Promise.resolve({ dead: 0, injured: 0, missing: 0, affected: 0, displaced: 0 }),
      fetchHistoricalHazard(locationInfo!.district, locationInfo!.lat, locationInfo!.lon, ctx.startDate, 5, 75).catch(() => null),
      fetchHistoricalWeather(locationInfo!.lat, locationInfo!.lon, ctx.startDate, 5).catch(() => null),
      fetchWeather(resolvedHome!.lat, resolvedHome!.lon).catch(() => null),
      fetchHazard(locationInfo!.lat, locationInfo!.lon, prisma).catch(() => null),
      fetchWeather(locationInfo!.lat, locationInfo!.lon).catch(() => null),
      fetchForecastWindowInline(locationInfo!.lat, locationInfo!.lon, ctx.startDate, ctx.endDate).catch(() => []),
      loadPlaces().catch(() => [] as PlacePoint[]),
    ]);

  const evidence: PillarEvidence = {
    routeHistorical: routeHistorical as any,
    routeRealtime: routeRealtime as any,
    impactSummary,
    destinationHistorical,
    destinationWeather,
    homeWeather,
    destinationLiveHazard,
    destinationLiveWeather,
    forecastWeek,
    places,
  };

  return { liveWeather, liveHazard, evidence };
}

async function fetchForecastWindowInline(lat: number, lon: number, startDate: string, endDate: string) {
  try {
    const url = `https://dhm.gov.np/mfd/api/forecast?lat=${lat}&lng=${lon}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json() as any;
    const daily = data?.daily_forecast;
    if (!Array.isArray(daily) || daily.length === 0) return [];

    const startTs = Date.parse(`${startDate}T00:00:00Z`);
    const endTs = Date.parse(`${endDate}T23:59:59Z`);

    const all: ForecastDay[] = daily.map((d: any) => {
      const dt = d.datetime;
      const ts = Date.parse(`${dt}T00:00:00Z`);
      return {
        date: dt,
        weatherCode: 0,
        tempMax: Number(d.max_temperature ?? 0),
        tempMin: Number(d.min_temperature ?? 0),
        rainProb: Number(d.precipitation_probability ?? 0),
        windMax: Number(d.wind_speed ?? 0),
        isTravelDate: ts >= startTs && ts <= endTs,
      };
    });

    const inTrip = all.filter((d) => d.isTravelDate);
    if (inTrip.length >= 1) return inTrip;

    const midTs = (startTs + endTs) / 2;
    const sorted = [...all].sort((a, b) => {
      const aTs = Date.parse(`${a.date}T00:00:00Z`);
      const bTs = Date.parse(`${b.date}T00:00:00Z`);
      return Math.abs(aTs - midTs) - Math.abs(bTs - midTs);
    });
    return sorted.slice(0, 7);
  } catch {
    console.warn("[forecast] DHM API failed for weather forecast");
    return [];
  }
}

async function loadPlaces(): Promise<PlacePoint[]> {
  const rows = await prisma.location.findMany({
    select: { name: true, latitude: true, longitude: true },
  });
  return rows
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({ name: r.name, lat: r.latitude, lon: r.longitude }));
}

// ── Stage 4: travellers (recoverable) ──────────────────────────────────────

async function stageAnalyzeTravellers(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["travellers"]> {
  const { ctx, locationInfo, leaderHealth, leaderUser } = state;

  const groupMembers = ctx.tripType === "GROUP" ? await loadGroupMembers(ctx.memberUsernames) : [];

  const allTravellers: Traveller[] = [
    {
      id: ctx.session.user.id,
      name: leaderUser?.name ?? "You",
      username: leaderUser?.username ?? null,
      health: leaderHealth as any,
      homeAltitude: leaderUser?.homeLocation?.altitude ?? 0,
      homeProvince: leaderUser?.homeLocation?.district?.province?.name ?? "",
      isLeader: true,
    },
    ...groupMembers.map((m) => ({ ...m, isLeader: false })),
  ];

  const memberAnalyses = await analyzeTravellers(
    allTravellers,
    locationInfo!,
    ctx.startDate,
    ctx.tripType,
  );
  const leaderAnalysis = memberAnalyses[0];

  return { memberAnalyses, leaderAnalysis, allTravellers };
}

// ── Stage 5: pillars (recoverable) ─────────────────────────────────────────

async function stageComputePillars(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["pillars"]> {
  const { ctx, locationInfo, evidence, leaderHealth, resolvedHome } = state;

  const pillarModel = await computePillarModel(
    {
      routeIntelligence: state.routeIntelligence,
      destination: {
        id: state.destination!.id,
        name: locationInfo!.name,
        district: locationInfo!.district,
        province: locationInfo!.province,
        lat: locationInfo!.lat,
        lon: locationInfo!.lon,
        altitude: locationInfo!.altitude,
      },
      home: resolvedHome!,
      travelDate: ctx.startDate,
      endDate: ctx.endDate,
      tripType: ctx.tripType,
      userHealth: leaderHealth
        ? {
            fitnessLevel: leaderHealth.fitnessLevel as "LOW" | "MODERATE" | "HIGH",
            mobilityLimited: leaderHealth.mobilityLimited,
            chronicConditions: leaderHealth.chronicConditions,
          }
        : null,
    },
    evidence,
  );

  const { groupScore, groupLevel, groupAvgScore, conflict, mostVulnerable } = computeGroupScore(
    state.memberAnalyses!,
    pillarModel.totalScore,
    ctx.tripType,
  );

  const actionableRecommendations = gatherRecommendations(pillarModel, locationInfo!.name);

  return {
    pillarModel,
    groupScore,
    groupLevel,
    groupAvgScore,
    conflict,
    mostVulnerable: conflict && mostVulnerable
      ? { name: mostVulnerable.name, score: mostVulnerable.score, level: mostVulnerable.level as string, topRisks: mostVulnerable.topRisks }
      : { name: "", score: 0, level: "", topRisks: [] },
    actionableRecommendations,
  };
}

// ── Stage 6: budget (recoverable) ──────────────────────────────────────────

async function stageComputeBudget(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["budget"]> {
  const { ctx, resolvedHome, locationInfo, allTravellers } = state;

  const effectiveOrigin = resolvedHome!.lat !== 0 && resolvedHome!.lon !== 0
    ? { lat: resolvedHome!.lat, lon: resolvedHome!.lon }
    : null;

  const budget = await computeBudget({
    destinationName: locationInfo!.name,
    destinationLat: locationInfo!.lat,
    destinationLon: locationInfo!.lon,
    altitude: locationInfo!.altitude,
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    budgetNPR: ctx.budgetNPR,
    travellerCount: allTravellers!.length,
    travelStyle: ctx.travelStyle,
    vehicle: ctx.vehicle,
    origin: effectiveOrigin,
  });

  return { budget };
}

// ── Stage 7: alternatives (recoverable) ────────────────────────────────────

async function stageFindAlternatives(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["alternatives"]> {
  const { ctx, allTravellers, destination, groupLevel } = state;

  if (!shouldRunAlternativeAnalysis(groupLevel ?? "SAFE")) {
    return { alternatives: [] };
  }

  const alternatives = await findAlternatives(
    ctx.destinationId,
    {
      name: destination!.name,
      district: { name: destination!.district.name, province: { name: destination!.district.province.name } },
    },
    ctx.startDate,
    ctx.endDate,
    ctx.tripType,
    allTravellers!,
    ctx.budgetNPR,
    destination!.altitude,
    ctx.travelStyle,
  );

  return { alternatives };
}

// ── Stage 8: Deterministic explanation engine ──────────────────────────────

async function stageGenerateAiNarrative(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["ai"]> {
  const startTime = performance.now();

  if (!TemplateCache.instance.size) {
    try {
      await TemplateCache.initialize(prisma);
    } catch (err) {
      console.error("[pipeline] TemplateCache init failed:", err);
    }
  }

  const input = buildEvaluatorInput(state);

  let output = { ai: emptyAiResult(), routeAdvice: "" };
  try {
    const result = await runExplanationEngine(input);
    output = result.output;
  } catch (err) {
    console.error("[pipeline] ExplanationEngine failed:", err);
  }

  const durationMs = performance.now() - startTime;

  return {
    ai: output.ai,
    routeAdvice: output.routeAdvice,
    aiDiagnostics: {
      provider: "deterministic",
      model: "explanation-engine-v2",
      durationMs,
      fallbackUsed: false,
    },
  };
}

function buildEvaluatorInput(state: PipelineState): EvaluatorInput {
  const loc = state.locationInfo!;
  const la = state.leaderAnalysis!;
  const ctx = state.ctx;
  const dest = state.destination!;

  return {
    destination: {
      id: dest.id,
      name: dest.name,
      district: dest.district.name,
      province: dest.district.province.name,
      latitude: dest.latitude,
      longitude: dest.longitude,
      altitude: dest.altitude,
    },
    locationInfo: {
      name: loc.name,
      district: loc.district,
      province: loc.province,
      lat: loc.lat,
      lon: loc.lon,
      altitude: loc.altitude,
    },
    travelDate: ctx.startDate,
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    vehicle: ctx.vehicle,
    travelStyle: ctx.travelStyle,
    tripType: ctx.tripType,
    season: la.riskReport.season,
    overallScore: state.groupScore ?? 0,
    overallLevel: (state.groupLevel ?? "CAUTION") as any,
    baselineScore: state.pillarModel?.baselineScore ?? 0,
    seasonalModifier: state.pillarModel ? {
      factors: state.pillarModel.seasonalFactors.map((f) => ({ factor: f.factor, points: f.points })),
      total: -state.pillarModel.seasonalFactors.reduce((s, f) => s + f.points, 0),
      effectiveScore: state.groupScore ?? 0,
      baselineScore: state.pillarModel.baselineScore,
    } : undefined,
    groupAvgScore: state.groupAvgScore ?? 0,
    confidence: la.riskReport.confidence,
    conflict: state.conflict ?? false,
    mostVulnerableMember: state.conflict && state.mostVulnerable
      ? { name: state.mostVulnerable.name, score: state.mostVulnerable.score, level: state.mostVulnerable.level, risks: state.mostVulnerable.topRisks }
      : null,
    memberAnalyses: (state.memberAnalyses ?? []).map((m) => ({
      userId: m.userId,
      name: m.name,
      username: m.username,
      isLeader: m.isLeader,
      score: m.score,
      level: m.level,
      topRisks: m.topRisks,
      healthFlags: m.healthFlags,
    })),
    riskFactors: la.riskReport.riskFactors.map((f: any) => ({
      category: f.category ?? "",
      name: f.name,
      severity: f.severity,
      score: f.score ?? 0,
      description: f.description ?? "",
    })),
    healthAdvisories: la.riskReport.healthAdvisories.map((h: any) => ({
      condition: h.condition,
      risk: h.risk,
      detail: h.detail,
      affectedGroups: h.affectedGroups,
    })),
    recommendations: [
      ...la.riskReport.recommendations.map((r: any) => ({ type: r.type ?? "", text: r.text })),
      ...(state.actionableRecommendations ?? []).map((r: any) => ({ type: r.type ?? "", text: r.text })),
    ],
    notableEvents: la.riskReport.notableEvents.map((e: any) => ({
      date: e.date,
      type: e.type,
      description: e.description,
      severity: e.severity,
    })),
    seasonalContext: la.riskReport.seasonalContext,
    weatherStats: la.riskReport.weatherStats as any,
    budget: state.budget!,
    alternatives: (state.alternatives ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      district: a.district,
      province: a.province,
      altitude: a.altitude,
      safetyScore: a.safetyScore,
      safetyLevel: a.safetyLevel,
      estimatedNPR: a.estimatedNPR,
      budgetFeasible: a.budgetFeasible,
      transportCost: a.transportCost,
      dailyCost: a.dailyCost,
      tripDays: a.tripDays,
    })),
    liveWeather: state.liveWeather as any,
    liveHazard: state.liveHazard as any,
    routeRisk: state.routeRisk as any,
    disasterRouteRisk: state.disasterRouteRisk as any,
    routeAssessment: state.routePlan ? {
      roadConditions: "MEDIUM" as const,
      seasonalCorridorRisk: "MEDIUM" as const,
      overall: (state.groupLevel ?? "CAUTION") as any,
    } : undefined,
    routePlan: state.routePlan ? {
      nodes: state.routePlan.nodes.map((n: any) => ({ name: n.name, lat: n.lat, lon: n.lon })),
      segments: state.routePlan.segments.map((s: any) => ({
        from: s.from.name ?? s.from,
        to: s.to.name ?? s.to,
        distanceKm: Math.round((s.distance / 1000) * 10) / 10,
        riskLevel: s.riskLevel,
      })),
      distanceKm: Math.round((state.routePlan!.distance / 1000) * 10) / 10,
      durationHours: Math.round((state.routePlan!.duration / 3600) * 10) / 10,
      corridor: state.routePlan.nodes.map((n: any) => n.name).join(" \u2192 "),
      source: state.routePlan.source,
      resolutionNote: state.originResolutionNote,
    } : null,
    routePillar: state.pillarModel?.route as any,
    segmentDetails: state.pillarModel?.segmentDetails as any,
    destinationPillar: state.pillarModel?.destination as any,
    weatherPillar: state.pillarModel?.weather as any,
    personalPillar: state.pillarModel?.personal as any,
    pillarScores: state.pillarModel?.pillars as any,
    stopAnalyses: undefined,
    evidence: state.evidence ?? null,
  };
}

// ── Stage 9: response (pure, no I/O) ───────────────────────────────────────

async function stageBuildResponse(
  state: PipelineState,
  _ctx: StageContext,
): Promise<StageOutputMap["response"]> {
  return {};
}

function buildResponse(state: Readonly<PipelineState>): AnalysisResult {
  const {
    ctx, destination, locationInfo, leaderAnalysis, pillarModel,
    groupScore, groupLevel, groupAvgScore, conflict, mostVulnerable,
    memberAnalyses,
    actionableRecommendations, budget, alternatives,
    liveWeather, liveHazard, routeRisk, disasterRouteRisk, routePlan,
    routeAdvice, ai, evidence, originResolutionNote,
  } = state;

  const roadConditions = routeRisk?.risk ?? null;
  const seasonalLevel = disasterRouteRisk
    ? ({ SAFE: "LOW", CAUTION: "MEDIUM", HIGH_RISK: "HIGH", EXTREME: "EXTREME" } as Record<string, "LOW" | "MEDIUM" | "HIGH" | "EXTREME">)[
        (disasterRouteRisk as any).routeRiskLevel ?? "SAFE"
      ] ?? "LOW"
    : null;
  const routeAssessment = roadConditions && seasonalLevel
    ? {
        roadConditions: roadConditions as "LOW" | "MEDIUM" | "HIGH",
        seasonalCorridorRisk: seasonalLevel,
        overall: computeRouteOutlook(roadConditions as "LOW" | "MEDIUM" | "HIGH", seasonalLevel),
      }
    : null;

  return {
    destination: {
      id: destination!.id,
      name: destination!.name,
      district: destination!.district.name,
      province: destination!.district.province.name,
      latitude: destination!.latitude,
      longitude: destination!.longitude,
      altitude: destination!.altitude,
    },
    travelDate: ctx.startDate,
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    vehicle: ctx.vehicle,
    travelStyle: ctx.travelStyle,
    tripType: ctx.tripType,
    season: leaderAnalysis?.riskReport.season ?? "",
    overallScore: groupScore ?? 0,
    overallLevel: (groupLevel ?? "CAUTION") as "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME",
    baselineScore: pillarModel?.baselineScore ?? 0,
    seasonalModifier: pillarModel ? {
      factors: pillarModel.seasonalFactors,
      total: -pillarModel.seasonalFactors.reduce((s, f) => s + f.points, 0),
      effectiveScore: groupScore ?? 0,
      baselineScore: pillarModel.baselineScore,
    } : undefined,
    groupAvgScore: groupAvgScore ?? 0,
    confidence: leaderAnalysis?.riskReport.confidence ?? 0,
    conflict: conflict ?? false,
    mostVulnerableMember: conflict && mostVulnerable
      ? { name: mostVulnerable.name, score: mostVulnerable.score, level: mostVulnerable.level, risks: mostVulnerable.topRisks }
      : null,
    memberAnalyses: (memberAnalyses ?? []).map((m) => ({
      userId: m.userId, name: m.name, username: m.username, isLeader: m.isLeader,
      score: m.score, level: m.level, topRisks: m.topRisks, healthFlags: m.healthFlags,
    })),
    riskFactors: leaderAnalysis?.riskReport.riskFactors ?? [],
    healthAdvisories: leaderAnalysis?.riskReport.healthAdvisories ?? [],
    recommendations: [
      ...(leaderAnalysis?.riskReport.recommendations ?? []),
      ...(actionableRecommendations ?? []),
    ],
    notableEvents: leaderAnalysis?.riskReport.notableEvents ?? [],
    seasonalContext: leaderAnalysis?.riskReport.seasonalContext ?? "",
    weatherStats: leaderAnalysis?.riskReport.weatherStats ?? null,
    liveWeather,
    liveHazard,
    routeRisk,
    disasterRouteRisk,
    routeAssessment,
    routePlan: routePlan ? {
      nodes: routePlan.nodes.map((n: any) => ({ name: n.name, lat: n.lat, lon: n.lon })),
      segments: routePlan.segments.map((s: any) => ({
        from: s.from.name, to: s.to.name,
        distanceKm: Math.round((s.distance / 1000) * 10) / 10,
        riskLevel: s.riskLevel,
      })),
      distanceKm: Math.round((routePlan.distance / 1000) * 10) / 10,
      durationHours: Math.round((routePlan.duration / 3600) * 10) / 10,
      corridor: routePlan.nodes.map((n: any) => n.name).join(" → "),
      source: routePlan.source,
      resolutionNote: originResolutionNote,
    } : null,
    routePillar: pillarModel?.route,
    segmentDetails: pillarModel?.segmentDetails,
    destinationPillar: pillarModel?.destination,
    weatherPillar: pillarModel?.weather,
    personalPillar: pillarModel?.personal,
    pillarScores: pillarModel?.pillars,
    budget: budget ?? {
      specified: 0, estimatedTotal: 0, estimatedDays: 0, tripDays: 0,
      perPerson: 0, breakdown: { accommodation: 0, food: 0, localTransport: 0, intercityTransport: 0, misc: 0, label: "" },
      dailyCost: { accommodation: 0, meals: 0, localTransport: 0, misc: 0, total: 0 },
      transportCost: 0, remainingBudget: 0, feasible: true, shortfall: 0,
    },
    alternatives: alternatives ?? [],
    ai: { ...(ai ?? emptyAiResult()), routeAdvice: routeAdvice || undefined },
    evidence: evidence ?? null,
    analyzedAt: new Date().toISOString(),
  };
}

function emptyAiResult(): AiResult {
  return {
    verdict: "", whyUnsafe: "", groupConflict: "", riskExplanation: "",
    healthWarning: "", budgetAdvice: "", alternativeReason: "", topTip: "",
  };
}

// ── Pipeline definition ────────────────────────────────────────────────────

const PIPELINE: readonly StageDef<any>[] = [
  { name: "destination", label: "Loading destination", fatal: true, run: stageLoadDestination },
  { name: "route", label: "Resolving route", fatal: false, run: stageResolveRoute },
  { name: "evidence", label: "Collecting evidence", fatal: false, run: stageCollectEvidence },
  { name: "travellers", label: "Analyzing travellers", fatal: false, run: stageAnalyzeTravellers },
  { name: "pillars", label: "Computing pillars", fatal: false, run: stageComputePillars },
  { name: "budget", label: "Calculating budget", fatal: false, run: stageComputeBudget },
  { name: "alternatives", label: "Finding alternatives", fatal: false, run: stageFindAlternatives },
  { name: "ai", label: "Generating explanation", fatal: false, run: stageGenerateAiNarrative },
  { name: "response", label: "Building response", fatal: false, run: stageBuildResponse },
];

// ── Public API ─────────────────────────────────────────────────────────────

export async function runAnalysis(
  ctx: AnalysisContext,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const state: PipelineState = { ctx, execution: { timings: [], warnings: [] } };
  const { onProgress, signal, debug } = options;
  const stageCtx: StageContext = { signal, debug: debug ?? false };
  const total = PIPELINE.length;

  for (const [index, stageDef] of PIPELINE.entries()) {
    signal?.throwIfAborted();

    const step = index + 1;
    const startTime = performance.now();
    const startedPhase: AnalysisPhase = {
      step, total, stageName: stageDef.name, label: stageDef.label,
      status: "running", startedAt: startTime,
    };
    onProgress?.(startedPhase);

    try {
      const output = await stageDef.run(state, stageCtx);
      Object.assign(state, output);

      const finishedAt = performance.now();
      state.execution.timings.push({
        stage: stageDef.name, startedAt: startTime,
        finishedAt, durationMs: finishedAt - startTime,
      });
      onProgress?.({
        ...startedPhase, status: "completed", result: "completed",
        finishedAt, durationMs: finishedAt - startTime,
      });
    } catch (err) {
      const finishedAt = performance.now();

      if (err instanceof FatalAnalysisError) {
        state.execution.timings.push({
          stage: stageDef.name, startedAt: startTime,
          finishedAt, durationMs: finishedAt - startTime,
        });
        onProgress?.({
          ...startedPhase, status: "failed", result: "failed",
          finishedAt, durationMs: finishedAt - startTime,
        });
        throw err;
      }

      state.execution.warnings.push({
        stage: stageDef.name,
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      });
      state.execution.timings.push({
        stage: stageDef.name, startedAt: startTime,
        finishedAt, durationMs: finishedAt - startTime,
      });
      onProgress?.({
        ...startedPhase, status: "warning", result: "warning",
        finishedAt, durationMs: finishedAt - startTime,
      });
    }
  }

  return buildFinalResult(state, options);
}

function buildFinalResult(
  state: Readonly<PipelineState>,
  options: Readonly<AnalysisOptions>,
): AnalysisResult {
  const result = buildResponse(state);
  if (options.debug) {
    result.meta = {
      version: ANALYSIS_PIPELINE_VERSION,
      timings: state.execution.timings,
      warnings: state.execution.warnings,
    };
    if (state.aiDiagnostics) {
      result.meta.ai = state.aiDiagnostics;
    }
  }
  return result;
}

// ── Re-exports ─────────────────────────────────────────────────────────────

export type { AnalysisPhase, StageName } from "./pipeline-types";

// ── AnalysisResult (local alias for PlanReport) ────────────────────────────

import type { PlanReport } from "@/lib/types/plan-report";
type AnalysisResult = PlanReport;
