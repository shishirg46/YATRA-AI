#!/usr/bin/env node
/**
 * scripts/seed-destinations-json.ts
 *
 * Seeds destinations from the JSON export created by export-destinations.ts.
 * Uses upsert to preserve existing records or create new ones.
 *
 * Run: npx tsx scripts/seed-destinations-json.ts
 * Input: scripts/data/destinations.json
 */

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PrismaClient, DestinationCategory, DestinationSource } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type ExportedDestination = {
  id: string;
  name: string;
  normalizedName: string;
  district: string;
  province: string;
  municipality: string | null;
  latitude: number;
  longitude: number;
  altitude: number | null;
  category: DestinationCategory;
  description: string | null;
  image: string | null;
  tags: string[];
  osmId: string | null;
  source: DestinationSource;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  routeAccessible: boolean;
  coordinateAccuracy: number | null;
  dataQualityScore: number | null;
  popularityScore: number | null;
  confidenceScore: number | null;
  accessibilityScore: number | null;
  tourismSupportScore: number | null;
  destinationTier: number | null;
  metadata: any | null;
  createdAt: string;
  updatedAt: string;
  sourceLastFetch: string | null;
};

type ExportData = {
  exportedAt: string;
  count: number;
  destinations: ExportedDestination[];
};

async function main() {
  const inputPath = join(__dirname, "data", "destinations.json");

  if (!existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    console.error("Run 'npx tsx scripts/export-destinations.ts' first to create the export.");
    process.exit(1);
  }

  console.log(`Reading destinations from: ${inputPath}`);
  const data = JSON.parse(readFileSync(inputPath, "utf-8")) as ExportData;
  console.log(`Found ${data.destinations.length} destinations (exported: ${data.exportedAt})`);

  let created = 0;
  let updated = 0;

  for (const dest of data.destinations) {
    const upsertData = {
      name: dest.name,
      normalizedName: dest.normalizedName,
      district: dest.district,
      province: dest.province,
      municipality: dest.municipality,
      latitude: dest.latitude,
      longitude: dest.longitude,
      altitude: dest.altitude,
      category: dest.category,
      description: dest.description,
      image: dest.image,
      tags: dest.tags,
      osmId: dest.osmId,
      source: dest.source,
      verified: dest.verified,
      verifiedBy: dest.verifiedBy,
      verifiedAt: dest.verifiedAt ? new Date(dest.verifiedAt) : null,
      routeAccessible: dest.routeAccessible,
      coordinateAccuracy: dest.coordinateAccuracy,
      dataQualityScore: dest.dataQualityScore,
      popularityScore: dest.popularityScore,
      confidenceScore: dest.confidenceScore,
      accessibilityScore: dest.accessibilityScore,
      tourismSupportScore: dest.tourismSupportScore,
      destinationTier: dest.destinationTier,
      metadata: dest.metadata,
      sourceLastFetch: dest.sourceLastFetch ? new Date(dest.sourceLastFetch) : null,
    };

    const result = await prisma.destination.upsert({
      where: { id: dest.id },
      create: {
        id: dest.id,
        ...upsertData,
        createdAt: new Date(dest.createdAt),
        updatedAt: new Date(dest.updatedAt),
      },
      update: upsertData,
    });

    if (result.createdAt.toISOString() === result.updatedAt.toISOString() && 
        dest.createdAt === dest.updatedAt) {
      created++;
    } else {
      updated++;
    }

    if ((created + updated) % 50 === 0) {
      console.log(`  Processed ${created + updated}/${data.destinations.length}...`);
    }
  }

  console.log("\nDone!");
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Total: ${created + updated}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("Seed failed:", e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
