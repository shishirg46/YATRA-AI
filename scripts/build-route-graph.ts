import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { bearingDeg, haversineKm } from "../lib/routing/geo";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────

interface RouteChain {
  id: string;
  roadCode: string;
  segmentIds: string[];
  startPlace: string;
  endPlace: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  lengthKm: number;
  meanConfidence: number;
  segmentCount: number;
  gaps: { fromSegmentId: string; toSegmentId: string; distanceKm: number; decision: string }[];
}

interface ChainLink {
  fromChainId: string;
  toChainId: string;
  distanceKm: number;
  decision: "link" | "split";
  headingSimilarity: number;
}

interface NamedPlace {
  name: string;
  lat: number;
  lon: number;
}

interface RouteGraphNode {
  id: string;
  roadCode: string;
  chainIndex: number;
  startPlace: string;
  endPlace: string;
  startPlaceSource: "raw" | "gazetteer";
  endPlaceSource: "raw" | "gazetteer";
  startPlaceResolved?: string;
  endPlaceResolved?: string;
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

interface RouteGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  roadCode: string;
  distanceKm: number;
  linkType: "link" | "split";
  headingSimilarity: number;
  weight: number;
}

interface DebugEntry {
  roadCode: string;
  highestWeightEdges: RouteGraphEdge[];
  lowestWeightEdges: RouteGraphEdge[];
  maxBearingJumpEdges: { fromNodeId: string; toNodeId: string; jumpDeg: number }[];
}

// ─── Constants ────────────────────────────────────────────────────────────

const INPUT_FILE = "scripts/data/route-chains.json";
const OUTPUT_FILE = "scripts/data/route-graph.json";
const DEBUG_FILE = "scripts/data/debug-route-graph-sample.json";

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeConfidencePenalty(meanConfidence: number): number {
  return 1 + 0.5 * clamp((0.7 - meanConfidence) / 0.7, 0, 1);
}

function cycleBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

// ─── Gazetteer ────────────────────────────────────────────────────────────

function isSyntheticLabel(name: string): boolean {
  return /-wp\d+$/.test(name);
}

const CORRIDOR_DIR = "scripts/data/corridors";
const ROUTE_NODES_FILE = "scripts/data/nepal-route-nodes.json";

function loadGazetteer(): NamedPlace[] {
  const places: NamedPlace[] = [];

  if (existsSync(ROUTE_NODES_FILE)) {
    const data = loadJSON<{ nodes: NamedPlace[] }>(ROUTE_NODES_FILE);
    for (const n of data.nodes) {
      places.push({ name: n.name, lat: n.lat, lon: n.lon });
    }
  }

  if (existsSync(CORRIDOR_DIR)) {
    for (const file of readdirSync(CORRIDOR_DIR).filter((f) => f.endsWith(".json"))) {
      const data = loadJSON<{ nodes: { name: string; lat: number; lon: number }[] }>(
        join(CORRIDOR_DIR, file),
      );
      if (data.nodes) {
        for (const n of data.nodes) {
          places.push({ name: n.name, lat: n.lat, lon: n.lon });
        }
      }
    }
  }

  return places;
}

