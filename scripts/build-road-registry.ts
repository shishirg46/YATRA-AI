/**
 * Builds dor-road-network.json — the canonical Nepal highway registry.
 *
 * Sources (by priority):
 *   1. corridor JSONs       (geometry backbone)
 *   2. nepal-highways.ts    (waypoint validation)
 *
 * Output: one entry per roadCode, stable + deterministic.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { HIGHWAY_CORRIDORS } from "@/scripts/data/nepal-highways";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

// ─── Types ───────────────────────────────────────────────────────
export type RoadType = "NATIONAL_HIGHWAY" | "FEEDER" | "MID_HILL" | "OTHER";

export interface RegistryRoad {
  roadCode: string;
  name: string;
  nameNe?: string;
  roadType: RoadType;
  fromPlace: string;
  toPlace: string;
  /** Ordered waypoints tracing the road (lat/lon) */
  waypoints: Array<{ lat: number; lon: number }>;
  /** Highway corridor IDs that contributed to this road */
  corridorSources: string[];
  /** Confidence per source (0-1) */
  sourceConfidence: Record<string, number>;
  /** Length estimate in km */
  lengthKm: number;
  /** Geometry metadata (set by densifier) */
  metadata?: Record<string, unknown>;
}

interface CorridorNode {
  name: string;
  lat: number;
  lon: number;
}

interface CorridorJSON {
  id: string;
  name: string;
  highway: string;
  nodes: CorridorNode[];
}

// ─── Road definitions — canonical mapping ──────────────────────
// roadCode is the PRIMARY KEY OF REALITY. Must never change once assigned.
interface RoadDef {
  code: string;
  type: RoadType;
  fromPlace: string;
  toPlace: string;
  /** Name variation to match against corridor names */
  corridorMatch?: string;
  /** Exact name to match in nepal-highways.ts */
  highwayTSName?: string;
  /** Corridor JSON ID (if present) */
  corridorJSONId?: string;
}

const ROADS: RoadDef[] = [
  // ── National Highways ──
  { code: "NH01", type: "NATIONAL_HIGHWAY", fromPlace: "Mechinagar", toPlace: "Bhimdatta", corridorJSONId: "east-west-highway" },
  { code: "NH02", type: "NATIONAL_HIGHWAY", fromPlace: "Kathmandu", toPlace: "Birgunj", highwayTSName: "Tribhuvan Highway" },
  { code: "NH03", type: "NATIONAL_HIGHWAY", fromPlace: "Kathmandu", toPlace: "Bardibas", corridorJSONId: "bp-highway" },
  { code: "NH04", type: "NATIONAL_HIGHWAY", fromPlace: "Bhadrapur", toPlace: "Darchula", corridorJSONId: "mid-hill-highway" },
  { code: "NH05", type: "NATIONAL_HIGHWAY", fromPlace: "Kakarbhitta", toPlace: "Mahendranagar", highwayTSName: "Hulaki Highway" },
  { code: "NH06", type: "NATIONAL_HIGHWAY", fromPlace: "Surkhet", toPlace: "Hilsa", highwayTSName: "Karnali Highway" },
  { code: "NH07", type: "NATIONAL_HIGHWAY", fromPlace: "Mahendranagar", toPlace: "Jhulaghat", highwayTSName: "Mahakali Highway" },
  { code: "NH08", type: "NATIONAL_HIGHWAY", fromPlace: "Kakarbhitta", toPlace: "Taplejung", highwayTSName: "Mechi Highway" },
  { code: "NH09", type: "NATIONAL_HIGHWAY", fromPlace: "Biratnagar", toPlace: "Kimathanka", highwayTSName: "Koshi Highway" },
  { code: "NH10", type: "NATIONAL_HIGHWAY", fromPlace: "Pokhara", toPlace: "Butwal", corridorJSONId: "siddhartha-highway", highwayTSName: "Siddhartha Highway" },
  { code: "NH11", type: "NATIONAL_HIGHWAY", fromPlace: "Pokhara", toPlace: "Lo Manthang", corridorJSONId: "kaligandaki-corridor", highwayTSName: "Kaligandaki Corridor" },
  { code: "NH12", type: "NATIONAL_HIGHWAY", fromPlace: "Kathmandu", toPlace: "Kodari", highwayTSName: "Arniko Highway" },
  { code: "NH13", type: "NATIONAL_HIGHWAY", fromPlace: "Kathmandu", toPlace: "Rasuwagadhi", highwayTSName: "Pasang Lhamu Highway" },
  { code: "NH14", type: "NATIONAL_HIGHWAY", fromPlace: "Thankot", toPlace: "Hetauda", highwayTSName: "Kanti Highway" },
  { code: "NH15", type: "NATIONAL_HIGHWAY", fromPlace: "Sindhuli", toPlace: "Mugling", highwayTSName: "Madan Bhandari Highway" },
  { code: "NH17", type: "NATIONAL_HIGHWAY", fromPlace: "Kathmandu", toPlace: "Pokhara", corridorJSONId: "prithvi-highway" },

  // ── Feeder Roads ──
  { code: "FR01", type: "FEEDER", fromPlace: "Butwal", toPlace: "Surkhet", highwayTSName: "Rapti Highway" },
  { code: "FR02", type: "FEEDER", fromPlace: "Biratnagar", toPlace: "Chainpur", highwayTSName: "Biratnagar-Dhankuta Road" },
  { code: "FR03", type: "FEEDER", fromPlace: "Janakpur", toPlace: "Siraha", highwayTSName: "Janakpur-Dhanusa Road" },
  { code: "FR04", type: "FEEDER", fromPlace: "Pokhara", toPlace: "Kusma", highwayTSName: "Pokhara-Baglung Highway" },
  { code: "FR05", type: "FEEDER", fromPlace: "Nepalgunj", toPlace: "Dailekh", highwayTSName: "Nepalgunj-Dailekh Road" },
  { code: "FR06", type: "FEEDER", fromPlace: "Dhangadhi", toPlace: "Dadeldhura", highwayTSName: "Dhangadhi-Dadeldhura Road" },
  { code: "FR07", type: "FEEDER", fromPlace: "Mahendranagar", toPlace: "Darchula", highwayTSName: "Mahendranagar-Darchula Road" },
  { code: "FR08", type: "FEEDER", fromPlace: "Nepalgunj", toPlace: "Surkhet", highwayTSName: "Nepalgunj-Surkhet Road" },
  { code: "FR09", type: "FEEDER", fromPlace: "Pokhara", toPlace: "Besisahar", highwayTSName: "Besisahar Road" },
  { code: "FR10", type: "FEEDER", fromPlace: "Butwal", toPlace: "Lumbini", highwayTSName: "Lumbini Road" },
];

