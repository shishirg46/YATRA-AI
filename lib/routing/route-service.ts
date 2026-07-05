import { haversineKm, isPointInNepal } from "@/lib/routing/geo";
import { prepareMapPolyline } from "@/lib/routing/polyline-simplify";
import { fetchRoadRoute, fetchRouteGeometry } from "@/lib/routing/openroute-service";
import { createRouteBuffer } from "@/lib/routing/route-buffer";
import { findPlacesAlongRoute } from "@/lib/routing/places-along-route";
import { rankPlacesForRoute } from "@/lib/routing/route-ranking";
import { routeCache, routeGeometryCache, makeRouteCacheKey } from "@/lib/routing/route-cache";
import { isRouteSafeForVehicle, getVehicleProfile } from "@/lib/routing/nepal-profiles";
import { findNearestRouteNode } from "@/lib/routing/node-graph";
import {
  resolveDestination,
  resolveOrigin,
} from "@/lib/routing/place-resolver";
import {
  assembleNodeChain,
  buildIntermediateNodes,
  loadTemplateNodes,
} from "@/lib/routing/waypoint-builder";
import { extractRouteNames } from "@/lib/routing/route-name-extractor";

import type {
  BuildRouteInput,
  BuiltRoute,
  BuiltRouteSegment,
  PerSegmentRoute,
  ResolvedPlace,
  RouteNode,
  RouteInstruction,
  VehicleProfile,
  GeoPoint,
  RouteProvenance,
} from "@/lib/routing/types";

async function findNearestRouteNodeFromCoords(lat: number, lon: number) {
  return findNearestRouteNode(lat, lon, 50);
}

function buildSegmentsFromNodes(
  nodes: RouteNode[],
  segmentRisk?: Array<{ riskLevel?: BuiltRouteSegment["riskLevel"]; riskScore?: number; hazards?: string[] }>
): BuiltRouteSegment[] {
  const segments: BuiltRouteSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const risk = segmentRisk?.[i];
    segments.push({
      index: i,
      from,
      to,
      distance: Math.round(haversineKm(from.lat, from.lon, to.lat, to.lon) * 1000),
      riskLevel: risk?.riskLevel ?? "MEDIUM",
      riskScore: risk?.riskScore,
      hazards: risk?.hazards ?? [],
    });
  }
  return segments;
}

function fallbackPolyline(nodes: RouteNode[]): Array<{ lat: number; lon: number }> {
  return nodes.map((n) => ({ lat: n.lat, lon: n.lon }));
}

async function getRoadRouteBetween(
  origin: ResolvedPlace,
  destination: ResolvedPlace,
  vehicle: VehicleProfile = "car"
): Promise<{
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
  instructions?: RouteInstruction[];
  source: string;
}> {
  const cacheKey = makeRouteCacheKey(
    origin.lat, origin.lon,
    destination.lat, destination.lon,
    vehicle
  );

  const tags = [`dest:${destination.id ?? "unknown"}`];

  return routeGeometryCache.getOrFetch(
    cacheKey,
    async () => {
      const start: GeoPoint = { lat: origin.lat, lon: origin.lon, name: origin.name };
      const end: GeoPoint = { lat: destination.lat, lon: destination.lon, name: destination.name };

      const route = await fetchRouteGeometry(start, end, vehicle);

      const instructions: RouteInstruction[] = [];
      for (const leg of route.legs) {
        for (const step of leg.steps) {
          instructions.push(step);
        }
      }

      return {
        polyline: route.coordinates,
        distance: route.distance,
        duration: route.duration,
        instructions,
        source: `openrouteservice:${vehicle}`,
      };
    },
    15 * 60 * 1000,
    tags,
  );
}

