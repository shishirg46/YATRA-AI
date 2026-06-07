import { prisma } from "@/lib/prisma";

export interface CommunityHazardImpact {
  reportCount: number;
  criticalCount: number;
  highCount: number;
  penalty: number;
  reasoning: string[];
}

/**
 * Fetch approved community hazard reports near a route corridor
 * and compute a risk penalty.
 */
export async function getCommunityHazardImpact(
  originLat: number, originLon: number,
  destLat: number, destLon: number,
): Promise<CommunityHazardImpact> {
  // Define bounding box around the route with 20km buffer
  const bufferDeg = 20 / 111.32;
  const minLat = Math.min(originLat, destLat) - bufferDeg;
  const maxLat = Math.max(originLat, destLat) + bufferDeg;
  const minLng = Math.min(originLon, destLon) - bufferDeg;
  const maxLng = Math.max(originLon, destLon) + bufferDeg;

  const reports = await prisma.communityHazardReport.findMany({
    where: {
      status: "APPROVED",
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
    },
    select: { hazardType: true, severity: true, lat: true, lng: true },
  });

  if (reports.length === 0) {
    return { reportCount: 0, criticalCount: 0, highCount: 0, penalty: 0, reasoning: [] };
  }

  let penalty = 0;
  const criticalCount = reports.filter((r) => r.severity === "CRITICAL").length;
  const highCount = reports.filter((r) => r.severity === "HIGH").length;
  const mediumCount = reports.filter((r) => r.severity === "MEDIUM").length;
  const lowCount = reports.filter((r) => r.severity === "LOW").length;

  // Penalty calculation: CRITICAL=15, HIGH=10, MEDIUM=5, LOW=2
  penalty += criticalCount * 15;
  penalty += highCount * 10;
  penalty += mediumCount * 5;
  penalty += lowCount * 2;

  // Cap total community report penalty at 30
  penalty = Math.min(penalty, 30);

  const reasoning: string[] = [];
  if (criticalCount > 0) reasoning.push(`${criticalCount} critical community hazard report(s) near route`);
  if (highCount > 0) reasoning.push(`${highCount} high-severity community hazard report(s) near route`);
  if (mediumCount > 0) reasoning.push(`${mediumCount} medium-severity community hazard report(s) near route`);

  return {
    reportCount: reports.length,
    criticalCount,
    highCount,
    penalty,
    reasoning,
  };
}

/**
 * Fetch approved community hazard reports near a specific location
 */
export async function getCommunityReportsNear(
  lat: number, lng: number, radiusKm = 20,
) {
  const degLat = radiusKm / 111.32;
  const degLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));

  return prisma.communityHazardReport.findMany({
    where: {
      status: "APPROVED",
      lat: { gte: lat - degLat, lte: lat + degLat },
      lng: { gte: lng - degLng, lte: lng + degLng },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, hazardType: true, severity: true,
      title: true, description: true, lat: true, lng: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
}
