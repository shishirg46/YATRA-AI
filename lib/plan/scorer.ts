import { analyzeTemporalRisk, generateSeasonalContext } from "@/lib/analysis/temporal-risk";
import { computePillarModel } from "@/lib/analysis/pillar-score";
import { scoreToLevel } from "./config";

export type Traveller = {
  id: string;
  name: string;
  username: string | null;
  isLeader: boolean;
  health: {
    fitnessLevel: "LOW" | "MODERATE" | "HIGH";
    mobilityLimited: boolean;
    chronicConditions: string[];
    allergies: string[];
  } | null;
  homeAltitude: number;
  homeProvince: string;
};

type UserHealthInput = {
  fitnessLevel: "LOW" | "MODERATE" | "HIGH";
  mobilityLimited: boolean;
  chronicConditions: string[];
  allergies: string[];
  homeAltitude: number;
  homeProvince: string;
};

type HealthInput = UserHealthInput | null;

export async function analyzeTravellers(
  travellers: Traveller[],
  destination: { name: string; district: string; province: string; lat: number; lon: number; altitude: number | null },
  travelDate: string,
  tripType: "SOLO" | "GROUP",
) {
  // Generate seasonal context ONCE (not per traveller) to avoid N duplicate AI calls
  const travelDateObj = new Date(travelDate);
  const month = travelDateObj.getMonth() + 1;
  const season = getSeason(month);
  const seasonalCtx = await generateSeasonalContext({
    destinationName: destination.name,
    district: destination.district,
    province: destination.province,
    altitude: destination.altitude ?? 0,
    month,
    season,
  });

  return Promise.all(
    travellers.map(async (t) => {
      const report = await analyzeTemporalRisk({
        destinationName: destination.name,
        district: destination.district,
        province: destination.province,
        lat: destination.lat,
        lon: destination.lon,
        altitude: destination.altitude,
        travelDate,
        userHealth: t.health ? { ...t.health, homeAltitude: t.homeAltitude, homeProvince: t.homeProvince } : null,
        tripType,
        precomputedSeasonalContext: seasonalCtx,
      });
      return {
        userId: t.id,
        name: t.name,
        username: t.username,
        isLeader: t.isLeader,
        score: report.overallScore,
        level: report.overallLevel,
        topRisks: report.riskFactors.slice(0, 2).map((r: { name: string }) => r.name),
        healthFlags: report.healthAdvisories.map((h: { condition: string }) => h.condition),
        riskReport: report,
      };
    }),
  );
}

function getSeason(month: number): string {
  if (month >= 6  && month <= 9)  return "Monsoon";
  if (month >= 12 || month <= 2)  return "Winter";
  if (month >= 3  && month <= 5)  return "Pre-monsoon (Spring)";
  return "Post-monsoon (Autumn)";
}

export async function computePillar(
  destination: { id: string; name: string; district: string; province: string; lat: number; lon: number; altitude: number | null },
  home: { name: string; district: string; province: string; lat: number; lon: number; altitude: number },
  travelDate: string,
  tripType: "SOLO" | "GROUP",
  leaderHealth: { fitnessLevel: "LOW" | "MODERATE" | "HIGH"; mobilityLimited: boolean; chronicConditions: string[] } | null,
  endDate?: string,
) {
  return computePillarModel({
    destination,
    home,
    travelDate,
    endDate,
    tripType,
    userHealth: leaderHealth,
  });
}

export function computeGroupScore(
  memberAnalyses: { score: number; level: string; name: string; topRisks: string[] }[],
  pillarTotalScore: number,
  tripType: "SOLO" | "GROUP",
) {
  const scores = memberAnalyses.map((m) => m.score);
  const groupMinScore = Math.min(...scores);
  const groupAvgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const groupScore = tripType === "GROUP"
    ? Math.min(groupMinScore, pillarTotalScore)
    : Math.round((pillarTotalScore + groupMinScore) / 2);
  const groupLevel = scoreToLevel(groupScore);
  const conflict = memberAnalyses.some((m) => m.level === "HIGH_RISK" || m.level === "EXTREME");
  const mostVulnerable = memberAnalyses.find((m) => m.score === groupMinScore);
  return { groupScore, groupLevel, groupAvgScore, conflict, mostVulnerable };
}

export function gatherRecommendations(
  pillarModel: { route: { segmentFlags: { where: string; effect: string; when: string }[] }; personal: { guideRequired: boolean; flags: string[]; emergencyPreparedness: { hospital: string } } },
  locationName: string,
) {
  const r: { type: "ROUTE" | "MEDICAL"; text: string }[] = [
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
    ...(locationName.toLowerCase().includes("palpa") || locationName.toLowerCase().includes("tansen")
      ? [{ type: "ROUTE" as const, text: "Drive carefully after Butwal on Siddhartha Highway; sharp bends and variable mountain visibility are common." }]
      : []),
  ];
  return r;
}
