import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";
import { findNearestRouteNode as spatialFindNearestRouteNode } from "@/lib/routing/spatial";
import { MinPriorityQueue } from "@/lib/binary-heap";
import { computeEdgeWeight } from "@/lib/routing/routing-config";
import type { RouteNode as RouteNodeType } from "@/lib/routing/types";

export type GraphNode = {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  isHub: boolean;
  elevationM: number | null;
  accessibilityLevel: string | null;
  strategicImportance: string | null;
  hazardExposureIndex: number | null;
  connectivityRank: number | null;
  monsoonVulnerability: number | null;
};

export type GraphEdge = {
  from: string;
  to: string;
  weight: number;
  surfaceType: string | null;
  roadCondition: string | null;
  gradientPct: number | null;
  landslideRisk: number | null;
  floodRisk: number | null;
  weatherSensitivity: number | null;
  reliabilityScore: number | null;
  monsoonVulnerability: number | null;
  travelReliability: number | null;
};

let graphCache: {
  expiresAt: number;
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
} | null = null;

async function loadGraph(): Promise<{
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
}> {
  if (graphCache && graphCache.expiresAt > Date.now()) {
    return { nodes: graphCache.nodes, adjacency: graphCache.adjacency };
  }

  const rows = await prisma.routeNode.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      type: true,
      latitude: true,
      longitude: true,
      isHub: true,
      elevationM: true,
      accessibilityLevel: true,
      strategicImportance: true,
      hazardExposureIndex: true,
      connectivityRank: true,
      monsoonVulnerability: true,
      edgesFrom: {
        select: {
          toNodeId: true,
          distanceKm: true,
          surfaceType: true,
          roadCondition: true,
          gradientPct: true,
          landslideRisk: true,
          floodRisk: true,
          weatherSensitivity: true,
          reliabilityScore: true,
          monsoonVulnerability: true,
          travelReliability: true,
        },
      },
      edgesTo: {
        select: {
          fromNodeId: true,
          distanceKm: true,
          surfaceType: true,
          roadCondition: true,
          gradientPct: true,
          landslideRisk: true,
          floodRisk: true,
          weatherSensitivity: true,
          reliabilityScore: true,
          monsoonVulnerability: true,
          travelReliability: true,
        },
      },
    },
  });

  const nodes = new Map<string, GraphNode>();
  const adjacency = new Map<string, GraphEdge[]>();

  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      name: r.name,
      type: r.type,
      lat: r.latitude,
      lon: r.longitude,
      isHub: r.isHub,
      elevationM: r.elevationM,
      accessibilityLevel: r.accessibilityLevel,
      strategicImportance: r.strategicImportance,
      hazardExposureIndex: r.hazardExposureIndex,
      connectivityRank: r.connectivityRank,
      monsoonVulnerability: r.monsoonVulnerability,
    });
    adjacency.set(r.id, []);
  }

  for (const r of rows) {
    for (const e of r.edgesFrom) {
      adjacency.get(r.id)?.push({
        from: r.id,
        to: e.toNodeId,
        weight: e.distanceKm,
        surfaceType: e.surfaceType,
        roadCondition: e.roadCondition,
        gradientPct: e.gradientPct,
        landslideRisk: e.landslideRisk,
        floodRisk: e.floodRisk,
        weatherSensitivity: e.weatherSensitivity,
        reliabilityScore: e.reliabilityScore,
        monsoonVulnerability: e.monsoonVulnerability,
        travelReliability: e.travelReliability,
      });
    }
    for (const e of r.edgesTo) {
      adjacency.get(r.id)?.push({
        from: r.id,
        to: e.fromNodeId,
        weight: e.distanceKm,
        surfaceType: e.surfaceType,
        roadCondition: e.roadCondition,
        gradientPct: e.gradientPct,
        landslideRisk: e.landslideRisk,
        floodRisk: e.floodRisk,
        weatherSensitivity: e.weatherSensitivity,
        reliabilityScore: e.reliabilityScore,
        monsoonVulnerability: e.monsoonVulnerability,
        travelReliability: e.travelReliability,
      });
    }
  }

  graphCache = {
    expiresAt: Date.now() + 10 * 60 * 1000,
    nodes,
    adjacency,
  };

  return { nodes, adjacency };
}

export function invalidateGraphCache(): void {
  graphCache = null;
}

export async function findNearestRouteNode(
  lat: number,
  lon: number,
  maxKm = 35
): Promise<(GraphNode & { distanceKm: number }) | null> {
  return spatialFindNearestRouteNode(lat, lon, maxKm);
}

/** Check if current month is monsoon season (Jun-Sep) */
function isMonsoonSeason(): boolean {
  const month = new Date().getMonth() + 1; // 1-12
  return month >= 6 && month <= 9;
}

