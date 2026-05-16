/**
 * lib/destinations/geonames.ts
 * GeoNames API integration for additional place data
 * GeoNames is a geographical database with alternative names and additional metadata
 */

export interface GeoName {
  geonameId: number;
  name: string;
  asciiname: string;
  alternateNames: string[];
  latitude: number;
  longitude: number;
  featureClass: string;
  featureCode: string;
  countryCode: string;
  population: number;
  elevation: number | null;
  timezone: string;
}

export interface GeoNamesSearchResponse {
  totalResultsCount: number;
  geonames: Array<{
    geonameId: number;
    name: string;
    asciiname: string;
    lat: string;
    lng: string;
    featureClass: string;
    featureCode: string;
    countryCode: string;
    countryName: string;
    adminCode1: string;
    adminName1: string;
    adminCode2: string;
    adminName2: string;
    population: number;
    elevation: number | null;
    timezone: string;
  }>;
}

const GEONAMES_USERNAME = "yatrai"; // Using demo account - should be configured

/**
 * Search GeoNames for a place
 * Note: Uses free GeoNames API which has rate limits
 */
export async function searchGeoNames(
  name: string,
  options?: { country?: string; featureClass?: string }
): Promise<GeoName[]> {
  const params = new URLSearchParams({
    q: name,
    username: GEONAMES_USERNAME,
    type: "json",
    maxRows: "10",
  });

  if (options?.country) {
    params.append("countryBias", options.country);
  }
  if (options?.featureClass) {
    params.append("featureClass", options.featureClass);
  }

  try {
    const response = await fetch(
      `http://api.geonames.org/searchJSON?${params}`,
      {
        headers: {
          "User-Agent": "YatraAI/1.0 (destination-enrichment)",
        },
      }
    );

    if (!response.ok) {
      console.error(`GeoNames search failed: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as GeoNamesSearchResponse;
    return data.geonames?.map((g) => ({
      geonameId: g.geonameId,
      name: g.name,
      asciiname: g.asciiname,
      alternateNames: [],
      latitude: parseFloat(g.lat),
      longitude: parseFloat(g.lng),
      featureClass: g.featureClass,
      featureCode: g.featureCode,
      countryCode: g.countryCode,
      population: g.population,
      elevation: g.elevation,
      timezone: g.timezone,
    })) ?? [];
  } catch (error) {
    console.error("GeoNames search error:", error);
    return [];
  }
}

/**
 * Get detailed information about a place by geonameId
 */
export async function getGeoNameDetails(geonameId: number): Promise<GeoName | null> {
  const params = new URLSearchParams({
    geonameId: String(geonameId),
    username: GEONAMES_USERNAME,
    type: "json",
  });

  try {
    const response = await fetch(
      `http://api.geonames.org/getJSON?${params}`,
      {
        headers: {
          "User-Agent": "YatraAI/1.0 (destination-enrichment)",
        },
      }
    );

    if (!response.ok) {
      console.error(`GeoNames getJSON failed: ${response.status}`);
      return null;
    }

    const g = await response.json();

    if (g.status?.message) {
      // Error response
      console.error(`GeoNames error: ${g.status.message}`);
      return null;
    }

    return {
      geonameId: g.geonameId,
      name: g.name,
      asciiname: g.asciiname,
      alternateNames: g.alternateNames?.split(",") ?? [],
      latitude: g.lat,
      longitude: g.lng,
      featureClass: g.featureClass,
      featureCode: g.featureCode,
      countryCode: g.countryCode,
      population: g.population,
      elevation: g.elevation,
      timezone: g.timezone,
    };
  } catch (error) {
    console.error("GeoNames getJSON error:", error);
    return null;
  }
}

/**
 * Feature class to destination category mapping
 */
export function featureClassToCategory(
  featureClass: string,
  featureCode: string
): string | null {
  // Mapping from GeoNames feature classification to our categories
  const mapping: Record<string, string> = {
    "P": "MUNICIPALITY", // Populated place
    "H": "LAKE", // Hydrographic
    "T": "HILL", // Terrain
    "S": "TOURIST_ATTRACTION", // Spot/Building
    "R": "OTHER", // Road/Railroad
    "L": "FOREST", // Locality
  };

  // More specific mapping for feature codes
  const featureCodeMapping: Record<string, string> = {
    "LKSPRB": "LAKE",
    "MT": "HILL",
    "TMPL": "TEMPLE",
    "RUIN": "TOURIST_ATTRACTION",
    "FRM": "TOURIST_ATTRACTION",
    "CMPF": "CAMP",
  };

  return featureCodeMapping[featureCode] ?? mapping[featureClass] ?? null;
}
