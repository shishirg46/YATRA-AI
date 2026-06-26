import { readFileSync, writeFileSync, existsSync } from "fs";
import { haversineKm, bearingDeg } from "../lib/routing/geo";

// ─── Types ────────────────────────────────────────────────────────────────

interface Segment {
  id: string;
  roadCode: string;
  fromNode: string;
  toNode: string;
  nodeIds: string[];
  polyline: { lat: number; lon: number }[];
}

interface Corridor {
  roadCode: string;
  segments: Segment[];
}

interface ExistingChain {
  id: string;
  roadCode: string;
  segmentIds: string[];
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
}

interface GraphNode {
  id: string;
  roadCode: string;
  chainIndex: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  centroidLat: number;
  centroidLon: number;
  bearingDeg: number;
}

interface Junction {
  id: string;
  lat: number;
  lon: number;
  roads: string[];
  connectedNodeIds: string[];
  detectionMethod: "shared-node" | "endpoint-proximity";
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

// ─── Constants ────────────────────────────────────────────────────────────

const STITCHED_FILE = "scripts/data/stitched-corridors.json";
const ROUTE_GRAPH_FILE = "scripts/data/route-graph.json";
const CHAINS_FILE = "scripts/data/route-chains.json";
const OUTPUT_FILE = "scripts/data/junction-graph.json";

const ENDPOINT_RADIUS_KM = 0.5; // 500m for endpoint-endpoint
const MIDPOINT_RADIUS_KM = 0.5; // 500m for endpoint-midpoint (weak signal)
const ENDPOINT_MIDPOINT_HEADING_MAX = 90; // looser heading for midpoint detection
const HEADING_SYMMETRY_DEG = 45;
const CLUSTER_RADIUS_KM = 0.05; // 50m for coalescing nearby junctions

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function headingSymmetryScore(h1: number, h2: number): number {
  const diff = Math.abs(normalizeHeading(h1) - normalizeHeading(h2 + 180));
  return Math.min(diff, 360 - diff);
}

function junctionId(
  lat: number,
  lon: number,
  roads: string[],
): string {
  const latS = lat.toFixed(5);
  const lonS = lon.toFixed(5);
  const sortedRoads = [...roads].sort().join("_");
  return `J_${latS}_${lonS}_${sortedRoads}`;
}

function crossRoadEdgeId(from: string, to: string, idx: number): string {
  const parts = [from, to].sort();
  return `XR_${parts[0]}_${parts[1]}_${idx}`;
}

function endpointTangent(
  chain: ExistingChain,
  segMap: Map<string, Segment>,
  which: "start" | "end",
): number | null {
  const segId = which === "start"
    ? chain.segmentIds[0]
    : chain.segmentIds[chain.segmentIds.length - 1];
  const seg = segMap.get(segId);
  if (!seg || seg.polyline.length < 2) return null;
  const poly = seg.polyline;
  if (which === "start") {
    return bearingDeg(poly[0].lat, poly[0].lon, poly[1].lat, poly[1].lon);
  }
  return bearingDeg(
    poly[poly.length - 2].lat,
    poly[poly.length - 2].lon,
    poly[poly.length - 1].lat,
    poly[poly.length - 1].lon,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  for (const f of [STITCHED_FILE, ROUTE_GRAPH_FILE, CHAINS_FILE]) {
    if (!existsSync(f)) {
      console.error(`Missing input: ${f}`);
      process.exit(1);
    }
  }

  const stitched = loadJSON<{ corridors: Corridor[] }>(STITCHED_FILE);
  const routeGraph = loadJSON<{
    roads: Record<string, { nodes: GraphNode[] }>;
  }>(ROUTE_GRAPH_FILE);
  const chainsData = loadJSON<{
    roads: Record<string, { chains: ExistingChain[] }>;
  }>(CHAINS_FILE);

  // Build segment map: segmentId → Segment
  const segMap = new Map<string, Segment>();
  for (const corr of stitched.corridors) {
    for (const seg of corr.segments) {
      segMap.set(seg.id, seg);
    }
  }

  // Build nodeId → { roads, chainIds } for topological detection
  // We need to know which chains (route-graph nodes) contain each topology node
  const nodeIndex = new Map<
    string,
    { roads: Set<string>; chainIds: Set<string> }
  >();

  for (const corr of stitched.corridors) {
    const rc = corr.roadCode;
    const roadChains = chainsData.roads[rc]?.chains ?? [];
    for (const chain of roadChains) {
      for (const segId of chain.segmentIds) {
        const seg = segMap.get(segId);
        if (!seg) continue;
        for (const nid of seg.nodeIds) {
          let entry = nodeIndex.get(nid);
          if (!entry) {
            entry = { roads: new Set(), chainIds: new Set() };
            nodeIndex.set(nid, entry);
          }
          entry.roads.add(rc);
          entry.chainIds.add(chain.id);
        }
      }
    }
  }

  // ─── Phase 1: Topological (shared-node) detection ────────────────────

  const junctionsMap = new Map<string, Junction>();
  const crossEdges: CrossRoadEdge[] = [];
  const resolvedPairs = new Set<string>();

  for (const [nodeId, entry] of nodeIndex) {
    if (entry.roads.size < 2) continue;

    // Find the actual coordinates from the first segment that uses this node
    let nodeLat = 0;
    let nodeLon = 0;
    for (const corr of stitched.corridors) {
      if (!entry.roads.has(corr.roadCode)) continue;
      for (const seg of corr.segments) {
        // Check if nodeId is in this segment's nodeIds or is fromNode/toNode
        const idx = seg.nodeIds.indexOf(nodeId);
        if (idx >= 0) {
          // Approximate by finding a polyline point near this node
          // Use the midpoint of the segment as a rough position
          const mid = Math.floor(seg.polyline.length / 2);
          nodeLat = seg.polyline[mid].lat;
          nodeLon = seg.polyline[mid].lon;
          break;
        }
      }
      if (nodeLat !== 0) break;
    }

    // Fallback: use centroid of connected chain endpoints
    if (nodeLat === 0) continue;

    const sortedRoads = [...entry.roads].sort();
    const jid = junctionId(nodeLat, nodeLon, sortedRoads);

    const junction: Junction = {
      id: jid,
      lat: nodeLat,
      lon: nodeLon,
      roads: sortedRoads,
      connectedNodeIds: [...entry.chainIds].sort(),
      detectionMethod: "shared-node",
    };

    // Only keep one junction per coordinate+roads combo
    const existing = junctionsMap.get(jid);
    if (existing) {
      // Merge chain IDs
      for (const cid of entry.chainIds) {
        if (!existing.connectedNodeIds.includes(cid)) {
          existing.connectedNodeIds.push(cid);
        }
      }
      existing.connectedNodeIds.sort();
      continue;
    }
    junctionsMap.set(jid, junction);

    // Create cross-road edges for each pair of roads at this junction
    const nodeIdsArr = [...entry.chainIds];
    for (let i = 0; i < nodeIdsArr.length; i++) {
      for (let j = i + 1; j < nodeIdsArr.length; j++) {
        const fromRoad = nodeIdsArr[i].split("_")[0];
        const toRoad = nodeIdsArr[j].split("_")[0];
        crossEdges.push({
          id: crossRoadEdgeId(fromRoad, toRoad, crossEdges.length),
          fromNodeId: nodeIdsArr[i],
          toNodeId: nodeIdsArr[j],
          fromRoad,
          toRoad,
          junctionId: jid,
          distanceKm: 0,
          type: "shared-node",
          weight: 0.1, // small constant — real intersection, negligible cost
        });
      }
    }

    // Mark these road pairs as resolved
    for (let i = 0; i < sortedRoads.length; i++) {
      for (let j = i + 1; j < sortedRoads.length; j++) {
        resolvedPairs.add(`${sortedRoads[i]}:${sortedRoads[j]}`);
      }
    }
  }

  console.log(
    `Phase 1: ${junctionsMap.size} topological junctions, ${crossEdges.length} cross-road edges`,
  );

  // ─── Phase 2: Geometric (endpoint proximity) detection ──────────────

  // Collect all chain endpoints from route-graph nodes
  interface Endpoint {
    nodeId: string;
    roadCode: string;
    lat: number;
    lon: number;
    which: "start" | "end";
    chainIdx: number;
  }

  const allEndpoints: Endpoint[] = [];
  const chainMap = new Map<string, ExistingChain>();

  for (const [rc, road] of Object.entries(chainsData.roads)) {
    for (const chain of road.chains) {
      chainMap.set(chain.id, chain);
      allEndpoints.push({
        nodeId: chain.id,
        roadCode: rc,
        lat: chain.startLat,
        lon: chain.startLon,
        which: "start",
        chainIdx: allEndpoints.length,
      });
      allEndpoints.push({
        nodeId: chain.id,
        roadCode: rc,
        lat: chain.endLat,
        lon: chain.endLon,
        which: "end",
        chainIdx: allEndpoints.length,
      });
    }
  }

  // Group endpoints by roadCode for efficient pairwise checking
  const endpointsByRoad = new Map<string, Endpoint[]>();
  for (const ep of allEndpoints) {
    let arr = endpointsByRoad.get(ep.roadCode);
    if (!arr) {
      arr = [];
      endpointsByRoad.set(ep.roadCode, arr);
    }
    arr.push(ep);
  }

  const roadCodes = [...endpointsByRoad.keys()].sort();
  let geometricJunctions = 0;

  for (let i = 0; i < roadCodes.length; i++) {
    for (let j = i + 1; j < roadCodes.length; j++) {
      const rcA = roadCodes[i];
      const rcB = roadCodes[j];
      const pairKey = `${rcA}:${rcB}`;
      const pairKeyRev = `${rcB}:${rcA}`;

      // Skip if already resolved by shared-node detection
      if (
        resolvedPairs.has(pairKey) ||
        resolvedPairs.has(pairKeyRev)
      ) {
        continue;
      }

      const epsA = endpointsByRoad.get(rcA)!;
      const epsB = endpointsByRoad.get(rcB)!;

      for (const epA of epsA) {
        // Compute endpoint tangent for epA
        const chainA = chainMap.get(epA.nodeId);
        if (!chainA) continue;
        const tangentA = endpointTangent(chainA, segMap, epA.which);
        if (tangentA === null) continue;

        // Check against epB endpoints
        for (const epB of epsB) {
          const dist = haversineKm(epA.lat, epA.lon, epB.lat, epB.lon);
          if (dist > ENDPOINT_RADIUS_KM) continue;

          const chainB = chainMap.get(epB.nodeId);
          if (!chainB) continue;
          const tangentB = endpointTangent(chainB, segMap, epB.which);
          if (tangentB === null) continue;

          // Heading symmetry: A exits toward B, B enters from A
          // A's exit direction (tangentA at end) should complement B's entry direction (tangentB at start)
          // B's exit direction (tangentB at end) should complement A's entry direction (tangentA at start)
          let symmetryScore: number;
          if (epA.which === "end" && epB.which === "start") {
            symmetryScore = headingSymmetryScore(tangentA, tangentB);
          } else if (epA.which === "start" && epB.which === "end") {
            symmetryScore = headingSymmetryScore(tangentB, tangentA);
          } else if (epA.which === "end" && epB.which === "end") {
            // Both exiting → should point in similar direction (for passing each other)
            symmetryScore = Math.min(
              Math.abs(normalizeHeading(tangentA) - normalizeHeading(tangentB)),
              360 - Math.abs(normalizeHeading(tangentA) - normalizeHeading(tangentB)),
            );
          } else {
            // Both starting → similar direction
            symmetryScore = Math.min(
              Math.abs(normalizeHeading(tangentA) - normalizeHeading(tangentB)),
              360 - Math.abs(normalizeHeading(tangentA) - normalizeHeading(tangentB)),
            );
          }

          if (symmetryScore > HEADING_SYMMETRY_DEG) continue;

          // Found a geometric junction
          const avgLat = (epA.lat + epB.lat) / 2;
          const avgLon = (epA.lon + epB.lon) / 2;
          const roads = [rcA, rcB].sort();
          const jid = junctionId(avgLat, avgLon, roads);

          let junction = junctionsMap.get(jid);
          if (!junction) {
            junction = {
              id: jid,
              lat: avgLat,
              lon: avgLon,
              roads,
              connectedNodeIds: [],
              detectionMethod: "endpoint-proximity",
            };
            junctionsMap.set(jid, junction);
            geometricJunctions++;
          } else if (
            junction.detectionMethod === "endpoint-proximity"
          ) {
            // Refine position
            junction.lat = (junction.lat + avgLat) / 2;
            junction.lon = (junction.lon + avgLon) / 2;
          }

          // Add chain IDs if not present
          for (const nid of [epA.nodeId, epB.nodeId]) {
            if (!junction.connectedNodeIds.includes(nid)) {
              junction.connectedNodeIds.push(nid);
            }
          }
          junction.connectedNodeIds.sort();

          const weight = Math.min(
            1.0,
            0.1 * dist,
          );

          const existingEdge = crossEdges.find(
            (e) =>
              e.fromNodeId === epA.nodeId &&
              e.toNodeId === epB.nodeId &&
              e.type === "endpoint-endpoint",
          );
          if (!existingEdge) {
            crossEdges.push({
              id: crossRoadEdgeId(rcA, rcB, crossEdges.length),
              fromNodeId: epA.nodeId,
              toNodeId: epB.nodeId,
              fromRoad: rcA,
              toRoad: rcB,
              junctionId: jid,
              distanceKm: dist,
              type: "endpoint-endpoint",
              weight,
            });
          }
        }
      }
    }
  }

  // ─── Phase 2b: Endpoint-midpoint (weak geometric) ──────────────────

  const midpointCache = new Map<string, { lat: number; lon: number }>();

  function getChainMidpoint(chainId: string): { lat: number; lon: number } | null {
    const cached = midpointCache.get(chainId);
    if (cached) return cached;
    const chain = chainMap.get(chainId);
    if (!chain) return null;
    let tLat = 0;
    let tLon = 0;
    let count = 0;
    for (const segId of chain.segmentIds) {
      const seg = segMap.get(segId);
      if (!seg) continue;
      for (const pt of seg.polyline) {
        tLat += pt.lat;
        tLon += pt.lon;
        count++;
      }
    }
    if (count === 0) return null;
    const result = { lat: tLat / count, lon: tLon / count };
    midpointCache.set(chainId, result);
    return result;
  }

  for (let i = 0; i < roadCodes.length; i++) {
    for (let j = i + 1; j < roadCodes.length; j++) {
      const rcA = roadCodes[i];
      const rcB = roadCodes[j];
      const pairKey = `${rcA}:${rcB}`;
      const pairKeyRev = `${rcB}:${rcA}`;
      if (resolvedPairs.has(pairKey) || resolvedPairs.has(pairKeyRev)) continue;

      const chainsA = chainsData.roads[rcA]?.chains ?? [];
      const epsB = endpointsByRoad.get(rcB)!;

      for (const chainA of chainsA) {
        const mid = getChainMidpoint(chainA.id);
        if (!mid) continue;

        for (const epB of epsB) {
          const dist = haversineKm(mid.lat, mid.lon, epB.lat, epB.lon);
          if (dist > MIDPOINT_RADIUS_KM) continue;

          // Weak heading check: chainA's overall bearing vs epB's local tangent
          const tangentB = endpointTangent(chainMap.get(epB.nodeId)!, segMap, epB.which);
          if (tangentB === null) continue;

          const chainABearing =
            bearingDeg(chainA.startLat, chainA.startLon, chainA.endLat, chainA.endLon);
          const diff = Math.abs(
            normalizeHeading(chainABearing) - normalizeHeading(tangentB),
          );
          const headingDiff = Math.min(diff, 360 - diff);
          if (headingDiff > ENDPOINT_MIDPOINT_HEADING_MAX) continue;

          // Found weak junction
          const avgLat = (mid.lat + epB.lat) / 2;
          const avgLon = (mid.lon + epB.lon) / 2;
          const roads = [rcA, rcB].sort();
          const jid = junctionId(avgLat, avgLon, roads);

          let junction = junctionsMap.get(jid);
          if (!junction) {
            junction = {
              id: jid,
              lat: avgLat,
              lon: avgLon,
              roads,
              connectedNodeIds: [],
              detectionMethod: "endpoint-proximity",
            };
            junctionsMap.set(jid, junction);
            geometricJunctions++;
          } else if (junction.detectionMethod === "endpoint-proximity") {
            junction.lat = (junction.lat + avgLat) / 2;
            junction.lon = (junction.lon + avgLon) / 2;
          }

          for (const nid of [chainA.id, epB.nodeId]) {
            if (!junction.connectedNodeIds.includes(nid)) {
              junction.connectedNodeIds.push(nid);
            }
          }
          junction.connectedNodeIds.sort();

          const weight = Math.min(1.0, 0.15 * dist);

          const existingEdge = crossEdges.find(
            (e) =>
              e.fromNodeId === chainA.id &&
              e.toNodeId === epB.nodeId &&
              e.type === "endpoint-midpoint",
          );
          if (!existingEdge) {
            crossEdges.push({
              id: crossRoadEdgeId(rcA, rcB, crossEdges.length),
              fromNodeId: chainA.id,
              toNodeId: epB.nodeId,
              fromRoad: rcA,
              toRoad: rcB,
              junctionId: jid,
              distanceKm: dist,
              type: "endpoint-midpoint",
              weight,
            });
          }
        }
      }
    }
  }

  console.log(
    `Phase 2: ${geometricJunctions} geometric junctions found`,
  );
  console.log(`Total junctions: ${junctionsMap.size}`);
  console.log(`Total cross-road edges: ${crossEdges.length}`);

  // ─── Coalesce nearby junctions ──────────────────────────────────────

  const junctionList = [...junctionsMap.values()];
  const merged = new Set<string>();
  const coalesced: Junction[] = [];

  for (const j of junctionList) {
    if (merged.has(j.id)) continue;
    merged.add(j.id);

    const nearby = junctionList.filter(
      (o) =>
        o.id !== j.id &&
        !merged.has(o.id) &&
        haversineKm(j.lat, j.lon, o.lat, o.lon) < CLUSTER_RADIUS_KM,
    );

    if (nearby.length > 0) {
      // Merge: combine chain IDs, average position
      const allRoads = new Set(j.roads);
      const allChainIds = new Set(j.connectedNodeIds);
      let tLat = j.lat;
      let tLon = j.lon;
      let count = 1;

      for (const n of nearby) {
        merged.add(n.id);
        for (const r of n.roads) allRoads.add(r);
        for (const cid of n.connectedNodeIds) allChainIds.add(cid);
        tLat += n.lat;
        tLon += n.lon;
        count++;
      }

      const sortedRoads = [...allRoads].sort();
      const mergedJid = junctionId(
        tLat / count,
        tLon / count,
        sortedRoads,
      );

      coalesced.push({
        id: mergedJid,
        lat: tLat / count,
        lon: tLon / count,
        roads: sortedRoads,
        connectedNodeIds: [...allChainIds].sort(),
        detectionMethod: "shared-node", // strongest method wins
      });
    } else {
      coalesced.push(j);
    }
  }

  console.log(`After coalescing: ${coalesced.length} junctions`);

  // Update edge junctionIds after coalescing
  const edgeJunctionMap = new Map<string, string>();
  for (const j of coalesced) {
    for (const nid of j.connectedNodeIds) {
      edgeJunctionMap.set(nid, j.id);
    }
  }
  for (const edge of crossEdges) {
    const jid =
      edgeJunctionMap.get(edge.fromNodeId) ||
      edgeJunctionMap.get(edge.toNodeId) ||
      edge.junctionId;
    edge.junctionId = jid;
  }

  // ─── Write output ───────────────────────────────────────────────────

  const output = {
    version: 4,
    generatedAt: new Date().toISOString(),
    source: "build-junction-graph.ts",
    junctions: coalesced,
    crossRoadEdges: crossEdges,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written ${OUTPUT_FILE}`);

  // Summary
  console.log("\nJunctions by road pair:");
  const pairCounts = new Map<string, number>();
  for (const j of coalesced) {
    for (let a = 0; a < j.roads.length; a++) {
      for (let b = a + 1; b < j.roads.length; b++) {
        const key = `${j.roads[a]}-${j.roads[b]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const sortedPairs = [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [pair, count] of sortedPairs) {
    const roads = pair.split("-");
    const edgesForPair = crossEdges.filter(
      (e) =>
        (e.fromRoad === roads[0] && e.toRoad === roads[1]) ||
        (e.fromRoad === roads[1] && e.toRoad === roads[0]),
    );
    console.log(
      `  ${pair}: ${count} junctions, ${edgesForPair.length} edges, types: ${[...new Set(edgesForPair.map((e) => e.type))].join(", ")}`,
    );
  }

  // Weight distribution
  const weights = crossEdges.map((e) => e.weight);
  console.log(
    `\nWeight range: ${Math.min(...weights).toFixed(3)} – ${Math.max(...weights).toFixed(3)}`,
  );
}

main();
