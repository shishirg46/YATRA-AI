import { prisma } from "@/lib/prisma";
import { DestinationCategory } from "@/app/generated/prisma/client";
import type { Prisma } from "@/app/generated/prisma/client";

export async function getDestinations(filters?: {
  category?: string;
  minScore?: number;
  minTier?: number;
  minPopularity?: number;
  limit?: number;
  offset?: number;
  orderBy?: "popularityScore" | "confidenceScore" | "destinationTier" | "dataQualityScore";
}) {
  const where: Prisma.DestinationWhereInput = {};

  if (filters?.category) {
    where.category = filters.category as DestinationCategory;
  }
  if (filters?.minScore !== undefined) {
    where.dataQualityScore = { gte: filters.minScore };
  }
  if (filters?.minTier !== undefined) {
    where.destinationTier = { gte: filters.minTier };
  }
  if (filters?.minPopularity !== undefined) {
    where.popularityScore = { gte: filters.minPopularity };
  }

  const orderField: string = filters?.orderBy ?? "popularityScore";

  return prisma.destination.findMany({
    where,
    orderBy: { [orderField]: "desc" },
    take: filters?.limit ?? 100,
    skip: filters?.offset ?? 0,
  });
}
