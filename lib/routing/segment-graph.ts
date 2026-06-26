/**
 * segment-graph.ts — in-memory graph query layer above the subsegment geometry.
 *
 * Design:
 *   - Pure in-memory (no DB dependency)
 *   - Lazy-loaded on first query
 *   - Read-only after initialization
 *   - Deterministic (subsegments.json is derived from canonical registry)
 *
 * Internally uses position-aware composite keys (`name|lat|lon`) for graph
 * traversal so same-named junctions at different positions (e.g. 4 instances
 * of "Mid-Hill Highway") are treated as distinct graph nodes.
 *
 * Phase 5.7B — Cost model:
 *   - State-expanded Dijkstra with (nodeId, prevRoadCode) keys
 *   - road continuity bias, junction-type-aware switching penalties
 *   - stability guard (dominant-road override, post-Dijkstra)
 *   - NOT globally shortest — stability-constrained cost-optimal
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "scripts", "data");
const REAL_ROAD_GRAPH_PATH = join(DATA_DIR, "real-road-graph.json");

// ─── Types ────────────────────────────────────────────────────────

export interface SubSegment {
  segmentId: string;
  roadCode: string;
  roadName: string;
  roadType: string;
  fromJunction: string;
  toJunction: string;
  fromKm: number;
  toKm: number;
  lengthKm: number;
  /** Projected coordinates of fromJunction on this subsegment's road */
  fromLat: number;
  fromLon: number;
  /** Projected coordinates of toJunction on this subsegment's road */
  toLat: number;
  toLon: number;
}

/**
 * Unique graph node — combines semantic name with position so same-named
 * junctions at different locations (e.g. "Mid-Hill Highway" × 4) are distinct.
 */
interface GraphNode {
  id: string;  // "name|lat|lon"
  name: string;
  lat: number;
  lon: number;
  source: "ROAD_JUNCTION" | "ROAD_ENDPOINT";
}

interface SegmentGraph {
  subSegments: SubSegment[];
  /** Index: roadCode → subsegments ordered by fromKm */
  byRoad: Map<string, SubSegment[]>;
  /** Index: junction name → subsegments incident at ANY position (user-facing) */
  byJunction: Map<string, SubSegment[]>;
  /** Index: graph node id "name|lat|lon" → graph node */
  graphNodes: Map<string, GraphNode>;
  /** Index: junction name → list of graph node IDs (for resolving) */
  nameToNodeIds: Map<string, string[]>;
}

// ─── Cost Model (Phase 5.7B) ──────────────────────────────────────

export interface CostModelOptions {
  /** Multiplier applied when edge.roadCode === previous edge's roadCode (default: 0.6) */
  sameRoadMultiplier: number;
  /** Km-equivalent penalty when roadCode changes (default: 15) */
  roadSwitchPenaltyKm: number;
  /** Junction-type-specific multipliers on roadSwitchPenalty (default: see below) */
  junctionMultiplier: Record<string, number>;
  /**
   * Stability threshold: if a direct same-road path exists with cost ≤ this
   * fraction of optimal cost, prefer it. Only triggers when the dominant
   * road in the optimal path is the same shared road. (default: 1.2)
   */
  hardStabilityThreshold: number;
}

export const DEFAULT_COST_MODEL: CostModelOptions = {
  sameRoadMultiplier: 0.6,
  roadSwitchPenaltyKm: 15,
  junctionMultiplier: {
    INTERCHANGE: 1.0,
    JUNCTION: 1.5,
    HIGHWAY_SPLIT: 2.0,
    UNKNOWN: 2.5,
  },
  hardStabilityThreshold: 1.2,
};

// ─── Singleton graph (lazy-loaded) ────────────────────────────────
let _graph: SegmentGraph | null = null;
let _junctionTypeById: Map<string, string> | null = null;

