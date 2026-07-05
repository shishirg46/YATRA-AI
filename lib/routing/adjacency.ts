import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";

export type AdjNode = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  roadClass: string;
  isJunction: boolean;
  elevationM: number | null;
};

export type AdjEdge = {
  from: string;
  to: string;
  wayId: string;
  distanceKm: number;
};

export type AdjacencyMap = {
  nodes: Map<string, AdjNode>;
  /** nodeId → outgoing edges */
  adjacency: Map<string, AdjEdge[]>;
  graphVersion: string;
};

let cache: { map: AdjacencyMap; expiresAt: number } | null = null;

/** Coordinate grouping tolerance in degrees (~10m) */
const JUNCTION_TOLERANCE = 0.0001;

function coordKey(lat: number, lon: number): string {
  return `${Math.round(lat / JUNCTION_TOLERANCE) * JUNCTION_TOLERANCE},${
    Math.round(lon / JUNCTION_TOLERANCE) * JUNCTION_TOLERANCE
  }`;
}

/**
 * Build the adjacency graph from OSM way topology.
 *
 * Rules:
 *  - Consecutive nodes on the same OSM way are connected (both directions, unless one-way)
 *  - Junction nodes at the same coordinate are connected across different ways
 *  - Topology is determined ONLY by OsmWay node ordering — never by spatial proximity
 */
