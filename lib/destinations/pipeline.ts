import { prisma } from "@/lib/prisma";
import { DestinationCategory } from "@/app/generated/prisma/client";

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
    `SELECT *, ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 AS "distanceKm"
     FROM "destination"
     WHERE geom IS NOT NULL
       AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
       AND "destinationTier" >= 2
     ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
     LIMIT $4`,
    lon, lat, radiusKm * 1000, limit
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