function makeNodeId(name: string, lat: number, lon: number): string {
  return `${name}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
}

function ensureJunctionTypes(): Map<string, string> {
  if (_junctionTypeById) return _junctionTypeById;
  _junctionTypeById = new Map();
  const g = ensureGraph();
  for (const [, node] of g.graphNodes) {
    _junctionTypeById.set(node.id, node.source === "ROAD_JUNCTION" ? "JUNCTION" : "UNKNOWN");
  }
  return _junctionTypeById;
}

function loadGraph(): SegmentGraph {
  const raw: {
    nodes: Array<{ id: string; name: string; lat: number; lon: number; type: "JUNCTION" | "ENDPOINT" }>;
    edges: Array<{ id: string; fromNode: string; toNode: string; roadCode: string; roadName: string; roadType: string; lengthKm: number }>;
  } = JSON.parse(readFileSync(REAL_ROAD_GRAPH_PATH, "utf-8"));

  // Build node map: nodeId → { name, lat, lon, type }
  const graphNodeMap = new Map<string, typeof raw.nodes[0]>();
  for (const n of raw.nodes) {
    graphNodeMap.set(n.id, n);
  }

  const subSegments: SubSegment[] = [];
  const byRoad = new Map<string, SubSegment[]>();
  const byJunction = new Map<string, SubSegment[]>();
  const graphNodes = new Map<string, GraphNode>();
  const nameToNodeIds = new Map<string, string[]>();

  function addNode(name: string, lat: number, lon: number, source: GraphNode["source"]) {
    const id = makeNodeId(name, lat, lon);
    if (!graphNodes.has(id)) {
      graphNodes.set(id, { id, name, lat, lon, source });
    }
    if (!nameToNodeIds.has(name)) nameToNodeIds.set(name, []);
    const ids = nameToNodeIds.get(name)!;
    if (!ids.includes(id)) ids.push(id);
  }

  for (const edge of raw.edges) {
    const fromNode = graphNodeMap.get(edge.fromNode);
    const toNode = graphNodeMap.get(edge.toNode);
    if (!fromNode || !toNode) continue;

    const seg: SubSegment = {
      segmentId: edge.id,
      roadCode: edge.roadCode,
      roadName: edge.roadName,
      roadType: edge.roadType,
      fromJunction: fromNode.name,
      toJunction: toNode.name,
      fromKm: 0,
      toKm: edge.lengthKm,
      lengthKm: edge.lengthKm,
      fromLat: fromNode.lat,
      fromLon: fromNode.lon,
      toLat: toNode.lat,
      toLon: toNode.lon,
    };
    subSegments.push(seg);

    if (!byRoad.has(seg.roadCode)) byRoad.set(seg.roadCode, []);
    byRoad.get(seg.roadCode)!.push(seg);

    if (!byJunction.has(seg.fromJunction)) byJunction.set(seg.fromJunction, []);
    byJunction.get(seg.fromJunction)!.push(seg);

    if (!byJunction.has(seg.toJunction)) byJunction.set(seg.toJunction, []);
    byJunction.get(seg.toJunction)!.push(seg);

    addNode(fromNode.name, fromNode.lat, fromNode.lon, fromNode.type === "JUNCTION" ? "ROAD_JUNCTION" : "ROAD_ENDPOINT");
    addNode(toNode.name, toNode.lat, toNode.lon, toNode.type === "JUNCTION" ? "ROAD_JUNCTION" : "ROAD_ENDPOINT");
  }

  for (const [, ids] of nameToNodeIds) {
    ids.sort();
  }

  _graph = { subSegments, byRoad, byJunction, graphNodes, nameToNodeIds };
  return _graph;
}

function ensureGraph(): SegmentGraph {
  if (!_graph) _graph = loadGraph();
  return _graph;
}

// ─── Lookups ──────────────────────────────────────────────────────

export function getSubSegments(
  roadCode: string,
  fromKm?: number,
  toKm?: number,
): SubSegment[] {
  const g = ensureGraph();
  const segs = g.byRoad.get(roadCode);
  if (!segs) return [];

  const f = fromKm ?? -Infinity;
  const t = toKm ?? Infinity;
  return segs.filter((s) => s.toKm > f && s.fromKm < t);
}

export function getSubSegmentAtKm(
  roadCode: string,
  km: number,
): SubSegment | null {
  const segs = getSubSegments(roadCode);
  return segs.find((s) => s.fromKm <= km && s.toKm >= km) ?? null;
}

export function getRoadsAtJunction(junctionName: string): SubSegment[] {
  const g = ensureGraph();
  return g.byJunction.get(junctionName) ?? [];
}

export function getJunctionsOnRoad(roadCode: string): string[] {
  const segs = getSubSegments(roadCode);
  const set = new Set<string>();
  for (const s of segs) {
    set.add(s.fromJunction);
    set.add(s.toJunction);
  }
  return [...set];
}

export function getGraphStats(): {
  totalSubSegments: number;
  totalRoads: number;
  totalJunctions: number;
  totalGraphNodes: number;
} {
  const g = ensureGraph();
  return {
    totalSubSegments: g.subSegments.length,
    totalRoads: g.byRoad.size,
    totalJunctions: g.byJunction.size,
    totalGraphNodes: g.graphNodes.size,
  };
}

/**
 * Resolve a lat/lon coordinate to the nearest position-aware graph node.
 *
 * Returns null if:
 *   - No junction found within radiusKm
 *   - distanceKm > radiusKm * 1.5
 *   - confidence < 0.6
 *
 * At the same distance, prefers:
 *   1. Nodes with incident edges in the graph (avoids isolated registry nodes)
 *   2. Nodes matching preferredName (if provided)
 *
 * The returned `id` is a composite key ("name|lat|lon") suitable for findPath().
 */
export function resolveNearestJunction(
  lat: number,
  lon: number,
  radiusKm: number = 20,
  preferredName?: string,
): {
  junctionName: string;
  id: string;
  lat: number;
  lon: number;
  distanceKm: number;
  confidence: number;
} | null {
  const g = ensureGraph();
  const adj = buildAdjacency();
  const adjNodeIds = new Set<string>([...adj.edges.keys(), ...adj.reverse.keys()]);

  // Collect all candidates within radius, sorted by distance
  const candidates: Array<{ node: GraphNode; dist: number; hasEdges: boolean }> = [];

  for (const [, node] of g.graphNodes) {
    const d = haversineKm(lat, lon, node.lat, node.lon);
    if (d > radiusKm * 1.5) continue;
    const confidence = 1 - d / (radiusKm * 1.5);
    if (confidence < 0.6) continue;
    candidates.push({ node, dist: d, hasEdges: adjNodeIds.has(node.id) });
  }

  if (candidates.length === 0) return null;

  // Sort: distance (asc) → hasEdges (prefer connected) → name match (if hint given)
  candidates.sort((a, b) => {
    if (Math.abs(a.dist - b.dist) > 0.001) return a.dist - b.dist;
    if (a.hasEdges !== b.hasEdges) return a.hasEdges ? -1 : 1;
    if (preferredName) {
      const aMatch = a.node.name.toLowerCase() === preferredName.toLowerCase() ? 0 : 1;
      const bMatch = b.node.name.toLowerCase() === preferredName.toLowerCase() ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    return 0;
  });

  const best = candidates[0];
  if (!best) return null;

  return {
    junctionName: best.node.name,
    id: best.node.id,
    lat: best.node.lat,
    lon: best.node.lon,
    distanceKm: +best.dist.toFixed(3),
    confidence: +(1 - best.dist / (radiusKm * 1.5)).toFixed(3),
  };
}

// ─── Path Finding (position-aware adjacency) ──────────────────────

export interface GraphEdge {
  segmentId: string;
  roadCode: string;
  roadName: string;
  fromId: string;   // composite key "name|lat|lon"
  toId: string;     // composite key "name|lat|lon"
  fromJunction: string;
  toJunction: string;
  lengthKm: number;
}

interface AdjacencyMap {
  /** graph node id → outgoing edges */
  edges: Map<string, GraphEdge[]>;
  /** graph node id → incoming edges (for bidirectional lookup) */
  reverse: Map<string, GraphEdge[]>;
}

function buildAdjacency(): AdjacencyMap {
  const g = ensureGraph();
  const edges = new Map<string, GraphEdge[]>();
  const reverse = new Map<string, GraphEdge[]>();

  function addEdge(fromId: string, toId: string, edge: GraphEdge) {
    if (!edges.has(fromId)) edges.set(fromId, []);
    edges.get(fromId)!.push(edge);
    if (!reverse.has(toId)) reverse.set(toId, []);
    reverse.get(toId)!.push(edge);
  }

  for (const seg of g.subSegments) {
    const fromId = makeNodeId(seg.fromJunction, seg.fromLat, seg.fromLon);
    const toId = makeNodeId(seg.toJunction, seg.toLat, seg.toLon);
    const edge: GraphEdge = {
      segmentId: seg.segmentId,
      roadCode: seg.roadCode,
      roadName: seg.roadName,
      fromId,
      toId,
      fromJunction: seg.fromJunction,
      toJunction: seg.toJunction,
      lengthKm: seg.lengthKm,
    };
    // Bidirectional traversal: add edge from both ends
    addEdge(fromId, toId, edge);
    addEdge(toId, fromId, edge);
  }

  return { edges, reverse };
}

// ─── Cost Model Helpers (Phase 5.7B) ────────────────────────────

/**
 * Compute the edge traversal cost given the previous road code context.
 *
 * cost = length * sameRoadMultiplier (if continuing same road)
 *      + roadSwitchPenalty * junctionMultiplier (if switching)
 *
 * Junction type is looked up at the edge's FROM node (the transition point).
 * Edge cost is computed EXACTLY ONCE per relaxation — never double-counted.
 */
function computeEdgeCost(
  edge: GraphEdge,
  prevRoadCode: string | null,
  options: CostModelOptions,
): number {
  const sameRoad = prevRoadCode === edge.roadCode;
  let cost = edge.lengthKm * (sameRoad ? options.sameRoadMultiplier : 1.0);

  if (!sameRoad && prevRoadCode !== null) {
    const jType = getJunctionType(edge.fromId);
    const multiplier = options.junctionMultiplier[jType] ?? options.junctionMultiplier["UNKNOWN"];
    cost += options.roadSwitchPenaltyKm * multiplier;
  }

  return cost;
}

/**
 * Look up a junction's type by its position-aware node ID.
 * Uses the road-junctions.json registry — defaults to "UNKNOWN" if not found.
 */
function getJunctionType(nodeId: string): string {
  ensureJunctionTypes();
  return _junctionTypeById?.get(nodeId) ?? "UNKNOWN";
}

/**
 * Find the ordered junction list along a road by walking the topology chain.
 * Handles disconnected components by appending them in arbitrary order.
 */
function getJunctionOrder(roadCode: string): string[] {
  const segs = getSubSegments(roadCode);
  if (segs.length === 0) return [];

  // Build adjacency: junctionName → neighboring junction names
  const adj = new Map<string, string[]>();
  for (const s of segs) {
    if (!adj.has(s.fromJunction)) adj.set(s.fromJunction, []);
    if (!adj.has(s.toJunction)) adj.set(s.toJunction, []);
    if (!adj.get(s.fromJunction)!.includes(s.toJunction))
      adj.get(s.fromJunction)!.push(s.toJunction);
    if (!adj.get(s.toJunction)!.includes(s.fromJunction))
      adj.get(s.toJunction)!.push(s.fromJunction);
  }

  const allNodes = new Set(adj.keys());
  const visited = new Set<string>();
  const order: string[] = [];

  while (allNodes.size > visited.size) {
    // Pick an unvisited node — prefer an endpoint (degree-1)
    const unvisited = [...allNodes].filter((n) => !visited.has(n));
    const start =
      unvisited.find((n) => (adj.get(n) ?? []).length === 1) ?? unvisited[0];
    if (!start) break;

    // Walk the chain
    const chain: string[] = [start];
    visited.add(start);
    let current = start;
    while (true) {
      const neighbors = (adj.get(current) ?? []).filter((n) => !visited.has(n));
      if (neighbors.length === 0) break;
      const next = neighbors[0];
      chain.push(next);
      visited.add(next);
      current = next;
    }
    order.push(...chain);
  }

  return order;
}

/**
 * Find the subsegment chain between two junctions on a single road.
 * Uses BFS within the road's subgraph. Returns null if the junctions
 * are not connected on that road.
 */
function findDirectRoadSubSegments(
  roadCode: string,
  fromJunction: string,
  toJunction: string,
): SubSegment[] | null {
  const segs = getSubSegments(roadCode);
  if (segs.length === 0) return null;
  if (fromJunction === toJunction) return [];

  // Build adjacency: junctionName → incident subsegments
  const adj = new Map<string, SubSegment[]>();
  for (const s of segs) {
    if (!adj.has(s.fromJunction)) adj.set(s.fromJunction, []);
    if (!adj.has(s.toJunction)) adj.set(s.toJunction, []);
    adj.get(s.fromJunction)!.push(s);
    adj.get(s.toJunction)!.push(s);
  }

  // BFS from fromJunction, tracking parent segments
  const parent = new Map<string, { seg: SubSegment; prev: string | null }>();
  const queue: string[] = [fromJunction];
  parent.set(fromJunction, { seg: null as unknown as SubSegment, prev: null });

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toJunction) break;

    const incident = adj.get(current) ?? [];
    for (const s of incident) {
      const next = s.fromJunction === current ? s.toJunction : s.fromJunction;
      if (!parent.has(next)) {
        parent.set(next, { seg: s, prev: current });
        queue.push(next);
      }
    }
  }

  if (!parent.has(toJunction)) return null;

  // Reconstruct path
  const chain: SubSegment[] = [];
  let curr: string | null = toJunction;
  while (curr && parent.get(curr)?.prev !== null) {
    const p: { seg: SubSegment; prev: string | null } = parent.get(curr)!;
    chain.unshift(p.seg);
    curr = p.prev;
  }

  return chain;
}

// ─── Cost-Aware Dijkstra (Phase 5.7B) ───────────────────────────

/**
 * State-expanded Dijkstra with road continuity awareness.
 *
 * Each state is (nodeId, prevRoadCode) — the same junction reached via
 * different roads is a distinct state. This prevents cost collapse when
 * multiple roads converge at a shared junction.
 *
 * Visited key: "nodeId|prevRoadCode" (state-specific, NOT node-only)
 *
 * Returns the cost-optimal path under the given cost model.
 *
 * @param fromId - Composite key returned by resolveNearestJunction()
 * @param toId   - Composite key returned by resolveNearestJunction()
 * @param costOptions - Cost model overrides (optional)
 * @returns Ordered GraphEdge[] or null if no path exists.
 *          NEVER returns partial paths — if connectivity fails, returns null.
 */
export function findPath(
  fromId: string,
  toId: string,
  costOptions?: Partial<CostModelOptions>,
): GraphEdge[] | null {
  const g = ensureGraph();

  // Validate nodes exist
  if (!g.graphNodes.has(fromId) || !g.graphNodes.has(toId)) return null;
  if (fromId === toId) return [];

  const options: CostModelOptions = { ...DEFAULT_COST_MODEL, ...costOptions };
  const adj = buildAdjacency();

  // State-expanded visited: key = "nodeId|prevRoadCode"
  // Prevents state collapse — same node reached via different roads is distinct
  const visited = new Set<string>();

  interface DijkstraState {
    nodeId: string;
    prevRoadCode: string | null;
    cost: number;
    path: GraphEdge[];
  }

  const pq: DijkstraState[] = [
    { nodeId: fromId, prevRoadCode: null, cost: 0, path: [] },
  ];

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const cur = pq.shift()!;

    if (cur.nodeId === toId) return cur.path;

    const stateKey = `${cur.nodeId}|${cur.prevRoadCode ?? ""}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);

    const incident = adj.edges.get(cur.nodeId) ?? [];
    for (const edge of incident) {
      const nextId = edge.fromId === cur.nodeId ? edge.toId : edge.fromId;
      // Next state: nextNode + roadCode of the edge we traverse
      const nextStateKey = `${nextId}|${edge.roadCode}`;
      if (visited.has(nextStateKey)) continue;

      const edgeCost = computeEdgeCost(edge, cur.prevRoadCode, options);
      pq.push({
        nodeId: nextId,
        prevRoadCode: edge.roadCode,
        cost: cur.cost + edgeCost,
        path: [...cur.path, edge],
      });
    }
  }

  return null;
}

