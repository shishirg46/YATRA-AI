import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import { fetchHistoricalHazard } from "@/lib/collectors/historical-hazard";
import { ensureRecentRealtimeData, calculateIndependentHazardScores } from "@/lib/disaster-pipeline";
import type { IndependentHazardScores } from "@/lib/disaster-pipeline";
import { generateDynamicAlerts } from "@/lib/alert-engine";
import { prisma } from "@/lib/prisma";
import { buildSegmentedRoute, buildRouteAlternatives } from "@/lib/routing/route-service";
import { roadCodeName } from "@/lib/routing/route-abstraction";
import { resolveDestination } from "@/lib/routing/place-resolver";
import { fetchRoadRoute, fetchRouteGeometry } from "@/lib/routing/openroute-service";
import { createRouteBuffer } from "@/lib/routing/route-buffer";
import { findPlacesAlongRoute } from "@/lib/routing/places-along-route";
import { rankPlacesForRoute } from "@/lib/routing/route-ranking";
import { findNearestLocation } from "@/lib/routing/spatial";
import { snapToNearestRoad } from "@/lib/routing/osrm-nearest";
import { labelPolylineSegments } from "@/lib/routing/geometry-projection";
import type {
  BuiltRoute,
  VehicleProfile,
  GeoPoint,
  RouteCoordinate,
  RouteNode,
  RouteInstruction,
  DetourInfo,
  RouteStop,
  TripIntelligence,
} from "@/lib/routing/types";
import { haversineKm } from "@/lib/routing/geo";
import { analyzeRouteSegments } from "@/lib/analysis/segment-analyzer";
import type { SegmentProfile } from "@/lib/analysis/segment-analyzer";

export type { GeoPoint } from "@/lib/routing/types";

export interface RouteWaypoint {
  lat: number;
  lon: number;
  name?: string;
  distanceFromStart: number;
}

