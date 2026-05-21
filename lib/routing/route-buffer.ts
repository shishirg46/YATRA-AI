import { prisma } from "@/lib/prisma";
import { haversineKm } from "./geo";
import type { RouteCoordinate, VehicleProfile } from "./types";
import { getBufferRadii } from "./nepal-profiles";

export interface RouteBuffer {
  strict: { radiusMeters: number; wkt: string };
  normal: { radiusMeters: number; wkt: string };
  exploration: { radiusMeters: number; wkt: string };
}

function coordinatesToWktLineString(coords: RouteCoordinate[]): string {
  if (coords.length < 2) return "";
  const points = coords.map((c) => `${c.lon} ${c.lat}`).join(",");
  return `LINESTRING(${points})`;
}

function boundingBoxWkt(coordinates: RouteCoordinate[], radiusMeters: number): string {
  const radiusDeg = radiusMeters / 111_320;
  const minLat = Math.min(...coordinates.map((c) => c.lat)) - radiusDeg;
  const maxLat = Math.max(...coordinates.map((c) => c.lat)) + radiusDeg;
  const minLon = Math.min(...coordinates.map((c) => c.lon)) - radiusDeg;
  const maxLon = Math.max(...coordinates.map((c) => c.lon)) + radiusDeg;
  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`;
}

function isWithinRadius(
  pointLat: number, pointLon: number,
  routeCoords: RouteCoordinate[], radiusMeters: number
): boolean {
  for (const rc of routeCoords) {
    const d = haversineKm(pointLat, pointLon, rc.lat, rc.lon) * 1000;
    if (d <= radiusMeters) return true;
  }
  return false;
}

export async function createRouteBuffer(
  coordinates: RouteCoordinate[],
  vehicle: VehicleProfile = "car"
): Promise<RouteBuffer> {
  const radii = getBufferRadii(vehicle);
  const wktLine = coordinatesToWktLineString(coordinates);

  if (!wktLine || coordinates.length < 2) {
    throw new Error("Insufficient coordinates to create route buffer");
  }

  const buffers: RouteBuffer = {
    strict: { radiusMeters: radii.strict, wkt: "" },
    normal: { radiusMeters: radii.normal, wkt: "" },
    exploration: { radiusMeters: radii.exploration, wkt: "" },
  };

  for (const key of ["strict", "normal", "exploration"] as const) {
    const radius = buffers[key].radiusMeters;
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ wkt: string }>>(
        `SELECT ST_AsText(ST_Buffer(ST_GeomFromText($1, 4326)::geography, $2)) as wkt`,
        wktLine,
        radius
      );
      buffers[key].wkt = result[0]?.wkt ?? "";
    } catch {
      buffers[key].wkt = boundingBoxWkt(coordinates, radius);
    }
  }

  return buffers;
}

export async function findDestinationsInBuffer(
  bufferWkt: string,
  radiusMeters: number,
  categories?: string[],
  routeCoords?: RouteCoordinate[]
): Promise<Array<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  popularityScore: number;
  accessibilityScore: number;
  distanceFromRoute: number;
}>> {
  try {
    const categoryFilter = categories && categories.length > 0
      ? `AND d.category IN (${categories.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")})`
      : "";

    const results = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        category: string;
        popularityScore: number;
        accessibilityScore: number;
        distance_from_route: number;
      }>
    >(
      `SELECT
        d.id, d.name, d.latitude, d.longitude, d.category,
        COALESCE(d."popularityScore", 0) as "popularityScore",
        COALESCE(d."accessibilityScore", 0) as "accessibilityScore",
        ST_Distance(
          ST_SetSRID(ST_MakePoint(d.longitude, d.latitude), 4326)::geography,
          ST_GeomFromText($1, 4326)::geography
        ) as distance_from_route
      FROM "destination" d
      WHERE verified = true
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(d.longitude, d.latitude), 4326)::geography,
          ST_GeomFromText($1, 4326)::geography,
          $2
        )
        ${categoryFilter}
      ORDER BY distance_from_route ASC
      LIMIT 100`,
      bufferWkt, radiusMeters
    );

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      category: r.category,
      popularityScore: r.popularityScore ?? 0,
      accessibilityScore: r.accessibilityScore ?? 0,
      distanceFromRoute: r.distance_from_route ?? 0,
    }));
  } catch {
    // JS fallback when PostGIS is unavailable
    if (!routeCoords) return [];
    try {
      const where: any = { verified: true };
      if (categories && categories.length > 0) where.category = { in: categories };
      const destinations = await prisma.destination.findMany({ where, select: { id: true, name: true, latitude: true, longitude: true, category: true, popularityScore: true, accessibilityScore: true } });

      const results: Array<{
        id: string; name: string; latitude: number; longitude: number;
        category: string; popularityScore: number; accessibilityScore: number; distanceFromRoute: number;
      }> = [];

      for (const d of destinations) {
        if (!isWithinRadius(d.latitude, d.longitude, routeCoords, radiusMeters)) continue;
        let minDist = Infinity;
        for (const rc of routeCoords) {
          const dist = haversineKm(d.latitude, d.longitude, rc.lat, rc.lon);
          if (dist < minDist) minDist = dist;
        }
        results.push({ id: d.id, name: d.name, latitude: d.latitude, longitude: d.longitude, category: d.category, popularityScore: d.popularityScore ?? 0, accessibilityScore: d.accessibilityScore ?? 0, distanceFromRoute: minDist * 1000 });
      }
      return results.sort((a, b) => a.distanceFromRoute - b.distanceFromRoute).slice(0, 100);
    } catch { return []; }
  }
}

export async function findPlacesInBuffer(
  bufferWkt: string,
  radiusMeters: number,
  routeCoords?: RouteCoordinate[]
): Promise<Array<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  distanceFromRoute: number;
}>> {
  try {
    const results = await prisma.$queryRawUnsafe<
      Array<{
        id: string; name: string; latitude: number; longitude: number;
        type: string; distance_from_route: number;
      }>
    >(
      `SELECT
        p.id, p.name, p.latitude, p.longitude, p.type,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
          ST_GeomFromText($1, 4326)::geography
        ) as distance_from_route
      FROM "place" p
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
        ST_GeomFromText($1, 4326)::geography,
        $2
      )
      ORDER BY distance_from_route ASC
      LIMIT 100`,
      bufferWkt, radiusMeters
    );

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      type: r.type,
      distanceFromRoute: r.distance_from_route ?? 0,
    }));
  } catch {
    if (!routeCoords) return [];
    try {
      const places = await prisma.place.findMany();
      const results: Array<{
        id: string; name: string; latitude: number; longitude: number;
        type: string; distanceFromRoute: number;
      }> = [];

      for (const p of places) {
        if (!isWithinRadius(p.latitude, p.longitude, routeCoords, radiusMeters)) continue;
        let minDist = Infinity;
        for (const rc of routeCoords) {
          const dist = haversineKm(p.latitude, p.longitude, rc.lat, rc.lon);
          if (dist < minDist) minDist = dist;
        }
        results.push({ id: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude, type: p.type, distanceFromRoute: minDist * 1000 });
      }
      return results.sort((a, b) => a.distanceFromRoute - b.distanceFromRoute).slice(0, 100);
    } catch { return []; }
  }
}
