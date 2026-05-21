import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";

type SpatialResult = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
};

type SpatialNodeResult = SpatialResult & { isHub: boolean };

function geogPoint(lon: number, lat: number): string {
  return `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;
}

/**
 * Find nearest Location using PostGIS GiST index + <-> KNN operator.
 * O(log n) instead of O(n) haversine loop.
 */
export async function findNearestLocation(
  lat: number,
  lon: number,
  maxKm = 50
): Promise<SpatialResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = await prisma.$queryRawUnsafe<SpatialResult[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon,
            ST_Distance(geom, ${geogPoint(lon, lat)}) / 1000 AS "distanceKm"
     FROM "Location"
     WHERE geom IS NOT NULL
       AND ST_DWithin(geom, ${geogPoint(lon, lat)}, $1)
     ORDER BY geom <-> ${geogPoint(lon, lat)}
     LIMIT 1`,
    maxKm * 1000
  );
  return rows[0] ?? null;
}

/**
 * Find nearest Location with full row returned.
 */
export async function findNearestLocationRow<T extends Record<string, unknown>>(
  lat: number,
  lon: number,
  maxKm = 50,
  select?: string
): Promise<(T & { distanceKm: number }) | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cols = select ?? "*";
  const rows = await prisma.$queryRawUnsafe<(T & { distanceKm: number })[]>(
    `SELECT ${cols},
            ST_Distance(geom, ${geogPoint(lon, lat)}) / 1000 AS "distanceKm"
     FROM "Location"
     WHERE geom IS NOT NULL
       AND ST_DWithin(geom, ${geogPoint(lon, lat)}, $1)
     ORDER BY geom <-> ${geogPoint(lon, lat)}
     LIMIT 1`,
    maxKm * 1000
  );
  return rows[0] ?? null;
}

/**
 * Find nearest RouteNode using PostGIS GiST index.
 */
export async function findNearestRouteNode(
  lat: number,
  lon: number,
  maxKm = 35
): Promise<(SpatialNodeResult & { distanceKm: number }) | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = await prisma.$queryRawUnsafe<(SpatialNodeResult & { distanceKm: number })[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon, "isHub",
            ST_Distance(geom, ${geogPoint(lon, lat)}) / 1000 AS "distanceKm"
     FROM "route_node"
     WHERE "isActive" = true
       AND geom IS NOT NULL
       AND ST_DWithin(geom, ${geogPoint(lon, lat)}, $1)
     ORDER BY geom <-> ${geogPoint(lon, lat)}
     LIMIT 1`,
    maxKm * 1000
  );
  return rows[0] ?? null;
}

/**
 * Find nearest Place using PostGIS GiST index.
 */
export async function findNearestPlace(
  lat: number,
  lon: number,
  maxKm = 50
): Promise<SpatialResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = await prisma.$queryRawUnsafe<SpatialResult[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon,
            ST_Distance(geom, ${geogPoint(lon, lat)}) / 1000 AS "distanceKm"
     FROM "place"
     WHERE geom IS NOT NULL
       AND ST_DWithin(geom, ${geogPoint(lon, lat)}, $1)
     ORDER BY geom <-> ${geogPoint(lon, lat)}
     LIMIT 1`,
    maxKm * 1000
  );
  return rows[0] ?? null;
}

/**
 * Find nearest Destination using PostGIS GiST index.
 */
export async function findNearestDestination(
  lat: number,
  lon: number,
  maxKm = 50
): Promise<(SpatialResult & { district: string; province: string }) | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = await prisma.$queryRawUnsafe<
    (SpatialResult & { district: string; province: string })[]
  >(
    `SELECT id, name, latitude AS lat, longitude AS lon, district, province,
            ST_Distance(geom, ${geogPoint(lon, lat)}) / 1000 AS "distanceKm"
     FROM "destination"
     WHERE geom IS NOT NULL
       AND ST_DWithin(geom, ${geogPoint(lon, lat)}, $1)
     ORDER BY geom <-> ${geogPoint(lon, lat)}
     LIMIT 1`,
    maxKm * 1000
  );
  return rows[0] ?? null;
}

/**
 * Find all Locations within a radius.
 */
export async function findLocationsWithinRadius(
  lat: number,
  lon: number,
  radiusKm: number,
  limit = 50
): Promise<SpatialResult[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return prisma.$queryRawUnsafe<SpatialResult[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon,
            ST_Distance(geom, ${geogPoint(lon, lat)}) / 1000 AS "distanceKm"
     FROM "Location"
     WHERE geom IS NOT NULL
       AND ST_DWithin(geom, ${geogPoint(lon, lat)}, $1)
     ORDER BY geom <-> ${geogPoint(lon, lat)}
     LIMIT $2`,
    radiusKm * 1000,
    limit
  );
}

/**
 * Find all Places along a route corridor (bounding box + buffer).
 */
export async function findPlacesInCorridor(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  limit = 100
): Promise<SpatialResult[]> {
  return prisma.$queryRawUnsafe<SpatialResult[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon, 0 AS "distanceKm"
     FROM "place"
     WHERE geom IS NOT NULL
       AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
     LIMIT $5`,
    minLon, minLat, maxLon, maxLat, limit
  );
}

/**
 * Batch nearest-neighbor for multiple points — single SQL pass.
 */
export async function findNearestLocationsBatch(
  points: Array<{ lat: number; lon: number }>,
  maxKm = 50
): Promise<Map<string, SpatialResult>> {
  if (points.length === 0) return new Map();

  const unions = points
    .map((p, i) => `SELECT ${i} AS idx, ${geogPoint(p.lon, p.lat)} AS pt`)
    .join("\nUNION ALL\n");

  const rows = await prisma.$queryRawUnsafe<
    Array<{ idx: number; id: string; name: string; lat: number; lon: number; distanceKm: number }>
  >(
    `WITH input AS (${unions}),
      nearest AS (
        SELECT DISTINCT ON (i.idx) i.idx, l.id, l.name, l.latitude AS lat, l.longitude AS lon,
               ST_Distance(l.geom, i.pt) / 1000 AS "distanceKm"
        FROM input i
        CROSS JOIN LATERAL (
          SELECT id, name, latitude, longitude, geom
          FROM "Location"
          WHERE geom IS NOT NULL
            AND ST_DWithin(geom, i.pt, $1)
          ORDER BY geom <-> i.pt
          LIMIT 1
        ) l
      )
      SELECT * FROM nearest ORDER BY idx`,
    maxKm * 1000
  );

  const map = new Map<string, SpatialResult>();
  for (const r of rows) {
    map.set(points[r.idx].lat + "," + points[r.idx].lon, {
      id: r.id,
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      distanceKm: r.distanceKm,
    });
  }
  return map;
}

/**
 * Keep haversine as fallback when geom columns are not populated.
 */
export { haversineKm } from "@/lib/routing/geo";
