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
  fallback?: {
    lat: number;
    lon: number;
    distanceKm: number;
  };
  weatherAvailable: boolean;
}

function deg2rad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchWeatherAvailable(lat: number, lon: number): Promise<boolean> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("timezone", "UTC");

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.current_weather);
  } catch {
    return false;
  }
}

async function findNearbyWeatherPoint(lat: number, lon: number): Promise<{ lat: number; lon: number; distanceKm: number } | null> {
  const offsets = [0.05, 0.1, 0.2, 0.4];
  for (const d of offsets) {
    for (const latSign of [1, -1]) {
      for (const lonSign of [1, -1]) {
        const candidateLat = lat + latSign * d;
        const candidateLon = lon + lonSign * d;
        const available = await fetchWeatherAvailable(candidateLat, candidateLon);
        if (available) {
          return {
            lat: candidateLat,
            lon: candidateLon,
            distanceKm: haversineKm(lat, lon, candidateLat, candidateLon),
          };
        }
      }
    }
  }
  return null;
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

  console.log(`Checking ${destinations.length} destination coordinates for weather availability...\n`);

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
    }

    const available = await fetchWeatherAvailable(dest.lat, dest.lng);
    result.weatherAvailable = available;

    if (!available) {
      const fallback = await findNearbyWeatherPoint(dest.lat, dest.lng);
      if (fallback) {
        result.valid = false;
        result.reason = "Original coordinate had no accessible weather data; fallback found nearby";
        result.fallback = fallback;
      } else {
        result.valid = false;
        result.reason = "No accessible nearby weather data found";
      }
    }

    results.push(result);
  }

  const bad = results.filter((r) => !r.valid);
  const good = results.filter((r) => r.valid && r.weatherAvailable);

  console.log(`Completed check. ${good.length} locations have weather data at the given coordinate.`);
  console.log(`${bad.length} locations need review or fallback coordinates.`);

  for (const item of bad) {
    console.log(`\n- ${item.destination} (${item.district})`);
    console.log(`  JSON coord: ${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}`);
    console.log(`  Reason: ${item.reason}`);
    if (item.fallback) {
      console.log(`  Fallback coord: ${item.fallback.lat.toFixed(6)}, ${item.fallback.lon.toFixed(6)} (≈ ${item.fallback.distanceKm.toFixed(2)} km away)`);
    }
  }

  process.exit(bad.length > 0 ? 0 : 0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