async function applyOsrmToChain(
  chain: RouteNode[],
  nodeSource: string,
  vehicle: VehicleProfile = "car"
): Promise<{
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
  source: string;
  instructions?: RouteInstruction[];
  alternatives?: Array<{
    polyline: Array<{ lat: number; lon: number }>;
    distance: number;
    duration: number;
    instructions: RouteInstruction[];
  }>;
}> {
  if (chain.length < 2) {
    return {
      polyline: [],
      distance: 0,
      duration: 0,
      source: "empty-chain",
    };
  }

  try {
    const start: GeoPoint = { lat: chain[0].lat, lon: chain[0].lon, name: chain[0].name };
    const end: GeoPoint = { lat: chain[chain.length - 1].lat, lon: chain[chain.length - 1].lon, name: chain[chain.length - 1].name };

    const waypoints = chain.slice(1, -1).map((n) => ({
      lat: n.lat,
      lon: n.lon,
      name: n.name,
    }));

    const routes = await fetchRoadRoute(start, end, vehicle, {
      alternatives: true,
      waypoints: waypoints.length > 0 ? waypoints : undefined,
    });

    if (routes.length === 0) {
      throw new Error("No routes returned");
    }

    const primary = routes[0];
    const alternatives = routes.slice(1).map((alt) => ({
      polyline: alt.coordinates,
      distance: alt.distance,
      duration: alt.duration,
      instructions: alt.legs.flatMap((l) => l.steps),
    }));

    return {
      polyline: primary.coordinates,
      distance: primary.distance,
      duration: primary.duration,
      source: `openrouteservice:${vehicle}:${nodeSource}`,
      instructions: primary.legs.flatMap((l) => l.steps),
      alternatives,
    };
  } catch {
    let distance = 0;
    for (let i = 1; i < chain.length; i++) {
      distance += Math.round(
        haversineKm(chain[i - 1].lat, chain[i - 1].lon, chain[i].lat, chain[i].lon) * 1000
      );
    }
    return {
      polyline: fallbackPolyline(chain),
      distance,
      duration: Math.max(1800, Math.round((distance / 1000 / 35) * 3600)),
      source: `estimated:${nodeSource}`,
    };
  }
}

async function applyPerSegmentRouting(
  chain: RouteNode[],
  vehicle: VehicleProfile = "car"
): Promise<{
  segmentRoutes: PerSegmentRoute[];
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
  instructions?: RouteInstruction[];
}> {
  const segmentRoutes: PerSegmentRoute[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  const fullPolyline: Array<{ lat: number; lon: number }> = [];
  const allInstructions: RouteInstruction[] = [];

  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const to = chain[i + 1];

    try {
      const start: GeoPoint = { lat: from.lat, lon: from.lon, name: from.name };
      const end: GeoPoint = { lat: to.lat, lon: to.lon, name: to.name };
      const routes = await fetchRoadRoute(start, end, vehicle, { alternatives: true });

      const primary = routes[0];
      const alternatives = routes.slice(1).map((alt) => ({
        polyline: alt.coordinates,
        distance: alt.distance,
        duration: alt.duration,
        instructions: alt.legs.flatMap((l) => l.steps),
      }));

      if (primary) {
        totalDistance += primary.distance;
        totalDuration += primary.duration;
        fullPolyline.push(...primary.coordinates);
        if (primary.legs) {
          for (const leg of primary.legs) {
            allInstructions.push(...leg.steps);
          }
        }
      }

      segmentRoutes.push({
        from,
        to,
        polyline: primary?.coordinates || fallbackPolyline([from, to]),
        distance: primary?.distance || Math.round(haversineKm(from.lat, from.lon, to.lat, to.lon) * 1000),
        duration: primary?.duration || 0,
        instructions: primary?.legs.flatMap((l) => l.steps),
        alternatives,
      });
    } catch {
      const legDist = Math.round(haversineKm(from.lat, from.lon, to.lat, to.lon) * 1000);
      segmentRoutes.push({
        from,
        to,
        polyline: fallbackPolyline([from, to]),
        distance: legDist,
        duration: Math.round((legDist / 1000 / 35) * 3600),
        alternatives: [],
      });
    }
  }

  return {
    segmentRoutes,
    polyline: fullPolyline,
    distance: totalDistance,
    duration: totalDuration,
    instructions: allInstructions.length > 0 ? allInstructions : undefined,
  };
}

async function ensureMultiStopChain(
  origin: ResolvedPlace,
  destination: ResolvedPlace,
  chain: RouteNode[],
  nodeSource: string,
  _depth = 0
): Promise<{ chain: RouteNode[]; source: string }> {
  if (_depth > 2) return { chain, source: nodeSource };
  const totalKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
  if (chain.length > 2 || totalKm <= 25) {
    return { chain, source: nodeSource };
  }

  if (origin.id && destination.id) {
    const template = await loadTemplateNodes(origin.id, destination.id);
    if (template && template.length > 2) {
      return { chain: assembleNodeChain(origin, template, destination), source: "template-retry" };
    }
  }

  const retry = await buildIntermediateNodes(origin, destination);
  if (retry.nodes.length > 0) {
    return {
      chain: assembleNodeChain(origin, retry.nodes, destination),
      source: retry.source,
    };
  }

  return { chain, source: nodeSource };
}