/**
 * Convenience wrapper: resolve two junction names to their nearest
 * position-aware graph nodes, then findPath between them.
 *
 * Useful when you don't have pre-resolved node IDs.
 */
export function findPathByName(
  fromJunction: string,
  toJunction: string,
  costOptions?: Partial<CostModelOptions>,
): GraphEdge[] | null {
  const g = ensureGraph();
  const fromIds = g.nameToNodeIds.get(fromJunction);
  const toIds = g.nameToNodeIds.get(toJunction);
  if (!fromIds || !toIds || fromIds.length === 0 || toIds.length === 0) return null;

  // Try all position combinations, return shortest
  let best: GraphEdge[] | null = null;
  let bestCost = Infinity;

  for (const fId of fromIds) {
    for (const tId of toIds) {
      const path = findPath(fId, tId, costOptions);
      if (path) {
        const options: CostModelOptions = { ...DEFAULT_COST_MODEL, ...costOptions };
        const total = path.reduce((s, e) => s + computeEdgeCost(e, null, options), 0);
        if (total < bestCost) {
          bestCost = total;
          best = path;
        }
      }
    }
  }

  return best;
}

/**
 * Find the optimal path with a stability guard that prefers staying on a
 * single dominant road when cost differences are within threshold.
 *
 * Post-Dijkstra override (NEVER influences priority queue):
 *   1. Run cost-aware Dijkstra → optimal path P, cost C
 *   2. If P is already single-road → return P
 *   3. Find dominant road in P (most frequent roadCode)
 *   4. If dominant road is shared by both junctions AND
 *      direct same-road path cost ≤ C × threshold → return direct path
 *   5. Otherwise → return P
 */