// ─── Load corridor JSONs ────────────────────────────────────────
function loadCorridorJSONs(): Map<string, CorridorJSON> {
  const ids = [
    "east-west-highway",
    "prithvi-highway",
    "bp-highway",
    "siddhartha-highway",
    "mid-hill-highway",
    "kaligandaki-corridor",
  ];
  const map = new Map<string, CorridorJSON>();
  for (const id of ids) {
    const path = join(DATA_DIR, "corridors", `${id}.json`);
    if (!existsSync(path)) {
      console.warn(`  WARN: missing ${path}`);
      continue;
    }
    const json = JSON.parse(readFileSync(path, "utf-8")) as CorridorJSON;
    map.set(id, json);
  }
  return map;
}

// ─── Build the registry ─────────────────────────────────────────
function buildRegistry(): RegistryRoad[] {
  const corridors = loadCorridorJSONs();
  const registry: RegistryRoad[] = [];

  for (const def of ROADS) {
    let waypoints: Array<{ lat: number; lon: number }> = [];
    const sources: string[] = [];

    // Try corridor JSON first
    if (def.corridorJSONId) {
      const cj = corridors.get(def.corridorJSONId);
      if (cj) {
        waypoints = cj.nodes.map((n) => ({ lat: n.lat, lon: n.lon }));
        sources.push(def.corridorJSONId);
      }
    }

    // If no waypoints from corridor JSON, try nepal-highways.ts
    if (waypoints.length === 0 && def.highwayTSName) {
      const hw = HIGHWAY_CORRIDORS.find(
        (h) => h.name.toLowerCase() === def.highwayTSName!.toLowerCase(),
      );
      if (hw) {
        waypoints = hw.waypoints.map((n) => ({ lat: n.lat, lon: n.lon }));
        sources.push(def.highwayTSName);
      }
    }

    if (waypoints.length === 0) {
      console.warn(`  WARN: no waypoints found for ${def.code} (${def.fromPlace} → ${def.toPlace})`);
      continue;
    }

    const lengthKm = estimateLengthKm(waypoints);

    // Use corridor JSON name or highway name
    let name = "";
    if (def.corridorJSONId) {
      const cj = corridors.get(def.corridorJSONId);
      name = cj?.name ?? def.highwayTSName ?? `${def.code} ${def.fromPlace}→${def.toPlace}`;
    } else {
      const hw = HIGHWAY_CORRIDORS.find(
        (h) => h.name.toLowerCase() === def.highwayTSName!.toLowerCase(),
      );
      name = hw?.name ?? `${def.code} ${def.fromPlace}→${def.toPlace}`;
    }

    const confidence: Record<string, number> = {};
    if (def.corridorJSONId) confidence.corridor = 0.8;
    if (def.highwayTSName && sources.includes(def.highwayTSName)) confidence.osm = 0.6;

    registry.push({
      roadCode: def.code,
      name,
      roadType: def.type,
      fromPlace: def.fromPlace,
      toPlace: def.toPlace,
      waypoints,
      corridorSources: sources,
      sourceConfidence: confidence,
      lengthKm,
    });
  }

  registry.sort((a, b) => a.roadCode.localeCompare(b.roadCode));
  return registry;
}

// ─── Utilities ──────────────────────────────────────────────────
function estimateLengthKm(waypoints: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineKm(waypoints[i - 1], waypoints[i]);
  }
  return Math.round(total * 10) / 10;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aVal =
    sinDLat * sinDLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

// ─── Main ───────────────────────────────────────────────────────
function main() {
  console.log("=== Building Nepal Road Registry ===\n");

  const registry = buildRegistry();

  const outPath = join(DATA_DIR, "dor-road-network.json");
  writeFileSync(outPath, JSON.stringify(registry, null, 2));
  console.log(`Wrote ${registry.length} roads to ${outPath}\n`);

  console.log("=== Registry Summary ===");
  console.log(`  Total roads:    ${registry.length}`);
  console.log(`  National highways: ${registry.filter((r) => r.roadType === "NATIONAL_HIGHWAY").length}`);
  console.log(`  Feeder roads:   ${registry.filter((r) => r.roadType === "FEEDER").length}`);
  console.log("");

  for (const r of registry) {
    console.log(
      `  ${r.roadCode.padEnd(6)} ${r.name.padEnd(40)} ${r.fromPlace.padEnd(20)} → ${r.toPlace.padEnd(20)} ${r.lengthKm} km (${r.waypoints.length} wpts)`,
    );
  }
}

main();
