#!/usr/bin/env node
/**
 * scripts/enrich-from-osm.ts
 * 
 * Batch enrich destinations from OpenStreetMap using Overpass API
 * Fetches POIs from specific geographic regions and creates/updates destinations
 * 
 * Run: npx tsx scripts/enrich-from-osm.ts [province]
 * 
 * This script:
 * 1. Defines bounding boxes for each Nepal province
 * 2. Queries Overpass API for specific POI types
 * 3. Enriches existing or creates new destinations
 * 4. Handles rate limiting
 * 5. Generates statistics
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as overpass from "../lib/destinations/overpass";
import * as validation from "../lib/destinations/validation";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Nepal province bounding boxes (south, west, north, east)
const PROVINCE_BBOXES: Record<string, { south: number; west: number; north: number; east: number }> = {
  Koshi: { south: 26.5, west: 86.6, north: 30.2, east: 88.1 },
  Madhesh: { south: 26.0, west: 84.7, north: 27.5, east: 86.7 },
  Bagmati: { south: 27.1, west: 84.5, north: 28.2, east: 86.1 },
  Gandaki: { south: 27.8, west: 83.2, north: 29.5, east: 85.5 },
  Lumbini: { south: 27.5, west: 82.0, north: 28.8, east: 84.5 },
  Karnali: { south: 28.5, west: 81.0, north: 30.5, east: 83.5 },
  Sudurpashchim: { south: 28.8, west: 80.0, north: 30.4, east: 82.4 },
};

interface OSMDestination {
  name: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  category: string;
  osmId: string;
  tags: string[];
}

/**
 * Query for temples in a province
 */
async function getTemples(bbox: typeof PROVINCE_BBOXES[string]): Promise<OSMDestination[]> {
  console.log("  🕌 Querying temples...");
  const elements = await overpass.queryTemples(bbox);

  return elements
    .map((el) => {
      const coords = overpass.getElementCoordinates(el);
      if (!coords) return null;

      return {
        name: overpass.getElementName(el),
        latitude: coords.lat,
        longitude: coords.lon,
        altitude: overpass.getElementAltitude(el) ?? undefined,
        category: "TEMPLE",
        osmId: `${el.type}/${el.id}`,
        tags: ["temple", "religious"],
      };
    })
    .filter((d) => d !== null) as OSMDestination[];
}

/**
 * Query for viewpoints in a province
 */
async function getViewpoints(bbox: typeof PROVINCE_BBOXES[string]): Promise<OSMDestination[]> {
  console.log("  👁️  Querying viewpoints...");
  const elements = await overpass.queryViewpoints(bbox);

  return elements
    .map((el) => {
      const coords = overpass.getElementCoordinates(el);
      if (!coords) return null;

      return {
        name: overpass.getElementName(el),
        latitude: coords.lat,
        longitude: coords.lon,
        altitude: overpass.getElementAltitude(el) ?? undefined,
        category: "VIEWPOINT",
        osmId: `${el.type}/${el.id}`,
        tags: ["viewpoint", "scenic"],
      };
    })
    .filter((d) => d !== null) as OSMDestination[];
}

/**
 * Query for lakes in a province
 */
async function getLakes(bbox: typeof PROVINCE_BBOXES[string]): Promise<OSMDestination[]> {
  console.log("  🌊 Querying lakes...");
  const elements = await overpass.queryLakes(bbox);

  return elements
    .map((el) => {
      const coords = overpass.getElementCoordinates(el);
      if (!coords) return null;

      return {
        name: overpass.getElementName(el),
        latitude: coords.lat,
        longitude: coords.lon,
        altitude: overpass.getElementAltitude(el) ?? undefined,
        category: "LAKE",
        osmId: `${el.type}/${el.id}`,
        tags: ["lake", "water"],
      };
    })
    .filter((d) => d !== null) as OSMDestination[];
}

/**
 * Query for waterfalls in a province
 */
async function getWaterfalls(bbox: typeof PROVINCE_BBOXES[string]): Promise<OSMDestination[]> {
  console.log("  💧 Querying waterfalls...");
  const elements = await overpass.queryWaterfalls(bbox);

  return elements
    .map((el) => {
      const coords = overpass.getElementCoordinates(el);
      if (!coords) return null;

      return {
        name: overpass.getElementName(el),
        latitude: coords.lat,
        longitude: coords.lon,
        altitude: overpass.getElementAltitude(el) ?? undefined,
        category: "WATERFALL",
        osmId: `${el.type}/${el.id}`,
        tags: ["waterfall", "water"],
      };
    })
    .filter((d) => d !== null) as OSMDestination[];
}

/**
 * Query for campsites in a province
 */
