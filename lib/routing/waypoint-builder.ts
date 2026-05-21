import { prisma } from "@/lib/prisma";
import { distanceToSegmentKm, haversineKm } from "@/lib/routing/geo";
import { buildGraphWaypoints, findNearestRouteNode } from "@/lib/routing/node-graph";
import { getAllKnownPlaces } from "@/lib/routing/place-resolver";
import { fetchOsmRoadNodesBetween } from "@/lib/routing/osm-road-fetcher";
import type { ResolvedPlace, RouteNode } from "@/lib/routing/types";

export async function loadTemplateNodes(
  originId: string,
  destinationId: string
): Promise<RouteNode[] | null> {
  const template = await prisma.routeTemplate.findFirst({
    where: {
      originLocationId: originId,
      destinationLocationId: destinationId,
      isActive: true,
    },
    include: {
      points: { orderBy: { seq: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!template?.points?.length || template.points.length < 2) return null;

  return template.points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    name: p.placeName ?? "Waypoint",
    locationId: p.matchedLocationId,
  }));
}

export async function buildIntermediateNodes(
  origin: ResolvedPlace,
  destination: ResolvedPlace,
  originRouteNodeId?: string | null,
  destRouteNodeId?: string | null,
  dynamicOsmRouting: boolean = false
): Promise<{ nodes: RouteNode[]; source: string }> {
  if (origin.id && destination.id) {
    const template = await loadTemplateNodes(origin.id, destination.id);
    if (template && template.length >= 2) {
      const trimmed = trimIntermediateStops(template, origin, destination);
      if (trimmed.length > 0) {
        return { nodes: trimmed, source: "template" };
      }
    }
  }

  const graph = await buildGraphWaypoints(
    origin.lat,
    origin.lon,
    destination.lat,
    destination.lon,
    originRouteNodeId,
    destRouteNodeId
  );
  if (graph.nodes.length > 0) {
    return graph;
  }

  const totalKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
  if (totalKm <= 30) {
    return { nodes: [], source: "short-direct" };
  }

  const originHub = await findNearestRouteNode(origin.lat, origin.lon, 35);
  const destHub = await findNearestRouteNode(destination.lat, destination.lon, 45);
  if (originHub && destHub && originHub.id !== destHub.id) {
    const retry = await buildGraphWaypoints(
      originHub.lat,
      originHub.lon,
      destHub.lat,
      destHub.lon,
      originHub.id,
      destHub.id
    );
    if (retry.nodes.length > 0) return retry;
  }

  if (dynamicOsmRouting && totalKm > 30) {
    const osmNodes = await fetchOsmRoadNodesBetween(
      origin.lat,
      origin.lon,
      destination.lat,
      destination.lon
    );
    if (osmNodes.length > 0) {
      return { nodes: osmNodes, source: "osm-road" };
    }
  }

  return { nodes: [], source: "direct" };
}

function trimIntermediateStops(
  nodes: RouteNode[],
  origin: ResolvedPlace,
  destination: ResolvedPlace
): RouteNode[] {
  const totalKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
  const maxStops = totalKm > 300 ? 5 : totalKm > 120 ? 4 : 3;
  const minSpacingKm = Math.max(20, totalKm * 0.08);

  const filtered: RouteNode[] = [];
  let lastProgress = 0;

  for (const node of nodes) {
    if (haversineKm(node.lat, node.lon, origin.lat, origin.lon) < 8) continue;
    if (haversineKm(node.lat, node.lon, destination.lat, destination.lon) < 8) continue;

    const progress =
      haversineKm(origin.lat, origin.lon, node.lat, node.lon) / Math.max(totalKm, 1);
    if (progress <= 0.05 || progress >= 0.95) continue;

    const spacing = (progress - lastProgress) * totalKm;
    if (filtered.length > 0 && spacing < minSpacingKm) continue;

    filtered.push(node);
    lastProgress = progress;
    if (filtered.length >= maxStops) break;
  }

  return filtered;
}

export function assembleNodeChain(
  origin: ResolvedPlace,
  intermediates: RouteNode[],
  destination: ResolvedPlace
): RouteNode[] {
  const originLat = origin.displayLat ?? origin.lat;
  const originLon = origin.displayLon ?? origin.lon;
  const chain: RouteNode[] = [
    {
      lat: originLat,
      lon: originLon,
      name: origin.name,
      locationId: origin.id,
    },
  ];

  const seen = new Set<string>();
  const key = (n: RouteNode) => `${n.lat.toFixed(3)},${n.lon.toFixed(3)}`;
  seen.add(key(chain[0]));

  for (const node of intermediates) {
    const k = key(node);
    if (seen.has(k)) continue;
    if (haversineKm(node.lat, node.lon, destination.lat, destination.lon) < 5) continue;
    if (haversineKm(node.lat, node.lon, origin.lat, origin.lon) < 5) continue;
    chain.push(node);
    seen.add(k);
  }

  const destNode: RouteNode = {
    lat: destination.displayLat ?? destination.lat,
    lon: destination.displayLon ?? destination.lon,
    name: destination.name,
    locationId: destination.id,
  };
  if (!seen.has(key(destNode))) {
    chain.push(destNode);
  }

  return chain.length >= 2 ? chain : [chain[0], destNode];
}

/** @deprecated kept for compatibility — corridor sampling removed in favor of graph routing */
export async function getMajorCorridorHubs(
  origin: ResolvedPlace,
  destination: ResolvedPlace
): Promise<RouteNode[]> {
  const allPlaces = await getAllKnownPlaces();
  const totalKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
  const maxCorridorKm = Math.min(35, Math.max(12, totalKm * 0.08));
  const candidates: RouteNode[] = [];

  for (const loc of allPlaces) {
    if (loc.id === origin.id || loc.id === destination.id) continue;
    const corridorKm = distanceToSegmentKm(
      loc.latitude,
      loc.longitude,
      origin.lat,
      origin.lon,
      destination.lat,
      destination.lon
    );
    if (corridorKm > maxCorridorKm) continue;
    const progress =
      haversineKm(origin.lat, origin.lon, loc.latitude, loc.longitude) / Math.max(totalKm, 1);
    if (progress <= 0.08 || progress >= 0.92) continue;
    candidates.push({
      lat: loc.latitude,
      lon: loc.longitude,
      name: loc.name,
      locationId: loc.id,
    });
  }

  return candidates.slice(0, 3);
}