export async function buildSegmentedRoute(input: BuildRouteInput): Promise<BuiltRoute> {
  if (!isPointInNepal(input.originLat, input.originLon)) {
    throw new Error("Origin is outside Nepal. This service is only available for locations within Nepal.");
  }
  if (input.destinationLat !== undefined && input.destinationLon !== undefined && !isPointInNepal(input.destinationLat, input.destinationLon)) {
    throw new Error("Destination is outside Nepal. This service is only available for locations within Nepal.");
  }

  const vehicle: VehicleProfile = input.vehicle ?? "car";

  const { place: originResolved, note: originNote, routeNodeId: originNodeId } = await resolveOrigin(
    input.originLat,
    input.originLon,
    input.originName,
    input.originRouteNodeId
  );

  const origin: ResolvedPlace = {
    ...originResolved,
    displayLat: input.originDisplayLat ?? originResolved.displayLat ?? originResolved.lat,
    displayLon: input.originDisplayLon ?? originResolved.displayLon ?? originResolved.lon,
  };

  const { place: destinationResolved, note: destNote } = await resolveDestination({
    destinationId: input.destinationId,
    destinationName: input.destinationName,
    destinationLat: input.destinationLat,
    destinationLon: input.destinationLon,
  });

  const destination: ResolvedPlace = {
    ...destinationResolved,
    displayLat: input.destinationDisplayLat ?? destinationResolved.lat,
    displayLon: input.destinationDisplayLon ?? destinationResolved.lon,
  };

  if (input.waypoints && input.waypoints.length > 0) {
    const chain = assembleNodeChain(origin, input.waypoints, destination);
    const source = "user-waypoints";

    let segmentRoutes: PerSegmentRoute[] | undefined;
    let polyline: Array<{ lat: number; lon: number }>;
    let distance: number;
    let duration: number;
    let instructions: RouteInstruction[] | undefined;
    let alternatives: BuiltRoute["alternatives"];
    let provenance: RouteProvenance;

    if (input.perSegmentRouting) {
      const perSeg = await applyPerSegmentRouting(chain, vehicle);
      segmentRoutes = perSeg.segmentRoutes;
      polyline = perSeg.polyline;
      distance = perSeg.distance;
      duration = perSeg.duration;
      instructions = perSeg.instructions;
      alternatives = undefined;
      provenance = {
        engine: "osrm",
        validationStatus: perSeg.distance > 0 ? "passed" : "fallback",
        isTraceValid: false,
        isMetricComplete: false,
      };
    } else {
      const osrm = await applyOsrmToChain(chain, source, vehicle);
      polyline = osrm.polyline;
      distance = osrm.distance;
      duration = osrm.duration;
      instructions = osrm.instructions;
      alternatives = osrm.alternatives;
      provenance = {
        engine: osrm.source?.startsWith("estimated") ? "estimated" : "osrm",
        validationStatus: osrm.source?.startsWith("estimated") ? "fallback" : "passed",
        fallbackReason: osrm.source?.startsWith("estimated") ? "osrm_fetch_failed" : undefined,
        isTraceValid: false,
        isMetricComplete: false,
      };
    }

    const segments = buildSegmentsFromNodes(chain);

    const displayWaypoints = chain.map((n, order) => ({
      lat: n.lat, lon: n.lon, name: n.name, order,
    }));
    if (displayWaypoints.length > 0) {
      displayWaypoints[0] = { ...displayWaypoints[0], lat: origin.displayLat ?? origin.lat, lon: origin.displayLon ?? origin.lon, name: origin.name };
      const last = displayWaypoints.length - 1;
      displayWaypoints[last] = { ...displayWaypoints[last], lat: destination.displayLat ?? destination.lat, lon: destination.displayLon ?? destination.lon, name: destination.name };
    }

    const enriched = input.includeNamedPlaces && polyline.length >= 2
      ? await extractRouteNames(input.originLat, input.originLon, input.destinationLat!, input.destinationLon!, polyline).catch(() => undefined)
      : undefined;

    return {
      origin, destination,
      nodes: chain,
      waypoints: displayWaypoints,
      segments, polyline, distance, duration,
      instructions, alternatives,
      segmentRoutes,
      source,
      provenance,
      resolutionNote: [originNote, destNote].filter(Boolean).join("; "),
      namedRoute: enriched ?? undefined,
    };
  }

  const destHub = await findNearestRouteNodeFromCoords(destination.lat, destination.lon);
  const { nodes: intermediates, source: nodeSource } = await buildIntermediateNodes(
    origin,
    destination,
    originNodeId ?? input.originRouteNodeId,
    input.destinationRouteNodeId ?? destHub?.id,
    input.dynamicOsmRouting
  );

  let chain = assembleNodeChain(origin, intermediates, destination);
  let source = nodeSource;
  const expanded = await ensureMultiStopChain(origin, destination, chain, source);
  chain = expanded.chain;
  source = expanded.source;

  let segmentRoutes: PerSegmentRoute[] | undefined;
  let polyline: Array<{ lat: number; lon: number }>;
  let distance: number;
  let duration: number;
  let instructions: RouteInstruction[] | undefined;
  let alternatives: BuiltRoute["alternatives"];
  let provenance: RouteProvenance;

  if (input.perSegmentRouting) {
    const perSeg = await applyPerSegmentRouting(chain, vehicle);
    segmentRoutes = perSeg.segmentRoutes;
    polyline = perSeg.polyline;
    distance = perSeg.distance;
    duration = perSeg.duration;
    instructions = perSeg.instructions;
    alternatives = undefined;
    provenance = {
      engine: "osrm",
      validationStatus: perSeg.distance > 0 ? "passed" : "fallback",
      isTraceValid: false,
      isMetricComplete: false,
    };
  } else {
    const osrm = await applyOsrmToChain(chain, source, vehicle);
    polyline = osrm.polyline;
    distance = osrm.distance;
    duration = osrm.duration;
    instructions = osrm.instructions;
    alternatives = osrm.alternatives;
    provenance = {
      engine: osrm.source?.startsWith("estimated") ? "estimated" : "osrm",
      validationStatus: osrm.source?.startsWith("estimated") ? "fallback" : "passed",
      fallbackReason: osrm.source?.startsWith("estimated") ? "osrm_fetch_failed" : undefined,
      isTraceValid: false,
      isMetricComplete: false,
    };
  }

  const segments = buildSegmentsFromNodes(chain);

  const displayWaypoints = chain.map((n, order) => ({
    lat: n.lat,
    lon: n.lon,
    name: n.name,
    order,
  }));
  if (displayWaypoints.length > 0) {
    displayWaypoints[0] = {
      ...displayWaypoints[0],
      lat: origin.displayLat ?? origin.lat,
      lon: origin.displayLon ?? origin.lon,
      name: origin.name,
    };
    const last = displayWaypoints.length - 1;
    displayWaypoints[last] = {
      ...displayWaypoints[last],
      lat: destination.displayLat ?? destination.lat,
      lon: destination.displayLon ?? destination.lon,
      name: destination.name,
    };
  }

  const fallbackEnriched = input.includeNamedPlaces && polyline.length >= 2
    ? await extractRouteNames(input.originLat, input.originLon, input.destinationLat!, input.destinationLon!, polyline).catch(() => undefined)
    : undefined;

  return {
    origin,
    destination,
    nodes: chain,
    waypoints: displayWaypoints,
    segments,
    polyline,
    distance,
    duration,
    instructions,
    alternatives,
    segmentRoutes,
    source: source,
    provenance,
    resolutionNote: [originNote, destNote].filter(Boolean).join("; "),
    namedRoute: fallbackEnriched ?? undefined,
  };
}

