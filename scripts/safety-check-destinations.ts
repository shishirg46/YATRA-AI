#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const NEPAL = { minLat: 26.3, maxLat: 30.5, minLng: 80.0, maxLng: 88.2 };

// Border buffer: keep entries within 0.5° of Nepal bounds
const BORDER_BUFFER = 0.5;

function findProvinceFromCoords(lat: number, lon: number): string {
  if (lat >= 29.5) return "Sudurpashchim";
  if (lat >= 28.8) return lon >= 83.5 ? "Karnali" : "Sudurpashchim";
  if (lat >= 28.0) return lon >= 84.5 ? "Gandaki" : "Karnali";
  if (lat >= 27.5) return lon >= 85.5 ? "Bagmati" : (lon >= 84.0 ? "Gandaki" : "Lumbini");
  if (lat >= 27.0) return lon >= 85.5 ? "Bagmati" : (lon >= 84.0 ? "Gandaki" : "Lumbini");
  if (lon >= 86.5) return "Koshi";
  if (lon >= 85.0) return "Bagmati";
  if (lon >= 84.0) return "Madhesh";
  return "Lumbini";
}

function isInNepal(lat: number, lon: number): boolean {
  return lat >= NEPAL.minLat && lat <= NEPAL.maxLat &&
         lon >= NEPAL.minLng && lon <= NEPAL.maxLng;
}

function isNearBorder(lat: number, lon: number): boolean {
  return lat >= NEPAL.minLat - BORDER_BUFFER && lat <= NEPAL.maxLat + BORDER_BUFFER &&
         lon >= NEPAL.minLng - BORDER_BUFFER && lon <= NEPAL.maxLng + BORDER_BUFFER;
}

const VALID_PROVINCES = new Set(["Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim", "Unknown"]);

// Keep these even if slightly outside Nepal (border peaks/rivers)
const BORDER_ALLOW = new Set([
  "Mount Everest", "Jomolhari", "Tirsuli", "West Rapti River",
  "Bagmati River", "Gandaki River", "Kamala River", "Mahananda River",
]);

async function main() {
  const inputPath = join(__dirname, "data", "destinations.json");
  const raw = JSON.parse(readFileSync(inputPath, "utf-8"));
  const dests = raw.destinations as any[];

  console.log(`\n=== Safety Check Report ===\n`);
  console.log(`Total: ${dests.length}\n`);

  const removed: string[] = [];
  const provinceFixed: string[] = [];
  const kept: any[] = [];

  for (const d of dests) {
    const inNepal = isInNepal(d.latitude, d.longitude);
    const nearBorder = isNearBorder(d.latitude, d.longitude);
    const expectedProvince = findProvinceFromCoords(d.latitude, d.longitude);

    // 1. Remove entries clearly outside Nepal (not even near border)
    if (!inNepal && !nearBorder && !BORDER_ALLOW.has(d.name)) {
      removed.push(`${d.name} (${d.latitude}, ${d.longitude}) — outside Nepal`);
      continue;
    }

    // 2. Fix province if it doesn't match coordinates
    const currentProvince = d.province || "Unknown";
    if (currentProvince !== "Unknown" && currentProvince !== expectedProvince &&
        VALID_PROVINCES.has(currentProvince) && VALID_PROVINCES.has(expectedProvince)) {
      provinceFixed.push(`${d.name}: ${currentProvince} → ${expectedProvince}`);
      d.province = expectedProvince;
    }

    // 3. If district is Unknown but in Nepal, set province from coords
    if ((d.district === "Unknown" || !d.district) && inNepal) {
      d.province = expectedProvince;
    }

    kept.push(d);
  }

  console.log(`Removed: ${removed.length}`);
  removed.forEach(r => console.log(`  ✗ ${r}`));

  console.log(`\nProvince fixes: ${provinceFixed.length}`);
  provinceFixed.forEach(r => console.log(`  ~ ${r}`));

  console.log(`\nKept: ${kept.length}`);
  const unknownDist = kept.filter(d => d.district === "Unknown" || !d.district);
  console.log(`Still Unknown district: ${unknownDist.length}`);
  unknownDist.forEach(d => console.log(`  ? ${d.name} (${d.latitude}, ${d.longitude})`));

  // Save
  raw.destinations = kept;
  raw.count = kept.length;
  writeFileSync(inputPath, JSON.stringify(raw, null, 2), "utf-8");
  console.log(`\nSaved ${kept.length} destinations to ${inputPath}`);
}

main().catch(console.error);
