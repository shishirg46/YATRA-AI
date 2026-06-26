import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { haversineKm as haversineKmRaw, distanceToSegmentKm } from "../lib/routing/geo";

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversineKmRaw(a.lat, a.lon, b.lat, b.lon);
}

// ─── Types ────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  roadCode: string;
  chainIndex: number;
  startPlace: string;
  endPlace: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  centroidLat: number;
  centroidLon: number;
  lengthKm: number;
  meanConfidence: number;
  bearingDeg: number;
}

interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  roadCode: string;
  distanceKm: number;
  linkType: "link" | "split";
  headingSimilarity: number;
  weight: number;
}

interface CrossRoadEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromRoad: string;
  toRoad: string;
  junctionId: string;
  distanceKm: number;
  type: "shared-node" | "endpoint-endpoint" | "endpoint-midpoint";
  weight: number;
}

interface Junction {
  id: string;
  lat: number;
  lon: number;
  roads: string[];
  connectedNodeIds: string[];
  detectionMethod: "shared-node" | "endpoint-proximity";
}

interface AdjEntry {
  toNodeId: string;
  weight: number;
  edgeId: string;
  edgeType: "intra" | "cross" | "virtual";
  roadCode: string;
  distanceKm: number;
}

interface SnapResult {
  node: GraphNode;
  score: number;
  confidence: "high" | "medium" | "low";
  endpointDist: number;
  centroidDist: number;
}

type SkipReason =
  | "VISITED_STATE"
  | "LOWER_BOUND_F"
  | "OSCILLATION_BLOCK"
  | "NO_ADJACENCY"
  | null;

interface TraceStep {
  nodeId: string;
  g: number;
  h: number;
  f: number;
  incomingRoad: string;
  edgeType: string;
  cumulativeRoadChanges: number;
  skipReason: SkipReason;
  viaEdgeId: string;
}

export interface RouteResult {
  found: boolean;
  path: {
    nodes: GraphNode[];
    edges: (GraphEdge | CrossRoadEdge)[];
    junctions: Junction[];
  };
  statistics: {
    totalDistanceKm: number;
    totalWeight: number;
    roadChanges: number;
    nodeCount: number;
    visitedNodeCount: number;
    crossRoadRatio: number;
    metrics?: RouteMetrics;
  };
  roadSequence: {
    roadCode: string;
    fromPlace: string;
    toPlace: string;
    edgeType: string;
  }[];
  trace: TraceStep[];
}

// ─── Routing Modes ─────────────────────────────────────────────────────────

export type RoutingMode = "strict-road" | "balanced" | "fastest" | "highway-preferred";

interface ModeConfig {
  crossRoadPenalty: number;
  virtualEdgePenalty: number;
  heuristicScale: number;
  allowCrossRoad: boolean;
  entryBiasSteps: number;
  entryBiasMultiplier: number;
}

const MODE_CONFIGS: Record<RoutingMode, ModeConfig> = {
  "strict-road": {
    crossRoadPenalty: Infinity,
    virtualEdgePenalty: Infinity,
    heuristicScale: 0.4,
    allowCrossRoad: false,
    entryBiasSteps: 0,
    entryBiasMultiplier: 1,
  },
  balanced: {
    crossRoadPenalty: 1.1,
    virtualEdgePenalty: 1.0,
    heuristicScale: 0.6,
    allowCrossRoad: true,
    entryBiasSteps: 0,
    entryBiasMultiplier: 1,
  },
  fastest: {
    crossRoadPenalty: 1.0,
    virtualEdgePenalty: 1.0,
    heuristicScale: 0.8,
    allowCrossRoad: true,
    entryBiasSteps: 0,
    entryBiasMultiplier: 1,
  },
  "highway-preferred": {
    crossRoadPenalty: 2.0,
    virtualEdgePenalty: 1.5,
    heuristicScale: 0.5,
    allowCrossRoad: true,
    entryBiasSteps: 3,
    entryBiasMultiplier: 8,
  },
};

export interface RouteMetrics {
  deviationScore: number;
  roadChangeRatePer100km: number;
  continuityScore: number;
  weightEfficiency: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const ROUTE_GRAPH_FILE = "scripts/data/route-graph.json";
const JUNCTION_GRAPH_FILE = "scripts/data/junction-graph.json";
const ALLOWED_VIRTUAL_PAIRS: Set<string> = new Set(["NH01-NH03"]);
const VIRTUAL_MAX_DIST_KM = 3;
const VIRTUAL_BASE_WEIGHT = 2.0;
const VIRTUAL_DIST_FACTOR = 0.1;
const OSCILLATION_WINDOW = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// Simple binary-heap priority queue
class PriorityQueue<T> {
  private heap: { item: T; priority: number }[] = [];

