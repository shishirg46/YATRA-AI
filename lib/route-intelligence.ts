/**
 * FILE: route-intelligence.ts
 * LOCATION: /lib/route-intelligence.ts
 * PURPOSE: Smart route generation with disaster + weather awareness for Nepal
 * 
 * FEATURES:
 * 1. Generate routes using OSRM/OpenRouteService
 * 2. Multiple route options (fastest, alternative, safer)
 * 3. Nepal-specific route naming
 * 4. Disaster data integration along routes
 * 5. Historical + real-time hazard mapping
 * 6. Route hazard scoring
 * 7. Weather integration for routes
 * 8. Route segmentation analysis
 */

import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import { fetchHistoricalHazard } from "@/lib/collectors/historical-hazard";
import { fetchHistoricalWeather } from "@/lib/collectors/historical-weather";
import { generateDynamicAlerts } from "@/lib/alert-engine";
import { prisma } from "@/lib/prisma";

// ── Types ───────────────────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lon: number;
  name?: string;
}

export interface RouteWaypoint {
  lat: number;
  lon: number;
  name?: string;
  distanceFromStart: number; // meters
}

export interface Route {
  id: string;
  name: string;
  description: string;
  waypoints: RouteWaypoint[];
  distance: number; // meters
  duration: number; // seconds
  riskScore: number; // 0-1
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  hazards: RouteHazards;
  segments: RouteSegment[];
  source: string; // OSRM, OpenRouteService, etc.
}

export interface RouteHazards {
  landslideZones: string[];
  floodZones: string[];
  activeAlerts: string[];
  weatherRisk: string;
  historicalRisk: number;
}

export interface RouteSegment {
  index: number;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  distance: number;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  hazards: string[];
  weather?: string;
  realtime?: {
    floodIndex: number;
    landslideIndex: number;
    earthquakeIndex: number;
    airQuality: number;
    rainfall: number;
    windSpeed: number;
    temperature: number;
  };
  historical?: {
    floodRisk: number;
    landslideRisk: number;
  };
  contributions?: {
    realtime: number;
    historical: number;
    regionalPrior: number;
  };
  evidence?: {
    realtime: {
      hazardSource?: string;
      weatherSource?: string;
      weatherTimestamp?: string;
    };
    historical: {
      source?: string;
      yearsAnalysed?: number;
      notableEvents?: {
        date: string;
        type: string;
        description: string;
        severity: "LOW" | "MEDIUM" | "HIGH";
      }[];
    };
    regionalPrior?: {
      reasons: string[];
    };
  };
  hazardAssessment?: {
    riskPercent: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    breakdown: {
      weather: number;
      realtime: number;
      historical: number;
      terrain: number;
    };
    alerts: string[];
    reason?: string;
  };
}

export interface RouteIntelligenceResult {
  origin: GeoPoint;
  destination: GeoPoint;
  departureDate: string;
  routes: Route[];
  bestRoute: Route | null;
  generatedAt: string;
}

const BREAKPOINT_ANCHORS: [number, number, string][] = [
  [26.6667, 87.6333, "Ratuwamai"],
  [26.6667, 87.6167, "Urlabari"],
  [26.6667, 87.7000, "Damak"],
  [26.6333, 87.8500, "Surunga"],
  [26.6500, 87.9833, "Birtamode"],
  [26.7500, 88.0167, "Charali"],
  [26.8500, 88.0333, "Budhabare"],
  [26.9167, 88.0500, "Kanyam"],
  [26.9500, 88.0667, "Antu Dada"],
  [26.9167, 87.9333, "Ilam"],
];

// ── Nepal Route Naming ───────────────────────────────────────────────────────

