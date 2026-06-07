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

/**
 * Build a haversine-distance SELECT expression that works without PostGIS.
 * 6371 = Earth radius in km.
 */
const HAVERSINE_SQL = (latCol: string, lonCol: string, latParam: string, lonParam: string) =>
  `6371 * 2 * ASIN(SQRT(
    POWER(SIN(((${latParam}) - ${latCol}) * PI() / 360), 2) +
    COS((${latParam}) * PI() / 180) * COS(${latCol} * PI() / 180) *
    POWER(SIN(((${lonParam}) - ${lonCol}) * PI() / 360), 2)
  )) AS "distanceKm"`;

function haversineWhere(
  latCol: string,
  lonCol: string,
  latParam: string,
  lonParam: string,
  maxKm: number
): string {
  // Approximate degree filter (1° ≈ 111km) for index-friendly pre-filter
  const deg = maxKm / 111;
  return `${latCol} BETWEEN ${latParam} - ${deg} AND ${latParam} + ${deg}
    AND ${lonCol} BETWEEN ${lonParam} - ${deg} AND ${lonParam} + ${deg}
    AND ${latCol} IS NOT NULL AND ${lonCol} IS NOT NULL`;
}

export async function findNearestLocation(
  lat: number,
  lon: number,
  maxKm = 50
): Promise<SpatialResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = await prisma.$queryRawUnsafe<SpatialResult[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon,
            ${HAVERSINE_SQL("latitude", "longitude", String(lat), String(lon))}
     FROM "Location"
     WHERE ${haversineWhere("latitude", "longitude", String(lat), String(lon), maxKm)}
     ORDER BY "distanceKm"
     LIMIT 1`
  );
  return rows[0] ?? null;
}

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
            ${HAVERSINE_SQL("latitude", "longitude", String(lat), String(lon))}
     FROM "Location"
     WHERE ${haversineWhere("latitude", "longitude", String(lat), String(lon), maxKm)}
     ORDER BY "distanceKm"
     LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function findNearestRouteNode(
  lat: number,
  lon: number,
  maxKm = 35
): Promise<(SpatialNodeResult & { distanceKm: number }) | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = await prisma.$queryRawUnsafe<(SpatialNodeResult & { distanceKm: number })[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon, "isHub",
            ${HAVERSINE_SQL("latitude", "longitude", String(lat), String(lon))}
     FROM "route_node"
     WHERE "isActive" = true
       AND ${haversineWhere("latitude", "longitude", String(lat), String(lon), maxKm)}
     ORDER BY "distanceKm"
     LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function findNearestPlace(
  lat: number,
  lon: number,
  maxKm = 50
): Promise<SpatialResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = await prisma.$queryRawUnsafe<SpatialResult[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon,
            ${HAVERSINE_SQL("latitude", "longitude", String(lat), String(lon))}
     FROM "place"
     WHERE ${haversineWhere("latitude", "longitude", String(lat), String(lon), maxKm)}
     ORDER BY "distanceKm"
     LIMIT 1`
  );
  return rows[0] ?? null;
}

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
            ${HAVERSINE_SQL("latitude", "longitude", String(lat), String(lon))}
     FROM "destination"
     WHERE ${haversineWhere("latitude", "longitude", String(lat), String(lon), maxKm)}
     ORDER BY "distanceKm"
     LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function findLocationsWithinRadius(
  lat: number,
  lon: number,
  radiusKm: number,
  limit = 50
): Promise<SpatialResult[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return prisma.$queryRawUnsafe<SpatialResult[]>(
    `SELECT id, name, latitude AS lat, longitude AS lon,
            ${HAVERSINE_SQL("latitude", "longitude", String(lat), String(lon))}
     FROM "Location"
     WHERE ${haversineWhere("latitude", "longitude", String(lat), String(lon), radiusKm)}
     ORDER BY "distanceKm"
     LIMIT ${limit}`
  );
}

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
     WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       AND latitude BETWEEN $1 AND $2
       AND longitude BETWEEN $3 AND $4
     LIMIT $5`,
    minLat, maxLat, minLon, maxLon, limit
  );
}

export async function findNearestLocationsBatch(
  points: Array<{ lat: number; lon: number }>,
  maxKm = 50
): Promise<Map<string, SpatialResult>> {
  if (points.length === 0) return new Map();

  const results = await Promise.all(
    points.map((p) => findNearestLocation(p.lat, p.lon, maxKm))
  );

  const map = new Map<string, SpatialResult>();
  for (let i = 0; i < points.length; i++) {
    const r = results[i];
    if (r) {
      map.set(points[i].lat + "," + points[i].lon, r);
    }
  }
  return map;
}

export { haversineKm } from "@/lib/routing/geo";
