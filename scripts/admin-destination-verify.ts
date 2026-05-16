#!/usr/bin/env node
/**
 * scripts/admin-destination-verify.ts
 * 
 * Admin utility for manual destination verification and correction
 * 
 * Run: npx tsx scripts/admin-destination-verify.ts
 * 
 * Features:
 * - Find unverified destinations
 * - Update coordinates for inaccurate locations
 * - Mark destinations as verified
 * - Search by name or criteria
 * - Batch operations
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as nominatim from "../lib/destinations/nominatim";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * Find unverified destinations in a district
 */
async function findUnverifiedInDistrict(district: string) {
  console.log(`\n🔍 Unverified destinations in ${district}:`);
  console.log("─".repeat(50));

  const destinations = await prisma.destination.findMany({
    where: {
      district,
      verified: false,
    },
    orderBy: { dataQualityScore: "asc" },
    take: 20,
  });

  if (destinations.length === 0) {
    console.log("✅ All destinations in this district are verified!");
    return;
  }

  for (const dest of destinations) {
    console.log(`\n📍 ${dest.name}`);
    console.log(`   Province: ${dest.province}`);
    console.log(`   Municipality: ${dest.municipality || "N/A"}`);
    console.log(`   Coordinates: ${dest.latitude}, ${dest.longitude}`);
    console.log(`   Altitude: ${dest.altitude}m`);
    console.log(`   Quality Score: ${dest.dataQualityScore}`);
    console.log(`   Category: ${dest.category}`);
    console.log(`   Source: ${dest.source}`);
  }
}

/**
 * Search for a destination by name
 */
async function searchDestination(query: string) {
  console.log(`\n🔎 Search results for: "${query}"`);
  console.log("─".repeat(50));

  const destinations = await prisma.destination.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { normalizedName: { contains: query.toLowerCase(), mode: "insensitive" } },
      ],
    },
    take: 10,
  });

  if (destinations.length === 0) {
    console.log("No destinations found.");
    return;
  }

  for (const dest of destinations) {
    console.log(`\n📍 ${dest.id}`);
    console.log(`   Name: ${dest.name} ${dest.verified ? "✅" : "⏳"}`);
    console.log(`   Location: ${dest.district}, ${dest.province}`);
    console.log(`   Coordinates: ${dest.latitude}, ${dest.longitude}`);
    console.log(`   Quality: ${dest.dataQualityScore}/100`);
  }
}

/**
 * Update coordinates for a destination
 */
async function updateCoordinates(
  destinationId: string,
  latitude: number,
  longitude: number,
  accuracy?: number
) {
  console.log(`\n✏️  Updating coordinates for destination: ${destinationId}`);

  const dest = await prisma.destination.findUnique({
    where: { id: destinationId },
  });

  if (!dest) {
    console.error("❌ Destination not found");
    return;
  }

  console.log(`Before: ${dest.latitude}, ${dest.longitude}`);
  console.log(`After: ${latitude}, ${longitude}`);

  if (!nominatim.isInNepal(latitude, longitude)) {
    console.warn("⚠️  Warning: Coordinates are outside Nepal!");
  }

  const updated = await prisma.destination.update({
    where: { id: destinationId },
    data: {
      latitude,
      longitude,
      coordinateAccuracy: accuracy ?? 10,
      verified: true, // Mark as verified when manually corrected
      verifiedAt: new Date(),
    },
  });

  console.log(`✅ Updated: ${updated.name}`);
}

/**
 * Verify a destination
 */
async function verifyDestination(destinationId: string, verifiedBy?: string) {
  const dest = await prisma.destination.update({
    where: { id: destinationId },
    data: {
      verified: true,
      verifiedAt: new Date(),
      verifiedBy,
    },
  });

  console.log(`✅ Verified: ${dest.name}`);
}

/**
 * Get detailed destination info
 */
async function getDestinationDetails(destinationId: string) {
  const dest = await prisma.destination.findUnique({
    where: { id: destinationId },
  });

  if (!dest) {
    console.error("❌ Destination not found");
    return;
  }

  console.log(`\n📋 DESTINATION DETAILS`);
  console.log("═".repeat(50));
  console.log(`ID: ${dest.id}`);
  console.log(`Name: ${dest.name}`);
  console.log(`Normalized Name: ${dest.normalizedName}`);
  console.log(`\n📍 LOCATION`);
  console.log(`  Province: ${dest.province}`);
  console.log(`  District: ${dest.district}`);
  console.log(`  Municipality: ${dest.municipality || "N/A"}`);
  console.log(`  Latitude: ${dest.latitude}`);
  console.log(`  Longitude: ${dest.longitude}`);
  console.log(`  Altitude: ${dest.altitude ? `${dest.altitude}m` : "N/A"}`);
  console.log(`\n🏷️  METADATA`);
  console.log(`  Category: ${dest.category}`);
  console.log(`  Description: ${dest.description || "N/A"}`);
  console.log(`  Tags: ${dest.tags.join(", ") || "N/A"}`);
  console.log(`  OSM ID: ${dest.osmId || "N/A"}`);
  console.log(`\n✔️  VERIFICATION`);
  console.log(`  Verified: ${dest.verified ? "Yes" : "No"}`);
  console.log(`  Verified By: ${dest.verifiedBy || "N/A"}`);
  console.log(`  Verified At: ${dest.verifiedAt || "N/A"}`);
  console.log(`\n📊 QUALITY`);
  console.log(`  Quality Score: ${dest.dataQualityScore}/100`);
  console.log(`  Coordinate Accuracy: ${dest.coordinateAccuracy ? `${dest.coordinateAccuracy}m` : "N/A"}`);
  console.log(`  Route Accessible: ${dest.routeAccessible ? "Yes" : "No"}`);
  console.log(`  Source: ${dest.source}`);
  console.log(`  Last Fetched: ${dest.sourceLastFetch}`);
  console.log(`\n⏰ TIMESTAMPS`);
  console.log(`  Created: ${dest.createdAt}`);
  console.log(`  Updated: ${dest.updatedAt}`);
}

