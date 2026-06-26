import { prisma } from "@/lib/prisma";
import { computeEdgeWeight, type RoutingConfig } from "@/lib/routing/routing-config";
import { latLngToCell } from "h3-js";
import type { AdjNode, AdjacencyMap } from "@/lib/routing/adjacency";

const H3_RESOLUTION = 8;
const SEASON_MONSOON = "monsoon";
const SEASON_DRY = "dry";

// Hazard model version — bump this when hazard scoring logic changes
// to invalidate stale in-flight cache loads
const HAZARD_MODEL_VERSION = "v1";

let hazardCachePromise: Promise<ReadonlyMap<string, HazardData>> | null = null;
let hazardCache: { map: ReadonlyMap<string, HazardData>; expiresAt: number; version: string } | null = null;

export type HazardData = {
  landslideRisk: number;
  floodRisk: number;
  monsoonVulnerability: number;
};

export type ScoredEdge = {
  cost: number;
  distanceKm: number;
  gradientPct: number;
  safetyScore: number;
  landslideRisk: number;
  floodRisk: number;
};

export type CacheEntry = {
  fromNodeId: string;
  toNodeId: string;
  distanceKm: number;
  gradientPct: number;
  compositeCost: number;
  graphVersion: string;
  season: string;
};

function currentSeason(): string {
  const month = new Date().getMonth() + 1;
  return month >= 6 && month <= 9 ? SEASON_MONSOON : SEASON_DRY;
}

function roadClassPenalty(roadClass: string): number {
  switch (roadClass) {
    case "motorway": return 0;
    case "trunk": return 0.1;
    case "primary": return 0.2;
    case "secondary": return 0.4;
    case "tertiary": return 0.6;
    default: return 0.5;
  }
}

function getH3ForEdge(from: AdjNode, to: AdjNode): string {
  const midLat = (from.lat + to.lat) / 2;
  const midLon = (from.lon + to.lon) / 2;
  return latLngToCell(midLat, midLon, H3_RESOLUTION);
}

export function roadConditionFromClass(roadClass: string): string {
  switch (roadClass) {
    case "motorway":
    case "trunk": return "GOOD";
    case "primary": return "FAIR";
    case "secondary": return "POOR";
    case "tertiary": return "DIRT_TRACK";
    default: return "FAIR";
  }
}

/**
 * Score an edge with optional preloaded hazard data.
 *
 * When `hazardMap` is provided, no DB queries are made for hazard data.
 * Returns both the scored edge and a cache entry for batch upsert.
 */
export function scoreEdge(
  from: AdjNode,
  to: AdjNode,
  adjacency: AdjacencyMap,
  distToDestCurrentKm: number,
  distToDestNextKm: number,
  hazardMap?: ReadonlyMap<string, HazardData>,
  coefficients?: { alpha?: number; beta?: number; gamma?: number; delta?: number; epsilon?: number },
  costOverrides?: ReadonlyMap<string, number>,
): { scored: ScoredEdge; cacheEntry: CacheEntry } {
  // Check cost overrides first (preloaded EdgeCache)
  const overrideKey = `${from.id}:${to.id}`;
  const overrideCost = costOverrides?.get(overrideKey);
  if (overrideCost !== undefined) {
    const distanceKm = adjacency.adjacency.get(from.id)?.find(e => e.to === to.id)?.distanceKm ?? 0;
    return {
      scored: { cost: overrideCost, distanceKm, gradientPct: 0, safetyScore: 0.5, landslideRisk: 0, floodRisk: 0 },
      cacheEntry: {
        fromNodeId: from.id, toNodeId: to.id, distanceKm, gradientPct: 0,
        compositeCost: overrideCost, graphVersion: adjacency.graphVersion, season: currentSeason(),
      },
    };
  }

  const season = currentSeason();
  const isMonsoon = season === SEASON_MONSOON;
  const distanceKm = adjacency.adjacency.get(from.id)?.find(e => e.to === to.id)?.distanceKm ?? 0;
  if (distanceKm < 0.001) {
    return {
      scored: { cost: 0, distanceKm: 0, gradientPct: 0, safetyScore: 1, landslideRisk: 0, floodRisk: 0 },
      cacheEntry: {
        fromNodeId: from.id, toNodeId: to.id, distanceKm: 0, gradientPct: 0,
        compositeCost: 0, graphVersion: adjacency.graphVersion, season,
      },
    };
  }

  const elevationDiff = Math.abs((from.elevationM ?? 0) - (to.elevationM ?? 0));
  const gradientPct = distanceKm > 0 ? (elevationDiff / 1000) / distanceKm * 100 : 0;

  let landslideRisk = 0.1;
  let floodRisk = 0.1;
  let monsoonVulnerability = 0.1;

  if (hazardMap) {
    const h3Index = getH3ForEdge(from, to);
    const hazard = hazardMap.get(h3Index);
    if (hazard) {
      landslideRisk = hazard.landslideRisk;
      floodRisk = hazard.floodRisk;
      monsoonVulnerability = hazard.monsoonVulnerability;
    }
  }

  const reliabilityScore = 1 - roadClassPenalty(from.roadClass);
  const roadCondition = roadConditionFromClass(from.roadClass);

  const cost = computeEdgeWeight({
    distanceKm,
    reliabilityScore,
    landslideRisk,
    floodRisk,
    monsoonVulnerability,
    roadCondition,
    distToDestCurrentKm,
    distToDestNextKm,
    isMonsoon,
    coefficients: coefficients as Partial<RoutingConfig>,
  });

  return {
    scored: {
      cost,
      distanceKm,
      gradientPct,
      safetyScore: landslideRisk * 0.4 + floodRisk * 0.3 + monsoonVulnerability * 0.3,
      landslideRisk,
      floodRisk,
    },
    cacheEntry: {
      fromNodeId: from.id,
      toNodeId: to.id,
      distanceKm,
      gradientPct,
      compositeCost: cost,
      graphVersion: adjacency.graphVersion,
      season,
    },
  };
}

