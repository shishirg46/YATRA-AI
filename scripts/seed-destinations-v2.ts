#!/usr/bin/env node
/**
 * scripts/seed-destinations-v2.ts
 * 
 * Comprehensive destination data ingestion and validation script
 * 
 * Run: npx tsx scripts/seed-destinations-v2.ts
 * 
 * Features:
 * - Loads existing JSON datasets
 * - Enriches data from trusted geographic sources
 * - Validates and normalizes place names
 * - Detects and handles duplicates
 * - Calculates data quality scores
 * - Provides detailed logging and statistics
 * 
 * Safe to run multiple times - will update existing records
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import * as enricher from "../lib/destinations/enricher";
import * as validation from "../lib/destinations/validation";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Load existing destination JSON files
async function loadExistingDestinations(): Promise<enricher.RawDestinationData[]> {
  const destinationsDir = path.join(__dirname, "destinations");
  const destinations: enricher.RawDestinationData[] = [];

  const provinces = [
    "bagmati",
    "gandaki",
    "koshi",
    "lumbini",
    "madhesh",
    "karnali",
    "sudurpashchim",
  ];

  for (const province of provinces) {
    const filePath = path.join(destinationsDir, `${province}.json`);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  Missing file: ${filePath}`);
      continue;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      for (const item of data) {
        destinations.push({
          name: item.name,
          district: item.district,
          latitude: item.lat,
          longitude: item.lng,
          altitude: item.alt,
          source: "MANUAL", // Marking existing data as manually entered
        });
      }

      console.log(`✓ Loaded ${data.length} destinations from ${province}.json`);
    } catch (error) {
      console.error(`✗ Error reading ${filePath}:`, error);
    }
  }

  return destinations;
}

/**
 * Main ingestion pipeline
 */