export function findStablePath(
  fromId: string,
  toId: string,
  fromJunction: string,
  toJunction: string,
  costOptions?: Partial<CostModelOptions>,
): GraphEdge[] | null {
  const g = ensureGraph();
  if (!g.graphNodes.has(fromId) || !g.graphNodes.has(toId)) return null;
  if (fromId === toId) return [];

  const options: CostModelOptions = { ...DEFAULT_COST_MODEL, ...costOptions };

  // Step 1: Run cost-aware Dijkstra
  const optimalPath = findPath(fromId, toId, costOptions);
  if (!optimalPath || optimalPath.length === 0) return null;

  // Step 2: If already single-road, no override needed
  const roadCodes = [...new Set(optimalPath.map(e => e.roadCode))];
  if (roadCodes.length === 1) return optimalPath;

  // Step 3: Find dominant road (most frequent in optimal path)
  const freq = new Map<string, number>();
  for (const e of optimalPath) {
    freq.set(e.roadCode, (freq.get(e.roadCode) ?? 0) + 1);
  }
  let dominantRoad = roadCodes[0];
  let maxFreq = 0;
  for (const [rc, count] of freq) {
    if (count > maxFreq) { maxFreq = count; dominantRoad = rc; }
  }

  // Compute optimal path cost
  let optimalCost = 0;
  {
    let prevRoad: string | null = null;
    for (const edge of optimalPath) {
      optimalCost += computeEdgeCost(edge, prevRoad, options);
      prevRoad = edge.roadCode;
    }
  }

  // Step 4: Check direct same-road path — only if dominantRoad is shared by both junctions
  const fromRoadCodes = new Set((g.byJunction.get(fromJunction) ?? []).map(s => s.roadCode));
  const toRoadCodes = new Set((g.byJunction.get(toJunction) ?? []).map(s => s.roadCode));

  if (fromRoadCodes.has(dominantRoad) && toRoadCodes.has(dominantRoad)) {
    const directSegs = findDirectRoadSubSegments(dominantRoad, fromJunction, toJunction);
    if (directSegs) {
      const directEdges: GraphEdge[] = directSegs.map(s => ({
        segmentId: s.segmentId,
        roadCode: s.roadCode,
        roadName: s.roadName,
        fromId: makeNodeId(s.fromJunction, s.fromLat, s.fromLon),
        toId: makeNodeId(s.toJunction, s.toLat, s.toLon),
        fromJunction: s.fromJunction,
        toJunction: s.toJunction,
        lengthKm: s.lengthKm,
      }));

      // Compute direct path cost (all same road — no switch penalties)
      let directCost = 0;
      for (const e of directEdges) {
        directCost += computeEdgeCost(e, dominantRoad, options);
      }

      if (directCost <= optimalCost * options.hardStabilityThreshold) {
        return directEdges;
      }
    }
  }

  // Step 5: Return optimal path
  return optimalPath;
}

