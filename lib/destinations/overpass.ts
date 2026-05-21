/**
 * lib/destinations/overpass.ts
 * Overpass API integration for querying OpenStreetMap data
 * Covers tourism, trekking, hiking, cultural sites, national parks,
 * protected areas, UNESCO heritage, and all Nepal tourism promoting sectors.
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
const OVERPASS_URL = "https://overpass.openstreetmap.fr/api/interpreter";

function makeBboxStr(bbox: { south: number; west: number; north: number; east: number }): string {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

export async function queryOverpass(
  bbox: { south: number; west: number; north: number; east: number },
  query: string,
  options?: { timeout?: number }
): Promise<OverpassElement[]> {
  const timeout = options?.timeout ?? 180;
  const bboxStr = makeBboxStr(bbox);
  const overpassQuery = `[out:json][timeout:${timeout}];${query};out center;`;

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
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
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["amenity"="place_of_worship"](${b});way["amenity"="place_of_worship"](${b});)`);
}

/**
 * Query for viewpoints in a region
 */
export async function queryViewpoints(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["tourism"="viewpoint"](${b});way["tourism"="viewpoint"](${b});relation["tourism"="viewpoint"](${b});)`);
}

/**
 * Query for lakes in a region
 */
export async function queryLakes(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["natural"="water"]["water"="lake"](${b});way["natural"="water"]["water"="lake"](${b});relation["natural"="water"]["water"="lake"](${b});)`);
}

/**
 * Query for waterfalls in a region
 */
export async function queryWaterfalls(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["waterway"="waterfall"](${b});way["waterway"="waterfall"](${b});)`);
}

/**
 * Query for campsites in a region
 */
export async function queryCampsites(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["tourism"="camp_site"](${b});way["tourism"="camp_site"](${b});)`);
}

/**
 * Query for lodges/hotels in a region
 */
export async function queryLodges(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["tourism"="alpine_hut","tourism"="guest_house","tourism"="hotel","tourism"="hostel"](${b});way["tourism"="alpine_hut","tourism"="guest_house","tourism"="hotel","tourism"="hostel"](${b});)`);
}

/**
 * Query for national parks in a region
 */
export async function queryNationalParks(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(relation["boundary"="national_park"](${b});way["boundary"="national_park"](${b});)`);
}

/**
 * Query for protected areas / conservation areas
 */
export async function queryProtectedAreas(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(relation["boundary"="protected_area"](${b});way["boundary"="protected_area"](${b});node["boundary"="protected_area"](${b});)`);
}

/**
 * Query for UNESCO World Heritage sites and heritage-tagged features
 */
export async function queryUNESCOSites(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["heritage"](${b});way["heritage"](${b});relation["heritage"](${b});node["unesco"](${b});way["unesco"](${b});relation["unesco"](${b});)`);
}

/**
 * Query for historic heritage sites — forts, palaces, ruins, battlefields, memorials
 */
export async function queryHeritageSites(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(
    node["historic"="fort"](${b}); way["historic"="fort"](${b});
    node["historic"="palace"](${b}); way["historic"="palace"](${b});
    node["historic"="ruins"](${b}); way["historic"="ruins"](${b});
    node["historic"="battlefield"](${b}); way["historic"="battlefield"](${b});
    node["historic"="memorial"](${b}); way["historic"="memorial"](${b});
    node["historic"="monument"](${b}); way["historic"="monument"](${b});
    node["historic"="archaeological_site"](${b}); way["historic"="archaeological_site"](${b});
  )`);
}

/**
 * Query for trekking routes / hiking trails (relations and ways)
 */
export async function queryTrekkingRoutes(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(
    relation["route"="hiking"](${b});
    relation["route"="trekking"](${b});
    relation["route"="foot"](${b});
    way["route"="hiking"](${b});
    way["route"="trekking"](${b});
  )`);
}

/**
 * Query for nature reserves and wildlife reserves
 */
export async function queryNatureReserves(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["leisure"="nature_reserve"](${b});way["leisure"="nature_reserve"](${b});relation["leisure"="nature_reserve"](${b});)`);
}

/**
 * Query for caves, hot springs, and glaciers (natural attractions)
 */
export async function queryNaturalAttractions(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(
    node["natural"="cave_entrance"](${b});
    node["natural"="hot_spring"](${b}); way["natural"="hot_spring"](${b});
    node["natural"="glacier"](${b}); way["natural"="glacier"](${b}); relation["natural"="glacier"](${b});
    node["natural"="valley"](${b});
    node["natural"="ridge"](${b});
    node["natural"="cliff"](${b}); way["natural"="cliff"](${b});
    node["natural"="plateau"](${b}); way["natural"="plateau"](${b});
  )`);
}

/**
 * Query for monasteries and gompas
 */
export async function queryMonasteries(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(node["amenity"="monastery"](${b});way["amenity"="monastery"](${b});relation["amenity"="monastery"](${b});)`);
}

/**
 * Query for rivers, streams, and major water bodies used as tourism landmarks
 */
export async function queryTourismWaterBodies(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(
    way["waterway"="river"](${b}); relation["waterway"="river"](${b});
    node["natural"="water"]["water"="pond"](${b}); way["natural"="water"]["water"="pond"](${b});
    node["natural"="water"]["water"="reservoir"](${b}); way["natural"="water"]["water"="reservoir"](${b});
    node["natural"="water"]["water"="oxbow"](${b}); way["natural"]["water"="oxbow"](${b});
  )`);
}

/**
 * Query for gardens, public parks, and recreation areas
 */
export async function queryGardensParks(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(
    node["leisure"="garden"](${b}); way["leisure"="garden"](${b});
    node["leisure"="park"](${b}); way["leisure"="park"](${b});
    node["leisure"="recreation_ground"](${b}); way["leisure"="recreation_ground"](${b});
    node["leisure"="playground"](${b}); way["leisure"="playground"](${b});
  )`);
}

/**
 * Query for world heritage sites through the protect-class/protect_id mechanism
 */
export async function queryProtectedHeritage(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<OverpassElement[]> {
  const b = makeBboxStr(bbox);
  return queryOverpass(bbox, `(
    node["protect_class"="1"](${b}); way["protect_class"="1"](${b}); relation["protect_class"="1"](${b});
    node["protect_class"="2"](${b}); way["protect_class"="2"](${b}); relation["protect_class"="2"](${b});
    node["protect_class"="3"](${b}); way["protect_class"="3"](${b}); relation["protect_class"="3"](${b});
  )`); // protect_class 1=IA/Strict Nature Reserve, 2=National Park, 3=Natural Monument
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
  return element.tags.name ?? element.tags["name:en"] ?? element.tags.ref ?? `${element.type}-${element.id}`;
}

/**
 * Get a short description from tags
 */
export function getElementDescription(element: OverpassElement): string | null {
  return element.tags.description ?? element.tags["name:en"] ?? null;
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
