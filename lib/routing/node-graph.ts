import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";
import { findNearestRouteNode as spatialFindNearestRouteNode } from "@/lib/routing/spatial";
import { MinPriorityQueue } from "@/lib/binary-heap";
import { ROUTING_COEFFICIENTS } from "@/lib/routing/routing-config";
import { buildAdjacency, invalidateAdjacencyCache } from "@/lib/routing/adjacency";
import type { AdjNode, AdjEdge, AdjacencyMap } from "@/lib/routing/adjacency";
import {
  scoreEdge,
  preloadHazardData,
  preloadEdgeCache,
  batchUpsertCache,
} from "@/lib/routing/edge-scorer";
import type { HazardData, CacheEntry } from "@/lib/routing/edge-scorer";

export type GraphNode = AdjNode & { distanceKm?: number };
export type GraphEdge = AdjEdge;

export function invalidateGraphCache(): void {
  invalidateAdjacencyCache();
}

export async function findNearestRouteNode(
  lat: number,
  lon: number,
  maxKm = 35,
): Promise<(GraphNode & { distanceKm: number }) | null> {
  const result = await spatialFindNearestRouteNode(lat, lon, maxKm);
  if (!result) return null;
  return {
    id: result.id,
    name: result.name,
    lat: result.lat,
    lon: result.lon,
    roadClass: result.type ?? "secondary",
    isJunction: false,
    elevationM: result.elevationM,
    distanceKm: result.distanceKm,
  };
}

/**
 * Admissible A* heuristic:
 *   haversine / maxspeed * alpha  +  elevationGain * terrainFactor
 *
 * The terrain term is a lower bound: any real path between two points has
 * at least this much elevation gain. No hazard or road class terms are
 * included, so the heuristic cannot overestimate. This tightens the bound
 * ~30-50% for hilly terrain, reducing A* node expansions.
 */
function heuristic(from: AdjNode, to: AdjNode): number {
  const dist = haversineKm(from.lat, from.lon, to.lat, to.lon);
  const elevationGain = Math.max(0, (to.elevationM ?? 0) - (from.elevationM ?? 0));
  return (dist / 80) * ROUTING_COEFFICIENTS.alpha
       + (elevationGain / 1000) * 0.5;
}

type WeightProfile = {
  alpha: number;
  beta: number;
  gamma: number;
  delta: number;
  epsilon: number;
};

const DEFAULT_PROFILE: WeightProfile = { ...ROUTING_COEFFICIENTS };
const REDUCED_HAZARD_PROFILE: WeightProfile = {
  ...ROUTING_COEFFICIENTS,
  beta: ROUTING_COEFFICIENTS.beta / 2,
  gamma: ROUTING_COEFFICIENTS.gamma * 0.7,
  epsilon: ROUTING_COEFFICIENTS.epsilon / 2,
};
const DISTANCE_ONLY_PROFILE: WeightProfile = {
  alpha: 1, beta: 0, gamma: 0, delta: 0, epsilon: 0,
};

/**
 * A* shortest path on the OSM-based adjacency graph.
 *
 * Edge weights are computed via the scoring engine.
 * Hazard data is preloaded once; cache entries are batch-upserted after search.
 * Falls back through reduced-hazard → distance-only on failure.
 */
export async function findRouteNodePath(
  fromNodeId: string,
  toNodeId: string,
  destLat?: number,
  destLon?: number,
  graph?: AdjacencyMap,
): Promise<GraphNode[]> {
  if (fromNodeId === toNodeId) {
    const { nodes } = graph ?? await buildAdjacency();
    const n = nodes.get(fromNodeId);
    return n ? [n] : [];
  }
  return findRouteNodePathWithFallback(fromNodeId, toNodeId, destLat, destLon, 1, graph);
}

