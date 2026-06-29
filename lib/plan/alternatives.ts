import { prisma } from "@/lib/prisma";
import { analyzeTemporalRisk } from "@/lib/analysis/temporal-risk";
import { computeLivingCost, computeTripDays } from "./config";
import type { Traveller } from "./scorer";
import type { TravelStyle } from "./trip-types";
import type { Alternative } from "@/lib/types/plan-report";

export async function findAlternatives(
  destinationId: string,
  location: { name: string; district: { name: string; province: { name: string } } },
  startDate: string,
  endDate: string,
  tripType: "SOLO" | "GROUP",
  allTravellers: Traveller[],
  budgetNPR: number,
  altitude: number | null,
  travelStyle: TravelStyle,
): Promise<Alternative[]> {
  const tripDays = computeTripDays(startDate, endDate);

  const rawAlternatives = await prisma.location.findMany({
    where: {
      id: { not: destinationId },
      district: { province: { name: location.district.province.name } },
      riskReports: { some: { safetyLevel: { in: ["SAFE", "CAUTION"] } } },
    },
    include: {
      district: { include: { province: true } },
      riskReports: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 10,
  });

  const scored = await Promise.all(
    rawAlternatives
      .filter((a) => a.riskReports.length > 0)
      .map(async (a) => {
        const dailyCost = computeLivingCost(a.name, a.altitude, travelStyle);
        const altDailyTotal = dailyCost.total;
        const altTotal = altDailyTotal * tripDays;
        const budgetOk = altTotal <= budgetNPR;

        let minAltScore = a.riskReports[0].safetyScore;
        if (tripType === "GROUP" && allTravellers.length > 1) {
          const altScores = await Promise.all(
            allTravellers.map(async (t) => {
              const h = t.health;
              const r = await analyzeTemporalRisk({
                destinationName: a.name,
                district: a.district.name,
                province: a.district.province.name,
                lat: a.latitude,
                lon: a.longitude,
                altitude: a.altitude,
                travelDate: startDate,
                userHealth: h ? { ...h, homeAltitude: t.homeAltitude, homeProvince: t.homeProvince } : null,
                tripType,
              });
              return r.overallScore;
            }),
          );
          minAltScore = Math.min(...altScores);
        }

        return {
          id: a.id,
          name: a.name,
          district: a.district.name,
          province: a.district.province.name,
          altitude: a.altitude ?? null,
          safetyScore: minAltScore,
          safetyLevel: a.riskReports[0].safetyLevel,
          estimatedNPR: altTotal,
          budgetFeasible: budgetOk,
          transportCost: 0,
          dailyCost: altDailyTotal,
          tripDays,
        };
      }),
  );

  return scored
    .filter((a) => a.safetyScore >= 60)
    .sort((a, b) => b.safetyScore - a.safetyScore)
    .slice(0, 4);
}
