/**
 * densify-corridors.ts — geometry enrichment for dor-road-network.json.
 *
 * Reads the canonical registry, applies adaptive Haversine interpolation,
 * and writes dor-road-network.densified.json.
 *
 * Never modifies source-of-truth files (corridor JSONs, nepal-highways.ts,
 * or the canonical registry itself).
 *
 * Usage:
 *   npx tsx scripts/densify-corridors.ts
 *
 * Output:
 *   scripts/data/dor-road-network.densified.json
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

const REGISTRY_PATH = join(DATA_DIR, "dor-road-network.json");
const OUTPUT_PATH = join(DATA_DIR, "dor-road-network.densified.json");

const SPACING_RULE_VERSION = "v1";

// ─── Spacing rules ────────────────────────────────────────────────
function getSpacing(roadType: string, avgLat: number): number {
  switch (roadType) {
    case "FEEDER":
      return 5;
    case "NATIONAL_HIGHWAY":
      return avgLat < 27.0 ? 2 : 1;
    default:
      return 3;
  }
}

// ─── Haversine helpers ────────────────────────────────────────────
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
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

interface Coord {
  lat: number;
  lon: number;
}

function haversineInterpolate(a: Coord, b: Coord, fraction: number): Coord {
  const lat1 = (a.lat * Math.PI) / 180;
  const lon1 = (a.lon * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const lon2 = (b.lon * Math.PI) / 180;

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );

  if (d < 1e-12) return { lat: a.lat, lon: a.lon };

  const A = Math.sin((1 - fraction) * d) / Math.sin(d);
  const B = Math.sin(fraction * d) / Math.sin(d);

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * (180 / Math.PI),
    lon: Math.atan2(y, x) * (180 / Math.PI),
  };
}

// ─── Normalized hash input ────────────────────────────────────────
function geometryHash(
  waypoints: Coord[],
  spacing: number,
): string {
  const normalized = waypoints.map((p) => ({
    lat: +p.lat.toFixed(6),
    lon: +p.lon.toFixed(6),
  }));
  const seed = JSON.stringify(normalized) + "|" + spacing + "|" + SPACING_RULE_VERSION;
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

// ─── Densify a road's waypoints ───────────────────────────────────
function densifyWaypoints(
  waypoints: Coord[],
  spacing: number,
): Coord[] {
  if (waypoints.length < 2) return [...waypoints];

  const result: Coord[] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);

    result.push({ lat: a.lat, lon: a.lon });

    if (dist > spacing && dist > 1e-12) {
      const n = Math.ceil(dist / spacing) - 1;
      for (let j = 1; j <= n; j++) {
        result.push(haversineInterpolate(a, b, j / (n + 1)));
      }
    }
  }

  result.push({
    lat: waypoints[waypoints.length - 1].lat,
    lon: waypoints[waypoints.length - 1].lon,
  });

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────
function main() {
  console.log("=== Corridor Densification ===\n");

  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  const registry: Array<Record<string, unknown>> = JSON.parse(raw);
  console.log(`Loaded ${registry.length} roads from registry\n`);

  let totalOriginal = 0;
  let totalDensified = 0;

  for (const road of registry) {
    const roadCode = road.roadCode as string;
    const roadType = road.roadType as string;
    const waypoints = road.waypoints as Coord[];
    const originalCount = waypoints.length;
    totalOriginal += originalCount;

    const sumLat = waypoints.reduce((s, p) => s + p.lat, 0);
    const avgLat = sumLat / waypoints.length;
    const spacing = getSpacing(roadType, avgLat);

    const densified = densifyWaypoints(waypoints, spacing);
    road.waypoints = densified;

    const hash = geometryHash(waypoints, spacing);
    const existingMeta = (road.metadata as Record<string, unknown>) ?? {};
    existingMeta.geometryVersion = `v1-densified-adaptive`;
    existingMeta.geometryHash = hash;
    road.metadata = existingMeta;

    totalDensified += densified.length;

    console.log(
      `  ${roadCode} ${road.name}: ${originalCount} → ${densified.length} pts (${spacing} km spacing, hash=${hash})`,
    );
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2));
  console.log(`\n  Total: ${totalOriginal} → ${totalDensified} waypoints`);
  console.log(`  Written: ${OUTPUT_PATH}`);
}

main();