/** Dijkstra shortest path on the route graph (balanced multi-cost). */
export async function findRouteNodePath(
  fromNodeId: string,
  toNodeId: string,
  destLat?: number,
  destLon?: number,
): Promise<GraphNode[]> {
  if (fromNodeId === toNodeId) {
    const { nodes } = await loadGraph();
    const n = nodes.get(fromNodeId);
    return n ? [n] : [];
  }

  const { nodes, adjacency } = await loadGraph();
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const pq = new MinPriorityQueue();

  const monsoon = isMonsoonSeason();

  for (const id of nodes.keys()) {
    const d = id === fromNodeId ? 0 : Infinity;
    dist.set(id, d);
    prev.set(id, null);
    pq.push(id, d);
  }

  while (pq.size > 0) {
    const current = pq.pop();
    if (!current) break;
    if (current.key === toNodeId) break;
    if (!Number.isFinite(current.priority)) break;

    const curNode = nodes.get(current.key);

    for (const edge of adjacency.get(current.key) ?? []) {
      const nextNode = nodes.get(edge.to);
      if (!curNode || !nextNode) continue;

      const distToDestCur = destLat != null && destLon != null
        ? haversineKm(curNode.lat, curNode.lon, destLat, destLon)
        : 0;
      const distToDestNext = destLat != null && destLon != null
        ? haversineKm(nextNode.lat, nextNode.lon, destLat, destLon)
        : 0;

      const edgeWeight = destLat != null && destLon != null
        ? computeEdgeWeight({
            distanceKm: edge.weight,
            reliabilityScore: edge.reliabilityScore,
            landslideRisk: edge.landslideRisk,
            floodRisk: edge.floodRisk,
            monsoonVulnerability: edge.monsoonVulnerability,
            roadCondition: edge.roadCondition,
            distToDestCurrentKm: distToDestCur,
            distToDestNextKm: distToDestNext,
            isMonsoon: monsoon,
          })
        : edge.weight; // fallback to pure distance when no destination

      // Skip impassable edges (Infinity weight from monsoonPenalty)
      if (!Number.isFinite(edgeWeight)) continue;

      const alt = current.priority + edgeWeight;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current.key);
        pq.push(edge.to, alt);
      }
    }
  }

  // Reconstruct path
  const path: GraphNode[] = [];
  let cursor: string | null = toNodeId;
  while (cursor) {
    const node = nodes.get(cursor);
    if (node) path.unshift(node);
    cursor = prev.get(cursor) ?? null;
  }

  if (path.length === 0 || path[0]?.id !== fromNodeId) {
    return [];
  }

  return path;
}

export async function buildGraphWaypoints(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  originNodeId?: string | null,
  destNodeId?: string | null
): Promise<{ nodes: RouteNodeType[]; source: string }> {
  const originNode =
    originNodeId
      ? (await loadGraph()).nodes.get(originNodeId)
      : await findNearestRouteNode(originLat, originLon, 40);
  const destNode =
    destNodeId
      ? (await loadGraph()).nodes.get(destNodeId)
      : await findNearestRouteNode(destLat, destLon, 50);

  if (!originNode || !destNode) {
    return { nodes: [], source: "no-graph" };
  }

  const path = await findRouteNodePath(originNode.id, destNode.id, destLat, destLon);
  if (path.length < 2) {
    return { nodes: [], source: "direct-graph" };
  }

  const totalKm = haversineKm(originLat, originLon, destLat, destLon);
  const maxStops = totalKm > 350 ? 6 : totalKm > 150 ? 5 : totalKm > 60 ? 4 : 3;

  // Prefer TOWN/JUNCTION/hub nodes; fall back to ROUTE_NODE only if not enough place nodes
  const placeNodes = path.slice(1, -1).filter(
    (n) => n.type !== "ROUTE_NODE" || n.isHub || n.strategicImportance != null
  );
  const fallbackNodes = path.slice(1, -1).filter((n) => n.type === "ROUTE_NODE" && !n.isHub);

  const selected = placeNodes.length >= maxStops
    ? placeNodes
    : [...placeNodes, ...fallbackNodes];

  const intermediates = selected.slice(0, maxStops).map((n) => ({
    lat: n.lat,
    lon: n.lon,
    name: n.name,
    locationId: null as string | null,
    routeNodeId: n.id,
  }));

  return {
    nodes: intermediates,
    source: `graph:${path.map((n) => n.name).join("→")}`,
  };
}

export async function getRouteNodeById(id: string): Promise<GraphNode | null> {
  const { nodes } = await loadGraph();
  return nodes.get(id) ?? null;
}
