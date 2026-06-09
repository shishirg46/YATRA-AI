import type { GeoPoint, RoadRoute, RouteCoordinate, RouteInstruction, RouteLeg, VehicleProfile } from "./types";

const ORS_BASE = "https://api.openrouteservice.org/v2";
const TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;

const VEHICLE_MAP: Record<VehicleProfile, string> = {
  car: "driving-car",
  motorcycle: "driving-motorcycle",
  jeep: "driving-hgv",
};

function getApiKey(): string {
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) throw new Error("OPENROUTESERVICE_API_KEY is not configured");
  return key;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error("Request failed after retries");
}

function polylineEncode(points: RouteCoordinate[]): string {
  if (!points.length) return "";
  let result = "";
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    const dLat = Math.round((p.lat - lat) * 1e5);
    const dLon = Math.round((p.lon - lon) * 1e5);
    lat = p.lat;
    lon = p.lon;
    for (const val of [dLat, dLon]) {
      let v = val < 0 ? ~(val << 1) : val << 1;
      while (v >= 0x20) {
        result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      result += String.fromCharCode(v + 63);
    }
  }
  return result;
}

interface OrsDirectionResponse {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "LineString";
      coordinates: [number, number][];
    };
    properties: {
      summary: {
        distance: number;
        duration: number;
      };
      segments: Array<{
        distance: number;
        duration: number;
        steps: Array<{
          distance: number;
          duration: number;
          type: number;
          instruction: string;
          name: string;
          way_points: [number, number];
          exit_number?: number;
        }>;
      }>;
      ascent?: number;
      descent?: number;
    };
  }>;
  metadata?: {
    query?: Record<string, unknown>;
  };
}

const INSTRUCTION_TYPE_MAP: Record<number, string> = {
  0: "turn",
  1: "turn",
  2: "turn",
  3: "turn",
  4: "turn",
  5: "turn",
  6: "turn",
  7: "turn",
  8: "turn",
  9: "roundabout",
  10: "roundabout",
  11: "roundabout",
  12: "fork",
  13: "merge",
  14: "depart",
  15: "arrive",
};

function parseOrsRoute(feature: OrsDirectionResponse["features"][0]): RoadRoute {
  const coords: RouteCoordinate[] = feature.geometry.coordinates.map(([lon, lat]) => ({
    lat,
    lon,
  }));

  const summary = feature.properties.summary;
  const segments = feature.properties.segments || [];

  const legs: RouteLeg[] = segments.map((seg) => ({
    distance: seg.distance,
    duration: seg.duration,
    summary: seg.steps.map((s) => s.instruction).join(" > "),
    steps: seg.steps.map((step) => ({
      text: step.instruction,
      distance: Math.round(step.distance),
      duration: Math.round(step.duration),
      type: INSTRUCTION_TYPE_MAP[step.type] || "turn",
      lat: coords[step.way_points[1]]?.lat ?? coords[0]?.lat ?? 0,
      lon: coords[step.way_points[1]]?.lon ?? coords[0]?.lon ?? 0,
      sign: String(step.type),
      streetName: step.name,
    })),
  }));

  return {
    coordinates: coords,
    distance: Math.round(summary.distance),
    duration: Math.round(summary.duration),
    encodedPolyline: polylineEncode(coords),
    legs,
    elevation: feature.properties.ascent !== undefined
      ? [feature.properties.ascent, feature.properties.descent ?? 0]
      : undefined,
  };
}

function buildCoordinateString(points: GeoPoint[]): string {
  return points.map((p) => `${p.lon},${p.lat}`).join("|");
}

function buildOrsUrl(vehicle: VehicleProfile, coordinates: string, alternatives: boolean): string {
  const profile = VEHICLE_MAP[vehicle];
  const parts = coordinates.split("|");
  let url = `${ORS_BASE}/directions/${profile}?api_key=${getApiKey()}&start=${parts[0]}&end=${parts.slice(-1)[0]}`;

  if (parts.length > 2) {
    const intermediates = parts.slice(1, -1).join("|");
    url += `&intermediates=${intermediates}`;
  }

  url += `&radiuses=${parts.map(() => "5000").join("|")}`;

  if (alternatives) {
    url += "&alternative_routes=true&alternative_routes.target_count=3";
  }

  url += "&instructions_format=text&units=m";
  return url;
}

export async function fetchRoadRoute(
  start: GeoPoint,
  end: GeoPoint,
  vehicle: VehicleProfile = "car",
  options?: { alternatives?: boolean; waypoints?: GeoPoint[] }
): Promise<RoadRoute[]> {
  const points = [start, ...(options?.waypoints || []), end];
  const coordsStr = buildCoordinateString(points);
  const url = buildOrsUrl(vehicle, coordsStr, options?.alternatives ?? false);

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      Accept: "application/json, application/geo+json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`OpenRouteService API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as OrsDirectionResponse;

  if (!data.features?.length) {
    throw new Error("OpenRouteService returned no routes");
  }

  return data.features.map(parseOrsRoute);
}

export async function fetchRouteWithAlternatives(
  start: GeoPoint,
  end: GeoPoint,
  vehicle: VehicleProfile = "car",
  waypoints?: GeoPoint[]
): Promise<RoadRoute[]> {
  return fetchRoadRoute(start, end, vehicle, { alternatives: true, waypoints });
}

export async function computeDetourRoute(
  from: GeoPoint,
  via: GeoPoint,
  to: GeoPoint,
  vehicle: VehicleProfile = "car"
): Promise<{ mainDistance: number; mainDuration: number; detourDistance: number; detourDuration: number; detourRoute: RoadRoute }> {
  const mainRoute = await fetchRoadRoute(from, to, vehicle);
  const detourRoute = await fetchRoadRoute(from, to, vehicle, { waypoints: [via] });

  const main = mainRoute[0];
  const detour = detourRoute[0];

  return {
    mainDistance: main.distance,
    mainDuration: main.duration,
    detourDistance: detour.distance,
    detourDuration: detour.duration,
    detourRoute: detour,
  };
}

export async function fetchRouteGeometry(
  start: GeoPoint,
  end: GeoPoint,
  vehicle: VehicleProfile = "car",
  waypoints?: GeoPoint[]
): Promise<RoadRoute> {
  const routes = await fetchRoadRoute(start, end, vehicle, { waypoints });
  return routes[0];
}
