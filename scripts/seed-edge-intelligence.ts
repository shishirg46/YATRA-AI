import "dotenv/config";

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type RoadSurface = "PAVED" | "GRAVEL" | "DIRT" | "UNKNOWN";

const DISASTER_RADIUS_KM = 20;

// Known highway surface classifications for Nepali highways
const HIGHWAY_SURFACE: Record<string, RoadSurface> = {
  "Prithvi Highway": "PAVED",
  "Tribhuvan Highway": "PAVED",
  "Arniko Highway": "PAVED",
  "Mahendra Highway": "PAVED",
  "East-West Highway": "PAVED",
  "Siddhartha Highway": "PAVED",
  "BP Highway": "PAVED",
  "Karnali Highway": "GRAVEL",
  "Besisahar Road": "GRAVEL",
  "Pokhara-Besisahar": "GRAVEL",
  "Ilam Road": "GRAVEL",
  "Lumbini Road": "PAVED",
  "Dharan Road": "PAVED",
  "Narayanghat-Bharatpur": "PAVED",
  "Kali Gandaki Corridor": "GRAVEL",
  "Muktinath Road": "DIRT",
};

// Highways known for seasonal monsoon closures
const MONSOON_SENSITIVE: string[] = [
  "BP Highway",
  "Karnali Highway",
  "Besisahar Road",
  "Pokhara-Besisahar",
  "Ilam Road",
];

const WINTER_SENSITIVE: string[] = [
  "Karnali Highway",
];