export function mergeSegmentRisk(
  built: BuiltRoute,
  intelligenceSegments?: Array<{
    from?: { lat: number; lon: number; name?: string };
    to?: { lat: number; lon: number; name?: string };
    riskLevel?: string;
    riskScore?: number;
    hazards?: string[];
  }>
): BuiltRoute {
  if (!intelligenceSegments?.length) return built;

  const merged = built.segments.map((seg, i) => {
    const intel = intelligenceSegments[i] ?? intelligenceSegments[intelligenceSegments.length - 1];
    if (!intel) return seg;
    const level = intel.riskLevel as BuiltRouteSegment["riskLevel"] | undefined;
    return {
      ...seg,
      from: { ...seg.from, name: intel.from?.name ?? seg.from.name },
      to: { ...seg.to, name: intel.to?.name ?? seg.to.name },
      riskLevel: level ?? seg.riskLevel,
      riskScore: intel.riskScore ?? seg.riskScore,
      hazards: intel.hazards ?? seg.hazards,
    };
  });

  return { ...built, segments: merged };
}

function filterNepalPolyline(
  points: Array<{ lat: number; lon: number }>
): Array<{ lat: number; lon: number }> {
  return points.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      p.lat >= 26.3 &&
      p.lat <= 30.5 &&
      p.lon >= 80 &&
      p.lon <= 88.2
  );
}

