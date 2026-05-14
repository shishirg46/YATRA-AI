import { readFile } from "fs/promises";
import * as path from "path";

interface Destination {
  province: string;
  district: string;
  name: string;
  lat: number;
  lng: number;
  alt: number;
}

interface GeocodeResult {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  elevation?: number;
}

const USER_AGENT = "yatraAI-dest-validation/1.0 (https://example.com)";
const NAME_SUFFIXES = [
  " Rural Municipality",
  " Municipality",
  " Industrial Area",
  " Airport Area",
  " District",
  " Village",
  " Area",
];

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

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildQueryNames(name: string) {
  const variants = [name];

  for (const suffix of NAME_SUFFIXES) {
    if (name.endsWith(suffix)) {
      variants.push(name.slice(0, -suffix.length));
    }
  }

  return uniqueStrings(variants);
}

function buildQueries(dest: Destination) {
  const nameVariants = buildQueryNames(dest.name);
  const districtVariants = uniqueStrings([dest.district, `${dest.district} District`]);
  const provinceVariants = uniqueStrings([dest.province, `${dest.province} Province`]);

  const queries: string[] = [];
  for (const name of nameVariants) {
    for (const district of districtVariants) {
      queries.push(`${name}, ${district}, Nepal`);
    }
    for (const province of provinceVariants) {
      queries.push(`${name}, ${province}, Nepal`);
    }
    queries.push(`${name}, Nepal`);
  }

  return uniqueStrings(queries);
}

async function fetchGeocode(query: string): Promise<GeocodeResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Geocoding API returned ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  if (!Array.isArray(data.results) || data.results.length === 0) {
    return [];
  }

  return data.results.map((item) => ({
    name: String(item.name ?? ""),
    country: String(item.country ?? ""),
    latitude: Number(item.latitude ?? NaN),
    longitude: Number(item.longitude ?? NaN),
    admin1: item.admin1 ? String(item.admin1) : undefined,
    elevation: item.elevation ? Number(item.elevation) : undefined,
  })).filter((item) => !Number.isNaN(item.latitude) && !Number.isNaN(item.longitude));
}

async function fetchNominatim(query: string): Promise<GeocodeResult[]> {
  await sleep(1200);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    if (res.status === 429) {
      await sleep(2000);
      const retry = await fetch(url.toString(), {
        cache: "no-store",
        headers: { "User-Agent": USER_AGENT },
      });
      if (!retry.ok) {
        return [];
      }
      const data = (await retry.json()) as Array<Record<string, unknown>>;
      return data.map((item) => ({
        name: String(item.display_name ?? item.name ?? ""),
        country: getAddressField(item, "country") ?? String(item.country ?? ""),
        latitude: Number(item.lat ?? NaN),
        longitude: Number(item.lon ?? NaN),
        admin1: getAddressField(item, "state"),
        elevation: undefined,
      })).filter((item) => !Number.isNaN(item.latitude) && !Number.isNaN(item.longitude));
    }
    return [];
  }

  const data = (await res.json()) as Array<Record<string, unknown>>;
  return data.map((item) => ({
    name: String(item.display_name ?? item.name ?? ""),
    country: getAddressField(item, "country") ?? String(item.country ?? ""),
    latitude: Number(item.lat ?? NaN),
    longitude: Number(item.lon ?? NaN),
    admin1: getAddressField(item, "state"),
    elevation: undefined,
  })).filter((item) => !Number.isNaN(item.latitude) && !Number.isNaN(item.longitude));
}

function getAddressField(item: Record<string, unknown>, key: string) {
  const address = item.address;
  if (!address || typeof address !== "object") {
    return undefined;
  }

  const value = (address as Record<string, unknown>)[key];
  return value ? String(value) : undefined;
}

async function canFetchWeather(lat: number, lon: number): Promise<boolean> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return false;
  const data = await res.json();
  return !!data?.current_weather;
}

async function findNearbyWeatherPoint(lat: number, lon: number): Promise<{lat:number; lon:number} | null> {
  const offsets = [0.05, 0.1, 0.2, 0.4];
  for (const d of offsets) {
    for (const latSign of [1, -1]) {
      for (const lonSign of [1, -1]) {
        const candidateLat = lat + latSign * d;
        const candidateLon = lon + lonSign * d;
        if (await canFetchWeather(candidateLat, candidateLon)) {
          return { lat: candidateLat, lon: candidateLon };
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

  console.log(`Validating ${destinations.length} destination coordinates using Open-Meteo geocoding...\n`);

  let mismatchCount = 0;

  for (const dest of destinations) {
    const queries = buildQueries(dest);

    let results: GeocodeResult[] = [];
    let usedQuery = "";
    let usedSource = "Open-Meteo";

    for (const query of queries) {
      results = await fetchGeocode(query);
      if (results.length > 0) {
        usedQuery = query;
        break;
      }
    }

    if (results.length === 0) {
      usedSource = "Nominatim";
      for (const query of queries) {
        try {
          results = await fetchNominatim(query);
        } catch (error) {
          console.warn(`   [warning] Nominatim failure for ${query}:`, error);
          results = [];
        }
        if (results.length > 0) {
          usedQuery = query;
          break;
        }
      }
    }

    if (results.length === 0) {
      console.log(`❌ ${dest.name} (${dest.district}) — no geocode match for queries: ${queries.join(" | ")}`);
      continue;
    }

    const ranked = [...results].sort((a, b) => {
      const distanceA = haversineKm(dest.lat, dest.lng, a.latitude, a.longitude);
      const distanceB = haversineKm(dest.lat, dest.lng, b.latitude, b.longitude);
      return distanceA - distanceB;
    });
    const best = ranked[0];
    const distance = haversineKm(dest.lat, dest.lng, best.latitude, best.longitude);
    const isMismatch = distance > 3;

    if (isMismatch) mismatchCount++;

    console.log(`\n${isMismatch ? "⚠️" : "✅"} ${dest.name} (${dest.district})`);
    console.log(`   JSON coord: ${dest.lat.toFixed(6)}, ${dest.lng.toFixed(6)}`);
    console.log(`   Best match: ${best.latitude.toFixed(6)}, ${best.longitude.toFixed(6)} — ${best.name}, ${best.admin1 ?? ""} ${best.country}`);
    console.log(`   Distance: ${distance.toFixed(2)} km`);
    console.log(`   Used query: ${usedQuery}`);

    const sample = ranked.slice(0, 3);
    if (sample.length > 1) {
      console.log(`   nearby matches:`);
      for (const item of sample) {
        const d = haversineKm(dest.lat, dest.lng, item.latitude, item.longitude);
        console.log(`     - ${item.name}, ${item.admin1 ?? ""} ${item.country}: ${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)} (${d.toFixed(2)} km)`);
      }
    }
  }

  console.log(`\nValidation complete. ${mismatchCount} destination(s) differ by > 3 km.`);
  process.exit(mismatchCount > 0 ? 0 : 0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
