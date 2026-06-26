#!/usr/bin/env npx tsx
/**
 * Places Ingestion Script
 *
 * Fetches OSM settlement data (city/town/village/hamlet) from Overpass API,
 * normalizes, deduplicates, and upserts into the Place table.
 *
 * Usage:
 *   npx tsx scripts/ingest-places.ts
 *
 * Flow:
 *   Overpass API → scripts/data/osm-settlements-nepal.json (raw backup)
 *                → normalize + map + dedup
 *                → batch upsert to Place table
 *                → seed fallback from local data
 *                → report
 */

import "dotenv/config";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── Types ──

type PlaceType = "CITY" | "TOWN" | "VILLAGE";

interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

interface PlaceInput {
  id: string;
  name: string;
  nameEn: string | null;
  nameNe: string | null;
  type: PlaceType;
  latitude: number;
  longitude: number;
  adminLevel: number | null;
  osmId: bigint | null;
  osmType: string | null;
  source: string;
}

interface SeedEntry {
  name: string;
  lat: number;
  lon: number;
  type?: string;
}

interface IngestReport {
  overpassFetched: number;
  validSettlements: number;
  seedAdded: number;
  mergedDuplicates: number;
  inserted: number;
  skipped: number;
  nameEnPct: string;
  nameNePct: string;
  executionTimeMs: number;
}

// ── Config ──

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT = 300_000;
const BATCH_SIZE = 500;
const DEDUP_DISTANCE_M = 200;
const SEED_DISTANCE_M = 100;
const DATA_DIR = join(dirname(new URL(import.meta.url).pathname), "data");
const RAW_BACKUP = join(DATA_DIR, "osm-settlements-nepal.json");
const OVERPASS_QUERY = `[out:json][timeout:300];
rel(184633); map_to_area;
(
  node(area)["place"~"^(city|town|village|hamlet)$"];
);
out body;`;

const OSM_TYPE_MAP: Record<string, PlaceType> = {
  city: "CITY",
  town: "TOWN",
  village: "VILLAGE",
  hamlet: "VILLAGE",
};

const VALID_OSM_TYPES = new Set(Object.keys(OSM_TYPE_MAP));

// ── Normalization ──

