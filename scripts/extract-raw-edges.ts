#!/usr/bin/env npx tsx
import { open } from "shapefile";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "scripts", "data");
const SHP_DIR = join(DATA_DIR, "npl-rdsl-trans-25k-50k-sdn-wgs84");

const SHP_PATH = join(SHP_DIR, "npl_rdsl_trans_25K_50K_sdn_wgs84.shp");
const DBF_PATH = join(SHP_DIR, "npl_rdsl_trans_25K_50K_sdn_wgs84.dbf");
const OUTPUT_PATH = join(DATA_DIR, "raw-edges.json");

const KEEP_FCODES = new Set([10111, 10121, 10131, 10141, 10511]);

const FCODE_LABELS: Record<number, string> = {
  10111: "Highway",
  10121: "Feeder Road",
  10131: "District Road",
  10141: "Other Road",
  10511: "Bridge Road",
};

interface RawEdge {
  id: number;
  fcode: number;
  features: string;
  fnode: number;
  tnode: number;
  polyline: Array<{ lat: number; lon: number }>;
  lengthKm: number;
}

function normalizeCoords(coords: number[][]): Array<{ lat: number; lon: number }> {
  return coords.map(([lon, lat]) => ({
    lat: +lat.toFixed(6),
    lon: +lon.toFixed(6),
  }));
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

function computePolylineLength(polyline: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    total += haversineKm(
      polyline[i - 1].lat,
      polyline[i - 1].lon,
      polyline[i].lat,
      polyline[i].lon,
    );
  }
  return +total.toFixed(4);
}

async function main() {
  console.log("[extract-raw-edges] Opening shapefile...");
  const source = await open(SHP_PATH, DBF_PATH);

  const edges: RawEdge[] = [];
  let totalRead = 0;
  let totalKept = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await source.read();
    if (result.done) break;

    const feature = result.value;
    totalRead++;

    const fcode = feature.properties?.FCODE as number | undefined;
    if (!fcode || !KEEP_FCODES.has(fcode)) continue;

    const geometry = feature.geometry;
    if (!geometry || geometry.type !== "LineString") continue;

    const coords = geometry.coordinates as number[][];
    if (coords.length < 2) continue;

    const polyline = normalizeCoords(coords);
    const features =
      (feature.properties?.FEATURES as string) ??
      FCODE_LABELS[fcode] ??
      "Unknown";

    const edge: RawEdge = {
      id: totalKept,
      fcode,
      features,
      fnode: (feature.properties?.FNODE_ as number) ?? -1,
      tnode: (feature.properties?.TNODE_ as number) ?? -1,
      polyline,
      lengthKm: computePolylineLength(polyline),
    };

    edges.push(edge);
    totalKept++;

    if (totalRead % 50000 === 0) {
      console.log(
        `[extract-raw-edges] Read ${totalRead} features, kept ${totalKept}...`,
      );
    }
  }

  console.log(
    `[extract-raw-edges] Complete: ${totalRead} total, ${totalKept} kept (${((totalKept / totalRead) * 100).toFixed(1)}%)`,
  );

  const byFcode: Record<number, number> = {};
  for (const e of edges) {
    byFcode[e.fcode] = (byFcode[e.fcode] ?? 0) + 1;
  }
  for (const [fcode, count] of Object.entries(byFcode).sort(
    (a, b) => +a[0] - +b[0],
  )) {
    const label = FCODE_LABELS[+fcode] ?? "Unknown";
    const totalKm = edges
      .filter((e) => e.fcode === +fcode)
      .reduce((s, e) => s + e.lengthKm, 0);
    console.log(
      `  FCODE ${fcode} (${label}): ${count} arcs, ${totalKm.toFixed(1)} km`,
    );
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(edges, null, 2));
  console.log(`[extract-raw-edges] Written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[extract-raw-edges] Fatal:", err);
  process.exit(1);
});
