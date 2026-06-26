import { runRoute, type RouteResult, type RoutingMode } from "./route-engine";
import { writeFileSync } from "fs";

interface RouteNode {
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

interface RouteEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  roadCode?: string;
  fromRoad?: string;
  toRoad?: string;
  distanceKm: number;
  weight: number;
  junctionId?: string;
  linkType?: string;
  type?: string;
}

interface RouteJunction {
  id: string;
  lat: number;
  lon: number;
  roads: string[];
  connectedNodeIds: string[];
  detectionMethod: string;
}

const ROAD_COLORS: Record<string, string> = {
  NH01: "#FF0000",
  NH02: "#FF6600",
  NH03: "#FFAA00",
  NH04: "#00CC00",
  NH05: "#0066FF",
  NH06: "#6600CC",
  NH07: "#CC0066",
  NH08: "#00CCCC",
  NH09: "#CC6600",
  NH10: "#339900",
  NH11: "#993300",
  NH12: "#336699",
  NH13: "#993366",
  FR01: "#999999",
  FR02: "#888888",
  FR03: "#777777",
  FR04: "#666666",
};

const JUNCTION_COLOR = "#FFD700";

function getRoadColor(roadCode: string): string {
  return ROAD_COLORS[roadCode] ?? "#AAAAAA";
}

function buildGeoJSON(result: RouteResult, label: string): Record<string, any> {
  if (!result.found || !result.path) return { type: "FeatureCollection", features: [] };

  const routeNodes = result.path.nodes as RouteNode[];
  const routeEdges = result.path.edges as RouteEdge[];

  const nodeMap = new Map<string, RouteNode>();
  for (const n of routeNodes) nodeMap.set(n.id, n);

  const features: Record<string, any>[] = [];

  for (const e of routeEdges) {
    const fromNode = nodeMap.get(e.fromNodeId);
    const toNode = nodeMap.get(e.toNodeId);
    if (!fromNode || !toNode) continue;

    const roadCode = e.roadCode || `${e.fromRoad ?? "?"}→${e.toRoad ?? "?"}`;
    const isCrossRoad = !!e.junctionId;
    const isVirtual = e.type === "virtual";

    const coords: [number, number][] = [
      [fromNode.centroidLon, fromNode.centroidLat],
      [toNode.centroidLon, toNode.centroidLat],
    ];

    let color = getRoadColor(roadCode);
    let width = isCrossRoad ? 2 : 3;
    let dash = isCrossRoad ? "5,5" : "none";
    if (isVirtual) {
      color = "#FF00FF";
      width = 2;
      dash = "3,3";
    }

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        edgeType: isCrossRoad ? (isVirtual ? "virtual" : "cross-road") : "intra-road",
        roadCode,
        fromNode: e.fromNodeId,
        toNode: e.toNodeId,
        distanceKm: Math.round(e.distanceKm * 100) / 100,
        weight: Math.round(e.weight * 100) / 100,
        stroke: color,
        "stroke-width": width,
        "stroke-dasharray": dash,
      },
    });
  }

  const added = new Set<string>();
  for (const e of routeEdges) {
    for (const nid of [e.fromNodeId, e.toNodeId]) {
      if (added.has(nid)) continue;
      added.add(nid);
      const n = nodeMap.get(nid);
      if (!n) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [n.centroidLon, n.centroidLat] },
        properties: {
          type: "chain-node",
          nodeId: n.id,
          roadCode: n.roadCode,
          startPlace: n.startPlace,
          endPlace: n.endPlace,
          bearingDeg: Math.round(n.bearingDeg),
          "marker-color": getRoadColor(n.roadCode),
          "marker-size": "small",
        },
      });
    }
  }

  const junctions = result.path.junctions as RouteJunction[];
  if (junctions) {
    for (const j of junctions) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [j.lon, j.lat] },
        properties: {
          type: "junction",
          junctionId: j.id,
          roads: j.roads.join(", "),
          detectionMethod: j.detectionMethod,
          "marker-color": JUNCTION_COLOR,
          "marker-size": "medium",
          "marker-symbol": "star",
        },
      });
    }
  }

  const out: Record<string, any> = {
    type: "FeatureCollection",
    features,
    metadata: {
      label: label,
      mode: (result as any).statistics?.metrics ? "with-metrics" : "basic",
      stats: result.statistics,
    },
  };

  return out;
}

function main() {
  const routes: { name: string; startLat: number; startLon: number; endLat: number; endLon: number; mode: RoutingMode; road: string }[] = [
    { name: "NH01-east-west-balanced", startLat: 26.681, startLon: 87.349, endLat: 28.92, endLon: 80.21, mode: "balanced", road: "NH01" },
    { name: "NH01-east-west-strict", startLat: 26.681, startLon: 87.349, endLat: 28.92, endLon: 80.21, mode: "strict-road", road: "NH01" },
    { name: "Hetauda-virtual", startLat: 27.42, startLon: 85.03, endLat: 27.30, endLon: 84.96, mode: "balanced", road: "NH01" },
  ];

  const collection: Record<string, any> = { type: "FeatureCollection", features: [] };

  for (const r of routes) {
    const result = runRoute({
      startLat: r.startLat, startLon: r.startLon,
      endLat: r.endLat, endLon: r.endLon,
      mode: r.mode, preferRoad: r.road,
    });
    const geojson = buildGeoJSON(result, r.name);
    collection.features.push(...geojson.features);
    const label = `${r.name}: ${result.found ? `found (${result.statistics.totalDistanceKm.toFixed(0)}km, ${result.statistics.roadChanges} changes)` : "NOT FOUND"}`;
    console.error(label);
  }

  writeFileSync("scripts/data/route-visualization.geojson", JSON.stringify(collection, null, 2));
  console.error(`\nWrote scripts/data/route-visualization.geojson (${collection.features.length} features)`);
}

main();