function midpoint(lat1: number, lon1: number, lat2: number, lon2: number) {
  return { lat: (lat1 + lat2) / 2, lon: (lon1 + lon2) / 2 };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcGradient(elevDiffM: number, distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  return (elevDiffM / 1000) / distanceKm * 100; // grade %
}

function pickSurface(roadName: string | null, gradientPct: number): RoadSurface {
  if (roadName && HIGHWAY_SURFACE[roadName]) return HIGHWAY_SURFACE[roadName];
  if (gradientPct > 8) return "GRAVEL";
  if (gradientPct > 5) return "DIRT";
  return "UNKNOWN";
}

function pickSeasonalClosure(
  roadName: string | null,
  gradientPct: number,
  monsoonVulnerability: number
): string {
  if (!roadName) return gradientPct > 6 ? "monsoon" : "none";
  if (WINTER_SENSITIVE.includes(roadName)) return "winter";
  if (MONSOON_SENSITIVE.includes(roadName) || monsoonVulnerability > 0.5) return "monsoon";
  if (gradientPct > 8) return "monsoon";
  return "none";
}

async function countDisastersNear(
  lat: number,
  lon: number,
  radiusKm: number
): Promise<{ flood: number; landslide: number; total: number }> {
  const deg = radiusKm / 111;
  const rows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}`
  );
  const floodRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE type = 'flood'
       AND lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}`
  );
  const landRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE type = 'landslide'
       AND lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}`
  );
  return {
    total: Number(rows[0]?.count ?? 0),
    flood: Number(floodRows[0]?.count ?? 0),
    landslide: Number(landRows[0]?.count ?? 0),
  };
}

async function main() {
  console.log("Loading edges with node data...");

  const edges = await prisma.routeEdge.findMany({
    include: {
      fromNode: { select: { elevationM: true, latitude: true, longitude: true, name: true } },
      toNode: { select: { elevationM: true, latitude: true, longitude: true, name: true } },
    },
  });

  console.log(`Found ${edges.length} edges`);

  // Track max values for normalization
  let maxLandslide = 0;
  let maxFlood = 0;
  const disasterResults: Map<string, { flood: number; landslide: number; total: number }> = new Map();

  // First pass: collect disaster counts for all edges
  for (const e of edges) {
    const mid = midpoint(
      e.fromNode.latitude, e.fromNode.longitude,
      e.toNode.latitude, e.toNode.longitude
    );
    const counts = await countDisastersNear(mid.lat, mid.lon, DISASTER_RADIUS_KM);
    disasterResults.set(e.id, counts);
    if (counts.landslide > maxLandslide) maxLandslide = counts.landslide;
    if (counts.flood > maxFlood) maxFlood = counts.flood;
  }

  const maxLandslideNorm = Math.max(maxLandslide, 1);
  const maxFloodNorm = Math.max(maxFlood, 1);

  console.log("Computing edge intelligence...");
  let updated = 0;

  for (const e of edges) {
    const fromElev = e.fromNode.elevationM ?? 0;
    const toElev = e.toNode.elevationM ?? 0;
    const elevDiff = toElev - fromElev;
    const gradientPct = Math.round(calcGradient(elevDiff, e.distanceKm) * 100) / 100;

    const actualDist = haversineKm(
      e.fromNode.latitude, e.fromNode.longitude,
      e.toNode.latitude, e.toNode.longitude
    );
    const surfaceType = pickSurface(e.roadName, gradientPct);

    const dc = disasterResults.get(e.id)!;
    const landslideRisk = Math.min(Math.round((dc.landslide / maxLandslideNorm) * 100) / 100, 1);
    const floodRisk = Math.min(Math.round((dc.flood / maxFloodNorm) * 100) / 100, 1);
    const weatherSensitivity = Math.min(
      Math.round(((dc.landslide + dc.flood) / Math.max(maxLandslideNorm + maxFloodNorm, 1)) * 100) / 100,
      1
    );

    // Reliability: composite of surface + gradient + risk
    const surfaceScore = surfaceType === "PAVED" ? 1 : surfaceType === "GRAVEL" ? 0.6 : surfaceType === "DIRT" ? 0.3 : 0.5;
    const gradientScore = gradientPct <= 3 ? 1 : gradientPct <= 6 ? 0.8 : gradientPct <= 10 ? 0.5 : 0.3;
    const riskPenalty = 1 - Math.max(landslideRisk, floodRisk);
    const reliabilityScore = Math.round((surfaceScore * 0.4 + gradientScore * 0.3 + riskPenalty * 0.3) * 100) / 100;

    const seasonalClosure = pickSeasonalClosure(e.roadName, gradientPct, weatherSensitivity);

    // Check if actual distance deviates significantly from stored distance (for quality)
    const distanceRatio = actualDist > 0 ? e.distanceKm / actualDist : 1;
    const isAccurate = distanceRatio > 0.7 && distanceRatio < 1.5;

    await prisma.routeEdge.update({
      where: { id: e.id },
      data: {
        surfaceType,
        gradientPct,
        landslideRisk,
        floodRisk,
        weatherSensitivity,
        reliabilityScore,
        seasonalClosure,
      },
    });
    updated++;

    if (updated <= 5 || updated % 20 === 0) {
      console.log(
        `  [${String(updated).padStart(2)}/${edges.length}]` +
        ` ${e.fromNode.name.padEnd(12)} → ${e.toNode.name.padEnd(12)}` +
        ` surface=${surfaceType.padEnd(7)} gradient=${gradientPct.toFixed(2)}%` +
        ` land=${landslideRisk.toFixed(2)} flood=${floodRisk.toFixed(2)}` +
        ` reliable=${reliabilityScore.toFixed(2)}` +
        (isAccurate ? "" : " ⚠ dist-mismatch")
      );
    }
  }

  console.log(`\nDone. Updated ${updated} edges.`);

  // Show summary by road quality
  const summary = await prisma.routeEdge.findMany({
    where: { surfaceType: { not: null } },
    include: {
      fromNode: { select: { name: true } },
      toNode: { select: { name: true } },
    },
    orderBy: { reliabilityScore: "asc" },
    take: 10,
  });

  console.log("\n--- Lowest reliability edges (need attention) ---");
  for (const e of summary) {
    console.log(
      `  ${String(e.fromNode.name).padEnd(12)} → ${String(e.toNode.name).padEnd(12)}` +
      ` surface=${e.surfaceType?.padEnd(7) ?? "?"}` +
      ` gradient=${(e.gradientPct ?? 0).toFixed(2)}%` +
      ` land=${(e.landslideRisk ?? 0).toFixed(2)} flood=${(e.floodRisk ?? 0).toFixed(2)}` +
      ` reliable=${(e.reliabilityScore ?? 0).toFixed(2)}`
    );
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
