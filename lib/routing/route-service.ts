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
import { runRoute, type RouteResult as DorRouteResult } from "@/scripts/route-engine";

import {
  abstractionFromRouteResult,
  classifyRouteIntent,
  generateRouteDescription,
  roadCodeName,
  type EdgeShape,
} from "@/lib/routing/route-abstraction";
import {
  explainRoute,
  compareAlternatives,
} from "@/lib/routing/route-explanation";
import { extractRouteNames } from "@/lib/routing/route-name-extractor";

import type {
  BuildRouteInput,
  BuiltRoute,
  BuiltRouteSegment,
  NamedRoute,
  PerSegmentRoute,
  ResolvedPlace,
  RouteNode,
  RouteInstruction,
  VehicleProfile,
  GeoPoint,
  RouteIntent,
  RouteAlternative,
  RouteAbstraction,
  RouteProvenance,
} from "@/lib/routing/types";
import { RouteExplanation } from "@/lib/routing/route-explanation";
import type { GraphEdge } from "@/lib/routing/segment-graph";

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
  nodeSource: string
): Promise<{ chain: RouteNode[]; source: string }> {
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

// ─── Route Alternative Builder (Stage 7) ──────────────────────────

interface ModeRun {
  mode: "fastest" | "balanced" | "highway-preferred";
  intent: RouteIntent;
}

const MODE_RUNS: ModeRun[] = [
  { mode: "fastest", intent: "fastest" },
  { mode: "balanced", intent: "balanced" },
  { mode: "highway-preferred", intent: "highway" },
];

/** Road codes to try as preferRoad for alternative diversity. */
const PREFER_ROAD_COMBOS: (string | undefined)[] = [
  undefined,        // default — no preference
  "NH09",           // Madan Bhandari Highway
  "NH08",           // Koshi Highway
  "NH01",           // Mahendra Highway
  "NH16",           // Sagarmatha Highway
];

function buildRouteDisplaySegments(abstraction: RouteAbstraction): RouteAlternative["displaySegments"] {
  return abstraction.highwaySegments.map((s) => ({
    roadCode: s.roadCode,
    roadName: roadCodeName(s.roadCode),
    fromPlace: s.fromPlace,
    toPlace: s.toPlace,
    distanceKm: s.distanceKm,
  }));
}

function pickRouteLabel(intent: RouteIntent, abstraction: RouteAbstraction): string {
  const roads = abstraction.highwaySegments.map((s) => roadCodeName(s.roadCode));
  const unique = [...new Set(roads)];
  const roadInfo = unique.length > 0 ? `via ${unique.join(", ")}` : "";

  const intentLabel = intent === "fastest"
    ? "Fastest"
    : intent === "scenic"
      ? "Scenic"
      : intent === "highway"
        ? "Highway"
        : "Balanced";
  return `${intentLabel} route ${roadInfo}`.trim();
}

export function buildRouteAlternatives(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
  originName: string,
  destinationName: string,
  preferRoad?: string,
): RouteAlternative[] {
  const seen = new Set<string>();
  const alternatives: RouteAlternative[] = [];

  // Try combinations of mode × preferRoad for genuine diversity
  const roadCombos = PREFER_ROAD_COMBOS.includes(preferRoad)
    ? PREFER_ROAD_COMBOS
    : [preferRoad, ...PREFER_ROAD_COMBOS.filter((r) => r !== undefined)];

  for (const config of MODE_RUNS) {
    for (const roadCombo of [...new Set(roadCombos)]) {
      const result = runRoute({
        startLat,
        startLon,
        endLat,
        endLon,
        mode: config.mode,
        preferRoad: roadCombo,
      });

      if (!result.found || result.statistics.totalDistanceKm <= 0) continue;

      // Deduplicate by road-chain signature
      const sig = result.roadSequence.map((rs) => rs.roadCode).join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);

      const intent = classifyRouteIntent(result.statistics.metrics, config.mode);
      const abstraction = abstractionFromRouteResult(
        result.path.nodes,
        result.path.edges as unknown as EdgeShape[],
        result.roadSequence,
        result.statistics,
        originName,
        destinationName,
        intent,
        startLat,
        startLon,
      );

      alternatives.push({
        label: pickRouteLabel(intent, abstraction),
        intent,
        abstraction,
        description: generateRouteDescription(abstraction.highwaySegments),
        displaySegments: buildRouteDisplaySegments(abstraction),
      });
    }
  }

  // Limit to top 3 most diverse (shortest chain → most chain difference)
  alternatives.sort((a, b) => a.abstraction.totalDistanceKm - b.abstraction.totalDistanceKm);

  return alternatives.slice(0, 4);
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

  if (input.dorRoutingMode) {
    const dorResult: DorRouteResult = runRoute({
      startLat: origin.lat,
      startLon: origin.lon,
      endLat: destination.lat,
      endLon: destination.lon,
      mode: input.dorRoutingMode,
      preferRoad: input.dorPreferRoad,
    });

    if (!dorResult.found) {
      return {
        origin, destination,
        nodes: chain,
        waypoints: [],
        segments: [],
        polyline: [],
        distance: 0,
        duration: 0,
        instructions: [],
        source: `dor:${input.dorRoutingMode}:not-found`,
        provenance: {
          engine: "dor",
          mode: input.dorRoutingMode,
          validationStatus: "empty",
          isTraceValid: false,
          isMetricComplete: false,
        },
        resolutionNote: [originNote, destNote].filter(Boolean).join("; "),
      };
    }

    const dorNodes: RouteNode[] = dorResult.path.nodes.map((n: any) => ({
      lat: n.centroidLat,
      lon: n.centroidLon,
      name: `${n.roadCode} ${n.startPlace}→${n.endPlace}`,
      roadCode: n.roadCode,
      routeNodeId: n.id,
    }));

    const dorPolyline: Array<{ lat: number; lon: number }> = dorResult.path.nodes.map((n: any) => ({
      lat: n.centroidLat,
      lon: n.centroidLon,
    }));

    const distanceKm = dorResult.statistics.totalDistanceKm;
    const dorSegments: BuiltRouteSegment[] = dorNodes.slice(0, -1).map((from, i) => ({
      index: i,
      from,
      to: dorNodes[i + 1],
      distance: Math.round(haversineKm(from.lat, from.lon, dorNodes[i + 1].lat, dorNodes[i + 1].lon) * 1000),
      roadCode: (dorResult.path.edges[i] as unknown as GraphEdge | undefined)?.roadCode,
    }));

    const displayWaypoints = dorNodes.map((n, order) => ({ ...n, order }));
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

    const roadChanges = dorResult.statistics.roadChanges;
    const roadSequenceStr = dorResult.roadSequence.map((r: any) => `${r.roadCode} (${r.fromPlace}→${r.toPlace})`);

    // ── Route Abstraction Layer (Stage 7) ──
    const dorIntent = classifyRouteIntent(dorResult.statistics.metrics, input.dorRoutingMode);
    const dorAbstraction = abstractionFromRouteResult(
      dorResult.path.nodes,
      dorResult.path.edges as unknown as EdgeShape[],
      dorResult.roadSequence,
      dorResult.statistics,
      origin.name,
      destination.name,
      dorIntent,
      input.originLat,
      input.originLon,
    );
    const dorAlternatives = dorResult.found
      ? buildRouteAlternatives(
          origin.lat, origin.lon,
          destination.lat, destination.lon,
          origin.name,
          destination.name,
          input.dorPreferRoad,
        )
      : [];

    // ── Route Explanation Layer (Stage 8) ──
    const dorProvenance: RouteProvenance = {
      engine: "dor",
      mode: input.dorRoutingMode,
      validationStatus: "passed",
      isTraceValid: true,
      isMetricComplete: true,
    };
    const dorExplanation: RouteExplanation | undefined = dorResult.found
      ? explainRoute(dorResult, dorAbstraction, input.dorRoutingMode ?? "balanced", dorProvenance)
      : undefined;
    if (dorExplanation && dorAlternatives.length > 0) {
      const { reasons } = compareAlternatives(dorAbstraction, dorAlternatives);
      dorExplanation.alternativeComparisons = reasons;
    }

    const dorEnriched = input.includeNamedPlaces && dorPolyline.length >= 2
      ? await extractRouteNames(input.originLat, input.originLon, input.destinationLat!, input.destinationLon!, dorPolyline).catch(() => undefined)
      : undefined;

    return {
      origin, destination,
      nodes: dorNodes,
      waypoints: displayWaypoints,
      segments: dorSegments,
      polyline: dorPolyline,
      distance: Math.round(distanceKm * 1000),
      duration: Math.max(1800, Math.round((distanceKm / 35) * 3600)),
      instructions: [],
      source: `dor:${input.dorRoutingMode}`,
      provenance: {
        engine: "dor",
        mode: input.dorRoutingMode,
        validationStatus: "passed",
        isTraceValid: true,
        isMetricComplete: true,
      },
      resolutionNote: `Road changes: ${roadChanges}. Sequence: ${roadSequenceStr.join(" → ")}`,
      dorMetrics: dorResult.statistics.metrics,
      abstraction: dorAbstraction,
      routeAlternatives: dorAlternatives,
      explanation: dorExplanation,
      namedRoute: dorEnriched ?? undefined,
    };
  }

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
