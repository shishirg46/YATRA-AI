/**
 * lib/destinations/nominatim.ts
 * Nominatim API integration for reverse geocoding and place lookups
 * Using OpenStreetMap data
 */

export interface NominatimAddress {
  amenity?: string;
  boundary?: string;
  place?: string;
  county?: string;
  city?: string;
  municipality?: string;
  city_district?: string;
  state_district?: string;
  state?: string;
  region?: string;
  country?: string;
  postcode?: string;
}

export interface NominatimResult {
  place_id: number;
  osm_id: number;
  osm_type: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  display_name: string;
  address?: NominatimAddress;
  importance: number;
  extratags?: Record<string, string>;
}

/**
 * Search for a place by name
 */
export async function searchPlace(
  query: string,
  options?: { limit?: number; countrycodes?: string }
): Promise<NominatimResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(options?.limit ?? 10),
    addressdetails: "1",
  });

  if (options?.countrycodes) {
    params.append("countrycodes", options.countrycodes);
  }

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "YatraAI/1.0 (destination-enrichment)",
      },
    });

    if (!response.ok) {
      console.error(`Nominatim search failed: ${response.status}`);
      return [];
    }

    return (await response.json()) as NominatimResult[];
  } catch (error) {
    console.error("Nominatim search error:", error);
    return [];
  }
}

/**
 * Reverse geocode coordinates to find place information
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  options?: { zoom?: number }
): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "jsonv2",
    zoom: String(options?.zoom ?? 10),
    addressdetails: "1",
  });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "YatraAI/1.0 (destination-enrichment)",
      },
    });

    if (!response.ok) {
      console.error(`Nominatim reverse geocoding failed: ${response.status}`);
      return null;
    }

    return (await response.json()) as NominatimResult;
  } catch (error) {
    console.error("Nominatim reverse geocoding error:", error);
    return null;
  }
}

/**
 * Extract Nepal region from Nominatim address
 */
export function extractNepalRegion(address?: NominatimAddress) {
  if (!address) return null;

  return {
    province: address.state ?? address.region,
    district: address.state_district ?? address.county ?? address.city_district,
    municipality: address.municipality ?? address.city,
  };
}

/**
 * Validate if coordinates are within Nepal bounds
 * Nepal bounds: ~26.3°N to ~30.5°N, ~80.0°E to ~88.2°E
 */
export function isInNepal(lat: number, lng: number): boolean {
  return lat >= 26.3 && lat <= 30.5 && lng >= 80.0 && lng <= 88.2;
}

/**
 * Calculate distance between two coordinates in kilometers
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
