import { haversineKm } from "@/lib/routing/geo";
import type { RouteNode } from "@/lib/routing/types";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

async function fetchOverpass(query: string, timeoutMs = 60000): Promise<Response | null> {
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": "YatraAI/1.0",
        },
        body: query,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
    } catch {
      continue;
    }
  }
  return null;
}

function corridorBbox(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  paddingKm = 10
): { south: number; west: number; north: number; east: number } {
  const kmPerDegLat = 111;
  const avgLat = (originLat + destLat) / 2;
  const kmPerDegLon = 111 * Math.cos((avgLat * Math.PI) / 180);
  const padLat = paddingKm / kmPerDegLat;
  const padLon = paddingKm / kmPerDegLon;
  return {
    south: Math.min(originLat, destLat) - padLat,
    west: Math.min(originLon, destLon) - padLon,
    north: Math.max(originLat, destLat) + padLat,
    east: Math.max(originLon, destLon) + padLon,
  };
}

function bboxStr(b: { south: number; west: number; north: number; east: number }): string {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: (OverpassNode | OverpassWay)[];
}

function distanceToLineKm(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const dAB = haversineKm(aLat, aLon, bLat, bLon);
  if (dAB < 0.01) return haversineKm(pLat, pLon, aLat, aLon);
  const dAP = haversineKm(aLat, aLon, pLat, pLon);
  const dBP = haversineKm(bLat, bLon, pLat, pLon);
  const cosA =
    (dAP * dAP + dAB * dAB - dBP * dBP) /
    (2 * Math.max(dAP, 0.001) * Math.max(dAB, 0.001));
  const t = Math.max(0, Math.min(1, cosA));
  const projDist = t * dAB;
  return Math.sqrt(Math.max(0, dAP * dAP - projDist * projDist));
}

export async function fetchOsmRoadNodesBetween(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  maxNodes = 8
): Promise<RouteNode[]> {
  const bbox = corridorBbox(originLat, originLon, destLat, destLon);
  const bb = bboxStr(bbox);
  const totalKm = haversineKm(originLat, originLon, destLat, destLon);

  const query = `[out:json][timeout:25];
(
  way["highway"~"^(primary|secondary|tertiary|trunk)$"](${bb});
  node(w);
);
out skel ${maxNodes * 20};`;

  try {
    const res = await fetchOverpass(query, 25000);
    if (!res) return [];

    const data = (await res.json()) as OverpassResponse;
    const elements = data.elements || [];

    const wayNodeIds = new Set<number>();
    const nodeMap = new Map<number, OverpassNode>();

    for (const el of elements) {
      if (el.type === "way") {
        for (const nid of el.nodes) wayNodeIds.add(nid);
      } else if (el.type === "node" && wayNodeIds.has(el.id)) {
        nodeMap.set(el.id, el);
      }
    }

    const candidates: {
      node: OverpassNode;
      distanceToLine: number;
      progress: number;
    }[] = [];

    for (const node of nodeMap.values()) {
      const progress =
        haversineKm(originLat, originLon, node.lat, node.lon) /
        Math.max(totalKm, 1);
      if (progress <= 0.05 || progress >= 0.95) continue;

      const dToLine = distanceToLineKm(
        node.lat,
        node.lon,
        originLat,
        originLon,
        destLat,
        destLon
      );
      if (dToLine > 15) continue;

      candidates.push({ node, distanceToLine: dToLine, progress });
    }

    candidates.sort((a, b) => a.progress - b.progress);

    const selected: RouteNode[] = [];
    const minSpacing = Math.max(15, totalKm * 0.08);
    let lastProgress = 0;

    for (const c of candidates) {
      if (selected.length >= maxNodes) break;
      const spacing = (c.progress - lastProgress) * totalKm;
      if (selected.length > 0 && spacing < minSpacing) continue;
      if (c.distanceToLine > 8) continue;

      const name =
        c.node.tags?.name ||
        `Junction ${c.node.lat.toFixed(3)},${c.node.lon.toFixed(3)}`;

      selected.push({
        lat: c.node.lat,
        lon: c.node.lon,
        name,
        locationId: null,
        routeNodeId: `osm/${c.node.id}`,
      });
      lastProgress = c.progress;
    }

    return selected;
  } catch {
    return [];
  }
}

export interface OsmRoadSurface {
  highway: string;
  surface?: string;
  smoothness?: string;
  width?: string;
  centerLat: number;
  centerLon: number;
}

export async function fetchOsmRoadSurface(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): Promise<OsmRoadSurface[]> {
  const bbox = corridorBbox(originLat, originLon, destLat, destLon);
  const bb = bboxStr(bbox);
  const query = `[out:json][timeout:60];
(
  way["highway"](${bb});
);
out center tags 2000;`;
  try {
    const res = await fetchOverpass(query);
    if (!res) return [];
    const data = (await res.json()) as OverpassResponse;
    const results: OsmRoadSurface[] = [];
    for (const el of data.elements) {
      if (el.type === "way" && el.tags?.highway) {
        results.push({
          highway: el.tags.highway,
          surface: el.tags.surface,
          smoothness: el.tags.smoothness,
          width: el.tags.width,
          centerLat: (el as any).center?.lat ?? 0,
          centerLon: (el as any).center?.lon ?? 0,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export interface OsmRiverWay {
  centerLat: number;
  centerLon: number;
}

export async function fetchOsmRivers(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): Promise<OsmRiverWay[]> {
  const bbox = corridorBbox(originLat, originLon, destLat, destLon);
  const bb = bboxStr(bbox);
  const query = `[out:json][timeout:60];
(
  way["waterway"="river"](${bb});
  way["waterway"="stream"](${bb});
);
out center 1000;`;
  try {
    const res = await fetchOverpass(query);
    if (!res) return [];
    const data = (await res.json()) as OverpassResponse;
    return data.elements
      .filter((el): el is OverpassWay & { center: { lat: number; lon: number } } =>
        el.type === "way" && !!(el as any).center
      )
      .map((el) => ({
        centerLat: (el as any).center.lat,
        centerLon: (el as any).center.lon,
      }));
  } catch {
    return [];
  }
}
