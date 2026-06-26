import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { haversineKm, bearingDeg } from "../lib/routing/geo";

// ─── Types ────────────────────────────────────────────────────────────────

type MergeDecision = "merge" | "merge-gap" | "link" | "split";

interface Waypoint {
  lat: number;
  lon: number;
  name?: string;
  index?: number;
}

interface Segment {
  id: string;
  roadCode: string;
  roadName: string;
  fromNode: string;
  toNode: string;
  fromPlace: string;
  toPlace: string;
  edgeIds: string[];
  nodeIds: string[];
  polyline: { lat: number; lon: number }[];
  lengthKm: number;
  edgeCount: number;
  meanConfidence: number;
}

interface ChainGap {
  fromSegmentId: string;
  toSegmentId: string;
  distanceKm: number;
  decision: "merge-gap";
}

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
  gaps: ChainGap[];
}

interface ChainLink {
  fromChainId: string;
  toChainId: string;
  distanceKm: number;
  decision: "link" | "split";
  headingSimilarity: number;
}

interface RoadData {
  chains: RouteChain[];
  links: ChainLink[];
  statistics: {
    totalChains: number;
    totalLinks: number;
    totalLengthKm: number;
    largestGapKm: number;
    splitWarnings: number;
  };
  warnings: string[];
}

interface CorridorWaypoints {
  waypoints: Waypoint[];
  fromPlace: string;
  toPlace: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const CORRIDOR_FILES_DIR = "scripts/data/corridors";
const CORRIDOR_TO_ROADCODE: Record<string, string[]> = {
  mahendra: ["NH01"],
  bp: ["NH03"],
  "mid-hill": ["NH04"],
  siddhartha: ["NH10"],
  prithvi: ["NH17"],
};

const LARGE_GAP_THRESHOLD: Record<string, number> = {
  NH01: 5,
  NH03: 5,
  NH10: 5,
  NH11: 5,
  NH04: 10,
  NH17: 8,
};

const HEADING_SIMILARITY_MIN = 0.6;

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function haversineKmBetween(a: Waypoint, b: Waypoint): number {
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}

function centroidOf(seg: Segment): Waypoint {
  const poly = seg.polyline;
  let lat = 0;
  let lon = 0;
  for (const p of poly) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / poly.length, lon: lon / poly.length };
}

function headingSimilarityDeg(aDeg: number, bDeg: number): number {
  const diff = Math.abs(aDeg - bDeg);
  const angularDiff = Math.min(diff, 360 - diff);
  return 1 - angularDiff / 180;
}

function headingOf(polyline: { lat: number; lon: number }[]): number {
  if (polyline.length < 2) return 0;
  return bearingDeg(
    polyline[polyline.length - 2].lat,
    polyline[polyline.length - 2].lon,
    polyline[polyline.length - 1].lat,
    polyline[polyline.length - 1].lon,
  );
}

function headingStartOf(polyline: { lat: number; lon: number }[]): number {
  if (polyline.length < 2) return 0;
  return bearingDeg(polyline[0].lat, polyline[0].lon, polyline[1].lat, polyline[1].lon);
}

function headingEndOf(polyline: { lat: number; lon: number }[]): number {
  return headingOf(polyline);
}

function classifyGap(
  distanceKm: number,
  headingSim: number,
  threshold: number,
): MergeDecision {
  if (distanceKm < 0.5 && headingSim > HEADING_SIMILARITY_MIN) return "merge";
  if (distanceKm <= 2) return "merge-gap";
  if (distanceKm < threshold) return "link";
  return "split";
}

function loadCorridorWaypoints(): Map<string, CorridorWaypoints> {
  const map = new Map<string, CorridorWaypoints>();
  const dir = CORRIDOR_FILES_DIR;
  if (!existsSync(dir)) return map;

  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
    const corridorName: string | undefined = data.highway;
    if (!corridorName) continue;
    const roadCodes = CORRIDOR_TO_ROADCODE[corridorName];
    if (!roadCodes || roadCodes.length === 0) continue;

    const waypoints: Waypoint[] = data.nodes.map((n: any, i: number) => ({
      lat: n.lat,
      lon: n.lon,
      name: n.name,
      index: i,
    }));

    for (const rc of roadCodes) {
      if (!map.has(rc)) {
        map.set(rc, { waypoints: [], fromPlace: "", toPlace: "" });
      }
      map.get(rc)!.waypoints = waypoints;
    }
  }
  return map;
}

