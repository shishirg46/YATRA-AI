export interface DynamicRouteRequest {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
}

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface DynamicRoute {
  id: string;
  name: string;
  distance: number;
  duration: number;
  points: RoutePoint[];
  sampledPoints: RoutePoint[];
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
}

interface OsrmResponse {
  code?: string;
  routes?: OsrmRoute[];
}

interface OrsFeature {
  properties?: {
    summary?: {
      distance?: number;
      duration?: number;
    };
    segments?: Array<{
      distance?: number;
      duration?: number;
    }>;
  };
  geometry?: {
    coordinates?: [number, number][];
  };
}

interface OrsResponse {
  features?: OrsFeature[];
}

export function sampleRoutePoints(points: RoutePoint[], step = 10): RoutePoint[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const safeStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 10;
  return points.filter((_, index) => index % safeStep === 0);
}

function toRouteName(index: number): string {
  return index === 0 ? "Primary Route" : `Alternative Route ${index}`;
}

function toDynamicRoute(index: number, distance: number, duration: number, coordinates: [number, number][]): DynamicRoute {
  const points = coordinates.map(([lon, lat]) => ({ lat, lon }));
  return {
    id: `route_${index + 1}`,
    name: toRouteName(index),
    distance: Math.round(distance),
    duration: Math.round(duration),
    points,
    sampledPoints: sampleRoutePoints(points, 10),
  };
}

async function fetchOsrmRoutes(input: DynamicRouteRequest): Promise<DynamicRoute[]> {
  const url = `http://router.project-osrm.org/route/v1/driving/${input.startLon},${input.startLat};${input.endLon},${input.endLat}?alternatives=true&overview=full&geometries=geojson`;

  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`OSRM request failed with status ${res.status}`);
  }

  const data = (await res.json()) as OsrmResponse;
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("OSRM returned no routes");
  }

  return data.routes.map((route, index) =>
    toDynamicRoute(index, route.distance, route.duration, route.geometry.coordinates)
  );
}

async function fetchOrsRoutes(input: DynamicRouteRequest): Promise<DynamicRoute[]> {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTESERVICE_API_KEY is missing");
  }

  const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${input.startLon},${input.startLat}&end=${input.endLon},${input.endLat}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouteService request failed with status ${res.status}`);
  }

  const data = (await res.json()) as OrsResponse;
  const features = Array.isArray(data.features) ? data.features : [];
  if (!features.length) {
    throw new Error("OpenRouteService returned no routes");
  }

  return features
    .map((feature, index) => {
      const coords = feature.geometry?.coordinates ?? [];
      if (!coords.length) return null;

      const summary = feature.properties?.summary;
      const firstSeg = feature.properties?.segments?.[0];
      const distance = summary?.distance ?? firstSeg?.distance ?? 0;
      const duration = summary?.duration ?? firstSeg?.duration ?? 0;

      return toDynamicRoute(index, distance, duration, coords);
    })
    .filter((r): r is DynamicRoute => r !== null);
}

export async function generateDynamicRoutes(input: DynamicRouteRequest): Promise<{ routes: DynamicRoute[] }> {
  try {
    const routes = await fetchOsrmRoutes(input);
    return { routes };
  } catch (osrmErr) {
    try {
      const routes = await fetchOrsRoutes(input);
      if (!routes.length) throw new Error("OpenRouteService returned no usable route");
      return { routes };
    } catch (orsErr) {
      throw new Error(`OSRM failed (${String(osrmErr)}); OpenRouteService failed (${String(orsErr)})`);
    }
  }
}