function findNearestPlace(
  lat: number,
  lon: number,
  places: NamedPlace[],
  radiusKm: number,
): NamedPlace | null {
  let best: NamedPlace | null = null;
  let bestDist = radiusKm;

  for (const p of places) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }

  return best;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error("Missing input:", INPUT_FILE);
    console.error("Run build:route-chains first");
    process.exit(1);
  }

  const input = loadJSON<{
    roads: Record<string, { chains: RouteChain[]; links: ChainLink[] }>;
  }>(INPUT_FILE);

  const roads: Record<
    string,
    { nodes: RouteGraphNode[]; edges: RouteGraphEdge[] }
  > = {};

  const debugEntries: DebugEntry[] = [];

  for (const [roadCode, road] of Object.entries(input.roads)) {
    const chains = road.chains;
    const links = road.links;

    if (chains.length === 0) {
      roads[roadCode] = { nodes: [], edges: [] };
      continue;
    }

    // Build nodes from chains
    const nodes: RouteGraphNode[] = chains.map((chain, i) => {
      const b = cycleBearing(
        bearingDeg(chain.startLat, chain.startLon, chain.endLat, chain.endLon),
      );
      return {
        id: chain.id,
        roadCode: chain.roadCode,
        chainIndex: i,
        startPlace: chain.startPlace,
        endPlace: chain.endPlace,
        startPlaceSource: "raw",
        endPlaceSource: "raw",
        startLat: chain.startLat,
        startLon: chain.startLon,
        endLat: chain.endLat,
        endLon: chain.endLon,
        centroidLat: (chain.startLat + chain.endLat) / 2,
        centroidLon: (chain.startLon + chain.endLon) / 2,
        lengthKm: chain.lengthKm,
        meanConfidence: chain.meanConfidence,
        bearingDeg: b,
      };
    });

    // Gazetteer enrichment — replace synthetic labels with resolved place names
    {
      const gazetteer = loadGazetteer();
      const RADIUS_KM = 10;

      for (const node of nodes) {
        if (isSyntheticLabel(node.startPlace)) {
          const nearest = findNearestPlace(node.startLat, node.startLon, gazetteer, RADIUS_KM);
          if (nearest) {
            node.startPlaceResolved = nearest.name;
            node.startPlaceSource = "gazetteer";
          }
        }
        if (isSyntheticLabel(node.endPlace)) {
          const nearest = findNearestPlace(node.endLat, node.endLon, gazetteer, RADIUS_KM);
          if (nearest) {
            node.endPlaceResolved = nearest.name;
            node.endPlaceSource = "gazetteer";
          }
        }
      }
    }

    // Build edges from links
    const edges: RouteGraphEdge[] = links.map((link, i) => {
      const fromNode = nodes.find((n) => n.id === link.fromChainId);
      const toNode = nodes.find((n) => n.id === link.toChainId);
      const meanConf = ((fromNode?.meanConfidence ?? 0.5) + (toNode?.meanConfidence ?? 0.5)) / 2;
      const linkFactor = link.decision === "split" ? 2.0 : 1.0;
      const confPenalty = computeConfidencePenalty(meanConf);
      const weight = link.distanceKm * linkFactor * confPenalty;

      return {
        id: `${roadCode}_edge_${i}`,
        fromNodeId: link.fromChainId,
        toNodeId: link.toChainId,
        roadCode,
        distanceKm: link.distanceKm,
        linkType: link.decision,
        headingSimilarity: link.headingSimilarity,
        weight,
      };
    });

    roads[roadCode] = { nodes, edges };

    // Build debug entry
    if (edges.length > 0) {
      const sortedByWeight = [...edges].sort((a, b) => b.weight - a.weight);
      const byBearingJump: {
        fromNodeId: string;
        toNodeId: string;
        jumpDeg: number;
      }[] = [];

      for (const edge of edges) {
        const fn = nodes.find((n) => n.id === edge.fromNodeId);
        const tn = nodes.find((n) => n.id === edge.toNodeId);
        if (!fn || !tn) continue;
        const diff = Math.abs(fn.bearingDeg - tn.bearingDeg);
        const jumpDeg = Math.min(diff, 360 - diff);
        byBearingJump.push({
          fromNodeId: fn.id,
          toNodeId: tn.id,
          jumpDeg,
        });
      }
      byBearingJump.sort((a, b) => b.jumpDeg - a.jumpDeg);

      debugEntries.push({
        roadCode,
        highestWeightEdges: sortedByWeight.slice(0, 10),
        lowestWeightEdges: sortedByWeight.slice(-10).reverse(),
        maxBearingJumpEdges: byBearingJump.slice(0, 5),
      });
    }
  }

  const output = {
    version: 3,
    generatedAt: new Date().toISOString(),
    source: "build-route-graph.ts",
    roads,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written ${OUTPUT_FILE}`);

  writeFileSync(DEBUG_FILE, JSON.stringify(debugEntries, null, 2));
  console.log(`Written ${DEBUG_FILE}`);

  // Summary table
  const totals = Object.keys(roads)
    .filter((rc) => roads[rc].nodes.length > 0)
    .map((rc) => {
      const r = roads[rc];
      const weights = r.edges.map((e) => e.weight);
      const maxW = weights.length > 0 ? Math.max(...weights) : 0;
      const medianW =
        weights.length > 0
          ? [...weights].sort((a, b) => a - b)[Math.floor(weights.length / 2)]
          : 0;
      return {
        roadCode: rc,
        nodes: r.nodes.length,
        edges: r.edges.length,
        totalKm: r.nodes.reduce((s, n) => s + n.lengthKm, 0).toFixed(1),
        maxWeight: maxW.toFixed(1),
        medianWeight: medianW.toFixed(2),
      };
    });
  console.table(totals);
}

main();