const NEPAL_HIGHWAYS: Record<string, { waypoints: [number, number][]; name: string }> = {
  "prithvi": {
    name: "Prithvi Highway",
    waypoints: [
      [27.7172, 85.3240], // Kathmandu
      [27.6333, 85.2833], // Naubise
      [27.5667, 85.1667], // Thankot
      [27.5833, 84.8333], // Mugling
      [27.7500, 84.4167], // Abu Khaireni
      [28.0500, 84.0833], // Beshisahar
      [28.2333, 84.0333], // Besi
      [28.2096, 83.9856], // Pokhara
    ],
  },
  "mahendra": {
    name: "Mahendra Highway",
    waypoints: [
      [27.7172, 85.3240], // Kathmandu
      [27.4667, 85.1000], // Hetauda
      [27.0333, 84.8667], // Birgunj
      [26.8167, 84.8333], // Gajuli
      [26.7333, 85.2667], // Parsa
      [26.8833, 85.5333], // Sunsari
      [26.8000, 86.1333], // Itahari
      [26.4500, 87.0333], // Bhadrapur
    ],
  },
  "karakoram": {
    name: "Karakoram Highway",
    waypoints: [
      [28.2333, 84.0333], // Besi
      [28.8833, 83.8833], // Manang
      [29.1667, 83.9333], // Chame
      [29.5333, 84.0833], // Dharapani
      [29.8833, 84.4167], // Jumla
    ],
  },
  "arniko": {
    name: "Arniko Highway",
    waypoints: [
      [27.7172, 85.3240], // Kathmandu
      [27.9500, 85.4333], // Kodari
      [28.0833, 85.8333], // Rasuwa
      [28.3333, 85.9333], // Timure
      [28.5000, 85.7500], // Nyalam
    ],
  },
  "siddhartha": {
    name: "Siddhartha Highway",
    waypoints: [
      [28.2096, 83.9856], // Pokhara
      [28.3167, 83.7667], // Waling
      [28.0667, 83.2833], // Butwal
      [27.8833, 82.9333], // Bhairahawa
      [27.7000, 82.5500], // Lumbini
      [27.4500, 82.2500], // Sonauli
    ],
  },
  "karnali": {
    name: "Karnali Highway",
    waypoints: [
      [28.9833, 84.4167], // Jumla
      [29.2833, 84.1167], // Mugu
      [29.5333, 83.9333], // Dolpa
    ],
  },
};

// ── Main Function ─────────────────────────────────────────────────────────────

export async function generateRouteIntelligence(
  origin: GeoPoint,
  destination: GeoPoint,
  departureDate: string
): Promise<RouteIntelligenceResult> {

  // Prefer stored route corridors if available.
  const storedRoutes = await fetchStoredRoutes(origin, destination);

  // Generate routes using OSRM if no stored corridor is available.
  const osrmRoutes = storedRoutes.length > 0 ? [] : await fetchOsrmRoutes(origin, destination);

  // If OSRM fails, try OpenRouteService
  let routes: Route[] = storedRoutes.length > 0
    ? storedRoutes
    : (osrmRoutes.length > 0 ? osrmRoutes : await fetchOpenRouteServiceRoutes(origin, destination));
  
  // If both fail, generate fallback route
  if (routes.length === 0) {
    routes = [generateFallbackRoute(origin, destination)];
  }

  // Learn new route template from generated routes.
  if (storedRoutes.length === 0 && routes.length > 0 && routes[0].waypoints.length > 2) {
    await saveRouteTemplate(origin, destination, routes[0]).catch(() => null);
  }

  // Analyze each route for hazards
  const analyzedRoutes = await Promise.all(
    routes.map(async (route) => await analyzeRouteHazards(route, departureDate))
  );

  // Find best route (lowest risk)
  const bestRoute = analyzedRoutes
    .filter(r => r.riskLevel !== "EXTREME")
    .sort((a, b) => a.riskScore - b.riskScore)[0] ?? null;

  return {
    origin,
    destination,
    departureDate,
    routes: analyzedRoutes,
    bestRoute,
    generatedAt: new Date().toISOString(),
  };
}

