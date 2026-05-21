import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";
import { findNearestRouteNode as spatialFindNearestRouteNode } from "@/lib/routing/spatial";
import { MinPriorityQueue } from "@/lib/binary-heap";
import type { RouteNode as RouteNodeType } from "@/lib/routing/types";

type GraphNode = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  isHub: boolean;
};

type GraphEdge = {
  from: string;
  to: string;
  weight: number;
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
      latitude: true,
      longitude: true,
      isHub: true,
      edgesFrom: { select: { toNodeId: true, distanceKm: true } },
    },
  });

  const nodes = new Map<string, GraphNode>();
  const adjacency = new Map<string, GraphEdge[]>();

  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      isHub: r.isHub,
    });
    adjacency.set(r.id, []);
  }

  for (const r of rows) {
    for (const e of r.edgesFrom) {
      adjacency.get(r.id)?.push({
        from: r.id,
        to: e.toNodeId,
        weight: e.distanceKm,
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

/** Dijkstra shortest path on the route graph. */
export async function findRouteNodePath(
  fromNodeId: string,
  toNodeId: string
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

    for (const edge of adjacency.get(current.key) ?? []) {
      const alt = current.priority + edge.weight;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current.key);
        pq.push(edge.to, alt);
      }
    }
  }

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

  const path = await findRouteNodePath(originNode.id, destNode.id);
  if (path.length < 2) {
    return { nodes: [], source: "direct-graph" };
  }

  const intermediates = path.slice(1, -1).map((n) => ({
    lat: n.lat,
    lon: n.lon,
    name: n.name,
    locationId: null as string | null,
    routeNodeId: n.id,
  }));

  const totalKm = haversineKm(originLat, originLon, destLat, destLon);
  const maxStops = totalKm > 350 ? 6 : totalKm > 150 ? 5 : totalKm > 60 ? 4 : 3;

  return {
    nodes: intermediates.slice(0, maxStops),
    source: `graph:${path.map((n) => n.name).join("→")}`,
  };
}

export async function getRouteNodeById(id: string): Promise<GraphNode | null> {
  const { nodes } = await loadGraph();
  return nodes.get(id) ?? null;
}
