/**
 * FILE: group-risk.ts
 * LOCATION: /lib/analysis/group-risk.ts
 * PURPOSE: Consensus-based group safety analysis
 *
 * METHODS:
 *  1. Worst-case safety (min score across all members per stop)
 *  2. Alternative destination recommendation (safe for ALL members)
 *  3. Scoring consensus (average + minimum threshold)
 *  4. Personalised altitude adjustment (home altitude vs destination)
 */

import { prisma } from "@/lib/prisma";
import { analyzeTemporalRisk } from "./temporal-risk";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";

export type SafetyLevel = "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";

export interface MemberProfile {
  userId:   string;
  name:     string;
  username: string | null;
  health: {
    fitnessLevel:      "LOW" | "MODERATE" | "HIGH";
    mobilityLimited:   boolean;
    chronicConditions: string[];
    allergies:         string[];
  } | null;
  homeAltitude: number;
  homeProvince: string;
}

export interface StopInput {
  locationId:    string;
  locationName:  string;
  district:      string;
  province:      string;
  lat:           number;
  lon:           number;
  altitude:      number | null;
  arrivalDate:   string; // YYYY-MM-DD
  departureDate: string;
}

export interface MemberStopResult {
  userId:      string;
  name:        string;
  safetyScore: number;
  safetyLevel: SafetyLevel;
  topRisks:    string[];
  healthFlags: string[];
}

export interface StopAnalysis {
  stop:         StopInput;
  // Per-member results
  memberResults: MemberStopResult[];
  // Consensus
  groupScore:   number;          // average of all members
  minScore:     number;          // worst-case member score
  groupLevel:   SafetyLevel;     // based on minScore (worst-case rule)
  conflict:     boolean;         // not all members are SAFE/CAUTION
  conflictReason: string;
  // Alternatives safe for ALL members (populated if conflict)
  alternatives: AlternativeStop[];
}

export interface AlternativeStop {
  locationId:    string;
  name:          string;
  district:      string;
  province:      string;
  altitude:      number | null;
  safetyScore:   number;
  safetyLevel:   SafetyLevel;
  reason:        string;
}

export interface RouteSegmentRisk {
  from:     string; // location name
  to:       string;
  date:     string;
  risk:     "LOW" | "MEDIUM" | "HIGH";
  reason:   string;
}

export interface GroupRouteAnalysis {
  stopAnalyses:    StopAnalysis[];
  routeSegments:   RouteSegmentRisk[];
  overallGroupScore: number;
  overallGroupLevel: SafetyLevel;
  totalBudgetNPR:  number | null;
  budgetPerPerson: number | null;
  budgetFeasible:  boolean;
  aiSummary:       string;
}

// ── Per-member risk calculation ───────────────────────────────────────────────

async function analyzeForMember(
  member:  MemberProfile,
  stop:    StopInput,
  tripType: "SOLO" | "GROUP",
): Promise<MemberStopResult> {

  const report = await analyzeTemporalRisk({
    destinationName: stop.locationName,
    district:        stop.district,
    province:        stop.province,
    lat:             stop.lat,
    lon:             stop.lon,
    altitude:        stop.altitude,
    travelDate:      stop.arrivalDate,
    userHealth:      member.health ? {
      ...member.health,
      homeAltitude: member.homeAltitude,
      homeProvince: member.homeProvince,
    } : null,
    tripType,
  });

  const healthFlags: string[] = [];
  if (member.health) {
    if (member.health.chronicConditions.includes("asthma"))  healthFlags.push("asthma");
    if (member.health.chronicConditions.includes("heart"))   healthFlags.push("heart condition");
    if (member.health.mobilityLimited)                       healthFlags.push("mobility limited");
    if (member.health.fitnessLevel === "LOW")                healthFlags.push("low fitness");

    // Altitude adjustment — coming from lowlands to high altitude
    const altDiff = (stop.altitude ?? 0) - member.homeAltitude;
    if (altDiff > 2000) healthFlags.push(`+${altDiff}m altitude change`);
  }

  return {
    userId:      member.userId,
    name:        member.name,
    safetyScore: report.overallScore,
    safetyLevel: report.overallLevel,
    topRisks:    report.riskFactors.slice(0, 2).map((f) => f.name),
    healthFlags,
  };
}