async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  🏔️  NEPAL DESTINATION DATA INGESTION SYSTEM 🏔️   ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  try {
    // Step 1: Load existing data
    console.log("📂 STEP 1: Loading existing destination JSON files...");
    console.log("─".repeat(50));
    const rawDestinations = await loadExistingDestinations();
    console.log(`✅ Loaded ${rawDestinations.length} destinations\n`);

    // Step 2: Enrich destinations
    console.log("🔄 STEP 2: Enriching destinations with trusted geographic data...");
    console.log("─".repeat(50));
    const enrichedDestinations = await enricher.batchEnrichDestinations(rawDestinations, {
      fetchCoordinates: true,
      delayMs: 50, // Rate limiting for APIs
    });
    console.log(`✅ Enrichment complete: ${enrichedDestinations.length} destinations\n`);

    // Step 3: Detect duplicates
    console.log("🔍 STEP 3: Detecting potential duplicates...");
    console.log("─".repeat(50));
    const duplicates = enricher.findDuplicates(enrichedDestinations, 0.75);
    if (duplicates.size > 0) {
      console.log(`⚠️  Found ${duplicates.size} potential duplicate groups:`);
      duplicates.forEach((indices, primary) => {
        console.log(
          `  - ${enrichedDestinations[primary].name} (${primary}) may duplicate: ${indices.map((i) => enrichedDestinations[i].name).join(", ")}`
        );
      });
    } else {
      console.log("✅ No significant duplicates detected");
    }
    console.log();

    // Step 4: Filter valid destinations
    console.log("✔️  STEP 4: Filtering destinations by quality criteria...");
    console.log("─".repeat(50));
    const validDestinations = enricher.filterValidDestinations(enrichedDestinations, 20);
    console.log(`✅ ${validDestinations.length} destinations passed quality checks`);
    console.log(
      `⏭️  ${enrichedDestinations.length - validDestinations.length} destinations filtered out\n`
    );

    // Step 5: Statistics
    console.log("📊 STEP 5: Data quality statistics...");
    console.log("─".repeat(50));

    const stats = {
      total: validDestinations.length,
      byCategory: {} as Record<string, number>,
      bySource: {} as Record<string, number>,
      byVerification: { verified: 0, unverified: 0 },
      qualityScores: {
        excellent: 0, // 80+
        good: 0, // 60-79
        fair: 0, // 40-59
        poor: 0, // 20-39
        veryPoor: 0, // <20
      },
      coordinateAccuracy: {
        highAccuracy: 0, // <10m
        mediumAccuracy: 0, // 10-100m
        lowAccuracy: 0, // >100m
      },
    };

    for (const dest of validDestinations) {
      // Category stats
      const cat = dest.category || "OTHER";
      stats.byCategory[cat] = (stats.byCategory[cat] ?? 0) + 1;

      // Source stats
      const src = dest.source || "UNKNOWN";
      stats.bySource[src] = (stats.bySource[src] ?? 0) + 1;

      // Verification
      if (dest.verified) stats.byVerification.verified++;
      else stats.byVerification.unverified++;

      // Quality score distribution
      const score = dest.dataQualityScore;
      if (score >= 80) stats.qualityScores.excellent++;
      else if (score >= 60) stats.qualityScores.good++;
      else if (score >= 40) stats.qualityScores.fair++;
      else if (score >= 20) stats.qualityScores.poor++;
      else stats.qualityScores.veryPoor++;

      // Coordinate accuracy
      const acc = dest.coordinateAccuracy ?? 500;
      if (acc < 10) stats.coordinateAccuracy.highAccuracy++;
      else if (acc < 100) stats.coordinateAccuracy.mediumAccuracy++;
      else stats.coordinateAccuracy.lowAccuracy++;
    }

    console.log(`Total destinations: ${stats.total}`);
    console.log(`\nBy Category:`);
    Object.entries(stats.byCategory)
      .sort(([, a], [, b]) => b - a)
      .forEach(([cat, count]) => {
        console.log(`  • ${cat}: ${count}`);
      });

    console.log(`\nBy Source:`);
    Object.entries(stats.bySource)
      .sort(([, a], [, b]) => b - a)
      .forEach(([src, count]) => {
        console.log(`  • ${src}: ${count}`);
      });

    console.log(`\nVerification Status:`);
    console.log(`  • Verified: ${stats.byVerification.verified}`);
    console.log(`  • Unverified: ${stats.byVerification.unverified}`);

    console.log(`\nData Quality Distribution:`);
    console.log(`  • Excellent (80-100): ${stats.qualityScores.excellent}`);
    console.log(`  • Good (60-79): ${stats.qualityScores.good}`);
    console.log(`  • Fair (40-59): ${stats.qualityScores.fair}`);
    console.log(`  • Poor (20-39): ${stats.qualityScores.poor}`);
    console.log(`  • Very Poor (<20): ${stats.qualityScores.veryPoor}`);

    console.log(`\nCoordinate Accuracy:`);
    console.log(`  • High (<10m): ${stats.coordinateAccuracy.highAccuracy}`);
    console.log(`  • Medium (10-100m): ${stats.coordinateAccuracy.mediumAccuracy}`);
    console.log(`  • Low (>100m): ${stats.coordinateAccuracy.lowAccuracy}`);
    console.log();

    // Step 6: Database insertion
    console.log("💾 STEP 6: Upserting destinations into database...");
    console.log("─".repeat(50));

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < validDestinations.length; i++) {
      const dest = validDestinations[i];

      try {
        // Check if destination already exists
        const existing = await prisma.destination.findFirst({
          where: {
            name: dest.name,
            district: dest.district || "",
            province: dest.province || "",
          },
        });

        if (existing) {
          // Update with enriched data
          await prisma.destination.update({
            where: { id: existing.id },
            data: {
              normalizedName: dest.normalizedName,
              latitude: dest.latitude ?? existing.latitude,
              longitude: dest.longitude ?? existing.longitude,
              altitude: dest.altitude ?? existing.altitude,
              category: dest.category || existing.category,
              description: dest.description || existing.description,
              osmId: dest.osmId || existing.osmId,
              source: dest.source || existing.source,
              municipality: dest.municipality || existing.municipality,
              dataQualityScore: dest.dataQualityScore,
              coordinateAccuracy: dest.coordinateAccuracy,
              sourceLastFetch: new Date(),
              tags: dest.tags || existing.tags,
            },
          });
          updated++;
        } else {
          // Create new destination
          await prisma.destination.create({
            data: {
              name: dest.name,
              normalizedName: dest.normalizedName,
              district: dest.district || "Unknown",
              province: dest.province || "Unknown",
              municipality: dest.municipality,
              latitude: dest.latitude ?? 0,
              longitude: dest.longitude ?? 0,
              altitude: dest.altitude,
              category: dest.category || "OTHER",
              description: dest.description,
              osmId: dest.osmId,
              source: dest.source || "MANUAL",
              verified: dest.verified,
              routeAccessible: dest.routeAccessible,
              dataQualityScore: dest.dataQualityScore,
              coordinateAccuracy: dest.coordinateAccuracy,
              sourceLastFetch: new Date(),
              tags: dest.tags || [],
            },
          });
          created++;
        }

        if ((i + 1) % 50 === 0) {
          console.log(`  ✓ Processed ${i + 1}/${validDestinations.length}`);
        }
      } catch (error) {
        console.error(`  ✗ Error upserting ${dest.name}:`, error);
        errors++;
      }
    }

    console.log();
    console.log("═".repeat(50));
    console.log("📈 SUMMARY");
    console.log("═".repeat(50));
    console.log(`✅ Created:  ${created} new destinations`);
    console.log(`🔄 Updated:  ${updated} existing destinations`);
    console.log(`❌ Errors:   ${errors} failures`);
    console.log(`📊 Total:    ${created + updated} destinations in database`);
    console.log();

    // Step 7: Additional statistics from database
    console.log("🗄️  Database Statistics:");
    console.log("─".repeat(50));

    const dbStats = await prisma.destination.groupBy({
      by: ["category"],
      _count: { id: true },
    });

    for (const stat of dbStats) {
      console.log(`  • ${stat.category}: ${stat._count.id} destinations`);
    }

    const totalInDb = await prisma.destination.count();
    const verifiedInDb = await prisma.destination.count({ where: { verified: true } });
    const routeAccessibleInDb = await prisma.destination.count({
      where: { routeAccessible: true },
    });

    console.log(`\n  Total in database: ${totalInDb}`);
    console.log(`  Verified: ${verifiedInDb}`);
    console.log(`  Route accessible: ${routeAccessibleInDb}`);
    console.log();

    console.log("✨ Ingestion pipeline complete!");
    console.log(
      "ℹ️  Next: Review unverified destinations and update verification status"
    );
  } catch (error) {
    console.error("❌ Fatal error in ingestion pipeline:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