async function getCampsites(bbox: typeof PROVINCE_BBOXES[string]): Promise<OSMDestination[]> {
  console.log("  ⛺ Querying campsites...");
  const elements = await overpass.queryCampsites(bbox);

  return elements
    .map((el) => {
      const coords = overpass.getElementCoordinates(el);
      if (!coords) return null;

      return {
        name: overpass.getElementName(el),
        latitude: coords.lat,
        longitude: coords.lon,
        altitude: overpass.getElementAltitude(el) ?? undefined,
        category: "CAMP",
        osmId: `${el.type}/${el.id}`,
        tags: ["camp", "accommodation"],
      };
    })
    .filter((d) => d !== null) as OSMDestination[];
}

/**
 * Enrich destinations from OSM for a specific province
 */
async function enrichProvinceFromOSM(provinceName: string) {
  console.log(`\n🌍 Enriching ${provinceName} Province from OpenStreetMap`);
  console.log("─".repeat(50));

  const bbox = PROVINCE_BBOXES[provinceName];
  if (!bbox) {
    console.error(`❌ Unknown province: ${provinceName}`);
    return;
  }

  try {
    // Query all POI types
    const destinations: OSMDestination[] = [];

    // Add delays between queries to avoid rate limiting
    const queries = [
      { fn: getTemples, delay: 2000 },
      { fn: getViewpoints, delay: 2000 },
      { fn: getLakes, delay: 2000 },
      { fn: getWaterfalls, delay: 2000 },
      { fn: getCampsites, delay: 2000 },
    ];

    for (const { fn, delay } of queries) {
      try {
        const results = await fn(bbox);
        destinations.push(...results);
        console.log(`    ✓ Found ${results.length} POIs`);

        // Rate limiting
        await new Promise((r) => setTimeout(r, delay));
      } catch (error) {
        console.error(`    ✗ Query failed:`, error);
      }
    }

    console.log(`\n✅ Total OSM destinations found: ${destinations.length}`);

    // Save to database
    console.log(`\n💾 Saving to database...`);
    console.log("─".repeat(50));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const dest of destinations) {
      try {
        // Normalize district/province for this destination
        const normalizedDistrict = validation.normalizeDistrict(dest.name.split(",")[1] || "");
        const district = normalizedDistrict || "Unknown";
        const province = validation.findProvinceForDistrict(district) || provinceName;

        // Check for existing
        const existing = await prisma.destination.findFirst({
          where: {
            osmId: dest.osmId,
          },
        });

        if (existing) {
          // Update if OSM data is more recent
          await prisma.destination.update({
            where: { id: existing.id },
            data: {
              latitude: dest.latitude,
              longitude: dest.longitude,
              altitude: dest.altitude || existing.altitude,
              category: dest.category as any,
              tags: [...new Set([...(existing.tags || []), ...dest.tags])],
              coordinateAccuracy: 50,
              source: "OPENSTREETMAP",
            },
          });
          updated++;
        } else {
          // Create new
          await prisma.destination.create({
            data: {
              name: dest.name,
              normalizedName: validation.normalizeName(dest.name),
              district,
              province,
              latitude: dest.latitude,
              longitude: dest.longitude,
              altitude: dest.altitude,
              category: dest.category as any,
              osmId: dest.osmId,
              tags: dest.tags,
              source: "OPENSTREETMAP",
              coordinateAccuracy: 50,
              dataQualityScore: 75, // OSM data is generally high quality
            },
          });
          created++;
        }

        if ((created + updated) % 50 === 0) {
          console.log(`  ✓ Processed ${created + updated} destinations`);
        }
      } catch (error) {
        console.error(`  ✗ Error saving ${dest.name}:`, error);
        skipped++;
      }
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log("📊 Results:");
    console.log("═".repeat(50));
    console.log(`✅ Created:  ${created}`);
    console.log(`🔄 Updated:  ${updated}`);
    console.log(`⏭️  Skipped:  ${skipped}`);
    console.log(`📊 Total:    ${created + updated} destinations upserted`);
  } catch (error) {
    console.error("❌ Error enriching province:", error);
  }
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage: npx tsx scripts/enrich-from-osm.ts <province>

Available provinces:
${Object.keys(PROVINCE_BBOXES).map((p) => `  • ${p}`).join("\n")}

Example:
  npx tsx scripts/enrich-from-osm.ts Gandaki
    `);
    return;
  }

  const province = args[0];

  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  🏔️  OSM DESTINATION ENRICHMENT SYSTEM 🏔️         ║");
  console.log("╚════════════════════════════════════════════════════╝");

  await enrichProvinceFromOSM(province);

  await prisma.$disconnect();
  await pool.end();
}

main();