// ── Consensus logic ───────────────────────────────────────────────────────────

function scoreToLevel(score: number): SafetyLevel {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}

function buildConflictReason(results: MemberStopResult[]): string {
  const atRisk = results.filter((r) => r.safetyLevel === "HIGH_RISK" || r.safetyLevel === "EXTREME");
  if (atRisk.length === 0) return "";
  const names = atRisk.map((r) => {
    const flags = r.healthFlags.length > 0 ? ` (${r.healthFlags.join(", ")})` : "";
    return `${r.name}${flags}: score ${r.safetyScore}/100`;
  });
  return `${atRisk.length} member${atRisk.length > 1 ? "s" : ""} at elevated risk — ${names.join("; ")}`;
}

// ── Route segment risk ────────────────────────────────────────────────────────
// Improved live route risk: sample weather/hazard along the path and infer risk.

interface RoutePoint {
  lat: number;
  lon: number;
}

function sampleRoutePoints(from: RoutePoint, to: RoutePoint, count: number): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    points.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
    });
  }
  return points;
}

export async function assessRouteSegment(from: StopInput, to: StopInput): Promise<RouteSegmentRisk> {
  const date  = from.departureDate;
  const month = new Date(date).getMonth() + 1;
  const isMonsoon = month >= 6 && month <= 9;

  const altDiff = Math.abs((to.altitude ?? 0) - (from.altitude ?? 0));
  const bothHill = (from.altitude ?? 0) > 500 && (to.altitude ?? 0) > 500;
  const pathPoints = sampleRoutePoints({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }, 3);

  type WeatherSample = Awaited<ReturnType<typeof fetchWeather>>;
  type HazardSample  = Awaited<ReturnType<typeof fetchHazard>>;
  type Sample        = {
    weather: NonNullable<WeatherSample>;
    hazard:  HazardSample | null;
  };

  const samples: Sample[] = await Promise.all(pathPoints.map(async (point) => {
    const [weatherResult, hazard] = await Promise.all([
      fetchWeather(point.lat, point.lon),
      fetchHazard(point.lat, point.lon, prisma),
    ]);
    const weather = weatherResult ?? {
      temperature: 18,
      humidity:    60,
      rainfall:    0,
      windSpeed:   3,
      pressure:    1013,
      description: "fallback:weather",
      source:      "fallback",
      timestamp:   new Date().toISOString(),
      sourceLabel: "Fallback",
      officialSource: false,
    };

    return {
      weather,
      hazard: hazard ? { ...hazard, heatIndex: Math.max(0, Math.min((weather.temperature - 25) / 20, 1)) } : null,
    };
  }));

  function isValidSample(sample: Sample): sample is { weather: NonNullable<WeatherSample>; hazard: HazardSample } {
    return sample.hazard !== null;
  }

  const valid = samples.filter(isValidSample);

  let risk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  let reason = "Live route conditions appear favorable at this time.";

  if (valid.length === 0) {
    risk = isMonsoon && bothHill ? "MEDIUM" : "LOW";
    reason = "Unable to retrieve full live segment data — monitor local weather and hazard alerts.";
    return { from: from.locationName, to: to.locationName, date, risk, reason };
  }

  const floodMax     = Math.max(...valid.map((s) => s.hazard.floodIndex), 0);
  const landslideMax = Math.max(...valid.map((s) => s.hazard.landslideIndex), 0);
  const quakeMax     = Math.max(...valid.map((s) => s.hazard.earthquakeIndex), 0);
  const aqiMax       = Math.max(...valid.map((s) => s.hazard.airQuality), 0);
  const rainMax      = Math.max(...valid.map((s) => s.weather.rainfall), 0);
  const windMax      = Math.max(...valid.map((s) => s.weather.windSpeed), 0);
  const windMaxKmh   = windMax * 3.6;
  const tempMax      = Math.max(...valid.map((s) => s.weather.temperature), Number.NEGATIVE_INFINITY);
  const tempMin      = Math.min(...valid.map((s) => s.weather.temperature), Number.POSITIVE_INFINITY);

  if (floodMax >= 0.6 || landslideMax >= 0.6 || quakeMax >= 0.7 || aqiMax >= 0.8) {
    risk = "HIGH";
    reason = `Live segment hazard indices are high: flood ${Math.round(floodMax * 100)}%, landslide ${Math.round(landslideMax * 100)}%, earthquake ${Math.round(quakeMax * 100)}%, air quality ${Math.round(aqiMax * 100)}%.`;
  } else if (
    isMonsoon && bothHill && (floodMax > 0.35 || landslideMax > 0.35) ||
    rainMax >= 20 || windMax >= 14 || tempMax >= 35 || tempMin < 0 || aqiMax >= 0.65
  ) {
    risk = "MEDIUM";
    reason = `Live route conditions show moderate risk: ${rainMax.toFixed(1)}mm rain, ${windMaxKmh.toFixed(1)}km/h wind, temperature range ${tempMin.toFixed(0)}°C–${tempMax.toFixed(0)}°C, flood ${Math.round(floodMax * 100)}%.`;
  } else if (isMonsoon && bothHill) {
    risk = "MEDIUM";
    reason = `Monsoon season on a hilly route — expect possible landslides and wet roads. Check local road status before travel.`;
  }

  return {
    from:   from.locationName,
    to:     to.locationName,
    date,
    risk,
    reason,
  };
}

