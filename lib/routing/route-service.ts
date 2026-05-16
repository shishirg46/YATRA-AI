import { haversineKm, isPointInNepal } from "@/lib/routing/geo";
import { prepareMapPolyline } from "@/lib/routing/polyline-simplify";
import type { RouteInstruction } from "@/lib/routing/types";
import { fetchOsrmRouteThroughNodes } from "@/lib/routing/osrm-client";
import {
  getAllKnownPlaces,
  resolveDestination,
  resolveOrigin,
} from "@/lib/routing/place-resolver";
import { findNearestRouteNode } from "@/lib/routing/node-graph";
import {
  assembleNodeChain,
  buildIntermediateNodes,
  loadTemplateNodes,
} from "@/lib/routing/waypoint-builder";

async function findNearestRouteNodeFromCoords(lat: number, lon: number) {
  return findNearestRouteNode(lat, lon, 50);
}
import type {
  BuildRouteInput,
  BuiltRoute,
  BuiltRouteSegment,
  ResolvedPlace,
  RouteNode,
} from "@/lib/routing/types";

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

async function applyOsrmToChain(
  chain: RouteNode[],
  nodeSource: string
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
  const osrmResults = await fetchOsrmRouteThroughNodes(chain, false);
  if (osrmResults && osrmResults.length > 0) {
    const primary = osrmResults[0];
    const alternatives = osrmResults.slice(1).map((alt) => ({
      polyline: alt.coordinates,
      distance: alt.distance,
      duration: alt.duration,
      instructions: alt.instructions || [],
    }));

    return {
      polyline: primary.coordinates,
      distance: primary.distance,
      duration: primary.duration,
      source: `osrm:${nodeSource}`,
      instructions: primary.instructions,
      alternatives,
    };
  }

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

/** Ensure long routes pass through at least one known intermediate place. */
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

  const places = await getAllKnownPlaces();
  let best: RouteNode | null = null;
  let bestScore = -Infinity;
  for (const loc of places) {
    if (loc.id === origin.id || loc.id === destination.id) continue;
    const progress =
      haversineKm(origin.lat, origin.lon, loc.latitude, loc.longitude) / Math.max(totalKm, 1);
    if (progress <= 0.08 || progress >= 0.92) continue;
    const score = 100 - progress * 20;
    if (score > bestScore) {
      bestScore = score;
      best = {
        lat: loc.latitude,
        lon: loc.longitude,
        name: loc.name,
        locationId: loc.id,
      };
    }
  }

  if (best) {
    return {
      chain: assembleNodeChain(origin, [best], destination),
      source: "corridor-fallback",
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

  const destHub = await findNearestRouteNodeFromCoords(destination.lat, destination.lon);
  const { nodes: intermediates, source: nodeSource } = await buildIntermediateNodes(
    origin,
    destination,
    originNodeId ?? input.originRouteNodeId,
    input.destinationRouteNodeId ?? destHub?.id
  );

  let chain = assembleNodeChain(origin, intermediates, destination);
  let source = nodeSource;

  const expanded = await ensureMultiStopChain(origin, destination, chain, source);
  chain = expanded.chain;
  source = expanded.source;

  const { polyline, distance, duration, source: routingSource, instructions, alternatives } = await applyOsrmToChain(
    chain,
    source
  );

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
    source: routingSource,
    resolutionNote: [originNote, destNote].filter(Boolean).join("; "),
  };
}

/** Map intelligence segments onto built route nodes when available. */
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

/** Filter polyline to Nepal bbox — prevents world-map glitches from bad coordinates. */
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
    source: built.source,
    resolutionNote: built.resolutionNote,
  };
}