/**
 * Fetch and verify coordinates from Nominatim
 */
async function verifyWithNominatim(destinationId: string) {
  const dest = await prisma.destination.findUnique({
    where: { id: destinationId },
  });

  if (!dest) {
    console.error("❌ Destination not found");
    return;
  }

  console.log(`\n🔍 Verifying coordinates for: ${dest.name}`);
  console.log("─".repeat(50));

  // Try to find current location
  const results = await nominatim.searchPlace(dest.name);

  if (results.length === 0) {
    console.log("❌ No results from Nominatim");
    return;
  }

  console.log(`✅ Found ${results.length} results:`);

  for (let i = 0; i < Math.min(3, results.length); i++) {
    const result = results[i];
    const coords = {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
    };

    const isInNepal = nominatim.isInNepal(coords.lat, coords.lon);
    const region = nominatim.extractNepalRegion(result.address);

    console.log(`\n  [${i + 1}] ${result.display_name}`);
    console.log(`      Coordinates: ${coords.lat}, ${coords.lon}`);
    console.log(`      In Nepal: ${isInNepal ? "✅" : "❌"}`);
    console.log(`      Region: ${region.province}, ${region.district}`);
    console.log(`      OSM: ${result.osm_type}/${result.osm_id}`);
    console.log(`      Distance from current: ${nominatim.calculateDistance(
      dest.latitude,
      dest.longitude,
      coords.lat,
      coords.lon
    ).toFixed(2)}km`);
  }
}

/**
 * Generate report of quality issues
 */
async function generateQualityReport() {
  console.log(`\n📊 DESTINATION QUALITY REPORT`);
  console.log("═".repeat(50));

  // Missing coordinates
  const missingCoordinates = await prisma.destination.count({
    where: {
      OR: [
        { latitude: 0 },
        { longitude: 0 },
      ],
    },
  });

  console.log(`\n❌ ISSUES FOUND:`);
  console.log(`  Missing/Zero Coordinates: ${missingCoordinates}`);

  // Low quality scores
  const lowQuality = await prisma.destination.count({
    where: { dataQualityScore: { lt: 30 } },
  });
  console.log(`  Low Quality Score (<30): ${lowQuality}`);

  // Unverified
  const unverified = await prisma.destination.count({
    where: { verified: false },
  });
  console.log(`  Unverified: ${unverified}`);

  // Not route accessible
  const notAccessible = await prisma.destination.count({
    where: { routeAccessible: false },
  });
  console.log(`  Not Route Accessible: ${notAccessible}`);

  // Quality distribution
  const distribution = await prisma.destination.groupBy({
    by: ["category"],
    _count: { id: true },
    _avg: { dataQualityScore: true },
  });

  console.log(`\n📈 QUALITY BY CATEGORY:`);
  for (const stat of distribution) {
    const score = stat._avg.dataQualityScore ?? 0;
    const indicator = score >= 70 ? "✅" : score >= 50 ? "⚠️" : "❌";
    console.log(
      `  ${indicator} ${stat.category}: ${stat._count.id} destinations (avg score: ${score.toFixed(1)})`
    );
  }

  // Top unverified
  const topUnverified = await prisma.destination.findMany({
    where: { verified: false },
    orderBy: { dataQualityScore: "desc" },
    take: 5,
  });

  console.log(`\n🔝 TOP UNVERIFIED (by quality):`);
  for (const dest of topUnverified) {
    console.log(`  • ${dest.name} (${dest.district}) - Score: ${dest.dataQualityScore}`);
  }
}

/**
 * Export destinations to JSON
 */
async function exportDestinations(outputPath: string) {
  console.log(`\n📤 Exporting destinations to ${outputPath}...`);

  const destinations = await prisma.destination.findMany({
    orderBy: [{ province: "asc" }, { district: "asc" }, { name: "asc" }],
  });

  const json = JSON.stringify(destinations, null, 2);
  require("fs").writeFileSync(outputPath, json);

  console.log(`✅ Exported ${destinations.length} destinations`);
  console.log(`   File size: ${(Buffer.byteLength(json) / 1024).toFixed(2)} KB`);
}

/**
 * CLI Menu
 */
async function showMenu() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage: npx tsx scripts/admin-destination-verify.ts <command> [args]

Commands:
  search <query>              Search destinations by name
  unverified <district>       Show unverified destinations in a district
  details <id>                Show detailed info for a destination
  verify <id> [userId]        Mark destination as verified
  update <id> <lat> <lon>     Update coordinates
  nominatim <id>              Verify coordinates using Nominatim
  report                      Generate quality report
  export <path>               Export all destinations to JSON
  help                        Show this menu
    `);
    return;
  }

  const command = args[0];

  try {
    switch (command) {
      case "search":
        await searchDestination(args[1]);
        break;
      case "unverified":
        await findUnverifiedInDistrict(args[1]);
        break;
      case "details":
        await getDestinationDetails(args[1]);
        break;
      case "verify":
        await verifyDestination(args[1], args[2]);
        break;
      case "update":
        await updateCoordinates(
          args[1],
          parseFloat(args[2]),
          parseFloat(args[3]),
          args[4] ? parseFloat(args[4]) : undefined
        );
        break;
      case "nominatim":
        await verifyWithNominatim(args[1]);
        break;
      case "report":
        await generateQualityReport();
        break;
      case "export":
        await exportDestinations(args[1]);
        break;
      case "help":
        await showMenu();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        await showMenu();
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

showMenu();
