import { haversineKm, isPointInNepal } from "@/lib/routing/geo";

export interface NominatimResult {
  displayName: string;
  lat: number;
  lon: number;
  placeType?: string;
  shortName: string;
  address?: { city?: string; town?: string; village?: string; suburb?: string; county?: string; municipality?: string; hamlet?: string; city_district?: string };
}

const NOMINATIM_BASE = process.env.NOMINATIM_URL || process.env.NEXT_PUBLIC_NOMINATIM_URL || "http://localhost:8080";
const NOMINATIM_TIMEOUT_MS = 10000;
const NOMINATIM_HEADERS = {
  "User-Agent": "YatraAI/1.0 (Nepal travel safety; contact@yatraai.local)",
};

let nominatimWarningAt = 0;
function warnNominatimFailure(err: unknown) {
  const now = Date.now();
  if (now - nominatimWarningAt < 60_000) return;
  nominatimWarningAt = now;
  console.warn("[nominatim] reverse geocode failed:", err instanceof Error ? err.message : err);
}

async function fetchNominatimJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: NOMINATIM_HEADERS,
        signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          warnNominatimFailure(new Error(`HTTP ${res.status}`));
          return null;
        }
        continue;
      }
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === 1) {
        warnNominatimFailure(err);
        return null;
      }
    }
  }
  return null;
}

/** Reverse geocode coordinates within Nepal using Nominatim. */
export async function reverseGeocodeNepal(
  lat: number,
  lon: number
): Promise<NominatimResult | null> {
  if (!isPointInNepal(lat, lon)) return null;

  const url = new URL(`${NOMINATIM_BASE}/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "14");
  url.searchParams.set("accept-language", "en");

  const data = await fetchNominatimJson<{
    display_name?: string;
    lat?: string;
    lon?: string;
    type?: string;
    address?: { city?: string; town?: string; village?: string; municipality?: string; suburb?: string; county?: string; city_district?: string };
  }>(url.toString());

  if (!data) return null;

  const parsedLat = parseFloat(data.lat ?? "");
  const parsedLon = parseFloat(data.lon ?? "");
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) return null;

  const addr = data.address;
  const shortName =
    addr?.village ||
    addr?.town ||
    addr?.city_district ||
    addr?.suburb ||
    addr?.city ||
    addr?.municipality ||
    addr?.county ||
    data.display_name?.split(",")[0] ||
    "Unknown place";

  return {
    displayName: data.display_name ?? shortName,
    lat: parsedLat,
    lon: parsedLon,
    placeType: data.type,
    shortName,
    address: addr,
  };
}

export interface HospitalResult {
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  osmId?: string;
  osmType?: string;
}

/**
 * Search for hospitals near a location in Nepal using Nominatim.
 * Returns up to `limit` hospitals sorted by relevance.
 */
export async function searchHospitalsNear(
  lat: number,
  lon: number,
  limit = 3,
): Promise<HospitalResult[]> {
  if (!isPointInNepal(lat, lon)) return [];

  const viewbox = `${lon - 0.15},${lat - 0.15},${lon + 0.15},${lat + 0.15}`;
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("q", "hospital");
  url.searchParams.set("countrycodes", "np");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("bounded", "1");
  url.searchParams.set("viewbox", viewbox);
  url.searchParams.set("extratags", "1");
  url.searchParams.set("accept-language", "en");

  const data = await fetchNominatimJson<
    {
      display_name?: string;
      lat?: string;
      lon?: string;
      type?: string;
      osm_id?: string;
      osm_type?: string;
      distance?: string;
      class?: string;
      extratags?: Record<string, string>;
    }[]
  >(url.toString());

  if (!data || !Array.isArray(data)) return [];

  const results: HospitalResult[] = [];
  for (const hit of data) {
    const hLat = parseFloat(hit.lat ?? "");
    const hLon = parseFloat(hit.lon ?? "");
    if (!Number.isFinite(hLat) || !Number.isFinite(hLon)) continue;

    const name = hit.display_name?.split(",")[0]?.trim();
    if (!name) continue;

    results.push({
      name,
      lat: hLat,
      lon: hLon,
      distanceKm: haversineKm(lat, lon, hLat, hLon),
      osmId: hit.osm_id,
      osmType: hit.osm_type,
    });
  }

  results.sort((a, b) => a.distanceKm - b.distanceKm);
  return results.slice(0, limit);
}

/** Search a place name within Nepal (used for validation, not UI search). */
export async function searchPlaceInNepal(query: string): Promise<NominatimResult | null> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", `${query}, Nepal`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "np");
  url.searchParams.set("accept-language", "en");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "YatraAI/1.0 (Nepal travel safety)",
      },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string; type?: string; address?: Record<string, string> }[];
    const hit = rows[0];
    if (!hit) return null;

    const lat = parseFloat(hit.lat ?? "");
    const lon = parseFloat(hit.lon ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isPointInNepal(lat, lon)) return null;

    const addr = hit.address as NominatimResult["address"] | undefined;
    return {
      displayName: hit.display_name ?? query,
      lat,
      lon,
      placeType: hit.type,
      shortName: addr?.village || addr?.town || addr?.city || query,
      address: addr,
    };
  } catch (err) {
    console.warn("[nominatim] search failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
