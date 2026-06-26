/**
 * ingest-junctions.ts — populates road_junction from road-junctions.json.
 *
 * Pipeline:
 *   1. Load extracted junction manifest
 *   2. Upsert into road_junction table via raw SQL (PostGIS geom)
 *   3. Idempotent: upsert by matching lat/lon within 100 m
 *
 * Deterministic + safe to re-run after rebuilds.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const JUNCTIONS_PATH = join(DATA_DIR, "road-junctions.json");

interface JunctionRecord {
  name: string;
  roadCodes: string[];
  type: string;
  latitude: number;
  longitude: number;
}

function deterministicId(name: string, lat: number, lon: number): string {
  return createHash("sha1")
    .update(`${name}|${lat.toFixed(4)}|${lon.toFixed(4)}`)
    .digest("hex")
    .slice(0, 12);
}

async function main() {
  console.log("=== Ingesting Road Junctions ===\n");

  const junctions: JunctionRecord[] = JSON.parse(readFileSync(JUNCTIONS_PATH, "utf-8"));
  console.log(`  Loaded ${junctions.length} junctions from manifest\n`);

  // Upsert each junction
  let inserted = 0;
  let updated = 0;

  for (const j of junctions) {
    const id = deterministicId(j.name, j.latitude, j.longitude);
    const roadCodesArray = j.roadCodes;

    // Check if a junction already exists near this location
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM road_junction
       WHERE ST_DWithin(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         geom::geography,
         100
       )
       LIMIT 1`,
      j.longitude,
      j.latitude,
    );

    if (existing.length > 0) {
      // Update existing — use array literal for TEXT[] column
      const roadCodesLiteral = `{${roadCodesArray.map(r => `"${r}"`).join(",")}}`;
      await prisma.$executeRawUnsafe(
        `UPDATE road_junction
         SET name = $1, "roadCodes" = $2::text[], type = $3::"JunctionType",
             latitude = $4, longitude = $5, "updatedAt" = NOW()
         WHERE id = $6`,
        j.name,
        roadCodesLiteral,
        j.type,
        j.latitude,
        j.longitude,
        existing[0].id,
      );
      updated++;
    } else {
      // Insert new
      const roadCodesLiteral = `{${roadCodesArray.map(r => `"${r}"`).join(",")}}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO road_junction
           (id, name, "roadCodes", type, latitude, longitude, "createdAt", "updatedAt")
         VALUES
           ($1, $2, $3::text[], $4::"JunctionType", $5, $6, NOW(), NOW())`,
        id,
        j.name,
        roadCodesLiteral,
        j.type,
        j.latitude,
        j.longitude,
      );
      inserted++;
    }
  }

  console.log(`  Inserted: ${inserted}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Total:    ${junctions.length}\n`);

  // Verify
  const count = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text as count FROM road_junction`,
  );
  console.log(`  DB has ${count[0].count} junction records`);

  // Show sample
  const samples = await prisma.$queryRawUnsafe<Array<{ name: string; roadCodes: string[]; type: string }>>(
    `SELECT name, "roadCodes", type FROM road_junction ORDER BY longitude LIMIT 5`,
  );
  console.log("\n  Westernmost junctions:");
  for (const s of samples) {
    console.log(`    ${s.name.padEnd(25)} ${s.type.padEnd(14)} ${s.roadCodes.join(", ")}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