function loadDORWaypoints(
  roadCode: string,
  dorData: any[],
  densifiedData: any[],
): CorridorWaypoints | null {
  const densified = densifiedData.find((r: any) => r.roadCode === roadCode);
  if (densified && densified.waypoints && densified.waypoints.length >= 2) {
    return {
      waypoints: densified.waypoints.map((w: any, i: number) => ({ ...w, index: i })),
      fromPlace: densified.fromPlace || "",
      toPlace: densified.toPlace || "",
    };
  }

  const dor = dorData.find((r: any) => r.roadCode === roadCode);
  if (dor && dor.waypoints && dor.waypoints.length >= 2) {
    return {
      waypoints: dor.waypoints.map((w: any, i: number) => ({ ...w, index: i })),
      fromPlace: dor.fromPlace || "",
      toPlace: dor.toPlace || "",
    };
  }

  return null;
}

function projectToWaypoint(centroid: Waypoint, waypoints: Waypoint[]): number {
  let bestDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const d = haversineKmBetween(centroid, waypoints[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function placeNameForWaypoint(
  waypoints: Waypoint[],
  index: number,
  roadCode: string,
): string {
  if (waypoints[index]?.name) return waypoints[index].name!;

  const wp = waypoints[index];
  if (wp) return `${roadCode}-wp${index}`;
  return "unknown";
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  const CORRIDORS_FILE = "scripts/data/stitched-corridors.json";
  const DOR_FILE = "scripts/data/dor-road-network.json";
  const DOR_DENSIFIED_FILE = "scripts/data/dor-road-network.densified.json";
  const OUTPUT_FILE = "scripts/data/route-chains.json";

  if (!existsSync(CORRIDORS_FILE)) {
    console.error("Missing input:", CORRIDORS_FILE);
    console.error("Run Stage 3.7 first: npm run build:topology");
    process.exit(1);
  }

  const stitchedCorridors = loadJSON<{
    corridors: { roadCode: string; roadName: string; segments: Segment[] }[];
  }>(CORRIDORS_FILE);
  const dorData = loadJSON<any[]>(DOR_FILE);
  const densifiedData = loadJSON<any[]>(DOR_DENSIFIED_FILE);

  const corridorWaypoints = loadCorridorWaypoints();
  const dorWaypointsMap = new Map<string, CorridorWaypoints>();
  for (const road of dorData) {
    const cw = loadDORWaypoints(road.roadCode, dorData, densifiedData);
    if (cw) dorWaypointsMap.set(road.roadCode, cw);
  }

  const roads: Record<string, RoadData> = {};

  for (const corridor of stitchedCorridors.corridors) {
    const roadCode = corridor.roadCode;
    const segments = corridor.segments;
    if (!segments || segments.length === 0) continue;

    // 1. Select waypoints
    let source: CorridorWaypoints | null = null;
    let sourceName = "";
    const cw = corridorWaypoints.get(roadCode);
    if (cw && cw.waypoints.length >= 2) {
      source = cw;
      sourceName = "corridorFile";
    } else {
      const dw = dorWaypointsMap.get(roadCode);
      if (dw && dw.waypoints.length >= 2) {
        source = dw;
        sourceName = "DOR";
      }
    }

    // 2. Project centroids
    interface AnnotatedSegment extends Segment {
      centroid: Waypoint;
      centroidIndex: number;
      heading: number;
      headingStart: number;
      headingEnd: number;
    }

    const annotated: AnnotatedSegment[] = segments.map((seg) => {
      const centroid = centroidOf(seg);
      const hStart = headingStartOf(seg.polyline);
      const hEnd = headingEndOf(seg.polyline);

      let centroidIndex: number;
      if (source) {
        centroidIndex = projectToWaypoint(centroid, source.waypoints);
      } else {
        // Geographic fallback: order by longitude for east-west, latitude otherwise
        centroidIndex = centroid.lon * 1000;
      }

      return {
        ...seg,
        centroid,
        centroidIndex,
        heading: (hStart + hEnd) / 2,
        headingStart: hStart,
        headingEnd: hEnd,
      };
    });

    // 3. Sort by centroidIndex
    annotated.sort((a, b) => a.centroidIndex - b.centroidIndex);

    // 4. Walk and build chains
    const chains: RouteChain[] = [];
    const links: ChainLink[] = [];
    const warnings: string[] = [];
    const threshold = LARGE_GAP_THRESHOLD[roadCode] ?? 5;

    if (annotated.length === 0) {
      roads[roadCode] = {
        chains: [],
        links: [],
        statistics: {
          totalChains: 0,
          totalLinks: 0,
          totalLengthKm: 0,
          largestGapKm: 0,
          splitWarnings: 0,
        },
        warnings: [],
      };
      continue;
    }

    // Build chains
    let currentSegments: AnnotatedSegment[] = [annotated[0]];
    let currentGaps: ChainGap[] = [];

    function finishChain(): RouteChain {
      const segs = currentSegments;
      const first = segs[0];
      const last = segs[segs.length - 1];
      const ids = segs.map((s) => s.id);

      const startPlace =
        first.fromPlace !== "unknown"
          ? first.fromPlace
          : source
            ? placeNameForWaypoint(source.waypoints, first.centroidIndex, roadCode)
            : roadCode + "_start";
      const endPlace =
        last.toPlace !== "unknown"
          ? last.toPlace
          : source
            ? placeNameForWaypoint(source.waypoints, last.centroidIndex, roadCode)
            : roadCode + "_end";

      const totalLen = segs.reduce((s, seg) => s + seg.lengthKm, 0);
      const avgConf =
        segs.reduce((s, seg) => s + seg.meanConfidence, 0) / segs.length;

      return {
        id: "",
        roadCode,
        segmentIds: ids,
        startPlace,
        endPlace,
        startLat: first.polyline[0].lat,
        startLon: first.polyline[0].lon,
        endLat: last.polyline[last.polyline.length - 1].lat,
        endLon: last.polyline[last.polyline.length - 1].lon,
        lengthKm: totalLen,
        meanConfidence: avgConf,
        segmentCount: segs.length,
        gaps: currentGaps,
      };
    }

    for (let i = 1; i < annotated.length; i++) {
      const prev = annotated[i - 1];
      const curr = annotated[i];

      const gapDist = haversineKmBetween(prev.centroid, curr.centroid);
      const headingSim = headingSimilarityDeg(prev.headingEnd, curr.headingStart);
      const decision = classifyGap(gapDist, headingSim, threshold);

      if (decision === "split") {
        chains.push(finishChain());
        links.push({
          fromChainId: "",
          toChainId: "",
          distanceKm: gapDist,
          decision: "split",
          headingSimilarity: headingSim,
        });
        warnings.push(
          `Large gap ${gapDist.toFixed(1)}km between ${prev.id} and ${curr.id} (centroidIndex ${prev.centroidIndex} → ${curr.centroidIndex})`,
        );
        currentSegments = [curr];
        currentGaps = [];
      } else if (decision === "link") {
        chains.push(finishChain());
        links.push({
          fromChainId: "",
          toChainId: "",
          distanceKm: gapDist,
          decision: "link",
          headingSimilarity: headingSim,
        });
        currentSegments = [curr];
        currentGaps = [];
      } else if (decision === "merge-gap") {
        currentGaps.push({
          fromSegmentId: prev.id,
          toSegmentId: curr.id,
          distanceKm: gapDist,
          decision: "merge-gap",
        });
        currentSegments.push(curr);
      } else {
        // merge — no record needed
        currentSegments.push(curr);
      }
    }

    chains.push(finishChain());

    // Assign chain IDs and update link references
    for (let j = 0; j < chains.length; j++) {
      chains[j].id = `${roadCode}_chain_${j}`;
    }
    for (const link of links) {
      // Link j connects chain j and chain j+1
      const idx = links.indexOf(link);
      link.fromChainId = chains[idx]?.id ?? "";
      link.toChainId = chains[idx + 1]?.id ?? "";
    }

    // Compute statistics
    const totalLengthKm = chains.reduce((s, c) => s + c.lengthKm, 0);
    let largestGapKm = 0;
    for (const link of links) {
      if (link.distanceKm > largestGapKm) largestGapKm = link.distanceKm;
    }
    for (const chain of chains) {
      for (const gap of chain.gaps) {
        if (gap.distanceKm > largestGapKm) largestGapKm = gap.distanceKm;
      }
    }
    const splitWarnings = warnings.length;

    roads[roadCode] = {
      chains,
      links,
      statistics: {
        totalChains: chains.length,
        totalLinks: links.length,
        totalLengthKm,
        largestGapKm,
        splitWarnings,
      },
      warnings,
    };
  }

  const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: "build-route-chains.ts",
    roads,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written ${OUTPUT_FILE}`);
  console.log(`Roads: ${Object.keys(roads).length}`);

  // Summary
  const totals = Object.entries(roads).map(([rc, rd]) => ({
    roadCode: rc,
    chains: rd.statistics.totalChains,
    links: rd.statistics.totalLinks,
    km: rd.statistics.totalLengthKm.toFixed(1),
    largestGap: rd.statistics.largestGapKm.toFixed(1),
    splits: rd.statistics.splitWarnings,
  }));
  console.table(totals);
}

main();