async function findRouteNodePathWithFallback(
  fromNodeId: string,
  toNodeId: string,
  destLat?: number,
  destLon?: number,
  attempt: number = 1,
  loadedGraph?: AdjacencyMap,
): Promise<GraphNode[]> {
  const profile: WeightProfile =
    attempt === 1 ? DEFAULT_PROFILE
    : attempt === 2 ? REDUCED_HAZARD_PROFILE
    : DISTANCE_ONLY_PROFILE;

  const graph = loadedGraph ?? await buildAdjacency();
  const { nodes, adjacency } = graph;

  const fromNode = nodes.get(fromNodeId);
  const toNode = nodes.get(toNodeId);
  if (!fromNode || !toNode) return [];

  const hazardMap = await preloadHazardData();
  const pendingCache: CacheEntry[] = [];

  // Preload EdgeCache for all nodes — single batch query before A* starts
  // Ensures the expansion loop never touches the database (pure CPU-only)
  const costOverrides = await preloadEdgeCache(
    Array.from(nodes.keys()),
    graph.graphVersion,
  );

  // A* state
  const openSet = new Set<string>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const visitedEdges = new Set<string>();

  gScore.set(fromNodeId, 0);
  const h = destLat != null && destLon != null
    ? heuristic(fromNode, { lat: destLat, lon: destLon, elevationM: 0 } as AdjNode)
    : heuristic(fromNode, toNode);
  openSet.add(fromNodeId);

  const pq = new MinPriorityQueue();
  pq.push(fromNodeId, h);

  while (pq.size > 0 && openSet.size > 0) {
    const current = pq.pop();
    if (!current) break;

    const currentId = current.key as string;
    openSet.delete(currentId);

    if (currentId === toNodeId) break;

    const currentNode = nodes.get(currentId);
    if (!currentNode) continue;

    const currentG = gScore.get(currentId) ?? Infinity;

    const edges = adjacency.get(currentId) ?? [];
    for (const edge of edges) {
      const edgeKey = `${currentId}:${edge.to}`;
      if (visitedEdges.has(edgeKey)) continue;
      visitedEdges.add(edgeKey);

      const neighbor = nodes.get(edge.to);
      if (!neighbor) continue;

      const distToDestCurrent = destLat != null && destLon != null
        ? haversineKm(currentNode.lat, currentNode.lon, destLat, destLon) : 0;
      const distToDestNext = destLat != null && destLon != null
        ? haversineKm(neighbor.lat, neighbor.lon, destLat, destLon) : 0;

      const { scored, cacheEntry } = scoreEdge(
        currentNode,
        neighbor,
        graph,
        distToDestCurrent,
        distToDestNext,
        hazardMap,
        profile,
        costOverrides,
      );

      if (!Number.isFinite(scored.cost) || scored.cost < 0) continue;

      const tentativeG = currentG + scored.cost;
      const neighborG = gScore.get(edge.to) ?? Infinity;

      if (tentativeG < neighborG) {
        cameFrom.set(edge.to, currentId);
        gScore.set(edge.to, tentativeG);

        const hNeighbor = destLat != null && destLon != null
          ? heuristic(neighbor, { lat: destLat, lon: destLon, elevationM: 0 } as AdjNode)
          : heuristic(neighbor, toNode);

        const f = tentativeG + hNeighbor;
        openSet.add(edge.to);
        pq.push(edge.to, f);
        pendingCache.push(cacheEntry);
      }
    }
  }

  // Batch upsert cache entries
  batchUpsertCache(pendingCache);

  // Reconstruct path
  const path: GraphNode[] = [];
  let cursor: string | null = toNodeId;
  while (cursor) {
    const node = nodes.get(cursor);
    if (node) path.unshift(node);
    cursor = cameFrom.get(cursor) ?? null;
  }

  if (path.length === 0 || path[0]?.id !== fromNodeId) {
    if (attempt < 3) {
      return findRouteNodePathWithFallback(fromNodeId, toNodeId, destLat, destLon, attempt + 1);
    }
    return [];
  }

  if (attempt > 1) {
    try {
      await prisma.routeUsageLog.create({
        data: {
          fallbackLevel: attempt - 1,
          segments: JSON.parse(JSON.stringify(path.map(n => ({ id: n.id, lat: n.lat, lon: n.lon })))),
          totalDistance: 0,
          vehicleProfile: "car",
          source: "a*",
        },
      });
    } catch {
      // non-critical
    }
  }

  return path;
}

export async function buildGraphWaypoints(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  originNodeId?: string | null,
  destNodeId?: string | null,
): Promise<{ nodes: Array<{ lat: number; lon: number; name: string; locationId: string | null; routeNodeId: string }>; source: string }> {
  const PAD = 0.75;
  const bounds = {
    minLat: Math.min(originLat, destLat) - PAD,
    maxLat: Math.max(originLat, destLat) + PAD,
    minLon: Math.min(originLon, destLon) - PAD,
    maxLon: Math.max(originLon, destLon) + PAD,
  };
  const graph = await buildAdjacency(bounds);
  const { nodes } = graph;

  const originNode = originNodeId
    ? nodes.get(originNodeId)
    : await findNearestRouteNode(originLat, originLon, 40);

  const destNode = destNodeId
    ? nodes.get(destNodeId)
    : await findNearestRouteNode(destLat, destLon, 50);

  if (!originNode || !destNode) {
    return { nodes: [], source: "no-graph" };
  }

  const path = await findRouteNodePath(originNode.id, destNode.id, destLat, destLon, graph);
  if (path.length < 2) {
    return { nodes: [], source: "direct-graph" };
  }

  const totalKm = haversineKm(originLat, originLon, destLat, destLon);
  const maxStops = totalKm > 350 ? 6 : totalKm > 150 ? 5 : totalKm > 60 ? 4 : 3;

  const step = Math.max(1, Math.floor(path.length / (maxStops + 2)));
  const intermediates = [];
  for (let i = step; i < path.length - 1; i += step) {
    const n = path[i];
    intermediates.push({
      lat: n.lat,
      lon: n.lon,
      name: n.name,
      locationId: null,
      routeNodeId: n.id,
    });
    if (intermediates.length >= maxStops) break;
  }

  return {
    nodes: intermediates,
    source: `a*:${path.length}nodes`,
  };
}

export async function getRouteNodeById(id: string): Promise<GraphNode | null> {
  const { nodes } = await buildAdjacency();
  return nodes.get(id) ?? null;
}