  push(item: T, priority: number): void {
    this.heap.push({ item, priority });
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[p].priority <= this.heap[i].priority) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      const n = this.heap.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && this.heap[l].priority < this.heap[smallest].priority)
          smallest = l;
        if (r < n && this.heap[r].priority < this.heap[smallest].priority)
          smallest = r;
        if (smallest === i) break;
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }
}

// ─── Adjacency Builder ───────────────────────────────────────────────────

function buildAdjacency(
  routeGraph: Record<string, { nodes: GraphNode[]; edges: GraphEdge[] }>,
  crossRoadEdges: CrossRoadEdge[],
  allNodes: Map<string, GraphNode>,
  mode: RoutingMode = "balanced",
  preferRoad: string = "",
): Map<string, AdjEntry[]> {
  const adj = new Map<string, AdjEntry[]>();
  const mc = MODE_CONFIGS[mode];

  // Intra-road edges (bidirectional)
  for (const [rc, road] of Object.entries(routeGraph)) {
    if (mode === "strict-road" && preferRoad && rc !== preferRoad) continue;
    for (const edge of road.edges) {
      const entry1: AdjEntry = {
        toNodeId: edge.toNodeId,
        weight: edge.weight,
        edgeId: edge.id,
        edgeType: "intra",
        roadCode: rc,
        distanceKm: edge.distanceKm,
      };
      const entry2: AdjEntry = {
        toNodeId: edge.fromNodeId,
        weight: edge.weight,
        edgeId: edge.id,
        edgeType: "intra",
        roadCode: rc,
        distanceKm: edge.distanceKm,
      };
      let a1 = adj.get(edge.fromNodeId);
      if (!a1) {
        a1 = [];
        adj.set(edge.fromNodeId, a1);
      }
      a1.push(entry1);

      let a2 = adj.get(edge.toNodeId);
      if (!a2) {
        a2 = [];
        adj.set(edge.toNodeId, a2);
      }
      a2.push(entry2);
    }
  }

  // Cross-road edges (bidirectional, with mode-specific penalty)
  for (const edge of crossRoadEdges) {
    if (!mc.allowCrossRoad) continue;
    const weight = edge.weight * mc.crossRoadPenalty;
    const entry1: AdjEntry = {
      toNodeId: edge.toNodeId,
      weight,
      edgeId: edge.id,
      edgeType: "cross",
      roadCode: edge.toRoad,
      distanceKm: edge.distanceKm,
    };
    const entry2: AdjEntry = {
      toNodeId: edge.fromNodeId,
      weight,
      edgeId: edge.id,
      edgeType: "cross",
      roadCode: edge.fromRoad,
      distanceKm: edge.distanceKm,
    };
    let a1 = adj.get(edge.fromNodeId);
    if (!a1) {
      a1 = [];
      adj.set(edge.fromNodeId, a1);
    }
    a1.push(entry1);

    let a2 = adj.get(edge.toNodeId);
    if (!a2) {
      a2 = [];
      adj.set(edge.toNodeId, a2);
    }
    a2.push(entry2);
  }

  // Virtual junction edges (additive cost, scoped to allowed pairs)
  const roadCodes = Object.keys(routeGraph);
  for (let i = 0; i < roadCodes.length; i++) {
    for (let j = i + 1; j < roadCodes.length; j++) {
      const ra = roadCodes[i];
      const rb = roadCodes[j];
      const pair = [ra, rb].sort().join("-");
      if (!ALLOWED_VIRTUAL_PAIRS.has(pair)) continue;

      const roadANodes = routeGraph[ra]?.nodes ?? [];
      const roadBNodes = routeGraph[rb]?.nodes ?? [];

      for (const na of roadANodes) {
        const nodeA = allNodes.get(na.id);
        if (!nodeA) continue;
        for (const nb of roadBNodes) {
          const nodeB = allNodes.get(nb.id);
          if (!nodeB) continue;
          const dist = haversineKm(
            { lat: nodeA.centroidLat, lon: nodeA.centroidLon },
            { lat: nodeB.centroidLat, lon: nodeB.centroidLon },
          );
          if (dist > VIRTUAL_MAX_DIST_KM) continue;

          let weight = VIRTUAL_BASE_WEIGHT + VIRTUAL_DIST_FACTOR * dist;
          if (mc.virtualEdgePenalty !== 1.0) weight *= mc.virtualEdgePenalty;
          const vid = `VIRTUAL_${na.id}_${nb.id}`;

          const e1: AdjEntry = {
            toNodeId: nb.id,
            weight,
            edgeId: vid,
            edgeType: "virtual",
            roadCode: rb,
            distanceKm: dist,
          };
          const e2: AdjEntry = {
            toNodeId: na.id,
            weight,
            edgeId: vid,
            edgeType: "virtual",
            roadCode: ra,
            distanceKm: dist,
          };

          let a1 = adj.get(na.id);
          if (!a1) {
            a1 = [];
            adj.set(na.id, a1);
          }
          a1.push(e1);

          let a2 = adj.get(nb.id);
          if (!a2) {
            a2 = [];
            adj.set(nb.id, a2);
          }
          a2.push(e2);
        }
      }
    }
  }

  return adj;
}

