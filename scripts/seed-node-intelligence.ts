import "dotenv/config";

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { haversineKm } from "../lib/routing/geo";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DISASTER_RADIUS_KM = 30;

type NodeAccessibility =
  | "YEAR_ROUND"
  | "SEASONAL"
  | "DIFFICULT"
  | "IMPASSABLE";

interface NodeToUpdate {
  id: string;
  name: string;
  lat: number;
  lon: number;
  edgeCount: number;
  elevationM: number;
  accessibilityLevel: NodeAccessibility;
  hazardExposureIndex: number;
  connectivityRank: number;
  monsoonVulnerability: number;
}

async function fetchElevationBatch(
  points: { lat: number; lon: number }[]
): Promise<number[]> {
  const chunkSize = 50;
  const elevations: number[] = [];

  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    const params = chunk.map((p) => `latitude=${p.lat}&longitude=${p.lon}`).join("&");
    const url = `https://api.open-meteo.com/v1/elevation?${params}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        console.warn(`  Elevation API returned ${res.status}, using defaults`);
        chunk.forEach(() => elevations.push(0));
        continue;
      }
      const data = await res.json();
      if (data.elevation && Array.isArray(data.elevation)) {
        elevations.push(...data.elevation.map((e: number | null) => e ?? 0));
      } else {
        chunk.forEach(() => elevations.push(0));
      }
    } catch (err) {
      console.warn(`  Elevation fetch failed: ${err}, using defaults`);
      chunk.forEach(() => elevations.push(0));
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  return elevations;
}

async function countDisastersNear(
  lat: number,
  lon: number,
  radiusKm: number,
  types?: string[]
): Promise<{
  total: number;
  flood: number;
  landslide: number;
  earthquake: number;
  monsoon: number;
}> {
  const deg = radiusKm / 111;
  const typeFilter = types?.length
    ? `AND type IN (${types.map((t) => `'${t}'`).join(",")})`
    : "";

  const total = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}
       ${typeFilter}`
  );

  const flood = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE type = 'flood'
       AND lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}`
  );

  const landslide = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE type = 'landslide'
       AND lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}`
  );

  const earthquake = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE type = 'earthquake'
       AND lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}`
  );

  const monsoon = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM yatra_disaster_events
     WHERE type IN ('flood','landslide')
       AND EXTRACT(MONTH FROM date) BETWEEN 6 AND 9
       AND lat BETWEEN ${lat - deg} AND ${lat + deg}
       AND lon BETWEEN ${lon - deg} AND ${lon + deg}`
  );

  const toNum = (v: [{ count: bigint }]) => Number(v[0]?.count ?? 0);
  return {
    total: toNum(total),
    flood: toNum(flood),
    landslide: toNum(landslide),
    earthquake: toNum(earthquake),
    monsoon: toNum(monsoon),
  };
}

function pickAccessibility(
  elevationM: number,
  hazardExposure: number,
  connectivityRank: number,
  totalDisasters: number
): NodeAccessibility {
  const isMajorHub = connectivityRank <= 5;
  const isRemote = connectivityRank >= 20;

  // Major hubs are always YEAR_ROUND unless extreme elevation or very high hazard
  if (isMajorHub) {
    if (elevationM > 3500) return "SEASONAL";
    return "YEAR_ROUND";
  }

  // Remote high-elevation nodes
  if (elevationM > 3000) return "IMPASSABLE";
  if (elevationM > 2000 && isRemote) return "SEASONAL";
  if (elevationM > 1500 && isRemote) return "DIFFICULT";

  // Low-elevation nodes (Terai) are mostly YEAR_ROUND
  if (elevationM < 300) return "YEAR_ROUND";

  // Moderate elevation: use hazard data
  if (hazardExposure > 0.7 || totalDisasters > 200) return "SEASONAL";
  if (hazardExposure > 0.4 || totalDisasters > 100) return "DIFFICULT";

  return "YEAR_ROUND";
}

function assignConnectivityRanks(
  nodes: { id: string; edgeCount: number }[]
): Map<string, number> {
  const sorted = [...nodes].sort((a, b) => b.edgeCount - a.edgeCount);
  const ranks = new Map<string, number>();
  sorted.forEach((n, i) => {
    if (i === 0) ranks.set(n.id, 1);
    else if (n.edgeCount === sorted[i - 1].edgeCount)
      ranks.set(n.id, ranks.get(sorted[i - 1].id)!);
    else ranks.set(n.id, i + 1);
  });
  return ranks;
}