async function fetchStoredRoutes(origin: GeoPoint, destination: GeoPoint): Promise<Route[]> {
  const prismaAny = prisma as any;
  const [originLoc, destinationLoc] = await Promise.all([
    findNearestLocationWithDistance(origin.lat, origin.lon),
    findNearestLocationWithDistance(destination.lat, destination.lon),
  ]);

  if (!originLoc || !destinationLoc) return [];
  // Only reuse a template when endpoints are actually close to the requested trip.
  // This prevents "hub to destination" templates from being used for arbitrary user origins.
  if (originLoc.distanceKm > 8 || destinationLoc.distanceKm > 12) return [];

  const templates = await prismaAny.routeTemplate.findMany({
    where: {
      originLocationId: originLoc.location.id,
      destinationLocationId: destinationLoc.location.id,
      isActive: true,
    },
    include: {
      points: { orderBy: { seq: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
    take: 2,
  });

  return templates
    .filter((t: any) => Array.isArray(t.points) && t.points.length > 1)
    .map((t: any, idx: number) => {
      const waypoints: RouteWaypoint[] = t.points.map((p: any) => ({
        lat: p.lat,
        lon: p.lon,
        name: p.placeName ?? undefined,
        distanceFromStart: Math.round((p.kmFromStart ?? 0) * 1000),
      }));
      return {
        id: `stored-${t.id}-${idx}`,
        name: t.name ?? `${originLoc.location.name} to ${destinationLoc.location.name} Route`,
        description: `${t.name ?? "Stored route"} via template`,
        waypoints,
        distance: Math.round((t.distanceKm ?? estimateDistanceKm(waypoints)) * 1000),
        duration: Math.max(1800, Math.round(((t.distanceKm ?? estimateDistanceKm(waypoints)) / 35) * 3600)),
        riskScore: 0.5,
        riskLevel: "MEDIUM" as const,
        hazards: {
          landslideZones: [],
          floodZones: [],
          activeAlerts: [],
          weatherRisk: "unknown",
          historicalRisk: 0.5,
        },
        segments: [],
        source: `stored:${t.source ?? "template"}`,
      };
    });
}

async function saveRouteTemplate(origin: GeoPoint, destination: GeoPoint, route: Route): Promise<void> {
  const prismaAny = prisma as any;
  const [originLoc, destinationLoc] = await Promise.all([
    findNearestLocation(origin.lat, origin.lon),
    findNearestLocation(destination.lat, destination.lon),
  ]);

  if (!originLoc || !destinationLoc) return;

  const sampled = sampleWaypoints(route.waypoints, Math.max(1, Math.floor(route.waypoints.length / 16)));
  if (sampled.length < 2) return;

  const template = await prismaAny.routeTemplate.upsert({
    where: {
      originLocationId_destinationLocationId_name: {
        originLocationId: originLoc.id,
        destinationLocationId: destinationLoc.id,
        name: route.name,
      },
    },
    create: {
      originLocationId: originLoc.id,
      destinationLocationId: destinationLoc.id,
      name: route.name,
      distanceKm: route.distance / 1000,
      source: route.source,
      isActive: true,
    },
    update: {
      distanceKm: route.distance / 1000,
      source: route.source,
      isActive: true,
    },
  });

  await prismaAny.routeTemplatePoint.deleteMany({ where: { routeTemplateId: template.id } });

  for (let i = 0; i < sampled.length; i++) {
    const wp = sampled[i];
    const nearest = await findNearestLocation(wp.lat, wp.lon, 8);
    await prismaAny.routeTemplatePoint.create({
      data: {
        routeTemplateId: template.id,
        seq: i,
        lat: wp.lat,
        lon: wp.lon,
        kmFromStart: (wp.distanceFromStart ?? 0) / 1000,
        placeName: nearest?.name ?? wp.name ?? null,
        matchedLocationId: nearest?.id ?? null,
      },
    });
  }
}

async function findNearestLocationWithDistance(
  lat: number,
  lon: number,
  maxKm = 30
): Promise<{ location: { id: string; name: string }; distanceKm: number } | null> {
  const prismaAny = prisma as any;
  const rows = await prismaAny.location.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  let best: { location: { id: string; name: string }; distanceKm: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const d = haversineKm(lat, lon, row.latitude, row.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = { location: { id: row.id, name: row.name }, distanceKm: d };
    }
  }

  if (!best || best.distanceKm > maxKm) return null;
  return best;
}

async function findNearestLocation(lat: number, lon: number, maxKm = 30): Promise<{ id: string; name: string } | null> {
  const prismaAny = prisma as any;
  const rows = await prismaAny.location.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  let best: { id: string; name: string } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const d = haversineKm(lat, lon, row.latitude, row.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = { id: row.id, name: row.name };
    }
  }
  if (bestDist > maxKm) return null;
  return best;
}

function estimateDistanceKm(points: RouteWaypoint[]): number {
  if (points.length < 2) return 1;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
}

// ── OSRM Route Generation ───────────────────────────────────────────────────

async function fetchOsrmRoutes(origin: GeoPoint, destination: GeoPoint): Promise<Route[]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&alternatives=true`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn("[route] OSRM failed:", res.status);
      return [];
    }

    const data = await res.json() as {
      code?: string;
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs?: { summary?: string }[];
      }[];
    };

    if (data.code !== "Ok" || !data.routes) {
      return [];
    }

    return data.routes.map((r, idx) => {
      const waypoints: RouteWaypoint[] = r.geometry.coordinates.map((coord, i) => ({
        lat: coord[1],
        lon: coord[0],
        distanceFromStart: i === 0 ? 0 : Math.round(r.distance * i / r.geometry.coordinates.length),
      }));

      // Generate route name based on Nepal highways
      const routeName = generateRouteName(origin, destination, waypoints);

      return {
        id: `osrm-${idx}`,
        name: routeName,
        description: `${routeName} via OSRM`,
        waypoints,
        distance: Math.round(r.distance),
        duration: Math.round(r.duration),
        riskScore: 0.5, // Will be updated after hazard analysis
        riskLevel: "MEDIUM",
        hazards: {
          landslideZones: [],
          floodZones: [],
          activeAlerts: [],
          weatherRisk: "unknown",
          historicalRisk: 0.5,
        },
        segments: [],
        source: "OSRM",
      };
    });
  } catch (err) {
    console.warn("[route] OSRM error:", err);
    return [];
  }
}

// ── OpenRouteService Fallback ───────────────────────────────────────────────

async function fetchOpenRouteServiceRoutes(origin: GeoPoint, destination: GeoPoint): Promise<Route[]> {
  try {
    const apiKey = process.env.OPENROUTESERVICE_API_KEY;
    if (!apiKey) {
      console.warn("[route] OpenRouteService API key not set");
      return [];
    }

    const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${origin.lon},${origin.lat}&end=${destination.lon},${destination.lat}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    if (!res.ok) return [];

    const data = await res.json() as {
      features?: {
        properties: { summary: { distance: number; duration: number } };
        geometry: { coordinates: [number, number][] };
      }[];
    };

    if (!data.features?.length) return [];

    return data.features.map((f, idx) => {
      const coords = f.geometry.coordinates;
      const waypoints: RouteWaypoint[] = coords.map((coord, i) => ({
        lat: coord[1],
        lon: coord[0],
        distanceFromStart: Math.round(f.properties.summary.distance * i / coords.length),
      }));

      const routeName = generateRouteName(origin, destination, waypoints);

      return {
        id: `ors-${idx}`,
        name: routeName,
        description: `${routeName} via OpenRouteService`,
        waypoints,
        distance: Math.round(f.properties.summary.distance),
        duration: Math.round(f.properties.summary.duration),
        riskScore: 0.5,
        riskLevel: "MEDIUM",
        hazards: {
          landslideZones: [],
          floodZones: [],
          activeAlerts: [],
          weatherRisk: "unknown",
          historicalRisk: 0.5,
        },
        segments: [],
        source: "OpenRouteService",
      };
    });
  } catch (err) {
    console.warn("[route] OpenRouteService error:", err);
    return [];
  }
}

// ── Fallback Route ──────────────────────────────────────────────────────────

function generateFallbackRoute(origin: GeoPoint, destination: GeoPoint): Route {
  const waypoints: RouteWaypoint[] = [
    { lat: origin.lat, lon: origin.lon, distanceFromStart: 0 },
    { lat: (origin.lat + destination.lat) / 2, lon: (origin.lon + destination.lon) / 2, distanceFromStart: 50000 },
    { lat: destination.lat, lon: destination.lon, distanceFromStart: 100000 },
  ];

  const routeName = generateRouteName(origin, destination, waypoints);

  return {
    id: "fallback",
    name: routeName,
    description: `${routeName} (estimated)`,
    waypoints,
    distance: 100000,
    duration: 7200,
    riskScore: 0.5,
    riskLevel: "MEDIUM",
    hazards: {
      landslideZones: [],
      floodZones: [],
      activeAlerts: [],
      weatherRisk: "unknown",
      historicalRisk: 0.5,
    },
    segments: [],
    source: "fallback",
  };
}

// ── Route Naming System ─────────────────────────────────────────────────────

function generateRouteName(origin: GeoPoint, destination: GeoPoint, waypoints: RouteWaypoint[]): string {
  // Check if route matches any Nepal highway
  for (const [, highway] of Object.entries(NEPAL_HIGHWAYS)) {
    if (isRouteOnHighway(waypoints, highway.waypoints)) {
      return highway.name;
    }
  }

  // Generate name based on regions
  const originRegion = getRegionFromCoords(origin.lat, origin.lon);
  const destRegion = getRegionFromCoords(destination.lat, destination.lon);

  if (originRegion && destRegion) {
    return `${originRegion} to ${destRegion} Route`;
  }

  // Default: use major cities
  return `${origin.name || "Origin"} to ${destination.name || "Destination"}`;
}

function isRouteOnHighway(waypoints: RouteWaypoint[], highwayCoords: [number, number][]): boolean {
  let matchCount = 0;
  for (const wp of waypoints) {
    for (const hc of highwayCoords) {
      const dist = haversineKm(wp.lat, wp.lon, hc[0], hc[1]);
      if (dist < 15) {
        matchCount++;
        break;
      }
    }
  }
  return matchCount >= Math.min(3, highwayCoords.length * 0.5);
}

function getRegionFromCoords(lat: number, lon: number): string | null {
  const regions: [number, number, string][] = [
    [27.7, 85.3, "Kathmandu"],
    [28.2, 84.0, "Pokhara"],
    [28.6, 80.2, "Far Western"],
    [27.4, 84.9, "Hetauda"],
    [27.7, 82.5, "Lumbini"],
    [26.8, 87.0, "Eastern"],
  ];

  let closest = "";
  let minDist = Infinity;

  for (const [rLat, rLon, name] of regions) {
    const dist = haversineKm(lat, lon, rLat, rLon);
    if (dist < minDist) {
      minDist = dist;
      closest = name;
    }
  }

  return minDist < 100 ? closest : null;
}

// ── Route Hazard Analysis ─────────────────────────────────────────────────

async function analyzeRouteHazards(route: Route, departureDate: string): Promise<Route> {
  const segments: RouteSegment[] = [];
  const targetSegments = 6;
  const samplingStep = Math.max(1, Math.ceil(route.waypoints.length / (targetSegments + 1)));
  const sampledWaypoints = sampleWaypoints(route.waypoints, samplingStep);
  const analysisWaypoints = sampledWaypoints.length >= 2 ? sampledWaypoints : route.waypoints;

  // Create segments from waypoints
  for (let i = 0; i < analysisWaypoints.length - 1; i++) {
    const start = analysisWaypoints[i];
    const end = analysisWaypoints[i + 1];
    
    segments.push({
      index: i,
      startPoint: { lat: start.lat, lon: start.lon, name: start.name ?? getDistrictFromCoords(start.lat, start.lon) },
      endPoint: { lat: end.lat, lon: end.lon, name: end.name ?? getDistrictFromCoords(end.lat, end.lon) },
      distance: end.distanceFromStart - start.distanceFromStart,
      riskScore: 0,
      riskLevel: "LOW",
      hazards: [],
    });
  }

  // Analyze each segment
  const segmentRisks = await Promise.all(
    segments.map(async (segment) => {
      const centerLat = (segment.startPoint.lat + segment.endPoint.lat) / 2;
      const centerLon = (segment.startPoint.lon + segment.endPoint.lon) / 2;

      // Get district name (simplified)
      const district = getDistrictFromCoords(centerLat, centerLon);

      // Fetch hazard data
      const [currentHazard, historicalHazard, weather] = await Promise.all([
        withTimeout(fetchHazard(district, centerLat, centerLon), 6000).catch(() => null),
        withTimeout(fetchHistoricalHazard(district, centerLat, centerLon, departureDate, 5), 6000).catch(() => null),
        withTimeout(
          fetchWeather(centerLat, centerLon, { fastMode: true, allowNearbyFallback: false, openMeteoTimeoutsMs: [3500] }),
          6000
        ).catch(() => null),
      ]);

      const hazards: string[] = [];
      const sampledPoints = [
        { lat: segment.startPoint.lat, lon: segment.startPoint.lon },
        { lat: centerLat, lon: centerLon },
        { lat: segment.endPoint.lat, lon: segment.endPoint.lon },
      ];
      const realtimeDisasters: { type: "flood" | "landslide" | "earthquake"; lat: number; lon: number }[] = [];
      if ((currentHazard?.floodIndex ?? 0) >= 0.2) realtimeDisasters.push({ type: "flood", lat: centerLat, lon: centerLon });
      if ((currentHazard?.landslideIndex ?? 0) >= 0.2) realtimeDisasters.push({ type: "landslide", lat: centerLat, lon: centerLon });
      if ((currentHazard?.earthquakeIndex ?? 0) >= 0.2) realtimeDisasters.push({ type: "earthquake", lat: centerLat, lon: centerLon });

      const historicalDisasters: { type: "flood" | "landslide"; lat: number; lon: number; count: number }[] = [];
      const floodCount = Math.round((historicalHazard?.historicalFloodRisk ?? 0) * 15);
      const landslideCount = Math.round((historicalHazard?.historicalLandslideRisk ?? 0) * 15);
      if (floodCount > 0) historicalDisasters.push({ type: "flood", lat: centerLat, lon: centerLon, count: floodCount });
      if (landslideCount > 0) historicalDisasters.push({ type: "landslide", lat: centerLat, lon: centerLon, count: landslideCount });

      const hazardAssessment = calculateSegmentHazardRisk({
        sampledPoints,
        weather: {
          rain_mm_per_hr: weather?.rainfall ?? 0,
          wind_kph: (weather?.windSpeed ?? 0) * 3.6,
        },
        realtimeDisasters,
        historicalDisasters,
      });

      const disasterClusters = [
        ...(currentHazard?.floodIndex && currentHazard.floodIndex > 0
          ? [{
              type: "flood" as const,
              lat: centerLat,
              lon: centerLon,
              location: district,
              region: inferNepalRegion(centerLat),
              count: Math.max(1, Math.round(currentHazard.floodIndex * 10)),
              recent: currentHazard.floodIndex >= 0.2,
              severityScore: Math.min(1, currentHazard.floodIndex),
            }]
          : []),
        ...(currentHazard?.landslideIndex && currentHazard.landslideIndex > 0
          ? [{
              type: "landslide" as const,
              lat: centerLat,
              lon: centerLon,
              location: district,
              region: inferNepalRegion(centerLat),
              count: Math.max(1, Math.round(currentHazard.landslideIndex * 10)),
              recent: currentHazard.landslideIndex >= 0.2,
              severityScore: Math.min(1, currentHazard.landslideIndex),
            }]
          : []),
        ...(currentHazard?.earthquakeIndex && currentHazard.earthquakeIndex > 0
          ? [{
              type: "earthquake" as const,
              lat: centerLat,
              lon: centerLon,
              location: district,
              region: inferNepalRegion(centerLat),
              count: Math.max(1, Math.round(currentHazard.earthquakeIndex * 10)),
              recent: currentHazard.earthquakeIndex >= 0.2,
              severityScore: Math.min(1, currentHazard.earthquakeIndex),
            }]
          : []),
        ...(floodCount > 0
          ? [{
              type: "flood" as const,
              lat: centerLat,
              lon: centerLon,
              location: district,
              region: inferNepalRegion(centerLat),
              count: floodCount,
              recent: false,
              severityScore: Math.min(1, (historicalHazard?.historicalFloodRisk ?? 0)),
            }]
          : []),
        ...(landslideCount > 0
          ? [{
              type: "landslide" as const,
              lat: centerLat,
              lon: centerLon,
              location: district,
              region: inferNepalRegion(centerLat),
              count: landslideCount,
              recent: false,
              severityScore: Math.min(1, (historicalHazard?.historicalLandslideRisk ?? 0)),
            }]
          : []),
      ];

      const dynamicAlerts = await generateDynamicAlerts({
        routePoints: sampledPoints,
        clusters: disasterClusters,
        weather: {
          rain_mm_per_hr: weather?.rainfall ?? 0,
          wind: weather?.windSpeed ?? 0,
        },
      });

      let riskScore = hazardAssessment.riskPercent / 100;
      // Regional priors blend-in (kept lightweight and explicit).
      let regionalPriorContribution = 0;
      if (centerLat < 27.2 && centerLon > 86.4 && centerLon < 87.6) {
        regionalPriorContribution += 0.16;
        hazards.push("Flood-prone Terai belt (regional prior)");
      }
      if (haversineKm(centerLat, centerLon, 26.543, 86.917) < 45) {
        regionalPriorContribution += 0.2;
        hazards.push("Koshi flood-prone zone (regional prior)");
      }
      if (centerLat > 26.95 && centerLat < 27.45 && centerLon > 87.7 && centerLon < 88.25) {
        regionalPriorContribution += 0.18;
        hazards.push("Hilly landslide-prone corridor (regional prior)");
      }
      riskScore = Math.min(1, riskScore + regionalPriorContribution * 0.1);

      hazards.push(...dynamicAlerts.alerts);
      if (currentHazard?.floodIndex && currentHazard.floodIndex > 0.3) hazards.push("Flood risk");
      if (currentHazard?.landslideIndex && currentHazard.landslideIndex > 0.3) hazards.push("Landslide risk");
      if (weather?.rainfall && weather.rainfall > 10) hazards.push(`Rain: ${weather.rainfall}mm/h`);

      return {
        ...segment,
        riskScore,
        riskLevel: scoreToLevel(riskScore),
        hazards: [...new Set(hazards)],
        weather: weather?.description,
        realtime: {
          floodIndex: currentHazard?.floodIndex ?? 0,
          landslideIndex: currentHazard?.landslideIndex ?? 0,
          earthquakeIndex: currentHazard?.earthquakeIndex ?? 0,
          airQuality: currentHazard?.airQuality ?? 0,
          rainfall: weather?.rainfall ?? 0,
          windSpeed: weather?.windSpeed ?? 0,
          temperature: weather?.temperature ?? 0,
        },
        historical: {
          floodRisk: historicalHazard?.historicalFloodRisk ?? 0,
          landslideRisk: historicalHazard?.historicalLandslideRisk ?? 0,
        },
        contributions: {
          realtime: Math.round((hazardAssessment.breakdown.realtime / 100) * 100) / 100,
          historical: Math.round((hazardAssessment.breakdown.historical / 100) * 100) / 100,
          regionalPrior: Math.round(regionalPriorContribution * 100) / 100,
        },
        evidence: {
          realtime: {
            hazardSource: currentHazard?.source,
            weatherSource: weather?.sourceLabel || weather?.source,
            weatherTimestamp: weather?.timestamp,
          },
          historical: {
            source: historicalHazard?.source,
            yearsAnalysed: historicalHazard?.yearsAnalysed,
            notableEvents: historicalHazard?.notableEvents?.slice(0, 3) ?? [],
          },
          regionalPrior: {
            reasons: hazards.filter((h) => h.includes("(regional prior)")),
          },
        },
        hazardAssessment,
      };
    })
  );

  // Update route with segment data
  const avgRisk = segmentRisks.reduce((sum, s) => sum + s.riskScore, 0) / segmentRisks.length;
  
  // Collect all hazards along route
  const landslideZones = [...new Set(segmentRisks.filter(s => s.hazards.includes("Landslide risk")).map(s => s.startPoint.name || "Unknown"))];
  const floodZones = [...new Set(segmentRisks.filter(s => s.hazards.includes("Flood risk")).map(s => s.startPoint.name || "Unknown"))];
  const activeAlerts = [...new Set(segmentRisks.flatMap(s => s.hazards))];

  // Get weather risk
  const weatherRisk = segmentRisks.find(s => s.weather)?.weather || "unknown";

  return {
    ...route,
    segments: segmentRisks,
    riskScore: Math.round(avgRisk * 100) / 100,
    riskLevel: scoreToLevel(avgRisk),
    hazards: {
      landslideZones,
      floodZones,
      activeAlerts,
      weatherRisk,
      historicalRisk: avgRisk,
    },
  };
}

function calculateSegmentHazardRisk(input: {
  sampledPoints: { lat: number; lon: number }[];
  weather?: { rain_mm_per_hr?: number; wind_kph?: number };
  realtimeDisasters?: { type: "flood" | "landslide" | "earthquake"; lat: number; lon: number }[];
  historicalDisasters?: { type: "flood" | "landslide"; lat: number; lon: number; count: number }[];
}): {
  riskPercent: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  breakdown: { weather: number; realtime: number; historical: number; terrain: number };
  alerts: string[];
  reason?: string;
} {
  let realtimeRisk = 0;
  let historicalRisk = 0;
  let weatherRisk = 0;
  let terrainRisk = 0;
  const alerts: string[] = [];

  const points = input.sampledPoints ?? [];
  const rain = input.weather?.rain_mm_per_hr ?? 0;
  const wind = input.weather?.wind_kph ?? 0;
  const realtime = input.realtimeDisasters ?? [];
  const historical = input.historicalDisasters ?? [];

  if (rain > 30) {
    weatherRisk += 0.7;
    alerts.push("Heavy rain detected");
  } else if (rain > 10) {
    weatherRisk += 0.4;
    alerts.push("Moderate rain detected");
  } else if (rain > 2) {
    weatherRisk += 0.1;
  }
  if (wind > 60) weatherRisk += 0.2;
  else if (wind > 35) weatherRisk += 0.1;

  for (const d of realtime) {
    const minDist = minDistanceKm(points, d.lat, d.lon);
    if (minDist < 5) {
      realtimeRisk += 0.6;
      alerts.push(`Nearby real-time ${d.type} alert`);
    } else if (minDist < 10) {
      realtimeRisk += 0.3;
      alerts.push(`Regional ${d.type} alert`);
    }
  }

  for (const h of historical) {
    const minDist = minDistanceKm(points, h.lat, h.lon);
    if (minDist > 15) continue;
    if (h.count > 10) historicalRisk += 0.6;
    else if (h.count > 5) historicalRisk += 0.4;
    else if (h.count > 1) historicalRisk += 0.2;
    if (h.count > 1) alerts.push(`Past ${h.type} zone nearby`);
  }

  // Terrain proxy fallback by coordinate belts (hills/terai).
  const center = points[Math.floor(points.length / 2)];
  if (center) {
    if (center.lat > 27.1) terrainRisk = 0.25;
    else if (center.lat > 26.7) terrainRisk = 0.15;
    else terrainRisk = 0.1;
  } else {
    terrainRisk = 0.12;
  }

  const hasAnyInput =
    points.length > 0 ||
    rain > 0 ||
    wind > 0 ||
    realtime.length > 0 ||
    historical.length > 0;

  if (!hasAnyInput) {
    return {
      riskPercent: 15,
      riskLevel: "LOW",
      breakdown: { weather: 0, realtime: 0, historical: 0, terrain: 15 },
      alerts: ["No data available, using baseline risk"],
      reason: "No data available, using baseline risk",
    };
  }

  weatherRisk = Math.min(1, weatherRisk);
  realtimeRisk = Math.min(1, realtimeRisk);
  historicalRisk = Math.min(1, historicalRisk);
  terrainRisk = Math.min(1, terrainRisk);

  const weightedWeather = weatherRisk * 0.4;
  const weightedRealtime = realtimeRisk * 0.3;
  const weightedHistorical = historicalRisk * 0.2;
  const weightedTerrain = terrainRisk * 0.1;
  const totalRisk = weightedWeather + weightedRealtime + weightedHistorical + weightedTerrain;
  const riskPercent = Math.min(100, Math.round(totalRisk * 100));

  const riskLevel: "LOW" | "MEDIUM" | "HIGH" =
    riskPercent > 70 ? "HIGH" : riskPercent > 40 ? "MEDIUM" : "LOW";

  return {
    riskPercent,
    riskLevel,
    breakdown: {
      weather: Math.round(weightedWeather * 100),
      realtime: Math.round(weightedRealtime * 100),
      historical: Math.round(weightedHistorical * 100),
      terrain: Math.round(weightedTerrain * 100),
    },
    alerts: [...new Set(alerts)],
  };
}

function minDistanceKm(points: { lat: number; lon: number }[], lat: number, lon: number): number {
  if (!points.length) return Infinity;
  let min = Infinity;
  for (const p of points) {
    const d = haversineKm(p.lat, p.lon, lat, lon);
    if (d < min) min = d;
  }
  return min;
}

// ── Helper Functions ─────────────────────────────────────────────────────────

function scoreToLevel(score: number): "LOW" | "MEDIUM" | "HIGH" | "EXTREME" {
  if (score < 0.3) return "LOW";
  if (score < 0.5) return "MEDIUM";
  if (score < 0.7) return "HIGH";
  return "EXTREME";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getDistrictFromCoords(lat: number, lon: number): string {
  const anchors: [number, number, string][] = [
    [27.7172, 85.3240, "Kathmandu"],
    [27.6710, 85.4298, "Bhaktapur"],
    [27.6588, 85.3247, "Lalitpur"],
    [28.2096, 83.9856, "Kaski"],
    [27.4280, 85.0322, "Makwanpur"],
    [27.8139, 85.2866, "Nuwakot"],
    [27.5291, 84.3542, "Chitwan"],
    [27.6833, 84.4333, "Tanahun"],
    [27.7000, 85.3000, "Kathmandu Valley"],
    [27.4833, 84.9833, "Hetauda Region"],
  ];

  let closest = anchors[0][2];
  let minDist = Infinity;
  for (const [aLat, aLon, name] of anchors) {
    const dist = haversineKm(lat, lon, aLat, aLon);
    if (dist < minDist) {
      minDist = dist;
      closest = name;
    }
  }
  if (minDist > 80) {
    return getRegionFromCoords(lat, lon) ?? "Route corridor";
  }
  return closest;
}

function inferNepalRegion(lat: number): "Terai" | "Hill" | "Mountain" {
  if (lat < 27.0) return "Terai";
  if (lat < 28.0) return "Hill";
  return "Mountain";
}

function sampleWaypoints(points: RouteWaypoint[], step = 10): RouteWaypoint[] {
  if (!points.length) return [];
  const safeStep = Math.max(1, Math.floor(step));
  const sampled = points.filter((_, index) => index % safeStep === 0);
  const last = points[points.length - 1];
  const hasLast = sampled.some((p) => p.lat === last.lat && p.lon === last.lon);
  if (!hasLast) sampled.push(last);
  return sampled;
}

function buildNamedBreakpoints(
  waypoints: RouteWaypoint[],
  originName?: string,
  destinationName?: string
): string[] {
  if (!waypoints.length) return [];
  const sampled = sampleWaypoints(waypoints, Math.max(1, Math.floor(waypoints.length / 12)));
  const names: string[] = [];

  if (originName) names.push(originName);

  for (const p of sampled) {
    const name = p.name ?? getDistrictFromCoords(p.lat, p.lon);
    if (name && names[names.length - 1] !== name) {
      names.push(name);
    }
  }

  if (destinationName && names[names.length - 1] !== destinationName) {
    names.push(destinationName);
  }

  return names;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ── API Response Formatter ─────────────────────────────────────────────────

export function formatRouteIntelligenceResponse(result: RouteIntelligenceResult): object {
  const seen = new Set<string>();
  const compactRoutes = result.routes.filter((route) => {
    const sig = `${Math.round(route.distance / 2500)}:${route.riskLevel}:${route.waypoints.slice(0, 1).map((w) => `${w.lat.toFixed(2)},${w.lon.toFixed(2)}`).join("|")}:${route.waypoints.slice(-1).map((w) => `${w.lat.toFixed(2)},${w.lon.toFixed(2)}`).join("|")}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  return {
    routes: compactRoutes.map(route => ({
      id: route.id,
      name: route.name,
      distance: route.distance,
      duration: route.duration,
      riskScore: route.riskScore,
      riskLevel: route.riskLevel,
      breakpoints: sampleWaypoints(route.waypoints, 10).map((p) => ({ lat: p.lat, lon: p.lon })),
      breakpointNames: buildNamedBreakpoints(
        route.waypoints,
        result.origin.name ?? "Your location",
        result.destination.name ?? "Destination"
      ),
      hazards: {
        landslideZones: route.hazards.landslideZones,
        floodZones: route.hazards.floodZones,
        weatherRisk: route.hazards.weatherRisk,
      },
      alerts: route.hazards.activeAlerts,
      segments: route.segments.map(seg => ({
        from: seg.startPoint,
        to: seg.endPoint,
        riskLevel: seg.riskLevel,
        riskScore: seg.riskScore,
        hazards: seg.hazards,
        realtime: seg.realtime,
        historical: seg.historical,
        contributions: seg.contributions,
        evidence: seg.evidence,
      })),
    })),
    bestRoute: result.bestRoute ? {
      name: result.bestRoute.name,
      riskLevel: result.bestRoute.riskLevel,
    } : null,
  };
}