// ─── Node Snapping ────────────────────────────────────────────────────────

function snapNode(
  lat: number,
  lon: number,
  allNodes: Map<string, GraphNode>,
  preferredRoad?: string,
): SnapResult | null {
  let bestNode: GraphNode | null = null;
  let bestScore = Infinity;
  let nearestEndpointNode: GraphNode | null = null;
  let nearestEndpointDist = Infinity;

  for (const node of allNodes.values()) {
    const centroidDist = haversineKm(
      { lat, lon },
      { lat: node.centroidLat, lon: node.centroidLon },
    );
    const endpointDist = Math.min(
      haversineKm({ lat, lon }, { lat: node.startLat, lon: node.startLon }),
      haversineKm({ lat, lon }, { lat: node.endLat, lon: node.endLon }),
    );
    let score = 0.7 * centroidDist + 0.3 * endpointDist;
    if (preferredRoad && node.roadCode === preferredRoad) score *= 0.5;

    if (endpointDist < nearestEndpointDist) {
      nearestEndpointDist = endpointDist;
      nearestEndpointNode = node;
    }

    if (score < bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  if (!bestNode || !nearestEndpointNode) return null;

  // Road preference: snap to preferred road if set and not already on it
  if (preferredRoad && bestNode.roadCode !== preferredRoad) {
    let bestRoadNode: GraphNode | null = null;
    let bestRoadScore = Infinity;
    let nearestRoadEndpointNode: GraphNode | null = null;
    let nearestRoadEndpointDist = Infinity;
    for (const node of allNodes.values()) {
      if (node.roadCode !== preferredRoad) continue;
      const centroidDist = haversineKm({ lat, lon }, { lat: node.centroidLat, lon: node.centroidLon });
      const endpointDist = Math.min(
        haversineKm({ lat, lon }, { lat: node.startLat, lon: node.startLon }),
        haversineKm({ lat, lon }, { lat: node.endLat, lon: node.endLon }),
      );
      const score = 0.7 * centroidDist + 0.3 * endpointDist;
      if (score < bestRoadScore) {
        bestRoadScore = score;
        bestRoadNode = node;
      }
      if (endpointDist < nearestRoadEndpointDist) {
        nearestRoadEndpointDist = endpointDist;
        nearestRoadEndpointNode = node;
      }
    }
    if (bestRoadNode) {
      bestNode = bestRoadNode;
      bestScore = bestRoadScore;
      nearestEndpointNode = nearestRoadEndpointNode ?? bestRoadNode;
      nearestEndpointDist = nearestRoadEndpointDist;
    }
  }

  // Hard fallback: if best node's endpoint distance > 5km, force nearest endpoint
  const bestEndpointDist = Math.min(
    haversineKm(
      { lat, lon },
      { lat: bestNode.startLat, lon: bestNode.startLon },
    ),
    haversineKm(
      { lat, lon },
      { lat: bestNode.endLat, lon: bestNode.endLon },
    ),
  );

  if (bestEndpointDist > 5 && nearestEndpointDist < bestEndpointDist) {
    bestNode = nearestEndpointNode;
    bestScore =
      0.7 *
        haversineKm(
          { lat, lon },
          { lat: bestNode.centroidLat, lon: bestNode.centroidLon },
        ) +
      0.3 * nearestEndpointDist;
  }

  const finalEndpointDist = Math.min(
    haversineKm(
      { lat, lon },
      { lat: bestNode.startLat, lon: bestNode.startLon },
    ),
    haversineKm(
      { lat, lon },
      { lat: bestNode.endLat, lon: bestNode.endLon },
    ),
  );
  const finalCentroidDist = haversineKm(
    { lat, lon },
    { lat: bestNode.centroidLat, lon: bestNode.centroidLon },
  );

  let confidence: "high" | "medium" | "low";
  if (finalEndpointDist < 0.5) confidence = "high";
  else if (finalEndpointDist < 2) confidence = "medium";
  else confidence = "low";

  return {
    node: bestNode,
    score: bestScore,
    confidence,
    endpointDist: finalEndpointDist,
    centroidDist: finalCentroidDist,
  };
}

// ─── A* Routing ──────────────────────────────────────────────────────────

interface AStarState {
  nodeId: string;
  g: number;
  f: number;
  parent: string | null;
  parentEdge: AdjEntry | null;
  incomingRoad: string;
  roadChanges: number;
  depth: number;
  lastKNodeIds: string[];
  lastKNodeRoads: string[];
}

function aStar(
  startId: string,
  targetId: string,
  adjacency: Map<string, AdjEntry[]>,
  allNodes: Map<string, GraphNode>,
  maxSteps: number,
  traceMode: boolean,
  mode: RoutingMode = "balanced",
  preferRoad: string = "",
): {
  found: boolean;
  g: number;
  backtrack: Map<string, AStarState>;
  targetId: string;
  visitedCount: number;
  trace: TraceStep[];
} {
  const mc = MODE_CONFIGS[mode];
  const target = allNodes.get(targetId);
  if (!target) return { found: false, g: 0, backtrack: new Map(), targetId, visitedCount: 0, trace: [] };

  const startNode = allNodes.get(startId);
  const startH = startNode
    ? mc.heuristicScale *
      haversineKm(
        { lat: startNode.centroidLat, lon: startNode.centroidLon },
        { lat: target.centroidLat, lon: target.centroidLon },
      )
    : 0;

  const startState: AStarState = {
    nodeId: startId,
    g: 0,
    f: startH,
    parent: null,
    parentEdge: null,
    incomingRoad: startNode?.roadCode ?? "",
    roadChanges: 0,
    depth: 0,
    lastKNodeIds: [startId],
    lastKNodeRoads: [startNode?.roadCode ?? ""],
  };

  const pq = new PriorityQueue<AStarState>();
  pq.push(startState, startState.f);

  const visited = new Map<string, AStarState>(); // key = nodeId|incomingRoad
  const backtrack = new Map<string, AStarState>();
  const trace: TraceStep[] = [];
  let visitedCount = 0;

  while (pq.size > 0 && visitedCount < maxSteps) {
    const current = pq.pop()!;
    const stateKey = `${current.nodeId}|${current.incomingRoad}`;

    if (visited.has(stateKey)) {
      if (traceMode) {
        trace.push({
          nodeId: current.nodeId,
          g: current.g,
          h: current.f - current.g,
          f: current.f,
          incomingRoad: current.incomingRoad,
          edgeType: current.parentEdge?.edgeType ?? "",
          cumulativeRoadChanges: current.roadChanges,
          skipReason: "VISITED_STATE",
          viaEdgeId: current.parentEdge?.edgeId ?? "",
        });
      }
      continue;
    }

    visited.set(stateKey, current);
    visitedCount++;
    backtrack.set(current.nodeId, current);

    // Goal check
    if (current.nodeId === targetId) {
      if (traceMode) {
        trace.push({
          nodeId: current.nodeId,
          g: current.g,
          h: current.f - current.g,
          f: current.f,
          incomingRoad: current.incomingRoad,
          edgeType: current.parentEdge?.edgeType ?? "",
          cumulativeRoadChanges: current.roadChanges,
          skipReason: null,
          viaEdgeId: current.parentEdge?.edgeId ?? "",
        });
      }
      return { found: true, g: current.g, backtrack, targetId, visitedCount, trace };
    }

    // Explore neighbors
    const neighbors = adjacency.get(current.nodeId) ?? [];

    for (const edge of neighbors) {
      const neighbor = allNodes.get(edge.toNodeId);
      if (!neighbor) continue;

      const neighborH = mc.heuristicScale * haversineKm(
        { lat: neighbor.centroidLat, lon: neighbor.centroidLon },
        { lat: target.centroidLat, lon: target.centroidLon },
      );
      const isCrossEdge = edge.edgeType === "cross" || edge.edgeType === "virtual";
      const bias = isCrossEdge && mc.entryBiasSteps > 0 && current.depth < mc.entryBiasSteps ? mc.entryBiasMultiplier : 1;
      const neighborG = current.g + edge.weight * bias;

      const roadChanged = current.incomingRoad !== "" && edge.roadCode !== current.incomingRoad && edge.edgeType !== "intra";
      const newRoadChanges = current.roadChanges + (roadChanged ? 1 : 0);

      // Oscillation guard: check last K nodes
      const isOscillation =
        current.lastKNodeRoads.includes(edge.roadCode) &&
        current.lastKNodeIds.includes(edge.toNodeId) &&
        current.lastKNodeIds.length >= 2 &&
        current.lastKNodeIds[current.lastKNodeIds.length - 1] !== edge.toNodeId;

      const neighborStateKey = `${edge.toNodeId}|${edge.roadCode}`;
      const existingBetter = visited.get(neighborStateKey);
      const neighborF = neighborG + neighborH;

      if (traceMode) {
        let skipReason: SkipReason = null;
        if (isOscillation) skipReason = "OSCILLATION_BLOCK";
        else if (existingBetter && existingBetter.g <= neighborG) skipReason = "LOWER_BOUND_F";
        trace.push({
          nodeId: edge.toNodeId,
          g: neighborG,
          h: neighborH,
          f: neighborF,
          incomingRoad: edge.roadCode,
          edgeType: edge.edgeType,
          cumulativeRoadChanges: newRoadChanges,
          skipReason,
          viaEdgeId: edge.edgeId,
        });
      }

      if (isOscillation) continue;
      if (existingBetter && existingBetter.g <= neighborG) continue;

      const lastKNodeIds =
        current.lastKNodeIds.length < OSCILLATION_WINDOW
          ? [...current.lastKNodeIds, edge.toNodeId]
          : [
              ...current.lastKNodeIds.slice(1),
              edge.toNodeId,
            ];
      const lastKNodeRoads =
        current.lastKNodeRoads.length < OSCILLATION_WINDOW
          ? [...current.lastKNodeRoads, edge.roadCode]
          : [
              ...current.lastKNodeRoads.slice(1),
              edge.roadCode,
            ];

      const next: AStarState = {
        nodeId: edge.toNodeId,
        g: neighborG,
        f: neighborF,
        parent: current.nodeId,
        parentEdge: edge,
        incomingRoad: edge.roadCode,
        roadChanges: newRoadChanges,
        depth: current.depth + 1,
        lastKNodeIds,
        lastKNodeRoads,
      };

      pq.push(next, next.f);
    }
  }

  return { found: false, g: 0, backtrack, targetId, visitedCount, trace };
}

// ─── Path Reconstruction ─────────────────────────────────────────────────

function reconstructPath(
  startId: string,
  targetId: string,
  backtrack: Map<string, AStarState>,
  allNodes: Map<string, GraphNode>,
  routeGraph: Record<string, { nodes: GraphNode[]; edges: GraphEdge[] }>,
  crossRoadEdges: CrossRoadEdge[],
  junctions: Junction[],
): {
  nodes: GraphNode[];
  edges: (GraphEdge | CrossRoadEdge)[];
  junctions: Junction[];
  totalDistanceKm: number;
  totalWeight: number;
  roadChanges: number;
  roadSequence: { roadCode: string; fromPlace: string; toPlace: string; edgeType: string }[];
  crossRoadRatio: number;
} {
  const pathNodes: GraphNode[] = [];
  const pathEdges: (GraphEdge | CrossRoadEdge)[] = [];
  const roadSequence: {
    roadCode: string;
    fromPlace: string;
    toPlace: string;
    edgeType: string;
  }[] = [];

  // Reconstruct backwards
  let current = backtrack.get(targetId);
  while (current && current.nodeId !== startId) {
    const node = allNodes.get(current.nodeId);
    if (node) pathNodes.unshift(node);
    current = current.parent ? backtrack.get(current.parent) : undefined;
  }
  const startNode = allNodes.get(startId);
  if (startNode) pathNodes.unshift(startNode);

  // Reconstruct edges forward
  let prev = backtrack.get(startId);
  for (let i = 1; i < pathNodes.length; i++) {
    const state = backtrack.get(pathNodes[i].id);
    if (state?.parentEdge) {
      const pe = state.parentEdge;
      // Find the original edge object
      let origEdge: GraphEdge | CrossRoadEdge | undefined;

      if (pe.edgeType === "intra") {
        // Search all roads in routeGraph
        for (const road of Object.values(routeGraph)) {
          origEdge = road.edges.find((e) => e.id === pe.edgeId);
          if (origEdge) break;
        }
      } else if (pe.edgeType === "cross") {
        origEdge = crossRoadEdges.find((e) => e.id === pe.edgeId);
      }

      if (origEdge) {
        pathEdges.push(origEdge);
      } else if (pe.edgeType === "virtual") {
        // Virtual edges don't exist in original data — create lightweight record
        pathEdges.push({
          id: pe.edgeId,
          fromNodeId: pathNodes[i - 1]?.id ?? "",
          toNodeId: pathNodes[i]?.id ?? "",
          fromRoad: pathNodes[i - 1]?.roadCode ?? "",
          toRoad: pathNodes[i]?.roadCode ?? "",
          junctionId: "",
          distanceKm: pe.distanceKm,
          type: "shared-node",
          weight: pe.weight,
        } as CrossRoadEdge);
      }
    }
  }

  // Compute statistics
  let totalDistanceKm = 0;
  let totalWeight = 0;
  let crossEdgeCount = 0;
  let intraEdgeCount = 0;
  let virtualEdgeCount = 0;

  for (const edge of pathEdges) {
    totalWeight += (edge as any).weight ?? 0;
    if ((edge as any).edgeId?.startsWith("VIRTUAL") || (edge as any).id?.startsWith("VIRTUAL")) {
      virtualEdgeCount++;
      continue;
    }
    // Cross-road edges are transitions, not travel distance
    const isCross = !!(edge as CrossRoadEdge).type && (edge as CrossRoadEdge).type !== "shared-node" && (edge as CrossRoadEdge).type !== undefined;
    if (isCross) {
      crossEdgeCount++;
      continue;
    }
    const isCrossRoad = Object.hasOwn(edge, "fromRoad");
    if (isCrossRoad && (edge as CrossRoadEdge).type !== undefined) {
      crossEdgeCount++;
    } else {
      intraEdgeCount++;
      totalDistanceKm += (edge as GraphEdge).distanceKm ?? 0;
    }
  }

  // Build road sequence
  let currentRoad = "";
  for (const node of pathNodes) {
    if (node.roadCode !== currentRoad) {
      roadSequence.push({
        roadCode: node.roadCode,
        fromPlace: node.startPlace,
        toPlace: node.endPlace,
        edgeType: "intra",
      });
      currentRoad = node.roadCode;
    }
  }

  const totalEdges = intraEdgeCount + crossEdgeCount + virtualEdgeCount;
  const crossRoadRatio = totalEdges > 0 ? (crossEdgeCount + virtualEdgeCount) / totalEdges : 0;

  // Resolve junctions crossed
  const crossedJunctions: Junction[] = [];
  const pathNodeSet = new Set(pathNodes.map((n) => n.id));
  for (const j of junctions) {
    const matched = j.connectedNodeIds.filter((nid) => pathNodeSet.has(nid));
    if (matched.length >= 2) {
      crossedJunctions.push(j);
    }
  }

  // Assertions (edges are bidirectional, so check either direction)
  for (let i = 0; i < pathEdges.length; i++) {
    const e = pathEdges[i] as any;
    const fromNode = pathNodes[i];
    const toNode = pathNodes[i + 1];
    if (fromNode && toNode) {
      const valid =
        (e.fromNodeId === fromNode.id && e.toNodeId === toNode.id) ||
        (e.fromNodeId === toNode.id && e.toNodeId === fromNode.id);
      if (!valid) {
        console.error(
          `Path edge mismatch at ${i}: expected ${fromNode.id}↔${toNode.id}, got ${e.fromNodeId}↔${e.toNodeId}`,
        );
      }
    }
  }

  // No duplicate node IDs
  const nodeIds = pathNodes.map((n) => n.id);
  console.assert(
    new Set(nodeIds).size === nodeIds.length,
    "Duplicate nodes in path",
  );

  return {
    nodes: pathNodes,
    edges: pathEdges,
    junctions: crossedJunctions,
    totalDistanceKm,
    totalWeight,
    roadChanges: roadSequence.length - 1,
    roadSequence,
    crossRoadRatio,
  };
}

// ─── Route Metrics ─────────────────────────────────────────────────────────

function computeRouteMetrics(
  nodes: GraphNode[],
  edges: (GraphEdge | CrossRoadEdge)[],
  totalDistanceKm: number,
  totalWeight: number,
  roadChanges: number,
  primaryRoad: string,
): RouteMetrics {
  const n = nodes.length;

  let totalDeviationKm = 0;
  let deviationCount = 0;
  if (n >= 3) {
    const slat = nodes[0].centroidLat;
    const slon = nodes[0].centroidLon;
    const elat = nodes[n - 1].centroidLat;
    const elon = nodes[n - 1].centroidLon;
    for (let i = 1; i < n - 1; i++) {
      const d = distanceToSegmentKm(nodes[i].centroidLat, nodes[i].centroidLon, slat, slon, elat, elon);
      totalDeviationKm += d;
      deviationCount++;
    }
  }
  const avgDeviationKm = deviationCount > 0 ? totalDeviationKm / deviationCount : 0;
  const straightLineKm = n >= 2
    ? haversineKmRaw(nodes[0].centroidLat, nodes[0].centroidLon, nodes[n - 1].centroidLat, nodes[n - 1].centroidLon)
    : 1;
  const deviationScore = straightLineKm > 1
    ? Math.min(1, avgDeviationKm / Math.max(straightLineKm * 0.1, 2))
    : 0;

  const roadChangeRatePer100km = totalDistanceKm > 0
    ? roadChanges / (totalDistanceKm / 100)
    : 0;

  let primaryDistanceKm = 0;
  for (const edge of edges) {
    if (!Object.hasOwn(edge, "fromRoad")) {
      const ge = edge as GraphEdge;
      if (ge.roadCode === primaryRoad) {
        primaryDistanceKm += ge.distanceKm;
      }
    }
  }
  const continuityScore = totalDistanceKm > 0
    ? primaryDistanceKm / totalDistanceKm
    : 0;

  const idealWeight = straightLineKm;
  const weightEfficiency = idealWeight > 0
    ? Math.min(10, totalWeight / idealWeight)
    : 0;

  return {
    deviationScore: Math.round(deviationScore * 100) / 100,
    roadChangeRatePer100km: Math.round(roadChangeRatePer100km * 100) / 100,
    continuityScore: Math.round(continuityScore * 100) / 100,
    weightEfficiency: Math.round(weightEfficiency * 100) / 100,
  };
}

// ─── Callable API ──────────────────────────────────────────────────────────

let cachedGraphData: {
  routeGraph: Record<string, { nodes: GraphNode[]; edges: GraphEdge[] }>;
  junctionGraph: { junctions: Junction[]; crossRoadEdges: CrossRoadEdge[] };
  allNodes: Map<string, GraphNode>;
} | null = null;

function loadGraphData() {
  if (cachedGraphData) return cachedGraphData;
  if (!existsSync(ROUTE_GRAPH_FILE)) throw new Error("Missing route-graph.json");
  if (!existsSync(JUNCTION_GRAPH_FILE)) throw new Error("Missing junction-graph.json");
  const routeGraphRaw = loadJSON<{ roads: Record<string, { nodes: GraphNode[]; edges: GraphEdge[] }> }>(ROUTE_GRAPH_FILE);
  const routeGraph = routeGraphRaw.roads;
  const junctionGraph = loadJSON<{ junctions: Junction[]; crossRoadEdges: CrossRoadEdge[] }>(JUNCTION_GRAPH_FILE);
  const allNodes = new Map<string, GraphNode>();
  for (const road of Object.values(routeGraph)) {
    for (const node of road.nodes) {
      allNodes.set(node.id, node);
    }
  }
  cachedGraphData = { routeGraph, junctionGraph, allNodes };
  return cachedGraphData;
}

export function runRoute(params: {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  mode?: RoutingMode;
  preferRoad?: string;
  traceMode?: boolean;
}): RouteResult {
  const mode = params.mode ?? "balanced";
  const preferRoad = params.preferRoad ?? "";
  const traceMode = params.traceMode ?? false;

  const { routeGraph, junctionGraph, allNodes } = loadGraphData();

  const adjacency = buildAdjacency(routeGraph, junctionGraph.crossRoadEdges, allNodes, mode, preferRoad);

  const snapStart = snapNode(params.startLat, params.startLon, allNodes, preferRoad);
  const snapEnd = snapNode(params.endLat, params.endLon, allNodes, preferRoad);

  if (!snapStart || !snapEnd) {
    return {
      found: false,
      path: { nodes: [], edges: [], junctions: [] },
      statistics: { totalDistanceKm: 0, totalWeight: 0, roadChanges: 0, nodeCount: 0, visitedNodeCount: 0, crossRoadRatio: 0 },
      roadSequence: [],
      trace: [],
    };
  }

  if (snapStart.node.id === snapEnd.node.id) {
    return {
      found: true,
      path: { nodes: [snapStart.node], edges: [], junctions: [] },
      statistics: { totalDistanceKm: 0, totalWeight: 0, roadChanges: 0, nodeCount: 1, visitedNodeCount: 1, crossRoadRatio: 0 },
      roadSequence: [{ roadCode: snapStart.node.roadCode, fromPlace: snapStart.node.startPlace, toPlace: snapStart.node.endPlace, edgeType: "intra" }],
      trace: [],
    };
  }

  const maxSteps = 5000;
  const ares = aStar(snapStart.node.id, snapEnd.node.id, adjacency, allNodes, maxSteps, traceMode, mode, preferRoad);

  if (!ares.found) {
    return {
      found: false,
      path: { nodes: [], edges: [], junctions: [] },
      statistics: { totalDistanceKm: 0, totalWeight: 0, roadChanges: 0, nodeCount: 0, visitedNodeCount: ares.visitedCount, crossRoadRatio: 0 },
      roadSequence: [],
      trace: ares.trace,
    };
  }

  const reconstructed = reconstructPath(snapStart.node.id, ares.targetId, ares.backtrack, allNodes, routeGraph, junctionGraph.crossRoadEdges, junctionGraph.junctions);

  const primaryRoad = preferRoad || reconstructed.roadSequence[0]?.roadCode || "";
  const metrics = computeRouteMetrics(reconstructed.nodes, reconstructed.edges, reconstructed.totalDistanceKm, reconstructed.totalWeight, reconstructed.roadChanges, primaryRoad);

  return {
    found: true,
    path: {
      nodes: reconstructed.nodes,
      edges: reconstructed.edges,
      junctions: reconstructed.junctions,
    },
    statistics: {
      totalDistanceKm: reconstructed.totalDistanceKm,
      totalWeight: reconstructed.totalWeight,
      roadChanges: reconstructed.roadChanges,
      nodeCount: reconstructed.nodes.length,
      visitedNodeCount: ares.visitedCount,
      crossRoadRatio: reconstructed.crossRoadRatio,
      metrics,
    },
    roadSequence: reconstructed.roadSequence,
    trace: ares.trace,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────

function parseArgs(): {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  traceMode: boolean;
  preferRoad: string;
  mode: RoutingMode;
} {
  const args = process.argv.slice(2);
  let startLat = 27.7;
  let startLon = 85.3;
  let endLat = 26.6;
  let endLon = 87.9;
  let traceMode = false;
  let preferRoad = "";
  let mode: RoutingMode = "balanced";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && i + 1 < args.length) {
      const parts = args[++i].split(",");
      startLat = parseFloat(parts[0]);
      startLon = parseFloat(parts[1]);
    } else if (args[i] === "--end" && i + 1 < args.length) {
      const parts = args[++i].split(",");
      endLat = parseFloat(parts[0]);
      endLon = parseFloat(parts[1]);
    } else if (args[i] === "--trace") {
      traceMode = true;
    } else if (args[i] === "--road" && i + 1 < args.length) {
      preferRoad = args[++i].toUpperCase();
    } else if (args[i] === "--mode" && i + 1 < args.length) {
      const m = args[++i].toLowerCase();
      if (m in MODE_CONFIGS) mode = m as RoutingMode;
      else console.error(`Unknown mode: ${m}, using balanced`);
    }
  }

  return { startLat, startLon, endLat, endLon, traceMode, preferRoad, mode };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  const { startLat, startLon, endLat, endLon, traceMode, preferRoad, mode } = parseArgs();

  console.error(`Mode: ${mode}`);
  const result = runRoute({ startLat, startLon, endLat, endLon, mode, preferRoad, traceMode });

  console.log(JSON.stringify(result, null, 2));

  if (!result.found) {
    console.error("No route found");
    return;
  }

  const s = result.statistics;
  const first = result.path.nodes[0];
  const last = result.path.nodes[result.path.nodes.length - 1];
  console.error(`\nRoute: ${first?.startPlace ?? "?"} → ${last?.endPlace ?? "?"}`);
  console.error(`Distance: ${s.totalDistanceKm.toFixed(1)} km (intra-road only)`);
  console.error(`Weight: ${s.totalWeight.toFixed(1)}`);
  console.error(`Road changes: ${s.roadChanges}`);
  console.error(`Cross-road ratio: ${(s.crossRoadRatio * 100).toFixed(1)}%`);
  console.error(`Path nodes: ${s.nodeCount}`);
  console.error(`Junctions crossed: ${result.path.junctions.length}`);

  if (s.metrics) {
    console.error(`Continuity: ${(s.metrics.continuityScore * 100).toFixed(1)}% on ${preferRoad || result.roadSequence[0]?.roadCode || "?"}`);
    console.error(`Deviation: ${s.metrics.deviationScore.toFixed(3)}`);
    console.error(`Road change rate: ${s.metrics.roadChangeRatePer100km.toFixed(2)} per 100km`);
    console.error(`Weight efficiency: ${s.metrics.weightEfficiency.toFixed(2)}`);
  }

  if (traceMode && result.trace.length > 0) {
    console.error(`\nTrace steps: ${result.trace.length}`);
    const skipped = result.trace.filter((t) => t.skipReason);
    console.error(`  Skipped: ${skipped.length}`);
    for (const reason of ["VISITED_STATE", "LOWER_BOUND_F", "OSCILLATION_BLOCK", "NO_ADJACENCY"] as SkipReason[]) {
      const count = skipped.filter((t) => t.skipReason === reason).length;
      if (count > 0) console.error(`    ${reason}: ${count}`);
    }
    const accepted = result.trace.filter((t) => !t.skipReason);
    console.error(`  Accepted: ${accepted.length}`);
    for (const t of accepted) {
      console.error(`  [${t.edgeType}] ${t.nodeId} g=${t.g.toFixed(2)} h=${t.h.toFixed(2)} f=${t.f.toFixed(2)} road=${t.incomingRoad} changes=${t.cumulativeRoadChanges} via=${t.viaEdgeId}`);
    }
  }
}

const isMain = process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith("route-engine.ts"));
if (isMain) main();
