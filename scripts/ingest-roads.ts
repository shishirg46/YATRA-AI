/**
 * ingests-roads.ts — populates road_segment from dor-road-network.json.
 *
 * Pipeline:
 *   1. Load canonical road registry
 *   2. For each road, fetch OSM geometry via Overpass
 *   3. Fallback: construct geometry from registry waypoints
 *   4. Resolve fromPlace/toPlace to Place IDs
 *   5. Upsert into road_segment
 *
 * Deterministic + idempotent. Safe to re-run.
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { prisma } from "@/lib/prisma";
import type { RegistryRoad, RoadType } from "@/scripts/build-road-registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

const INPUT_FLAG = process.argv.find((a) => a.startsWith("--input="));
const REGISTRY_PATH = INPUT_FLAG
  ? join(DATA_DIR, INPUT_FLAG.split("=")[1])
  : join(DATA_DIR, "dor-road-network.json");
const RAW_OSM_BACKUP = join(DATA_DIR, "osm-road-geometries.json");

// ─── Types ───────────────────────────────────────────────────────
interface OSMGeometry {
  roadCode: string;
  nodes: Array<{ lat: number; lon: number }>;
  source: string;
}

// ─── Load registry ───────────────────────────────────────────────
function loadRegistry(): RegistryRoad[] {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  return JSON.parse(raw) as RegistryRoad[];
}

// ─── OSM Overpass fetch ──────────────────────────────────────────
async function fetchOSMGeometryForRoad(
  road: RegistryRoad,
  timeout = 30,
): Promise<OSMGeometry | null> {
  // Try by roadCode (ref=NH01) first, then by name
  const refQuery = road.roadCode.startsWith("NH")
    ? `way["ref"="${road.roadCode}"]({{bbox}});`
    : "";

  const bbox = computeBBox(road.waypoints);

  const overpassQuery = `[out:json][timeout:${timeout}];
(
  ${refQuery}
  way["highway"]["name"~"${escapeOverpass(road.name)}"]({{bbox}});
);
out geom;
`;

  const body = `data=${encodeURIComponent(
    overpassQuery.replace("{{bbox}}", `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`),
  )}`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "YatraAI/1.0" },
      body,
      signal: AbortSignal.timeout(timeout * 1000),
    });
    if (!res.ok) {
      console.warn(`    Overpass returned ${res.status} for ${road.roadCode}`);
      return null;
    }
    const json = await res.json() as { elements?: Array<{ type: string; id: number; geometry?: Array<{ lat: number; lon: number }> }> };
    if (!json.elements || json.elements.length === 0) return null;

    // Collect all OSM way node coordinates, ordered
    const allNodes: Array<{ lat: number; lon: number }> = [];
    for (const el of json.elements) {
      if (el.type === "way" && el.geometry) {
        for (const pt of el.geometry) {
          allNodes.push({ lat: pt.lat, lon: pt.lon });
        }
      }
    }
    if (allNodes.length === 0) return null;

    return { roadCode: road.roadCode, nodes: allNodes, source: "osm" };
  } catch {
    return null;
  }
}

// ─── BBox calculation ────────────────────────────────────────────
function computeBBox(waypoints: Array<{ lat: number; lon: number }>) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const wp of waypoints) {
    if (wp.lat < minLat) minLat = wp.lat;
    if (wp.lat > maxLat) maxLat = wp.lat;
    if (wp.lon < minLon) minLon = wp.lon;
    if (wp.lon > maxLon) maxLon = wp.lon;
  }
  // Expand by ~1 degree for buffer
  return {
    south: Math.max(-90, minLat - 1),
    north: Math.min(90, maxLat + 1),
    west: Math.max(-180, minLon - 1),
    east: Math.min(180, maxLon + 1),
  };
}

// ─── Escape Overpass string ──────────────────────────────────────
function escapeOverpass(s: string): string {
  return s.replace(/[\\"]/g, "\\$&").replace(/[()]/g, ".");
}

// ─── Resolve place name to Place ID ──────────────────────────────
async function resolvePlace(
  placeName: string,
): Promise<string | null> {
  if (!placeName) return null;

  // Try exact match by nameEn or name
  const exact = await prisma.place.findFirst({
    where: {
      OR: [
        { nameEn: { equals: placeName, mode: "insensitive" } },
        { name: { equals: placeName, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (exact) return exact.id;

  // Fallback: find nearest place with name containing the target
  // This uses the Place table; if we had coords for the place we could use PG
  const fuzzy = await prisma.place.findFirst({
    where: {
      OR: [
        { nameEn: { contains: placeName, mode: "insensitive" } },
        { name: { contains: placeName, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return fuzzy?.id ?? null;
}

// ─── Build geometry from waypoints ────────────────────────────────
function buildLineStringWKT(waypoints: Array<{ lat: number; lon: number }>): string {
  const coords = waypoints.map((p) => `${p.lon} ${p.lat}`).join(", ");
  return `LINESTRING(${coords})`;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log("=== RoadSegment Ingestion ===\n");

  const registry = loadRegistry();
  console.log(`Loaded ${registry.length} roads from registry\n`);

  // Fetch OSM geometries concurrently (5 at a time)
  const osmGeometries = new Map<string, OSMGeometry>();
  const osmBackups: OSMGeometry[] = [];
  const CONCURRENCY = 5;

  async function fetchBatch(batch: RegistryRoad[]) {
    return Promise.allSettled(
      batch.map(async (road) => {
        const osm = await fetchOSMGeometryForRoad(road);
        return { road, osm };
      }),
    );
  }

  for (let i = 0; i < registry.length; i += CONCURRENCY) {
    const batch = registry.slice(i, i + CONCURRENCY);
    const results = await fetchBatch(batch);
    for (const result of results) {
      if (result.status === "fulfilled") {
        const { road, osm } = result.value;
        if (osm) {
          osmGeometries.set(road.roadCode, osm);
          osmBackups.push(osm);
          console.log(`  ✓ ${road.roadCode} ${road.name} (${osm.nodes.length} OSM nodes)`);
        } else {
          console.log(`  — ${road.roadCode} ${road.name} (using corridor geometry)`);
        }
      }
    }
  }

  // Save OSM backup
  writeFileSync(RAW_OSM_BACKUP, JSON.stringify(osmBackups, null, 2));
  console.log(`\nSaved OSM geometry backup to ${RAW_OSM_BACKUP}`);

  // Resolve fromPlace / toPlace
  console.log("\n  Resolving place references...");
  const placeCache = new Map<string, string | null>();
  async function getPlaceId(name: string): Promise<string | null> {
    if (placeCache.has(name)) return placeCache.get(name)!;
    const id = await resolvePlace(name);
    placeCache.set(name, id);
    return id;
  }

  // Upsert roads
  console.log("\n  Upserting road segments...\n");
  let created = 0, updated = 0, skipped = 0;

  for (const road of registry) {
    const osmGeo = osmGeometries.get(road.roadCode);
    const nodes = osmGeo?.nodes ?? road.waypoints;
    if (nodes.length < 2) {
      console.warn(`  SKIP ${road.roadCode}: <2 waypoints`);
      skipped++;
      continue;
    }

    const fromPlaceId = await getPlaceId(road.fromPlace);
    const toPlaceId = await getPlaceId(road.toPlace);

    const roadType = road.roadType;
    const wkt = buildLineStringWKT(nodes);
    const lengthKm = road.lengthKm;

    const confidenceJson = road.sourceConfidence
      ? JSON.stringify(road.sourceConfidence)
      : null;
    const metadataJson = road.metadata ? JSON.stringify(road.metadata) : null;

    try {
      // Use raw SQL to set geom column (Prisma doesn't manage PostGIS columns)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "road_segment" (
           "id", "roadCode", "roadNumber", "name", "roadType", "province",
           "fromPlaceId", "toPlaceId", "lengthKm", "isActive",
           "sourceConfidence", "metadata", "geom", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid()::text, $1, $2, $3, $4::"RoadType",
           $5, $6, $7, $8, true,
           $9::jsonb, $10::jsonb, ST_GeomFromText($11, 4326), NOW(), NOW()
         )
         ON CONFLICT ("roadCode") DO UPDATE SET
            "name" = EXCLUDED."name",
            "roadType" = EXCLUDED."roadType",
            "fromPlaceId" = EXCLUDED."fromPlaceId",
            "toPlaceId" = EXCLUDED."toPlaceId",
            "lengthKm" = EXCLUDED."lengthKm",
            "isActive" = EXCLUDED."isActive",
            "sourceConfidence" = EXCLUDED."sourceConfidence",
            "metadata" = EXCLUDED."metadata",
            "geom" = EXCLUDED."geom",
            "updatedAt" = NOW()`,
        road.roadCode,
        road.roadCode.replace(/^NH/, "").replace(/^FR/, ""),
        road.name,
        roadType,
        null, // province
        fromPlaceId,
        toPlaceId,
        lengthKm,
        confidenceJson,
        metadataJson,
        wkt,
      );
      created++;
      process.stdout.write(`  ✓ ${road.roadCode} ${road.name} (${nodes.length} pts, ${lengthKm} km)\n`);
    } catch (err) {
      console.error(`  ✗ ${road.roadCode}: ${err instanceof Error ? err.message : err}`);
      skipped++;
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`  Created/updated: ${created}`);
  console.log(`  Skipped:         ${skipped}`);
  console.log(`  Place refs resolved: ${placeCache.size} (${[...placeCache.values()].filter(Boolean).length} matched)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
