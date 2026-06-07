#!/usr/bin/env node
/**
 * scripts/export-destinations.ts
 *
 * Exports all destinations from the database to a JSON file.
 * Run: npx tsx scripts/export-destinations.ts
 * Output: scripts/data/destinations.json
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("Fetching all destinations from database...");

  const destinations = await prisma.destination.findMany({
    orderBy: { createdAt: "asc" },
  });

  const outputPath = join(__dirname, "data", "destinations.json");

  const jsonData = {
    exportedAt: new Date().toISOString(),
    count: destinations.length,
    destinations: destinations.map((dest) => ({
      ...dest,
      createdAt: dest.createdAt.toISOString(),
      updatedAt: dest.updatedAt.toISOString(),
      verifiedAt: dest.verifiedAt?.toISOString() || null,
      sourceLastFetch: dest.sourceLastFetch?.toISOString() || null,
    })),
  };

  writeFileSync(outputPath, JSON.stringify(jsonData, null, 2), "utf-8");

  console.log(`Exported ${destinations.length} destinations to:`);
  console.log(`  ${outputPath}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("Export failed:", e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
