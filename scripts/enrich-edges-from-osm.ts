import "dotenv/config";

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { haversineKm } from "../lib/routing/geo";
import { fetchOsmRoadSurface, type OsmRoadSurface } from "../lib/routing/osm-road-fetcher";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type RoadSurface = "PAVED" | "GRAVEL" | "DIRT" | "UNKNOWN";
type RoadCondition = "GOOD" | "FAIR" | "POOR" | "DIRT_TRACK" | "IMPASSABLE";

const HIGHWAY_SURFACE_MAP: Record<string, RoadSurface> = {
  primary: "PAVED",
  secondary: "PAVED",
  tertiary: "GRAVEL",
  trunk: "PAVED",
  motorway: "PAVED",
  unclassified: "GRAVEL",
  residential: "GRAVEL",
  service: "GRAVEL",
  track: "DIRT",
  path: "DIRT",
  footway: "DIRT",
  cycleway: "GRAVEL",
};

const SURFACE_MAP: Record<string, RoadSurface> = {
  paved: "PAVED",
  asphalt: "PAVED",
  concrete: "PAVED",
  "concrete:lanes": "PAVED",
  "concrete:plates": "PAVED",
  "unpaved": "GRAVEL",
  gravel: "GRAVEL",
  "fine_gravel": "GRAVEL",
  dirt: "DIRT",
  earth: "DIRT",
  ground: "DIRT",
  grass: "DIRT",
  sand: "DIRT",
  mud: "DIRT",
  "compacted": "GRAVEL",
  "cobblestone": "PAVED",
  "sett": "PAVED",
};

const HIGHWAY_CONDITION_MAP: Record<string, RoadCondition> = {
  motorway: "GOOD",
  trunk: "GOOD",
  primary: "GOOD",
  secondary: "FAIR",
  tertiary: "FAIR",
  unclassified: "POOR",
  residential: "FAIR",
  service: "POOR",
  track: "DIRT_TRACK",
  path: "DIRT_TRACK",
  footway: "IMPASSABLE",
  cycleway: "FAIR",
};

const RELIABILITY_SCORE: Record<string, number> = {
  motorway: 0.95,
  trunk: 0.90,
  primary: 0.85,
  secondary: 0.75,
  tertiary: 0.60,
  unclassified: 0.40,
  residential: 0.50,
  service: 0.30,
  track: 0.15,
  path: 0.05,
  footway: 0.02,
  cycleway: 0.35,
};

function matchClosestRoad(
  roads: OsmRoadSurface[],
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
): OsmRoadSurface | null {
  if (roads.length === 0) return null;

  const midLat = (fromLat + toLat) / 2;
  const midLon = (fromLon + toLon) / 2;

  let best: OsmRoadSurface | null = null;
  let bestDist = Infinity;

  for (const road of roads) {
    const dist = haversineKm(midLat, midLon, road.centerLat, road.centerLon);
    if (dist < bestDist) {
      bestDist = dist;
      best = road;
    }
  }

  return bestDist < 5 ? best : null;
}

async function main() {
  console.log("Fetching unenriched edges...");

  const edges = await prisma.routeEdge.findMany({
    where: {
      surfaceType: null,
      roadCondition: null,
    },
    include: {
      fromNode: { select: { latitude: true, longitude: true } },
      toNode: { select: { latitude: true, longitude: true } },
    },
  });

  console.log(`Found ${edges.length} edges missing attributes`);

  if (edges.length === 0) {
    console.log("Nothing to enrich.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  let skipped = 0;
  const batchSize = 10;

  for (let i = 0; i < edges.length; i += batchSize) {
    const batch = edges.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (edge) => {
        const fl = edge.fromNode;
        const tl = edge.toNode;

        let roads: OsmRoadSurface[] | null = null;
        try {
          roads = await fetchOsmRoadSurface(fl.latitude, fl.longitude, tl.latitude, tl.longitude);
        } catch {
          // fall through
        }

        if (!roads || roads.length === 0) {
          skipped++;
          return;
        }

        const closest = matchClosestRoad(roads, fl.latitude, fl.longitude, tl.latitude, tl.longitude);
        if (!closest) {
          skipped++;
          return;
        }

        const highway = closest.highway;
        const surface = closest.surface
          ? (SURFACE_MAP[closest.surface.toLowerCase()] ?? HIGHWAY_SURFACE_MAP[highway] ?? "UNKNOWN")
          : (HIGHWAY_SURFACE_MAP[highway] ?? "UNKNOWN");
        const condition = HIGHWAY_CONDITION_MAP[highway] ?? "FAIR";
        const reliability = RELIABILITY_SCORE[highway] ?? 0.5;

        await prisma.routeEdge.update({
          where: { id: edge.id },
          data: {
            surfaceType: surface,
            roadCondition: condition,
            travelReliability: reliability,
            roadName: null,
          },
        });

        updated++;
      }),
    );

    const pct = Math.min(100, Math.round(((i + batchSize) / edges.length) * 100));
    console.log(`Progress: ${pct}% (${updated} updated, ${skipped} skipped)`);
  }

  console.log(`\nDone! ${updated} edges enriched, ${skipped} skipped (no nearby OSM road found).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
