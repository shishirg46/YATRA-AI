import { prisma } from "@/lib/prisma";
import { analyzeTemporalRisk } from "@/lib/analysis/temporal-risk";
import { getCosts } from "./config";
import type { Traveller } from "./scorer";

type DestinationSummary = {
  id: string;
  name: string;
  district: string;
  province: string;
  altitude: number | null;
  safetyScore: number;
  safetyLevel: string;
  estimatedNPR: number;
  budgetFeasible: boolean;
};

export async function findAlternatives(
  destinationId: string,
  location: { name: string; district: { name: string; province: { name: string } } },
  travelDate: string,
  tripType: "SOLO" | "GROUP",
  allTravellers: Traveller[],
  budgetNPR: number,
  altitude: number | null,
): Promise<DestinationSummary[]> {
  const needsAlternatives = true;

  if (!needsAlternatives) return [];

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

  const altCosts = getCosts(location.name, altitude);
  const estDays = (altitude ?? 0) > 3000 ? 7 : (altitude ?? 0) > 1500 ? 4 : 2;

  const scored = await Promise.all(
    rawAlternatives
      .filter((a) => a.riskReports.length > 0)
      .map(async (a) => {
        const ac = getCosts(a.name, a.altitude);
        const altDaily = ac.accommodation + ac.food + ac.transport;
        const altTotal = altDaily * estDays;
        const budgetOk = budgetNPR === 0 || altTotal <= budgetNPR * 1.1;

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
                travelDate,
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
        };
      }),
  );

  return scored
    .filter((a) => a.safetyScore >= 60)
    .sort((a, b) => b.safetyScore - a.safetyScore)
    .slice(0, 4);
}