// ── Main analysis function ────────────────────────────────────────────────────

export async function analyzeGroupRoute(params: {
  stops:        StopInput[];
  members:      MemberProfile[];
  tripType:     "SOLO" | "GROUP";
  budgetNPR:    number | null;
  alternatives: AlternativeStop[][];   // pre-fetched safe alternatives per stop
}): Promise<GroupRouteAnalysis> {

  const { stops, members, tripType, budgetNPR, alternatives } = params;

  // Analyse each stop for each member in parallel
  const stopAnalyses: StopAnalysis[] = await Promise.all(
    stops.map(async (stop, idx) => {
      const memberResults = await Promise.all(
        members.map((m) => analyzeForMember(m, stop, tripType))
      );

      const scores    = memberResults.map((r) => r.safetyScore);
      const minScore  = Math.min(...scores);
      const avgScore  = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      const groupLevel = scoreToLevel(minScore); // worst-case rule
      const conflict  = memberResults.some(
        (r) => r.safetyLevel === "HIGH_RISK" || r.safetyLevel === "EXTREME"
      );

      return {
        stop,
        memberResults,
        groupScore:     avgScore,
        minScore,
        groupLevel,
        conflict,
        conflictReason: buildConflictReason(memberResults),
        alternatives:   conflict ? (alternatives[idx] ?? []) : [],
      };
    })
  );

  // Route segments (between consecutive stops)
  const routeSegments: RouteSegmentRisk[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    routeSegments.push(await assessRouteSegment(stops[i], stops[i + 1]));
  }

  // Overall group score = min across all stops (worst stop defines the trip)
  const allMinScores = stopAnalyses.map((s) => s.minScore);
  const overallGroupScore = Math.min(...allMinScores);
  const overallGroupLevel = scoreToLevel(overallGroupScore);

  // Budget per person
  const budgetPerPerson = budgetNPR && members.length > 0
    ? Math.round(budgetNPR / members.length)
    : null;
  const budgetFeasible  = budgetNPR == null || budgetNPR > 0; // detailed check done in API

  return {
    stopAnalyses,
    routeSegments,
    overallGroupScore,
    overallGroupLevel,
    totalBudgetNPR:  budgetNPR,
    budgetPerPerson,
    budgetFeasible,
    aiSummary:       "", // filled by API after Claude call
  };
}
