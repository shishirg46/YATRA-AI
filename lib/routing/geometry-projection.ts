import { haversineKm } from "@/lib/routing/geo";
import { buildPlaceSequence } from "@/lib/routing/place-sequence";
import { findRoute } from "@/lib/routing/road-sequence";
import type { RouteCoordinate, GeoPoint, RouteNode, CorridorLabel } from "@/lib/routing/types";

/**
 * Pure display layer — labels a coordinate polyline with road + place names.
 *
 * Routing truth is from the segment graph (findRoute). Places are enriched
 * via buildPlaceSequence. This function ONLY:
 *   - coordinates mapping
 *   - polyline alignment
 *   - place injection
 *   - visualization enrichment
 *
 * It must NEVER:
 *   - call graph directly
 *   - infer road identity
 *   - modify routing logic
 */
export async function labelPolylineSegments(
  coordinates: RouteCoordinate[],
  origin: GeoPoint,
  destination: GeoPoint,
): Promise<{ chain: RouteNode[]; source: string; corridorLabels?: CorridorLabel[] }> {
  if (coordinates.length < 2) {
    return { chain: [], source: "no-geometry" };
  }

  const totalKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);

  // Graph-first routing (replaces legacy buildRoadSequence)
  const [places, roads] = await Promise.all([
    buildPlaceSequence(coordinates, {
      radiusMeters: totalKm > 200 ? 5000 : 3000,
      minGapKm: totalKm > 200 ? 5 : 2,
      sampleEvery: totalKm > 200 ? 10 : 5,
      maxPlaces: 50,
    }),
    findRoute(coordinates, origin, destination),
  ]);

  interface MergedItem {
    node: RouteNode;
    polylineIdx: number;
  }

  const merged: MergedItem[] = [];

  for (const p of places) {
    merged.push({
      node: {
        lat: p.place.lat,
        lon: p.place.lon,
        name: p.place.nameEn ?? p.place.name,
        locationId: p.place.id,
      },
      polylineIdx: p.polylineIndex,
    });
  }

  for (let i = 1; i < roads.length; i++) {
    const prev = roads[i - 1];
    const curr = roads[i];
    if (prev.roadCode !== curr.roadCode) {
      const coord = coordinates[curr.polylineStartIdx];
      if (coord) {
        const junction = prev.toJunction ?? curr.fromJunction;
        merged.push({
          node: {
            lat: coord.lat,
            lon: coord.lon,
            name: curr.roadName,
            roadCode: curr.roadCode ?? undefined,
            junction,
          },
          polylineIdx: curr.polylineStartIdx,
        });
      }
    }
  }

  if (roads.length > 0) {
    const first = roads[0];
    const coord = coordinates[first.polylineStartIdx];
    if (coord) {
      const nearOrigin = haversineKm(coord.lat, coord.lon, origin.lat, origin.lon) < 1;
      if (!nearOrigin) {
        merged.push({
          node: {
            lat: coord.lat,
            lon: coord.lon,
            name: first.roadName,
            roadCode: first.roadCode ?? undefined,
            junction: first.fromJunction,
          },
          polylineIdx: first.polylineStartIdx,
        });
      }
    }
  }

  merged.sort((a, b) => a.polylineIdx - b.polylineIdx);

  const chain: RouteNode[] = [];

  if (origin.name) {
    chain.push({ lat: origin.lat, lon: origin.lon, name: origin.name });
  }

  for (const item of merged) {
    const last = chain[chain.length - 1];
    if (last) {
      const gapKm = haversineKm(last.lat, last.lon, item.node.lat, item.node.lon);
      if (gapKm < 1) continue;
    }
    chain.push(item.node);
  }

  if (destination.name) {
    const last = chain[chain.length - 1];
    const gapKm = last ? haversineKm(last.lat, last.lon, destination.lat, destination.lon) : Infinity;
    if (gapKm >= 0.5) {
      chain.push({ lat: destination.lat, lon: destination.lon, name: destination.name });
    }
  }

  let corridorLabels: CorridorLabel[] | undefined;
  if (chain.length <= 2 && totalKm > 300 && roads.length > 0) {
    corridorLabels = roads.map((r) => ({
      displayName: r.roadName,
      startIdx: r.polylineStartIdx,
      endIdx: r.polylineEndIdx,
    }));
  }

  if (chain.length < 2) {
    const originNode: RouteNode = { lat: origin.lat, lon: origin.lon, name: origin.name ?? "Origin" };
    const destNode: RouteNode = { lat: destination.lat, lon: destination.lon, name: destination.name ?? "Destination" };

    if (chain.length === 0) {
      chain.push(originNode, destNode);
    } else {
      chain.push(destNode);
    }
  }

  return {
    chain,
    source: "polyline-projection",
    corridorLabels,
  };
}
