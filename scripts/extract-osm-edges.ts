#!/usr/bin/env npx tsx
/**
 * extract-osm-edges.ts — Stage 2B: OSM Topology Extraction.
 *
 * Fetches OSM highway ways for configured AOIs via Overpass API,
 * converts to normalized raw edge format, and writes raw-edges-osm.json.
 *
 * Configuration:
 *   Edit the AOIS array to add/remove bounding boxes.
 *   Each AOI is extracted independently and merged.
 *
 * Usage:
 *   npx tsx scripts/extract-osm-edges.ts
 *
 * Output: scripts/data/raw-edges-osm.json
 */
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { haversineKm } from "../lib/routing/geo";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const OUTPUT_PATH = join(DATA_DIR, "raw-edges-osm.json");

// ─── AOI Configuration ────────────────────────────────────────────────
// Add new AOIs here when corridor gaps are identified.
// Bounds format: { north, south, east, west } in decimal degrees.
const AOIS: Array<{ name: string; bounds: { north: number; south: number; east: number; west: number } }> = [
  {
    name: "kaligandaki",
    bounds: { north: 29.2, south: 28.4, east: 84.0, west: 83.5 },
  },
];

// Highway types considered vehicular (everything else excluded).
// We exclude footway, path, track, cycleway, bridleway, pedestrian, steps,
// escalator, proposed, construction, raceway, and other non-vehicular types.
const EXCLUDED_HIGHWAYS =
  "footway|path|track|cycleway|bridleway|pedestrian|steps|escalator|proposed|construction|raceway|corridor|elevator|escape|give_way|platform|rest_area|services|speed_camera|stop|street_lamp|toll_gantry|traffic_signals|turning_circle|turning_loop|bus_stop|crossing";

// ─── Types ─────────────────────────────────────────────────────────────

interface OsmNormalizedEdge {
  id: string;
  source: "OSM";
  sourcePriority: number;
  polyline: Array<{ lat: number; lon: number }>;
  lengthKm: number;
  fcode: null;
  features: string;
  fnode: null;
  tnode: null;
  highway: string;
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface OverpassWayGeom {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: (OverpassNode | OverpassWayGeom)[];
}

// ─── Overpass Fetch ────────────────────────────────────────────────────

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

async function fetchOverpass(query: string, timeoutMs = 120000): Promise<Response | null> {
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": "YatraAI/1.0",
        },
        body: query,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("[extract-osm-edges] Starting OSM extraction...");
  console.log(`  ${AOIS.length} AOI(s) configured: ${AOIS.map((a) => a.name).join(", ")}`);

  const allEdges: OsmNormalizedEdge[] = [];
  let totalWays = 0;
  let keptWays = 0;

  for (const aoi of AOIS) {
    const { name, bounds } = aoi;
    console.log(`\n[extract-osm-edges] Processing AOI: ${name}`);
    console.log(`  Bounds: N=${bounds.north} S=${bounds.south} E=${bounds.east} W=${bounds.west}`);

    const bboxStr = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
    const query = `[out:json][timeout:120];
(
  way["highway"]["highway"!~"${EXCLUDED_HIGHWAYS}"](${bboxStr});
);
out geom;`;

    console.log("  Fetching from Overpass (up to 120s timeout)...");
    const res = await fetchOverpass(query, 120000);
    if (!res) {
      console.log(`  WARN: No response for AOI "${name}", skipping`);
      continue;
    }

    const data: OverpassResponse = await res.json();
    const elements = data.elements || [];
    console.log(`  Received ${elements.length} elements`);

    let aoiWays = 0;
    let aoiKept = 0;

    for (const el of elements) {
      if (el.type !== "way") continue;
      totalWays++;
      aoiWays++;

      const way = el as OverpassWayGeom;
      if (!way.geometry || way.geometry.length < 2) continue;

      const polyline = way.geometry.map((p) => ({
        lat: +p.lat.toFixed(6),
        lon: +p.lon.toFixed(6),
      }));

      // Compute length
      let lengthKm = 0;
      for (let i = 1; i < polyline.length; i++) {
        lengthKm += haversineKm(
          polyline[i - 1].lat, polyline[i - 1].lon,
          polyline[i].lat, polyline[i].lon,
        );
      }
      lengthKm = +lengthKm.toFixed(4);

      const highway = way.tags?.highway ?? "unknown";

      const edge: OsmNormalizedEdge = {
        id: `osm_${way.id.toString().padStart(8, "0")}`,
        source: "OSM",
        sourcePriority: 0.7,
        polyline,
        lengthKm,
        fcode: null,
        features: `OSM ${highway}`,
        fnode: null,
        tnode: null,
        highway,
      };

      allEdges.push(edge);
      aoiKept++;
      keptWays++;
    }

    console.log(`  AOI "${name}": ${aoiKept}/${aoiWays} ways kept`);
  }

  // Summary
  console.log(`\n[extract-osm-edges] Complete: ${totalWays} total ways, ${keptWays} kept`);
  console.log(`  Total OSM edges: ${allEdges.length}`);

  const byType: Record<string, number> = {};
  for (const e of allEdges) {
    byType[e.highway] = (byType[e.highway] ?? 0) + 1;
  }
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    const totalKm = allEdges.filter((e) => e.highway === type).reduce((s, e) => s + e.lengthKm, 0);
    console.log(`  highway=${type}: ${count} edges, ${totalKm.toFixed(1)} km`);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(allEdges, null, 2));
  console.log(`\n[extract-osm-edges] Written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[extract-osm-edges] Fatal:", err);
  process.exit(1);
});