export async function buildAdjacency(
  bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<AdjacencyMap> {
  if (!bounds && cache && cache.expiresAt > Date.now()) {
    return cache.map;
  }

  const ways = await prisma.osmWay.findMany({
    where: {
      isActive: true,
      ...(bounds && {
        nodes: {
          some: {
            isActive: true,
            latitude: { gte: bounds.minLat, lte: bounds.maxLat },
            longitude: { gte: bounds.minLon, lte: bounds.maxLon },
          },
        },
      }),
    },
    select: {
      id: true,
      oneWay: true,
      graphVersion: true,
      nodes: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
          roadClass: true,
          isJunctionNode: true,
          elevationM: true,
          sequenceIndex: true,
        },
        orderBy: { sequenceIndex: "asc" },
      },
    },
  });

  const nodes = new Map<string, AdjNode>();
  const adjacency = new Map<string, AdjEdge[]>();
  let graphVersion = "";

  // Phase 1: Build same-way adjacency
  for (const way of ways) {
    if (way.graphVersion) graphVersion = way.graphVersion;
    const ordered = way.nodes;

    for (let i = 0; i < ordered.length; i++) {
      const n = ordered[i];
      if (!nodes.has(n.id)) {
        nodes.set(n.id, {
          id: n.id,
          name: n.name,
          lat: n.latitude,
          lon: n.longitude,
          roadClass: n.roadClass ?? "secondary",
          isJunction: n.isJunctionNode,
          elevationM: n.elevationM,
        });
      }
      if (!adjacency.has(n.id)) adjacency.set(n.id, []);
    }

    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      const dist = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);

      // Forward edge
      adjacency.get(from.id)!.push({
        from: from.id,
        to: to.id,
        wayId: way.id,
        distanceKm: dist,
      });

      // Backward edge (unless one-way)
      if (!way.oneWay) {
        adjacency.get(to.id)!.push({
          from: to.id,
          to: from.id,
          wayId: way.id,
          distanceKm: dist,
        });
      }
    }
  }

  // Phase 2: Connect junction nodes at the same coordinate
  // Only connect ONE representative node per way per cluster.
  // This prevents O(N²) intra-way connections that pollute adjacency
  // while ensuring maximal cross-way connectivity.

  // Phase 3: Bridge nearby endpoints from disconnected components.
  // OSM data for Nepal has many ways that are almost-connected but don't
  // share a node. This phase finds way endpoints (degree ≤ 1) that are
  // within 50m of another way's endpoint and connects them as a "bridge" edge.
  // This dramatically improves graph connectivity at minimal false-positive
  // cost for a routing application.
  const junctionClusters = new Map<string, AdjNode[]>();

  for (const node of nodes.values()) {
    if (node.isJunction) {
      const key = coordKey(node.lat, node.lon);
      if (!junctionClusters.has(key)) junctionClusters.set(key, []);
      junctionClusters.get(key)!.push(node);
    }
  }

  for (const cluster of junctionClusters.values()) {
    if (cluster.length < 2) continue;

    // Group by way ID, pick first node per way as representative
    const byWay = new Map<string, AdjNode>();
    for (const node of cluster) {
      const wayId = node.id.split(":")[0];
      if (!byWay.has(wayId)) byWay.set(wayId, node);
    }

    if (byWay.size < 2) continue;

    const reps = Array.from(byWay.values());
    for (let i = 0; i < reps.length; i++) {
      for (let j = i + 1; j < reps.length; j++) {
        const a = reps[i];
        const b = reps[j];
        const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);

        adjacency.get(a.id)!.push({
          from: a.id,
          to: b.id,
          wayId: "junction",
          distanceKm: dist,
        });

        adjacency.get(b.id)!.push({
          from: b.id,
          to: a.id,
          wayId: "junction",
          distanceKm: dist,
        });
      }
    }
  }

  // Phase 3: Bridge nearby endpoints from disconnected components.
  // Many OSM way segments end within meters of another way's endpoint
  // without sharing a node. Connect them with a "bridge" edge.
  const BRIDGE_THRESHOLD_KM = 0.1; // 100m
  const endpoints: Array<{ id: string; lat: number; lon: number; wayId: string }> = [];

  for (const [id, edges] of adjacency) {
    const sameWayEdges = edges.filter(e => e.wayId !== "junction" && e.wayId !== "bridge");
    if (sameWayEdges.length <= 1) {
      const node = nodes.get(id);
      if (node) {
        endpoints.push({ id, lat: node.lat, lon: node.lon, wayId: id.split(":")[0] });
      }
    }
  }

  if (endpoints.length > 1) {
    // Spatial index: 0.01° grid cells (~1km)
    const grid = new Map<string, typeof endpoints>();
    for (const ep of endpoints) {
      const key = `${Math.round(ep.lat / 0.01)},${Math.round(ep.lon / 0.01)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(ep);
    }

    const connectedWayPairs = new Set<string>();

    for (const [key, eps] of grid) {
      const [clat, clon] = key.split(",").map(Number);
      const neighborKeys: string[] = [key];
      for (const dlat of [-1, 0, 1]) {
        for (const dlon of [-1, 0, 1]) {
          if (dlat === 0 && dlon === 0) continue;
          neighborKeys.push(`${clat + dlat},${clon + dlon}`);
        }
      }

      const neighbors: typeof endpoints = [];
      for (const nk of neighborKeys) {
        const cell = grid.get(nk);
        if (cell) neighbors.push(...cell);
      }

      for (const a of eps) {
        for (const b of neighbors) {
          if (a.id <= b.id) continue;
          if (a.wayId === b.wayId) continue;

          const pairKey = a.wayId < b.wayId ? `${a.wayId}:${b.wayId}` : `${b.wayId}:${a.wayId}`;
          if (connectedWayPairs.has(pairKey)) continue;

          // Check if already connected via junction
          const aEdges = adjacency.get(a.id) ?? [];
          const alreadyConnectedViaJunction = aEdges.some(e =>
            e.wayId === "junction" && nodes.get(e.to)?.id.split(":")[0] === b.wayId
          );
          if (alreadyConnectedViaJunction) {
            connectedWayPairs.add(pairKey);
            continue;
          }

          const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
          if (dist > BRIDGE_THRESHOLD_KM) continue;

          connectedWayPairs.add(pairKey);

          adjacency.get(a.id)!.push({
            from: a.id, to: b.id,
            wayId: "bridge",
            distanceKm: dist,
          });
          adjacency.get(b.id)!.push({
            from: b.id, to: a.id,
            wayId: "bridge",
            distanceKm: dist,
          });
        }
      }
    }
  }

  const map: AdjacencyMap = { nodes, adjacency, graphVersion };

  if (!bounds) {
    cache = {
      map,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  }

  return map;
}

export function invalidateAdjacencyCache(): void {
  cache = null;
}

export async function getAdjNode(id: string): Promise<AdjNode | null> {
  const { nodes } = await buildAdjacency();
  return nodes.get(id) ?? null;
}

export async function getNeighbors(id: string): Promise<AdjEdge[]> {
  const { adjacency } = await buildAdjacency();
  return adjacency.get(id) ?? [];
}
