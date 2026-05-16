/**
 * lib/destinations/overpass.ts
 * Overpass API integration for querying OpenStreetMap data
 * Useful for finding all destinations of a specific type in a region
 */

export interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

export interface OverpassWay {
  type: "way";
  id: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

export interface OverpassRelation {
  type: "relation";
  id: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export interface OverpassResponse {
  version: number;
  generator: string;
  osm3s: Record<string, unknown>;
  elements: OverpassElement[];
}

/**
 * Run an Overpass query
 * Returns POIs (points of interest) matching the query in the specified bounding box
 */
export async function queryOverpass(
  bbox: { south: number; west: number; north: number; east: number },
  query: string,
  options?: { timeout?: number }
): Promise<OverpassElement[]> {
  const timeout = options?.timeout ?? 30;
  const overpassQuery = `
    [bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
    [timeout:${timeout}];
    ${query};
    out center;
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "YatraAI/1.0 (destination-enrichment)",
      },
      body: overpassQuery,
    });

    if (!response.ok) {
      console.error(`Overpass query failed: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as OverpassResponse;
    return data.elements || [];
  } catch (error) {
    console.error("Overpass query error:", error);
    return [];
  }
}

/**
 * Query for temples in a region
 */
export async function queryTemples(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  return queryOverpass(bbox, '(node["amenity"="place_of_worship"]["religion"="hindu"];way["amenity"="place_of_worship"]["religion"="hindu"];)');
}

/**
 * Query for viewpoints in a region
 */
export async function queryViewpoints(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  return queryOverpass(
    bbox,
    '(node["tourism"="viewpoint"];way["tourism"="viewpoint"];relation["tourism"="viewpoint"];)'
  );
}

/**
 * Query for lakes in a region
 */
export async function queryLakes(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  return queryOverpass(
    bbox,
    '(node["natural"="water"]["water"="lake"];way["natural"="water"]["water"="lake"];relation["natural"="water"]["water"="lake"];)'
  );
}

/**
 * Query for waterfalls in a region
 */
export async function queryWaterfalls(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  return queryOverpass(
    bbox,
    '(node["waterway"="waterfall"];way["waterway"="waterfall"];)'
  );
}

/**
 * Query for campsites in a region
 */
export async function queryCampsites(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  return queryOverpass(
    bbox,
    '(node["tourism"="camp_site"];way["tourism"="camp_site"];)'
  );
}

/**
 * Query for lodges/hotels in a region
 */
export async function queryLodges(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  return queryOverpass(
    bbox,
    '(node["tourism"="alpine_hut","tourism"="guest_house","tourism"="hotel","tourism"="hostel"];way["tourism"="alpine_hut","tourism"="guest_house","tourism"="hotel","tourism"="hostel"];)'
  );
}

/**
 * Extract coordinates from an Overpass element
 */
export function getElementCoordinates(element: OverpassElement): { lat: number; lon: number } | null {
  if (element.type === "node") {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.type === "way" || element.type === "relation") {
    return element.center ?? null;
  }
  return null;
}

/**
 * Extract name and tags from an Overpass element
 */
export function getElementName(element: OverpassElement): string {
  return element.tags.name ?? element.tags."name:en" ?? element.tags.ref ?? `${element.type}-${element.id}`;
}

/**
 * Get a short description from tags
 */
export function getElementDescription(element: OverpassElement): string | null {
  return element.tags.description ?? element.tags."name:en" ?? null;
}

/**
 * Extract main tag indicating the POI type
 */
export function getElementType(element: OverpassElement): string {
  // Check common tag keys in order of priority
  const priorityKeys = [
    "tourism",
    "amenity",
    "natural",
    "waterway",
    "historic",
    "man_made",
    "leisure",
    "shop",
  ];

  for (const key of priorityKeys) {
    if (element.tags[key]) {
      return element.tags[key];
    }
  }

  return "poi";
}

/**
 * Get elevation/altitude if available
 */
export function getElementAltitude(element: OverpassElement): number | null {
  const alt = element.tags.ele;
  if (!alt) return null;
  
  try {
    const meters = parseFloat(alt);
    return isFinite(meters) ? meters : null;
  } catch {
    return null;
  }
}