export interface Route {
  id: string;
  name: string;
  description: string;
  waypoints: RouteWaypoint[];
  distance: number;
  duration: number;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  hazards: RouteHazards;
  segments: RouteSegment[];
  source: string;
  encodedPolyline?: string;
  placesAlongRoute?: DetourInfo[];
  rankedStops?: RouteStop[];
  turnByTurn?: RouteInstruction[];
  tripIntelligence?: TripIntelligence;
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
  roadCode?: string;
  roadName?: string;
  fromJunction?: string;
  toJunction?: string;
  hazardProfile?: IndependentHazardScores;
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
      sources?: string[];
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
  gradient?: number | null;
  roadSurface?: { highway: string; surface: string | null; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME" } | null;
  riverProximityKm?: number | null;
  elevationStart?: number | null;
  elevationEnd?: number | null;
}

export interface RouteIntelligenceResult {
  origin: GeoPoint;
  destination: GeoPoint;
  departureDate: string;
  routes: Route[];
  bestRoute: Route | null;
  generatedAt: string;
}

/**
 * Ultra-fast route builder — the routing kernel.
 *
 * Returns structural route data (waypoints, geometry, polyline, turn-by-turn)
 * with NO hazard analysis, NO place enrichment, NO DB writes.
 *
 * Target: <3s.  This is the ONLY synchronous path exposed to the API handler.
 *
 * Design rules:
 *   - A* + ORS geometry only
 *   - NO createRouteBuffer / findPlacesAlongRoute / rankPlacesForRoute
 *   - NO saveRouteTemplate
 *   - NO ensureRecentRealtimeData
 *   - NO fallback chain (stored routes, ORS alternatives, snap-to-road)
 *   - DOR alternatives via buildRouteAlternatives (synchronous, sub-100ms)
 *   - If A* fails → return empty (handler decides next step)
 */
export async function buildRouteUltraFast(
  origin: GeoPoint,
  destination: GeoPoint,
  departureDate: string,
  options?: { destinationId?: string; vehicle?: VehicleProfile },
  signal?: AbortSignal,  // hard cancellation for HTTP only
): Promise<{
  routes: Route[];
  resolvedDest: GeoPoint;
  generatedAt: string;
}> {
  const vehicle = options?.vehicle ?? "car";

  let resolvedDest = destination;
  try {
    const resolved = await withTimeout(
      resolveDestination({
        destinationId: options?.destinationId,
        destinationName: destination.name,
        destinationLat: destination.lat,
        destinationLon: destination.lon,
      }),
      10_000,
    );
    resolvedDest = {
      lat: resolved.place.lat,
      lon: resolved.place.lon,
      name: resolved.place.name,
    };
  } catch {
    // Keep provided coordinates when resolution times out or fails
  }

  let routes: Route[] = [];

  try {
    // Try DOR first for semantic route structure; fall back to OSRM if unavailable
    let built: BuiltRoute;
    try {
      built = await withTimeout(
        buildSegmentedRoute({
          originLat: origin.lat,
          originLon: origin.lon,
          originName: origin.name,
          destinationLat: resolvedDest.lat,
          destinationLon: resolvedDest.lon,
          destinationName: resolvedDest.name ?? destination.name,
          destinationId: options?.destinationId,
          vehicle,
          dorRoutingMode: "balanced",
        }),
        10_000,
      );
      if (built.provenance?.validationStatus === "empty") throw new Error("DOR empty");
    } catch {
      built = await withTimeout(
        buildSegmentedRoute({
          originLat: origin.lat,
          originLon: origin.lon,
          originName: origin.name,
          destinationLat: resolvedDest.lat,
          destinationLon: resolvedDest.lon,
          destinationName: resolvedDest.name ?? destination.name,
          destinationId: options?.destinationId,
          vehicle,
        }),
        10_000,
      );
    }

    // ORS geometry: cached hit is instant, miss adds ~1-3s
    let roadRoute: Awaited<ReturnType<typeof fetchRouteGeometry>> | undefined;
    try {
      roadRoute = await withTimeout(
        fetchRouteGeometry(
          { lat: origin.lat, lon: origin.lon, name: origin.name },
          { lat: resolvedDest.lat, lon: resolvedDest.lon, name: resolvedDest.name },
          vehicle,
          undefined, // waypoints
          signal,    // hard cancellation for ORS HTTP
        ),
        10_000,
      );
    } catch {
      // ORS failure is non-fatal — fall back to A*-only polyline
    }

    // Compute display segments from ground-truth ORS geometry
    // (display-only — never feeds back into routing inputs)
    let displayChain: RouteNode[] | undefined;
    if (roadRoute?.coordinates?.length) {
      try {
        const labeled = await labelPolylineSegments(
          roadRoute.coordinates,
          { lat: origin.lat, lon: origin.lon, name: origin.name },
          { lat: resolvedDest.lat, lon: resolvedDest.lon, name: resolvedDest.name },
        );
        if (labeled.chain.length >= 2) {
          displayChain = labeled.chain;
        }
      } catch (err) {
        console.warn("[route-ultrafast] polyline projection failed:", err);
      }
    }

    const primaryRoute = builtRouteToIntelligenceRoute(
      built,
      { ...origin, name: origin.name ?? built.origin.name },
      { ...resolvedDest, name: resolvedDest.name ?? built.destination.name },
      roadRoute,
      undefined,  // no placesAlongRoute (ultra-fast)
      undefined,  // no rankedStops (ultra-fast)
      displayChain,
    );

    // Generate diverse alternatives via DOR with different preferRoad values
    try {
      const extras = buildRouteAlternatives(
        origin.lat, origin.lon,
        resolvedDest.lat, resolvedDest.lon,
        origin.name ?? "Origin",
        resolvedDest.name ?? destination.name ?? "Destination",
        undefined,
      );
      const primaryChain = built.abstraction?.roadChain?.join("|") ?? "";
      const altRoutes: Route[] = [];
      for (let i = 0; i < extras.length; i++) {
        const altChain = extras[i].abstraction.roadChain.join("|");
        if (altChain === primaryChain) continue; // dedup with primary
        if (altRoutes.some((r) => r.name === extras[i].label)) continue; // dedup among alts
        altRoutes.push(
          alternativeToRoute(extras[i], i + 1, origin, resolvedDest, roadRoute),
        );
      }
      routes = [primaryRoute, ...altRoutes];
    } catch {
      routes = [primaryRoute];
    }
  } catch (err) {
    console.warn("[route-ultrafast] A* build failed:", err);
  }

  // Lightweight fallback: straight-line route when A* yields nothing
  if (routes.length === 0) {
    try {
      const fallback = generateFallbackRoute(origin, resolvedDest);
      routes = [await ensureSegmentedWaypoints(fallback, origin, resolvedDest)];
    } catch {
      routes = [generateFallbackRoute(origin, resolvedDest)];
    }
  }

  return {
    routes,
    resolvedDest,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build the core route (waypoints, geometry, polyline) WITHOUT hazard analysis.
 *
 * This is the fast path — it resolves the destination, builds segmented routes,
 * fetches ORS geometry, finds places along route, and ranks stops.
 * No external hazard APIs are called in this phase.
 *
 * Designed to complete in <15s under normal conditions.
 */
export async function buildRouteCore(
  origin: GeoPoint,
  destination: GeoPoint,
  departureDate: string,
  options?: { destinationId?: string; vehicle?: VehicleProfile }
): Promise<{
  origin: GeoPoint;
  destination: GeoPoint;
  departureDate: string;
  routes: Route[];
  resolvedDest: GeoPoint;
  generatedAt: string;
}> {
  if (process.env.CRON_ENABLED !== "1") {
    ensureRecentRealtimeData().catch(() => {});
  }

  const vehicle = options?.vehicle ?? "car";

  let resolvedDest = destination;
  try {
    const resolved = await resolveDestination({
      destinationId: options?.destinationId,
      destinationName: destination.name,
      destinationLat: destination.lat,
      destinationLon: destination.lon,
    });
    resolvedDest = {
      lat: resolved.place.lat,
      lon: resolved.place.lon,
      name: resolved.place.name,
    };
  } catch {
    // Keep provided coordinates when resolution fails
  }

  let routes: Route[] = [];

  try {
    const built = await buildSegmentedRoute({
      originLat: origin.lat,
      originLon: origin.lon,
      originName: origin.name,
      destinationLat: resolvedDest.lat,
      destinationLon: resolvedDest.lon,
      destinationName: resolvedDest.name ?? destination.name,
      destinationId: options?.destinationId,
      vehicle,
    });

    const roadRoute = await fetchRouteGeometry(
      { lat: origin.lat, lon: origin.lon, name: origin.name },
      { lat: resolvedDest.lat, lon: resolvedDest.lon, name: resolvedDest.name },
      vehicle
    );

    const buffer = await createRouteBuffer(roadRoute.coordinates, vehicle).catch(() => null);

    let placesAlongRoute: DetourInfo[] = [];
    let rankedStops: RouteStop[] = [];
    if (buffer) {
      placesAlongRoute = await findPlacesAlongRoute({
        bufferWkt: buffer.normal.wkt,
        radiusMeters: buffer.normal.radiusMeters,
        mainRoute: roadRoute.coordinates,
        vehicle,
      });
      const ranked = rankPlacesForRoute(placesAlongRoute, roadRoute.coordinates);
      rankedStops = ranked.stops;
    }

    routes = [
      builtRouteToIntelligenceRoute(
        built,
        { ...origin, name: origin.name ?? built.origin.name },
        { ...resolvedDest, name: resolvedDest.name ?? built.destination.name },
        roadRoute,
        placesAlongRoute,
        rankedStops,
      ),
    ];
  } catch (err) {
    console.warn("[route-intelligence] segmented build failed:", err);
  }

  if (routes.length === 0) {
    const storedRoutes = await fetchStoredRoutes(origin, resolvedDest);
    let roadRoutes: Route[] = [];

    if (storedRoutes.length === 0) {
      roadRoutes = await fetchRoadRoutesFallback(origin, resolvedDest, vehicle);

      if (roadRoutes.length === 0) {
        const [snappedOrigin, snappedDest] = await Promise.all([
          snapToNearestRoad(origin.lat, origin.lon),
          snapToNearestRoad(resolvedDest.lat, resolvedDest.lon),
        ]);

        const effectiveOrigin = snappedOrigin && snappedOrigin.distance <= 5000
          ? { lat: snappedOrigin.lat, lon: snappedOrigin.lon, name: origin.name }
          : origin;
        const effectiveDest = snappedDest && snappedDest.distance <= 5000
          ? { lat: snappedDest.lat, lon: snappedDest.lon, name: resolvedDest.name }
          : resolvedDest;

        if (effectiveOrigin.lat !== origin.lat || effectiveOrigin.lon !== origin.lon ||
            effectiveDest.lat !== resolvedDest.lat || effectiveDest.lon !== resolvedDest.lon) {
          roadRoutes = await fetchRoadRoutesFallback(effectiveOrigin, effectiveDest, vehicle);
          if (roadRoutes.length > 0) {
            resolvedDest = effectiveDest;
          }
        }
      }
    }

    routes = storedRoutes.length > 0 ? storedRoutes : roadRoutes;

    if (routes.length === 0) {
      routes = [generateFallbackRoute(origin, resolvedDest)];
    }

    routes = await Promise.all(
      routes.map((r) => ensureSegmentedWaypoints(r, origin, resolvedDest))
    );
  }

  if (routes.length > 0 && routes[0].waypoints.length > 2) {
    await saveRouteTemplate(origin, resolvedDest, routes[0]).catch(() => null);
  }

  return {
    origin,
    destination,
    departureDate,
    routes,
    resolvedDest,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateRouteIntelligence(
  origin: GeoPoint,
  destination: GeoPoint,
  departureDate: string,
  options?: { destinationId?: string; vehicle?: VehicleProfile }
): Promise<RouteIntelligenceResult> {
  const core = await buildRouteCore(origin, destination, departureDate, options);

  const analyzedRoutes = await Promise.all(
    core.routes.map(async (route) => await analyzeRouteHazards(route, departureDate))
  );

  const bestRoute = analyzedRoutes
    .filter(r => r.riskLevel !== "EXTREME")
    .sort((a, b) => a.riskScore - b.riskScore)[0] ?? null;

  return {
    origin: core.origin,
    destination: core.destination,
    departureDate: core.departureDate,
    routes: analyzedRoutes,
    bestRoute,
    generatedAt: core.generatedAt,
  };
}

async function fetchRoadRoutesFallback(origin: GeoPoint, destination: GeoPoint, vehicle: VehicleProfile): Promise<Route[]> {
  try {
    const routes = await fetchRoadRoute(origin, destination, vehicle, { alternatives: true });

    return routes.map((r, idx) => {
      const waypoints: RouteWaypoint[] = r.coordinates.map((coord, i) => ({
        lat: coord.lat,
        lon: coord.lon,
        distanceFromStart: i === 0 ? 0 : Math.round(r.distance * i / r.coordinates.length),
      }));

      const routeName = generateRouteName(origin, destination, waypoints);

      return {
        id: `ors-${idx}`,
        name: routeName,
        description: `${routeName} via OpenRouteService (${vehicle})`,
        waypoints,
        distance: r.distance,
        duration: r.duration,
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
        source: `OpenRouteService:${vehicle}`,
        encodedPolyline: r.encodedPolyline,
        turnByTurn: r.legs.flatMap((l) => l.steps),
      };
    });
  } catch (err) {
    console.warn("[route] OpenRouteService error:", err);
    return [];
  }
}

async function fetchStoredRoutes(origin: GeoPoint, destination: GeoPoint): Promise<Route[]> {
  const [originLoc, destinationLoc] = await Promise.all([
    findNearestLocationWithDistance(origin.lat, origin.lon),
    findNearestLocationWithDistance(destination.lat, destination.lon),
  ]);

  if (!originLoc || !destinationLoc) return [];
  if (originLoc.distanceKm > 8 || destinationLoc.distanceKm > 12) return [];

  const templates = await prisma.routeTemplate.findMany({
    where: {
      originLocationId: originLoc.location.id,
      destinationLocationId: destinationLoc.location.id,
      isActive: true,
    },
    include: {
      points: { orderBy: { seq: "asc" as const } },
    },
    orderBy: { updatedAt: "desc" },
    take: 2,
  });

  return templates
    .filter((t) => Array.isArray(t.points) && t.points.length > 1)
    .map((t, idx) => {
      const waypoints: RouteWaypoint[] = t.points.map((p) => ({
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
  const [originLoc, destinationLoc] = await Promise.all([
    findNearestLocation(origin.lat, origin.lon),
    findNearestLocation(destination.lat, destination.lon),
  ]);

  if (!originLoc || !destinationLoc) return;

  const sampled = sampleWaypoints(route.waypoints, Math.max(1, Math.floor(route.waypoints.length / 16)));
  if (sampled.length < 2) return;

  const template = await prisma.routeTemplate.upsert({
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

  await prisma.routeTemplatePoint.deleteMany({ where: { routeTemplateId: template.id } });

  const pointData = await Promise.all(
    sampled.map(async (wp, i) => {
      const nearest = await findNearestLocation(wp.lat, wp.lon, 8);
      return {
        routeTemplateId: template.id,
        seq: i,
        lat: wp.lat,
        lon: wp.lon,
        kmFromStart: (wp.distanceFromStart ?? 0) / 1000,
        placeName: nearest?.name ?? wp.name ?? null,
        matchedLocationId: nearest?.id ?? null,
      };
    })
  );

  if (pointData.length > 0) {
    await prisma.routeTemplatePoint.createMany({ data: pointData });
  }
}

async function findNearestLocationWithDistance(
  lat: number,
  lon: number,
  maxKm = 30
): Promise<{ location: { id: string; name: string }; distanceKm: number } | null> {
  const result = await findNearestLocation(lat, lon, maxKm);
  if (!result) return null;
  return {
    location: { id: result.id, name: result.name },
    distanceKm: result.distanceKm,
  };
}

function estimateDistanceKm(points: RouteWaypoint[]): number {
  if (points.length < 2) return 1;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
}

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

function generateRouteName(origin: GeoPoint, destination: GeoPoint, waypoints: RouteWaypoint[]): string {
  for (const [, highway] of Object.entries(NEPAL_HIGHWAYS)) {
    if (isRouteOnHighway(waypoints, highway.waypoints)) {
      return highway.name;
    }
  }

  const originRegion = getRegionFromCoords(origin.lat, origin.lon);
  const destRegion = getRegionFromCoords(destination.lat, destination.lon);

  if (originRegion && destRegion) {
    return `${originRegion} to ${destRegion} Route`;
  }

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

// ── Fallback Route ──────────────────────────────────────────────────────────

export function generateFallbackRoute(origin: GeoPoint, destination: GeoPoint): Route {
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

// ── Route Hazard Analysis ─────────────────────────────────────────────────

async function analyzeRouteHazards(route: Route, departureDate: string): Promise<Route> {
  const segments: RouteSegment[] = [];
  const targetSegments = 6;
  const samplingStep = Math.max(1, Math.ceil(route.waypoints.length / (targetSegments + 1)));
  const sampledWaypoints = sampleWaypoints(route.waypoints, samplingStep);
  const analysisWaypoints = sampledWaypoints.length >= 2 ? sampledWaypoints : route.waypoints;

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

  const fineSegments = await withTimeout(
    analyzeRouteSegments(
      route.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
      { lat: route.waypoints[0]?.lat ?? 0, lon: route.waypoints[0]?.lon ?? 0 },
      {
        lat: route.waypoints[route.waypoints.length - 1]?.lat ?? 0,
        lon: route.waypoints[route.waypoints.length - 1]?.lon ?? 0,
      }
    ),
    30000
  ).catch(() => [] as SegmentProfile[]);

  const segmentRisks = await Promise.all(
    segments.map(async (segment) => {
      const centerLat = (segment.startPoint.lat + segment.endPoint.lat) / 2;
      const centerLon = (segment.startPoint.lon + segment.endPoint.lon) / 2;

      const nearestFine = fineSegments.length > 0
        ? fineSegments.reduce((best, fs) => {
            const d = haversineKm(centerLat, centerLon, fs.midpoint.lat, fs.midpoint.lon);
            return d < best.dist ? { fs, dist: d } : best;
          }, { fs: fineSegments[0]!, dist: Infinity } as { fs: SegmentProfile; dist: number })
        : null;

      const district = getDistrictFromCoords(centerLat, centerLon);

      const [currentHazard, historicalHazard, weather] = await Promise.all([
        withTimeout(fetchHazard(district, centerLat, centerLon), 6000).catch(() => null),
        withTimeout(fetchHistoricalHazard(district, centerLat, centerLon, departureDate, 5), 6000).catch(() => null),
        withTimeout(
          fetchWeather(centerLat, centerLon),
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
        gradientOverride: nearestFine?.fs.gradient ?? null,
      });

      // NEW: Compute independent per-hazard scores (landslide, flood, weather, road, seismic)
      const independentScores = calculateIndependentHazardScores({
        sampledPoints,
        weather: {
          rain_mm_per_hr: weather?.rainfall ?? 0,
          wind_kph: (weather?.windSpeed ?? 0) * 3.6,
        },
        realtimeDisasters,
        historicalDisasters,
        avgLat: centerLat,
        avgGradient: nearestFine?.fs.gradient ?? null,
        hasRiverProximity: (nearestFine?.fs.riverProximityKm ?? Infinity) < 2,
        surfaceType: nearestFine?.fs.roadSurface?.surface ?? null,
        reliabilityScore: null, // will be populated from edge data at routing time
        landslideRisk: currentHazard?.landslideIndex ?? null,
        floodRisk: currentHazard?.floodIndex ?? null,
      });

      const disasterClusters = [
        ...(currentHazard?.floodIndex && currentHazard.floodIndex > 0
          ? [{ type: "flood" as const, lat: centerLat, lon: centerLon, location: district, region: inferNepalRegion(centerLat), count: Math.max(1, Math.round(currentHazard.floodIndex * 10)), recent: currentHazard.floodIndex >= 0.2, severityScore: Math.min(1, currentHazard.floodIndex) }]
          : []),
        ...(currentHazard?.landslideIndex && currentHazard.landslideIndex > 0
          ? [{ type: "landslide" as const, lat: centerLat, lon: centerLon, location: district, region: inferNepalRegion(centerLat), count: Math.max(1, Math.round(currentHazard.landslideIndex * 10)), recent: currentHazard.landslideIndex >= 0.2, severityScore: Math.min(1, currentHazard.landslideIndex) }]
          : []),
        ...(currentHazard?.earthquakeIndex && currentHazard.earthquakeIndex > 0
          ? [{ type: "earthquake" as const, lat: centerLat, lon: centerLon, location: district, region: inferNepalRegion(centerLat), count: Math.max(1, Math.round(currentHazard.earthquakeIndex * 10)), recent: currentHazard.earthquakeIndex >= 0.2, severityScore: Math.min(1, currentHazard.earthquakeIndex) }]
          : []),
        ...(floodCount > 0
          ? [{ type: "flood" as const, lat: centerLat, lon: centerLon, location: district, region: inferNepalRegion(centerLat), count: floodCount, recent: false, severityScore: Math.min(1, (historicalHazard?.historicalFloodRisk ?? 0)) }]
          : []),
        ...(landslideCount > 0
          ? [{ type: "landslide" as const, lat: centerLat, lon: centerLon, location: district, region: inferNepalRegion(centerLat), count: landslideCount, recent: false, severityScore: Math.min(1, (historicalHazard?.historicalLandslideRisk ?? 0)) }]
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
        hazardProfile: independentScores,
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
            sources: historicalHazard?.sources,
            yearsAnalysed: historicalHazard?.yearsAnalysed,
            notableEvents: historicalHazard?.notableEvents?.slice(0, 3) ?? [],
          },
          regionalPrior: {
            reasons: hazards.filter((h) => h.includes("(regional prior)")),
          },
        },
        hazardAssessment,
        gradient: nearestFine?.fs.gradient ?? null,
        roadSurface: nearestFine?.fs.roadSurface ?? undefined,
        riverProximityKm: nearestFine?.fs.riverProximityKm ?? null,
        elevationStart: nearestFine?.fs.elevationStart ?? null,
        elevationEnd: nearestFine?.fs.elevationEnd ?? null,
      };
    })
  );

  let avgRisk = segmentRisks.reduce((sum, s) => sum + s.riskScore, 0) / segmentRisks.length;

  // Monsoon season applies a base penalty to the route risk score
  const _monthJul = new Date().getMonth() + 1;
  const _isMonsoon = _monthJul >= 6 && _monthJul <= 9;
  if (_isMonsoon) {
    avgRisk = Math.min(1, avgRisk + 0.15);
  }

  const landslideZones = [...new Set(segmentRisks.filter(s => s.hazards.includes("Landslide risk")).map(s => s.startPoint.name || "Unknown"))];
  const floodZones = [...new Set(segmentRisks.filter(s => s.hazards.includes("Flood risk")).map(s => s.startPoint.name || "Unknown"))];
  const activeAlerts = [...new Set(segmentRisks.flatMap(s => s.hazards))];
  const weatherRisk = segmentRisks.find(s => s.weather)?.weather || "unknown";

  // Build segment hazard profiles lookup
  const segmentHazards: Record<number, IndependentHazardScores> = {};
  for (const s of segmentRisks) {
    if (s.hazardProfile) {
      segmentHazards[s.index] = s.hazardProfile;
    }
  }

  // Generate monsoon advisory
  const monsoonWarning = _isMonsoon && segmentRisks.some((s) => (s.hazardProfile?.roadConditionRisk ?? 0) > 50)
    ? "Monsoon season — road conditions may be poor on unpaved segments. Check for active road closures."
    : _isMonsoon
    ? "Monsoon season — expect rain and possible delays on mountain roads."
    : null;

  // Driver advisories
  const driverAdvisories: string[] = [];
  if (segmentRisks.some((s) => (s.hazardProfile?.landslideExposure ?? 0) > 60)) {
    driverAdvisories.push("⚠ High landslide exposure on route — exercise caution in hill/mountain segments");
  }
  if (segmentRisks.some((s) => (s.hazardProfile?.floodExposure ?? 0) > 60)) {
    driverAdvisories.push("⚠ High flood exposure — avoid low-lying segments during heavy rain");
  }
  if (segmentRisks.some((s) => (s.hazardProfile?.roadConditionRisk ?? 0) > 60)) {
    driverAdvisories.push("⚠ Poor road condition on some segments — 4WD recommended");
  }
  if (landslideZones.length > 0) {
    driverAdvisories.push(`Landslide-prone areas: ${landslideZones.join(", ")}`);
  }

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
    tripIntelligence: {
      optimalDepartureTime: _isMonsoon ? "Early morning (6-8 AM) before afternoon rains" : null,
      monsoonWarning,
      driverAdvisories,
      segmentHazards,
      seasonalNote: _isMonsoon
        ? "June-September monsoon — mountain roads may be affected by landslides and rain"
        : "October-May dry season — generally favourable travel conditions across Nepal",
    },
  };
}

function calculateSegmentHazardRisk(input: {
  sampledPoints: { lat: number; lon: number }[];
  weather?: { rain_mm_per_hr?: number; wind_kph?: number };
  realtimeDisasters?: { type: "flood" | "landslide" | "earthquake"; lat: number; lon: number }[];
  historicalDisasters?: { type: "flood" | "landslide"; lat: number; lon: number; count: number }[];
  gradientOverride?: number | null;
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

  if (rain > 30) { weatherRisk += 0.7; alerts.push("Heavy rain detected"); }
  else if (rain > 10) { weatherRisk += 0.4; alerts.push("Moderate rain detected"); }
  else if (rain > 2) { weatherRisk += 0.1; }
  if (wind > 60) weatherRisk += 0.2;
  else if (wind > 35) weatherRisk += 0.1;

  for (const d of realtime) {
    const minDist = minDistanceKm(points, d.lat, d.lon);
    if (minDist < 5) { realtimeRisk += 0.6; alerts.push(`Nearby real-time ${d.type} alert`); }
    else if (minDist < 10) { realtimeRisk += 0.3; alerts.push(`Regional ${d.type} alert`); }
  }

  for (const h of historical) {
    const minDist = minDistanceKm(points, h.lat, h.lon);
    if (minDist > 15) continue;
    if (h.count > 10) historicalRisk += 0.6;
    else if (h.count > 5) historicalRisk += 0.4;
    else if (h.count > 1) historicalRisk += 0.2;
    if (h.count > 1) alerts.push(`Past ${h.type} zone nearby`);
  }

  if (input.gradientOverride !== undefined && input.gradientOverride !== null) {
    const absGrad = Math.abs(input.gradientOverride);
    if (absGrad > 20) terrainRisk = 0.45;
    else if (absGrad > 12) terrainRisk = 0.3;
    else if (absGrad > 6) terrainRisk = 0.2;
    else terrainRisk = 0.1;
  } else {
    const center = points[Math.floor(points.length / 2)];
    if (center) {
      if (center.lat > 27.1) terrainRisk = 0.25;
      else if (center.lat > 26.7) terrainRisk = 0.15;
      else terrainRisk = 0.1;
    } else {
      terrainRisk = 0.12;
    }
  }

  const hasAnyInput = points.length > 0 || rain > 0 || wind > 0 || realtime.length > 0 || historical.length > 0;

  if (!hasAnyInput) {
    return { riskPercent: 15, riskLevel: "LOW", breakdown: { weather: 0, realtime: 0, historical: 0, terrain: 15 }, alerts: ["No data available, using baseline risk"], reason: "No data available, using baseline risk" };
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

  const riskLevel: "LOW" | "MEDIUM" | "HIGH" = riskPercent > 70 ? "HIGH" : riskPercent > 40 ? "MEDIUM" : "LOW";

  return { riskPercent, riskLevel, breakdown: { weather: Math.round(weightedWeather * 100), realtime: Math.round(weightedRealtime * 100), historical: Math.round(weightedHistorical * 100), terrain: Math.round(weightedTerrain * 100) }, alerts: [...new Set(alerts)] };
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

function scoreToLevel(score: number): "LOW" | "MEDIUM" | "HIGH" | "EXTREME" {
  if (score < 0.3) return "LOW";
  if (score < 0.5) return "MEDIUM";
  if (score < 0.7) return "HIGH";
  return "EXTREME";
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
    if (dist < minDist) { minDist = dist; closest = name; }
  }
  if (minDist > 80) { return getRegionFromCoords(lat, lon) ?? "Route corridor"; }
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

function buildNamedBreakpoints(waypoints: RouteWaypoint[], originName?: string, destinationName?: string): string[] {
  if (!waypoints.length) return [];
  const sampled = sampleWaypoints(waypoints, Math.max(1, Math.floor(waypoints.length / 12)));
  const names: string[] = [];
  if (originName) names.push(originName);
  for (const p of sampled) {
    const name = p.name ?? getDistrictFromCoords(p.lat, p.lon);
    if (name && names[names.length - 1] !== name) names.push(name);
  }
  if (destinationName && names[names.length - 1] !== destinationName) names.push(destinationName);
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

/**
 * Build RouteSegment[] from a display chain (polyline-projected named nodes).
 * Each pair of consecutive nodes becomes one segment.
 * Road identity (roadCode, roadName, junctions) is forward-filled from road transition nodes.
 */
function buildSegmentsFromDisplayChain(chain: RouteNode[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let currentRoadCode: string | undefined;
  let currentRoadName: string | undefined;

  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1];
    const to = chain[i];

    if (to.roadCode) {
      currentRoadCode = to.roadCode;
      currentRoadName = to.name;
    }

    const seg: RouteSegment = {
      index: i - 1,
      startPoint: { lat: from.lat, lon: from.lon, name: from.name },
      endPoint: { lat: to.lat, lon: to.lon, name: to.name },
      distance: Math.round(haversineKm(from.lat, from.lon, to.lat, to.lon) * 1000),
      riskScore: 0,
      riskLevel: "MEDIUM",
      hazards: [],
    };

    if (currentRoadCode) {
      seg.roadCode = currentRoadCode;
      seg.roadName = currentRoadName;
    }
    if (from.junction) seg.fromJunction = from.junction;
    if (to.junction) seg.toJunction = to.junction;

    segments.push(seg);
  }
  return segments;
}

/**
 * Convert a RouteAlternative (from buildRouteAlternatives) into a Route.
 * Used to surface multiple routing options in the UI.
 */
function alternativeToRoute(
  alt: import("@/lib/routing/types").RouteAlternative,
  index: number,
  origin: GeoPoint,
  destination: GeoPoint,
  primaryPolyline?: { coordinates: RouteCoordinate[]; encodedPolyline?: string },
): Route {
  const hs = alt.abstraction.highwaySegments;

  // Build waypoints from highway segment endpoints
  const waypoints: RouteWaypoint[] = [];
  let distAcc = 0;
  for (let i = 0; i < hs.length; i++) {
    const seg = hs[i];
    if (i === 0) {
      waypoints.push({
        lat: seg.fromLat,
        lon: seg.fromLon,
        name: seg.fromPlace,
        distanceFromStart: 0,
      });
    }
    waypoints.push({
      lat: seg.toLat,
      lon: seg.toLon,
      name: seg.toPlace,
      distanceFromStart: Math.round((distAcc + seg.distanceKm * 1000)),
    });
    distAcc += seg.distanceKm * 1000;
  }
  if (waypoints.length === 0) {
    waypoints.push(
      { lat: origin.lat, lon: origin.lon, name: origin.name, distanceFromStart: 0 },
      { lat: destination.lat, lon: destination.lon, name: destination.name, distanceFromStart: Math.round(alt.abstraction.totalDistanceKm * 1000) },
    );
  }

  const segments: RouteSegment[] = hs.map((s, i) => ({
    index: i,
    startPoint: { lat: s.fromLat, lon: s.fromLon, name: s.fromPlace },
    endPoint: { lat: s.toLat, lon: s.toLon, name: s.toPlace },
    distance: Math.round(s.distanceKm * 1000),
    riskScore: 0,
    riskLevel: "MEDIUM" as const,
    hazards: [],
    roadCode: s.roadCode,
    roadName: roadCodeName(s.roadCode),
  }));

  return {
    id: `alternative-${index + 1}`,
    name: alt.label,
    description: alt.description ?? `${index + 1} alternative route option`,
    waypoints,
    distance: Math.round(alt.abstraction.totalDistanceKm * 1000),
    duration: Math.round((alt.abstraction.totalDistanceKm / 50) * 3600 * 1000),
    riskScore: 0.5,
    riskLevel: "MEDIUM",
    hazards: { landslideZones: [], floodZones: [], activeAlerts: [], weatherRisk: "unknown", historicalRisk: 0.5 },
    segments,
    source: "dor-alternative",
    encodedPolyline: primaryPolyline?.encodedPolyline,
  };
}

function builtRouteToIntelligenceRoute(
  built: BuiltRoute,
  origin: GeoPoint,
  destination: GeoPoint,
  roadRoute?: { coordinates: RouteCoordinate[]; encodedPolyline?: string; legs?: { steps: RouteInstruction[] }[] },
  placesAlongRoute?: DetourInfo[],
  rankedStops?: RouteStop[],
  displayChain?: RouteNode[],  // XOR with built.nodes — display-only labeling
): Route {
  const routeNodes = displayChain ?? built.nodes;
  const routeSource = displayChain ? "polyline-projection" : built.source;

  let distAcc = 0;
  const nodeWaypoints: RouteWaypoint[] = routeNodes.map((n, i) => {
    if (i > 0) {
      distAcc += haversineKm(routeNodes[i - 1].lat, routeNodes[i - 1].lon, n.lat, n.lon) * 1000;
    }
    return { lat: n.lat, lon: n.lon, name: n.name, distanceFromStart: Math.round(distAcc) };
  });

  const polylineWaypoints: RouteWaypoint[] = roadRoute?.coordinates
    ? roadRoute.coordinates.map((p, i) => ({
        lat: p.lat,
        lon: p.lon,
        distanceFromStart: i === 0 ? 0 : Math.round((built.distance * i) / Math.max(roadRoute.coordinates.length - 1, 1)),
      }))
    : nodeWaypoints;

  // Build segments from abstraction (DOR priority), displayChain (ORS), or raw built.segments
  const segments: RouteSegment[] =
    built.abstraction?.highwaySegments?.length && built.provenance?.engine === "dor"
      ? built.abstraction.highwaySegments.map((hs, i) => ({
          index: i,
          startPoint: { lat: hs.fromLat, lon: hs.fromLon, name: hs.fromPlace },
          endPoint: { lat: hs.toLat, lon: hs.toLon, name: hs.toPlace },
          distance: Math.round(hs.distanceKm * 1000),
          riskScore: 0,
          riskLevel: "MEDIUM" as RouteSegment["riskLevel"],
          hazards: [],
          roadCode: hs.roadCode,
          roadName: roadCodeName(hs.roadCode),
        }))
      : displayChain
        ? buildSegmentsFromDisplayChain(displayChain)
        : built.segments.map((s) => ({
            index: s.index,
            startPoint: { lat: s.from.lat, lon: s.from.lon, name: s.from.name },
            endPoint: { lat: s.to.lat, lon: s.to.lon, name: s.to.name },
            distance: s.distance,
            riskScore: 0,
            riskLevel: (s.riskLevel ?? "MEDIUM") as RouteSegment["riskLevel"],
            hazards: s.hazards ?? [],
          }));

  const highwayLabel = built.abstraction?.highwaySegments?.length
    ? built.abstraction.highwaySegments.map((hs) => `${hs.roadCode}: ${hs.fromPlace}→${hs.toPlace}`).join(" → ")
    : null;
  const corridorLabel = routeNodes.length > 2 ? routeNodes.map((n) => n.name).join(" → ") : null;
  const routeName = highwayLabel ?? corridorLabel ?? generateRouteName(origin, destination, nodeWaypoints);

  const turnByTurn: RouteInstruction[] = [];
  if (roadRoute?.legs) {
    for (const leg of roadRoute.legs) {
      turnByTurn.push(...leg.steps);
    }
  }

  return {
    id: `segmented-${routeSource}`,
    name: routeName,
    description: built.resolutionNote ? `${routeName} (${built.resolutionNote})` : `${routeName} via real roads`,
    waypoints: polylineWaypoints,
    distance: built.distance,
    duration: built.duration,
    riskScore: 0.5,
    riskLevel: "MEDIUM",
    hazards: { landslideZones: [], floodZones: [], activeAlerts: [], weatherRisk: "unknown", historicalRisk: 0.5 },
    segments,
    source: routeSource,
    encodedPolyline: roadRoute?.encodedPolyline,
    placesAlongRoute,
    rankedStops: rankedStops?.slice(0, 10),
    turnByTurn: turnByTurn.slice(0, 60),
  };
}

function countCorridorStops(route: Route): number {
  const names = new Set<string>();
  for (const w of route.waypoints) { if (w.name) names.add(w.name); }
  for (const s of route.segments) {
    if (s.startPoint.name) names.add(s.startPoint.name);
    if (s.endPoint.name) names.add(s.endPoint.name);
  }
  return names.size;
}

async function ensureSegmentedWaypoints(route: Route, origin: GeoPoint, destination: GeoPoint): Promise<Route> {
  const hasStructure = route.segments.length >= 2 && countCorridorStops(route) >= 3;
  if (hasStructure) return route;

  try {
    const built = await buildSegmentedRoute({
      originLat: origin.lat, originLon: origin.lon, originName: origin.name,
      destinationLat: destination.lat, destinationLon: destination.lon, destinationName: destination.name,
    });
    return builtRouteToIntelligenceRoute(built, origin, destination);
  } catch {
    return route;
  }
}

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
      breakpoints: sampleWaypoints(route.waypoints, 10).map((p) => ({ lat: p.lat, lon: p.lon, name: p.name })),
      breakpointNames: buildNamedBreakpoints(route.waypoints, result.origin.name ?? "Your location", result.destination.name ?? "Destination"),
      hazards: { landslideZones: route.hazards.landslideZones, floodZones: route.hazards.floodZones, weatherRisk: route.hazards.weatherRisk },
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
      encodedPolyline: route.encodedPolyline,
      turnByTurn: route.turnByTurn,
      placesAlongRoute: route.placesAlongRoute?.slice(0, 10).map((p) => ({
        name: p.placeName,
        category: p.category,
        detourMinutes: p.detourMinutes,
        distanceFromRouteKm: p.distanceFromRouteKm,
        score: p.score,
        lat: p.lat,
        lon: p.lon,
      })),
      rankedStops: route.rankedStops?.slice(0, 5).map((s) => ({
        name: s.name,
        score: s.score,
        detourTime: s.detourTime,
        category: s.category,
      })),
    })),
    bestRoute: result.bestRoute ? { name: result.bestRoute.name, riskLevel: result.bestRoute.riskLevel } : null,
  };
}
