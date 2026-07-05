import type { GeoPoint, RoadRoute, RouteCoordinate, RouteInstruction, RouteLeg, VehicleProfile } from "./types";

const ORS_BASE = process.env.OPENROUTESERVICE_URL ?? "https://api.openrouteservice.org/v2";
const OSRM_BASE = process.env.OSRM_URL ?? "http://localhost:5000";
const TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;

const VEHICLE_MAP: Record<VehicleProfile, string> = {
  car: "driving-car",
  motorcycle: "driving-motorcycle",
  jeep: "driving-hgv",
};

type RoutingProvider = "openrouteservice" | "osrm";

function getRoutingProvider(): RoutingProvider {
  const provider = process.env.ROUTING_PROVIDER?.toLowerCase();
  if (provider === "osrm") return "osrm";
  if (provider === "openrouteservice" || provider === "ors") return "openrouteservice";
  return process.env.OPENROUTESERVICE_API_KEY ? "openrouteservice" : "osrm";
}

function getApiKey(): string {
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) throw new Error("OPENROUTESERVICE_API_KEY is not configured");
  return key;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
  externalSignal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const combined = externalSignal
        ? AbortSignal.any([externalSignal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS);
      const res = await fetch(url, {
        ...options,
        signal: combined,
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
  const profile = VEHICLE_MAP[vehicle] ?? "driving-car";
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

function buildOsrmUrl(points: GeoPoint[], alternatives: boolean): string {
  const coordString = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = new URL(`${OSRM_BASE}/route/v1/driving/${coordString}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");
  url.searchParams.set("alternatives", alternatives ? "true" : "false");
  return url.toString();
}

function parseOsrmRoute(route: {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: Array<{
    steps: Array<{
      distance: number;
      duration: number;
      name: string;
      maneuver: { instruction?: string; location: [number, number]; type: string };
    }>;
  }>;
}): RoadRoute {
  const coords: RouteCoordinate[] = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

  const legs: RouteLeg[] = route.legs.map((leg) => ({
    distance: leg.steps.reduce((sum, step) => sum + step.distance, 0),
    duration: leg.steps.reduce((sum, step) => sum + step.duration, 0),
    summary: leg.steps.map((step) => step.maneuver.instruction || step.name || step.maneuver.type).join(" > "),
    steps: leg.steps.map((step) => ({
      text: step.maneuver.instruction || step.name || step.maneuver.type,
      distance: Math.round(step.distance),
      duration: Math.round(step.duration),
      type: step.maneuver.type,
      lat: step.maneuver.location[1],
      lon: step.maneuver.location[0],
      streetName: step.name,
    })),
  }));

  return {
    coordinates: coords,
    distance: Math.round(route.distance),
    duration: Math.round(route.duration),
    encodedPolyline: polylineEncode(coords),
    legs,
  };
}

async function fetchOsrmRoadRoute(
  start: GeoPoint,
  end: GeoPoint,
  vehicle: VehicleProfile,
  options?: { alternatives?: boolean; waypoints?: GeoPoint[] },
  externalSignal?: AbortSignal,
): Promise<RoadRoute[]> {
  const points = [start, ...(options?.waypoints || []), end];
  const url = buildOsrmUrl(points, options?.alternatives ?? false);

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  }, MAX_RETRIES, externalSignal);

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`OSRM API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    code?: string;
    routes?: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
      legs: Array<{
        steps: Array<{
          distance: number;
          duration: number;
          name: string;
          maneuver: { instruction?: string; location: [number, number]; type: string };
        }>;
      }>;
    }>;
  };

  if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
    throw new Error("OSRM returned no routes");
  }

  return data.routes.map(parseOsrmRoute);
}

export async function fetchRoadRoute(
  start: GeoPoint,
  end: GeoPoint,
  vehicle: VehicleProfile = "car",
  options?: { alternatives?: boolean; waypoints?: GeoPoint[] },
  externalSignal?: AbortSignal,
): Promise<RoadRoute[]> {
  const provider = getRoutingProvider();
  if (provider === "osrm") {
    return fetchOsrmRoadRoute(start, end, vehicle, options, externalSignal);
  }

  const points = [start, ...(options?.waypoints || []), end];
  const coordsStr = buildCoordinateString(points);
  const url = buildOrsUrl(vehicle, coordsStr, options?.alternatives ?? false);

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      Accept: "application/json, application/geo+json",
    },
  }, MAX_RETRIES, externalSignal);

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
  waypoints?: GeoPoint[],
  externalSignal?: AbortSignal,
): Promise<RoadRoute> {
  const routes = await fetchRoadRoute(start, end, vehicle, { waypoints }, externalSignal);
  return routes[0];
}