const MAX_INSTRUCTIONS = 40;

function capInstructions(instructions?: RouteInstruction[]): RouteInstruction[] | undefined {
  if (!instructions?.length) return instructions;
  if (instructions.length <= MAX_INSTRUCTIONS) return instructions;
  const step = Math.ceil(instructions.length / MAX_INSTRUCTIONS);
  return instructions.filter((_, i) => i % step === 0 || i === instructions.length - 1);
}

export function toMapPayload(built: BuiltRoute) {
  const nodeWaypoints = built.waypoints.length > 0
    ? built.waypoints
    : built.nodes.map((n, order) => ({
        lat: n.lat,
        lon: n.lon,
        name: n.name,
        order,
      }));

  const filtered = filterNepalPolyline(built.polyline);
  const polyline =
    filtered.length >= 2
      ? prepareMapPolyline(filtered, { toleranceKm: 0.35, maxPoints: 80 })
      : nodeWaypoints.map((w) => ({ lat: w.lat, lon: w.lon }));

  return {
    waypoints: nodeWaypoints,
    polyline,
    segments: built.segments.map((s) => ({
      index: s.index,
      startLat: s.from.lat,
      startLon: s.from.lon,
      endLat: s.to.lat,
      endLon: s.to.lon,
      distance: s.distance,
      riskLevel: s.riskLevel ?? "MEDIUM",
      hazards: s.hazards ?? [],
      fromName: s.from.name,
      toName: s.to.name,
    })),
    distance: built.distance,
    duration: built.duration,
    nodes: built.nodes.map((n) => ({ name: n.name, lat: n.lat, lon: n.lon })),
    origin: built.origin,
    destination: built.destination,
    instructions: capInstructions(built.instructions),
    alternatives: built.alternatives?.map((alt) => ({
      ...alt,
      polyline: prepareMapPolyline(filterNepalPolyline(alt.polyline), { maxPoints: 60 }),
      instructions: capInstructions(alt.instructions) ?? [],
    })),
    segmentRoutes: built.segmentRoutes?.map((sr) => ({
      from: sr.from,
      to: sr.to,
      polyline: prepareMapPolyline(filterNepalPolyline(sr.polyline), { maxPoints: 60 }),
      distance: sr.distance,
      duration: sr.duration,
      instructions: capInstructions(sr.instructions),
      alternatives: sr.alternatives.map((alt) => ({
        ...alt,
        polyline: prepareMapPolyline(filterNepalPolyline(alt.polyline), { maxPoints: 60 }),
        instructions: capInstructions(alt.instructions) ?? [],
      })),
    })),
    source: built.source,
    resolutionNote: built.resolutionNote,
    abstraction: built.abstraction ?? null,
    namedRoute: built.namedRoute ?? null,
    provenance: built.provenance,
  };
}

export async function getRouteIntelligence(
  start: GeoPoint,
  end: GeoPoint,
  vehicle: VehicleProfile = "car"
) {
  const safety = isRouteSafeForVehicle(start.lat, end.lat, vehicle);

  const route = await fetchRouteGeometry(start, end, vehicle);

  const buffer = await createRouteBuffer(route.coordinates, vehicle);

  const placesAlongRoute = await findPlacesAlongRoute({
    bufferWkt: buffer.normal.wkt,
    radiusMeters: buffer.normal.radiusMeters,
    mainRoute: route.coordinates,
    vehicle,
  });

  const { stops, bestStop } = rankPlacesForRoute(placesAlongRoute, route.coordinates);

  return {
    route,
    buffer,
    placesAlongRoute,
    rankedStops: stops,
    bestStop,
    vehicleProfile: vehicle,
    safety,
  };
}