function normalizeName(raw: string): string {
  return raw
    .trim()
    .normalize("NFC")
    .replace(/[\x00-\x1F]/g, "")
    .replace(/[-–—]\s*\d+$/g, "")
    .replace(/\s+Ward\s*\d+$/gi, "")
    .replace(/\s+\([^)]*\)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function generateId(name: string, lat: number, lon: number): string {
  const key = `${normalizeName(name)}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 24);
}

function haversineDist(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Overpass fetch ──

async function fetchOverpass(query: string): Promise<OsmNode[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "YatraAI/1.0 (Nepal spatial intelligence ingestion; shishir@yatraai.com)",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Overpass returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();

    if (!data.elements || !Array.isArray(data.elements)) {
      throw new Error("Unexpected Overpass response format");
    }

    return data.elements.filter(
      (e: { type?: string }) => e.type === "node"
    ) as OsmNode[];
  } finally {
    clearTimeout(timer);
  }
}

// ── Seed data sources ──

function loadSeedEntries(): SeedEntry[] {
  const seeds: SeedEntry[] = [];

  // 1. nepal-route-nodes.json
  const routeNodesPath = join(DATA_DIR, "nepal-route-nodes.json");
  if (existsSync(routeNodesPath)) {
    const raw = JSON.parse(readFileSync(routeNodesPath, "utf-8"));
    if (raw.nodes) {
      for (const n of raw.nodes) {
        seeds.push({
          name: n.name,
          lat: n.lat,
          lon: n.lon,
          type: n.type?.toLowerCase(),
        });
      }
    }
  }

  // 2. nepal-highways.ts — we need a JSON version or inline data
  // The corridor waypoints are in TypeScript, so we'll use the
  // highway corridors defined in the script's data section.
  // Fallback: import from the compiled TS if available.

  return seeds;
}

// ── Dedup ──

function deduplicate(places: PlaceInput[]): PlaceInput[] {
  const byName = new Map<string, PlaceInput[]>();

  for (const p of places) {
    const key = normalizeName(p.name).toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(p);
  }

  const result: PlaceInput[] = [];
  let merged = 0;

  for (const [, group] of byName) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const kept = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (kept.has(i)) continue;
      const candidates = [i];
      for (let j = i + 1; j < group.length; j++) {
        if (kept.has(j)) continue;
        const dist = haversineDist(
          group[i].latitude, group[i].longitude,
          group[j].latitude, group[j].longitude
        );
        if (dist < DEDUP_DISTANCE_M) {
          candidates.push(j);
        }
      }
      // Merge candidates: keep the one with smallest adminLevel (most specific)
      let best = candidates[0];
      for (const c of candidates) {
        kept.add(c);
        const aLevel = group[c].adminLevel ?? 99;
        const bLevel = group[best].adminLevel ?? 99;
        if (aLevel < bLevel) best = c;
        // Prefer entries with richer name data
        if (aLevel === bLevel) {
          const aRich = (group[c].nameEn ? 1 : 0) + (group[c].nameNe ? 1 : 0);
          const bRich = (group[best].nameEn ? 1 : 0) + (group[best].nameNe ? 1 : 0);
          if (aRich > bRich) best = c;
        }
      }
      result.push(group[best]);
      merged += candidates.length - 1;
    }
  }

  // Track merged count
  (result as any).mergedCount = merged;
  return result;
}

// ── Batch upsert ──

async function upsertPlaces(places: PlaceInput[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    const operations = batch.map((p) =>
      prisma.place.upsert({
        where: { id: p.id },
        create: {
          id: p.id,
          name: p.name,
          nameEn: p.nameEn,
          nameNe: p.nameNe,
          type: p.type as any,
          latitude: p.latitude,
          longitude: p.longitude,
          adminLevel: p.adminLevel,
          osmId: p.osmId,
          osmType: p.osmType,
        },
        update: {
          name: p.name,
          nameEn: p.nameEn,
          nameNe: p.nameNe,
          type: p.type as any,
          latitude: p.latitude,
          longitude: p.longitude,
          adminLevel: p.adminLevel,
          osmId: p.osmId,
          osmType: p.osmType,
        },
      })
    );
    const results = await Promise.all(operations);
    inserted += results.length;

    process.stdout.write(
      `\r  Upserted ${inserted}/${places.length} places`
    );
  }

  process.stdout.write("\n");
  return inserted;
}

// ── Main ──

async function main() {
  const start = performance.now();
  const report: IngestReport = {
    overpassFetched: 0,
    validSettlements: 0,
    seedAdded: 0,
    mergedDuplicates: 0,
    inserted: 0,
    skipped: 0,
    nameEnPct: "0%",
    nameNePct: "0%",
    executionTimeMs: 0,
  };

  console.log("\n=== Nepal Places Ingestion ===\n");

  // ── Fetch OSM data ──
  console.log("Fetching OSM settlements from Overpass...");
  const rawNodes = await fetchOverpass(OVERPASS_QUERY);
  report.overpassFetched = rawNodes.length;
  console.log(`  Fetched ${rawNodes.length} nodes\n`);

  // ── Save raw backup ──
  console.log(`Saving raw backup to ${RAW_BACKUP}...`);
  writeFileSync(
    RAW_BACKUP,
    JSON.stringify(
      { fetchedAt: new Date().toISOString(), count: rawNodes.length, nodes: rawNodes },
      null,
      2
    )
  );
  console.log("  Done\n");

  // ── Parse OSM nodes ──
  console.log("Parsing OSM nodes...");
  const parsed: PlaceInput[] = [];
  let skipped = 0;

  for (const node of rawNodes) {
    const rawType = (node.tags.place || "").toLowerCase();
    if (!VALID_OSM_TYPES.has(rawType)) {
      skipped++;
      continue;
    }

    const name = normalizeName(node.tags.name || "");
    if (!name) {
      skipped++;
      continue;
    }

    const nameEn = node.tags["name:en"]
      ? normalizeName(node.tags["name:en"])
      : null;
    const nameNe = node.tags["name:ne"]
      ? normalizeName(node.tags["name:ne"])
      : null;

    const placeType = OSM_TYPE_MAP[rawType];
    const adminLevel = node.tags.admin_level
      ? parseInt(node.tags.admin_level, 10) || null
      : null;

    parsed.push({
      id: generateId(name, node.lat, node.lon),
      name,
      nameEn: nameEn || null,
      nameNe: nameNe || null,
      type: placeType,
      latitude: node.lat,
      longitude: node.lon,
      adminLevel,
      osmId: BigInt(node.id),
      osmType: "node",
      source: "overpass",
    });
  }

  report.validSettlements = parsed.length;
  report.skipped = skipped;
  console.log(`  Valid: ${parsed.length}, Skipped: ${skipped}\n`);

  // ── Seed from local data ──
  console.log("Loading seed data...");
  const seeds = loadSeedEntries();

  const importedFromSeed: PlaceInput[] = [];
  for (const seed of seeds) {
    const name = normalizeName(seed.name);
    if (!name) continue;

    // Skip if already covered by OSM data (within SEED_DISTANCE_M)
    const alreadyExists = parsed.some(
      (p) =>
        haversineDist(p.latitude, p.longitude, seed.lat, seed.lon) <
        SEED_DISTANCE_M
    );
    if (alreadyExists) continue;

    const seedType: PlaceType =
      seed.type === "city"
        ? "CITY"
        : seed.type === "town"
          ? "TOWN"
          : "VILLAGE";

    importedFromSeed.push({
      id: generateId(name, seed.lat, seed.lon),
      name,
      nameEn: null,
      nameNe: null,
      type: seedType,
      latitude: seed.lat,
      longitude: seed.lon,
      adminLevel: null,
      osmId: null,
      osmType: null,
      source: "seed",
    });
  }

  report.seedAdded = importedFromSeed.length;
  console.log(`  Seed entries: ${importedFromSeed.length}\n`);

  // ── Deduplicate ──
  console.log("Deduplicating...");
  const allPlaces = [...parsed, ...importedFromSeed];
  const deduped = deduplicate(allPlaces);
  report.mergedDuplicates = (deduped as any).mergedCount || 0;
  console.log(`  After dedup: ${deduped.length} (+ ${report.mergedDuplicates} merged)\n`);

  // ── Upsert ──
  console.log("Upserting to database...");
  const inserted = await upsertPlaces(deduped);
  report.inserted = inserted;

  // ── Stats ──
  const total = deduped.length;
  const withNameEn = deduped.filter((p) => p.nameEn).length;
  const withNameNe = deduped.filter((p) => p.nameNe).length;
  report.nameEnPct = total > 0
    ? ((withNameEn / total) * 100).toFixed(1) + "%"
    : "0%";
  report.nameNePct = total > 0
    ? ((withNameNe / total) * 100).toFixed(1) + "%"
    : "0%";

  report.executionTimeMs = Math.round(performance.now() - start);

  // ── Report ──
  console.log("\n=== Phase 2 Complete ===\n");
  console.log(`  Overpass fetched:    ${report.overpassFetched}`);
  console.log(`  Valid settlements:   ${report.validSettlements}`);
  console.log(`  Seed data added:     ${report.seedAdded}`);
  console.log(`  Merged duplicates:   ${report.mergedDuplicates}`);
  console.log(`  Inserted:            ${report.inserted}`);
  console.log(`  Skipped:             ${report.skipped}`);
  console.log(`  name_en present:     ${report.nameEnPct}`);
  console.log(`  name_ne present:     ${report.nameNePct}`);
  console.log(`  Execution time:      ${(report.executionTimeMs / 1000).toFixed(1)}s\n`);

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("\nIngestion failed:", err);
  process.exit(1);
});
