/**
 * Checks if DHM API can provide weather data for destinations
 * DHM API: https://dhm.gov.np/mfd/api/forecast
 */

import { readFile } from "fs/promises";
import path from "path";

interface Destination {
  province: string;
  district: string;
  name: string;
  lat: number;
  lng: number;
  alt: number;
}

interface CheckResult {
  destination: string;
  district: string;
  lat: number;
  lng: number;
  valid: boolean;
  reason: string;
  weatherAvailable: boolean;
}

async function fetchWeatherAvailable(lat: number, lon: number): Promise<boolean> {
  const url = `https://dhm.gov.np/mfd/api/forecast?lat=${lat}&lng=${lon}`;

  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.hourly_forecast && data.hourly_forecast.length > 0);
  } catch {
    return false;
  }
}

async function main() {
  const files = [
    "scripts/destinations/bagmati.json",
    "scripts/destinations/gandaki.json",
    "scripts/destinations/koshi.json",
    "scripts/destinations/lumbini.json",
    "scripts/destinations/madhesh.json",
    "scripts/destinations/karnali.json",
    "scripts/destinations/sudurpashchim.json",
  ];
  const destinations = (
    await Promise.all(
      files.map(async (file) => {
        const payload = await readFile(path.resolve(process.cwd(), file), "utf8");
        return JSON.parse(payload) as Destination[];
      })
    )
  ).flat();

  console.log(`Checking ${destinations.length} destination coordinates for DHM weather availability...\n`);

  const results: CheckResult[] = [];

  for (const dest of destinations) {
    const result: CheckResult = {
      destination: dest.name,
      district: dest.district,
      lat: dest.lat,
      lng: dest.lng,
      valid: true,
      reason: "OK",
      weatherAvailable: false,
    };

    if (dest.lat === 0 && dest.lng === 0) {
      result.valid = false;
      result.reason = "Invalid placeholder coordinates 0,0";
      results.push(result);
      continue;
    }

    if (dest.lat < 24 || dest.lat > 31 || dest.lng < 80 || dest.lng > 89) {
      result.valid = false;
      result.reason = "Coordinates appear outside Nepal bounds";
      results.push(result);
      continue;
    }

    const available = await fetchWeatherAvailable(dest.lat, dest.lng);
    result.weatherAvailable = available;

    if (!available) {
      result.valid = false;
      result.reason = "DHM API not returning data for this coordinate";
    }

    results.push(result);
  }

  const bad = results.filter((r) => !r.valid);
  const good = results.filter((r) => r.valid && r.weatherAvailable);

  console.log(`Completed check. ${good.length} locations have DHM weather data.`);
  console.log(`${bad.length} locations need review.`);

  for (const item of bad) {
    console.log(`\n- ${item.destination} (${item.district})`);
    console.log(`  Coordinates: ${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}`);
    console.log(`  Reason: ${item.reason}`);
  }

  process.exit(bad.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