/**
 * Preload hazard hex data as a promise-locked singleton.
 *
 * Safety guarantees:
 *  - Concurrent callers share one in-flight DB query (no duplicate loads)
 *  - If `HAZARD_MODEL_VERSION` changes during load, stale result is discarded
 *  - Returned map is frozen — no mutations by consumers
 *  - 10-minute TTL; expiresAt check avoids stale data in long-running processes
 */
export function preloadHazardData(): Promise<ReadonlyMap<string, HazardData>> {
  if (hazardCache && hazardCache.expiresAt > Date.now() && hazardCache.version === HAZARD_MODEL_VERSION) {
    return Promise.resolve(hazardCache.map);
  }

  if (hazardCachePromise) return hazardCachePromise;

  const loadVersion = HAZARD_MODEL_VERSION;

  hazardCachePromise = (async () => {
    const map = new Map<string, HazardData>();
    try {
      const records = await prisma.hazardHex.findMany({
        select: { h3Index: true, landslideRisk: true, floodRisk: true, monsoonVulnerability: true },
      });
      for (const r of records) {
        map.set(r.h3Index, {
          landslideRisk: r.landslideRisk ?? 0.1,
          floodRisk: r.floodRisk ?? 0.1,
          monsoonVulnerability: r.monsoonVulnerability ?? 0.1,
        });
      }
    } catch {
      // HazardHex table may be empty — return empty map
    }

    // Version safety: discard if model version changed during load
    if (loadVersion !== HAZARD_MODEL_VERSION) {
      hazardCachePromise = null;
      return preloadHazardData();
    }

    const frozen = Object.freeze(map) as ReadonlyMap<string, HazardData>;
    hazardCache = { map: frozen, expiresAt: Date.now() + 10 * 60 * 1000, version: loadVersion };
    hazardCachePromise = null;
    return frozen;
  })();

  return hazardCachePromise;
}

/**
 * Batch preload EdgeCache entries for a set of node IDs.
 * Returns a Map<"fromId:toId", compositeCost> for O(1) lookups during A*.
 *
 * The node set should be scoped to the search region (bounding box around
 * origin-destination) to avoid loading the entire country's cache.
 *
 * Falls back to empty map on any error — non-critical.
 */
export async function preloadEdgeCache(
  nodeIds: string[],
  graphVersion: string,
  season?: string,
): Promise<ReadonlyMap<string, number>> {
  if (nodeIds.length === 0) return new Map();
  const s = season ?? currentSeason();
  const map = new Map<string, number>();

  try {
    // Batch into chunks of 5000 to avoid slow IN queries
    const CHUNK = 5000;
    for (let i = 0; i < nodeIds.length; i += CHUNK) {
      const chunk = nodeIds.slice(i, i + CHUNK);
      const records = await prisma.edgeCache.findMany({
        where: {
          fromNodeId: { in: chunk },
          graphVersion,
          season: s,
          ttl: { gt: new Date() },
        },
        select: { fromNodeId: true, toNodeId: true, compositeCost: true },
      });
      for (const r of records) {
        map.set(`${r.fromNodeId}:${r.toNodeId}`, r.compositeCost);
      }
    }
  } catch {
    // Non-critical — cache miss just means fresh compute
  }

  return Object.freeze(map);
}

/**
 * Batch upsert EdgeCache entries after A* completes.
 */
export async function batchUpsertCache(entries: CacheEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const ttl = new Date(Date.now() + 60 * 60 * 1000);
  try {
    await prisma.$transaction(
      entries.map(entry =>
        prisma.edgeCache.upsert({
          where: {
            fromNodeId_toNodeId_graphVersion_season: {
              fromNodeId: entry.fromNodeId,
              toNodeId: entry.toNodeId,
              graphVersion: entry.graphVersion,
              season: entry.season,
            },
          },
          create: { ...entry, ttl },
          update: { distanceKm: entry.distanceKm, gradientPct: entry.gradientPct, compositeCost: entry.compositeCost, ttl },
        }),
      ),
    );
  } catch {
    // Non-critical
  }
}

/**
 * Fast cost estimate without any lookups — for heuristic or cold-start.
 */
export function estimateEdgeCost(
  from: AdjNode,
  to: AdjNode,
  adjacency: AdjacencyMap,
  distToDestCurrentKm: number,
  distToDestNextKm: number,
): number {
  const distanceKm = adjacency.adjacency.get(from.id)?.find(e => e.to === to.id)?.distanceKm ?? 0;
  const roadPenalty = roadClassPenalty(from.roadClass);
  const dirPenalty = distToDestNextKm < distToDestCurrentKm ? 0 : 0.5;
  return distanceKm + roadPenalty * 0.5 + dirPenalty;
}