export function getSubSegmentRange(
  roadCode: string,
  fromKm: number,
  toKm: number,
): SubSegment[] {
  const segs = getSubSegments(roadCode);
  const covering = segs.filter((s) => s.toKm > fromKm && s.fromKm < toKm);
  covering.sort((a, b) => a.fromKm - b.fromKm);
  return covering;
}

export function expandPathToSubSegments(path: GraphEdge[]): SubSegment[] {
  const g = ensureGraph();
  const segMap = new Map<string, SubSegment>();
  for (const s of g.subSegments) {
    segMap.set(s.segmentId, s);
  }

  const result: SubSegment[] = [];
  for (const edge of path) {
    const seg = segMap.get(edge.segmentId);
    if (seg) result.push(seg);
  }
  return result;
}

// ─── Junction projection onto polyline ────────────────────────────

export interface PathProjection {
  polylineIdx: number;
  cumulativeKm: number;
}

export function projectJunctionOntoPolyline(
  junctionName: string,
  polyline: Array<{ lat: number; lon: number }>,
  cumulatives: number[],
): PathProjection | null {
  const g = ensureGraph();
  const ids = g.nameToNodeIds.get(junctionName);
  if (!ids || polyline.length < 2) return null;
  if (cumulatives.length !== polyline.length) return null;

  // Find the position of the first instance of this junction
  const node = g.graphNodes.get(ids[0]);
  if (!node) return null;

  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < polyline.length; i++) {
    const d = haversineKm(node.lat, node.lon, polyline[i].lat, polyline[i].lon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  return {
    polylineIdx: bestIdx,
    cumulativeKm: cumulatives[bestIdx],
  };
}

/**
 * Given a polyline and an ordered path of GraphEdges, project every edge
 * boundary onto the polyline using the edge's position-aware node IDs.
 */
export function projectPathOntoPolyline(
  path: GraphEdge[],
  polyline: Array<{ lat: number; lon: number }>,
  cumulatives: number[],
): Array<{ fromProjection: PathProjection; toProjection: PathProjection; edge: GraphEdge }> {
  if (path.length === 0) return [];
  const g = ensureGraph();

  function projectNodeId(nodeId: string): PathProjection {
    const node = g.graphNodes.get(nodeId);
    if (!node || polyline.length < 2) {
      return { polylineIdx: 0, cumulativeKm: 0 };
    }
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < polyline.length; i++) {
      const d = haversineKm(node.lat, node.lon, polyline[i].lat, polyline[i].lon);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return { polylineIdx: bestIdx, cumulativeKm: cumulatives[bestIdx] };
  }

  return path.map((edge) => ({
    fromProjection: projectNodeId(edge.fromId),
    toProjection: projectNodeId(edge.toId),
    edge,
  }));
}

// ─── Multi-Route / K-Shortest Paths (Phase 5.10) ─────────────────

export interface MultiRoutePath {
  path: GraphEdge[];
  cost: number;
  label: string;
}

function computePathCost(path: GraphEdge[], costOptions?: Partial<CostModelOptions>): number {
  const options: CostModelOptions = { ...DEFAULT_COST_MODEL, ...costOptions };
  let total = 0;
  let prevRoad: string | null = null;
  for (const edge of path) {
    total += computeEdgeCost(edge, prevRoad, options);
    prevRoad = edge.roadCode;
  }
  return total;
}

function makeRoadSignature(path: GraphEdge[]): string {
  return path.map(e => e.roadCode).join("|");
}

/**
 * findPath with edge/node exclusions.
 *
 * Accepts all same params as findPath, plus:
 *   blockedEdges - Set of segmentIds to exclude from traversal
 *   blockedNodes - Set of graph node IDs to exclude from traversal
 *
 * This is used internally by findMultiRoute (Yen's algorithm) and is
 * intentionally NOT exported — multi-route is the only external consumer.
 */
function findPathWithExclusions(
  fromId: string,
  toId: string,
  blockedEdges: Set<string>,
  blockedNodes: Set<string>,
  costOptions?: Partial<CostModelOptions>,
): GraphEdge[] | null {
  const g = ensureGraph();

  if (!g.graphNodes.has(fromId) || !g.graphNodes.has(toId)) return null;
  if (fromId === toId) return [];
  if (blockedNodes.has(fromId) || blockedNodes.has(toId)) return null;

  const options: CostModelOptions = { ...DEFAULT_COST_MODEL, ...costOptions };
  const adj = buildAdjacency();

  const visited = new Set<string>();

  interface DijkstraState {
    nodeId: string;
    prevRoadCode: string | null;
    cost: number;
    path: GraphEdge[];
  }

  const pq: DijkstraState[] = [
    { nodeId: fromId, prevRoadCode: null, cost: 0, path: [] },
  ];

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const cur = pq.shift()!;

    if (cur.nodeId === toId) return cur.path;

    const stateKey = `${cur.nodeId}|${cur.prevRoadCode ?? ""}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);

    const incident = adj.edges.get(cur.nodeId) ?? [];
    for (const edge of incident) {
      const nextId = edge.fromId === cur.nodeId ? edge.toId : edge.fromId;

      if (blockedEdges.has(edge.segmentId)) continue;
      if (blockedNodes.has(nextId)) continue;

      const nextStateKey = `${nextId}|${edge.roadCode}`;
      if (visited.has(nextStateKey)) continue;

      const edgeCost = computeEdgeCost(edge, cur.prevRoadCode, options);
      pq.push({
        nodeId: nextId,
        prevRoadCode: edge.roadCode,
        cost: cur.cost + edgeCost,
        path: [...cur.path, edge],
      });
    }
  }

  return null;
}

/**
 * Find K distinct routes between two graph nodes using Yen's algorithm.
 *
 * Path 0 is always findStablePath (the recommended route).
 * Paths 1+ are alternatives found by edge deviation + re-run.
 *
 * Returns at most K paths, each with:
 *   path  - Ordered GraphEdge[]
 *   cost  - Total cost under the given cost model
 *   label - Human-readable label (e.g. "Recommended", "Alternative via NH17")
 *
 * Deduplication is by road-sequence signature (e.g. "NH01|NH17|NH01").
 * If fewer than K distinct paths exist, returns what's available.
 * If the graph is disconnected for the given endpoints, returns [].
 */
export function findMultiRoute(
  fromId: string,
  toId: string,
  fromJunction: string,
  toJunction: string,
  K: number = 3,
  costOptions?: Partial<CostModelOptions>,
): MultiRoutePath[] {
  if (K < 1) return [];

  const options: CostModelOptions = { ...DEFAULT_COST_MODEL, ...costOptions };

  // ── Path 0: Stable (recommended) ──
  const primary = findStablePath(fromId, toId, fromJunction, toJunction, costOptions);
  if (!primary) return [];

  const result: MultiRoutePath[] = [
    { path: primary, cost: computePathCost(primary, options), label: "Recommended" },
  ];

  if (K === 1) return result;

  // ── Yen's algorithm ──
  const A: GraphEdge[][] = [primary]; // confirmed k-shortest paths
  const seenSignatures = new Set<string>([makeRoadSignature(primary)]);

  // B: candidate pool (global across all k iterations)
  const B: Array<{ path: GraphEdge[]; cost: number; label: string }> = [];

  for (let k = 1; k < K; k++) {
    const prevPath = A[k - 1];

    // Try deviation at each spur node (edge index 0..len-2)
    for (let spurIdx = 0; spurIdx < prevPath.length; spurIdx++) {
      const spurNode = prevPath[spurIdx].toId;
      const rootPath = prevPath.slice(0, spurIdx + 1);

      // Block edges: the edge from spur in the current path + edges from
      // any previously found path that shares the same root prefix
      const blockedEdges = new Set<string>();
      for (const p of A) {
        if (p.length <= spurIdx) continue;
        let rootMatches = true;
        for (let j = 0; j <= spurIdx; j++) {
          if (p[j].segmentId !== prevPath[j].segmentId) {
            rootMatches = false;
            break;
          }
        }
        if (rootMatches) {
          blockedEdges.add(p[spurIdx].segmentId);
        }
      }

      // Block nodes: all nodes from root path except the spur node
      const blockedNodes = new Set<string>();
      for (let j = 0; j < spurIdx; j++) {
        blockedNodes.add(prevPath[j].fromId);
        blockedNodes.add(prevPath[j].toId);
      }
      blockedNodes.delete(spurNode);

      // Find spur path
      const spurPath = findPathWithExclusions(spurNode, toId, blockedEdges, blockedNodes, costOptions);

      if (spurPath && spurPath.length > 0) {
        const combined = [...rootPath, ...spurPath];
        const cost = computePathCost(combined, options);
        const spurRoads = [...new Set(spurPath.map(e => e.roadCode))];
        const label = spurRoads.length === 1
          ? `Alternative via ${spurRoads[0]}`
          : `Alternative via ${spurRoads.join("→")}`;
        B.push({ path: combined, cost, label });
      }
    }

    // Select lowest-cost candidate not already seen
    B.sort((a, b) => a.cost - b.cost);

    let found = false;
    for (const candidate of B) {
      const sig = makeRoadSignature(candidate.path);
      if (!seenSignatures.has(sig)) {
        seenSignatures.add(sig);
        A.push(candidate.path);
        result.push({ path: candidate.path, cost: candidate.cost, label: candidate.label });
        found = true;
        break;
      }
    }

    if (!found) break; // no more distinct paths
  }

  return result;
}

// ─── Haversine helper ─────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