async function main() {
  console.log("Loading route nodes...");

  const nodes = await prisma.routeNode.findMany({
    where: { isActive: true },
    include: {
      edgesFrom: { select: { id: true } },
      edgesTo: { select: { id: true } },
    },
  });

  console.log(`Found ${nodes.length} active nodes`);

  const points = nodes.map((n) => ({ lat: n.latitude, lon: n.longitude }));
  console.log("Fetching elevation data from Open-Meteo...");
  const elevations = await fetchElevationBatch(points);

  const nodesWithEdgeCount = nodes.map((n, i) => ({
    id: n.id,
    name: n.name,
    lat: n.latitude,
    lon: n.longitude,
    elevationM: elevations[i],
    edgeCount: n.edgesFrom.length + n.edgesTo.length,
  }));

  // Compute connectivity ranks
  const ranks = assignConnectivityRanks(
    nodesWithEdgeCount.map((n) => ({ id: n.id, edgeCount: n.edgeCount }))
  );

  // Max disaster count for normalization (across all nodes)
  let maxTotal = 0;
  let maxMonsoon = 0;

  const disasterCounts: Map<string, {
    total: number;
    flood: number;
    landslide: number;
    earthquake: number;
    monsoon: number;
  }> = new Map();

  for (const n of nodesWithEdgeCount) {
    const counts = await countDisastersNear(
      n.lat,
      n.lon,
      DISASTER_RADIUS_KM
    );
    disasterCounts.set(n.id, counts);
    if (counts.total > maxTotal) maxTotal = counts.total;
    if (counts.monsoon > maxMonsoon) maxMonsoon = counts.monsoon;
    console.log(
      `  ${n.name.padEnd(15)} elev=${n.elevationM.toFixed(0).padStart(5)}m` +
        ` disasters=${counts.total} flood=${counts.flood} landslide=${counts.landslide}` +
        ` eq=${counts.earthquake} monsoon=${counts.monsoon}`
    );
  }

  const maxTotalNorm = Math.max(maxTotal, 1);
  const maxMonsoonNorm = Math.max(maxMonsoon, 1);

  console.log("\nUpdating nodes...");
  let updated = 0;

  for (const n of nodesWithEdgeCount) {
    const dc = disasterCounts.get(n.id)!;
    const connectivityRank = ranks.get(n.id) ?? 99;
    const hazardExposure =
      (dc.flood + dc.landslide * 1.5 + dc.earthquake * 0.5) /
      (maxTotalNorm * 1.5);
    const monsoonVulnerability = dc.monsoon / maxMonsoonNorm;
    const accessibilityLevel = pickAccessibility(
      n.elevationM,
      hazardExposure,
      connectivityRank,
      dc.total
    );

    // Only overwrite elevation if we got a valid (>0) value from API
    const validElevation = Math.round(n.elevationM) > 0
      ? Math.round(n.elevationM)
      : undefined;

    await prisma.routeNode.update({
      where: { id: n.id },
      data: {
        ...(validElevation !== undefined ? { elevationM: validElevation } : {}),
        accessibilityLevel,
        hazardExposureIndex: Math.min(Math.round(hazardExposure * 100) / 100, 1),
        connectivityRank,
        monsoonVulnerability: Math.min(
          Math.round(monsoonVulnerability * 100) / 100,
          1
        ),
      },
    });
    updated++;
  }

  console.log(`\nDone. Updated ${updated} nodes.`);
  console.log("\n--- Summary ---");
  const updatedNodes = await prisma.routeNode.findMany({
    where: { isActive: true },
    orderBy: { connectivityRank: "asc" },
  });
  for (const n of updatedNodes) {
    console.log(
      `  rank=${String(n.connectivityRank ?? "?").padStart(2)}` +
        ` ${n.name.padEnd(15)}` +
        ` elev=${String(n.elevationM ?? "?").padStart(5)}m` +
        ` access=${String(n.accessibilityLevel ?? "?").padEnd(10)}` +
        ` hazard=${(n.hazardExposureIndex ?? 0).toFixed(2)}` +
        ` monsoon=${(n.monsoonVulnerability ?? 0).toFixed(2)}`
    );
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
