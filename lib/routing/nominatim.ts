import { isPointInNepal } from "@/lib/routing/geo";

export interface NominatimResult {
  displayName: string;
  lat: number;
  lon: number;
  placeType?: string;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/** Reverse geocode coordinates within Nepal using Nominatim. */
export async function reverseGeocodeNepal(
  lat: number,
  lon: number
): Promise<NominatimResult | null> {
  if (!isPointInNepal(lat, lon)) return null;

  const url = new URL(`${NOMINATIM_BASE}/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "14");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "YatraAI/1.0 (Nepal travel safety; contact@yatraai.local)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      display_name?: string;
      lat?: string;
      lon?: string;
      type?: string;
      address?: { city?: string; town?: string; village?: string; suburb?: string; county?: string };
    };

    const parsedLat = parseFloat(data.lat ?? "");
    const parsedLon = parseFloat(data.lon ?? "");
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) return null;

    const addr = data.address;
    const shortName =
      addr?.village ||
      addr?.town ||
      addr?.suburb ||
      addr?.city ||
      addr?.county ||
      data.display_name?.split(",")[0] ||
      "Unknown place";

    return {
      displayName: data.display_name ?? shortName,
      lat: parsedLat,
      lon: parsedLon,
      placeType: data.type,
    };
  } catch {
    return null;
  }
}

/** Search a place name within Nepal (used for validation, not UI search). */
export async function searchPlaceInNepal(query: string): Promise<NominatimResult | null> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", `${query}, Nepal`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "np");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "YatraAI/1.0 (Nepal travel safety)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string; type?: string }[];
    const hit = rows[0];
    if (!hit) return null;

    const lat = parseFloat(hit.lat ?? "");
    const lon = parseFloat(hit.lon ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isPointInNepal(lat, lon)) return null;

    return {
      displayName: hit.display_name ?? query,
      lat,
      lon,
      placeType: hit.type,
    };
  } catch {
    return null;
  }
}
