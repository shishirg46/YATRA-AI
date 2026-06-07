import { prisma } from "@/lib/prisma";
import { DestinationCategory } from "@/app/generated/prisma/client";

const HAVERSINE_SQL = (latCol: string, lonCol: string, latParam: string, lonParam: string) =>
  `6371 * 2 * ASIN(SQRT(
    POWER(SIN(((${latParam}) - ${latCol}) * PI() / 360), 2) +
    COS((${latParam}) * PI() / 180) * COS(${latCol} * PI() / 180) *
    POWER(SIN(((${lonParam}) - ${lonCol}) * PI() / 360), 2)
  )) AS "distanceKm"`;

function haversineWhere(
  latCol: string,
  lonCol: string,
  latParam: string,
  lonParam: string,
  maxKm: number
): string {
  const deg = maxKm / 111;
  return `${latCol} BETWEEN ${latParam} - ${deg} AND ${latParam} + ${deg}
    AND ${lonCol} BETWEEN ${lonParam} - ${deg} AND ${lonParam} + ${deg}
    AND ${latCol} IS NOT NULL AND ${lonCol} IS NOT NULL`;
}

export async function getQualityDestinations(filters?: {
  category?: DestinationCategory;
  minTier?: number;
  minPopularity?: number;
  limit?: number;
  offset?: number;
  orderBy?: "popularityScore" | "confidenceScore" | "destinationTier";
}) {
  const where: Record<string, unknown> = {};

  if (filters?.category) where.category = filters.category;
  if (filters?.minTier !== undefined) where.destinationTier = { gte: filters.minTier };
  if (filters?.minPopularity !== undefined) where.popularityScore = { gte: filters.minPopularity };

  const orderField = filters?.orderBy ?? "popularityScore";

  return prisma.destination.findMany({
    where,
    orderBy: { [orderField]: "desc" },
    take: filters?.limit ?? 50,
    skip: filters?.offset ?? 0,
  });
}

export async function getNearbyDestinations(lat: number, lon: number, radiusKm = 10, limit = 20) {
  const rows = await prisma.$queryRawUnsafe<
    Array<Record<string, unknown> & { distanceKm: number }>
  >(
    `SELECT *,
            ${HAVERSINE_SQL("latitude", "longitude", String(lat), String(lon))}
     FROM "destination"
     WHERE ${haversineWhere("latitude", "longitude", String(lat), String(lon), radiusKm)}
       AND "destinationTier" >= 2
     ORDER BY "distanceKm"
     LIMIT ${limit}`
  );
  return rows;
}

export async function getPopularDestinations(
  limit = 20,
  options?: { minTier?: number; category?: DestinationCategory },
) {
  const where: Record<string, unknown> = {};
  if (options?.minTier !== undefined) where.destinationTier = { gte: options.minTier };
  if (options?.category) where.category = options.category;

  return prisma.destination.findMany({
    where,
    orderBy: { popularityScore: "desc" },
    take: limit,
  });
}
