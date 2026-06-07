/**
 * Fixes destination coordinates for high-altitude destinations (peaks, trekking spots)
 * by snapping them to the nearest road via OSRM.
 *
 * For destinations where a road is found within 5km, updates lat/lon to the road point.
 * For destinations where no road is found, sets routeAccessible = false.
 *
 * Run: npx tsx scripts/fix-destination-coords.ts
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const OSRM_BASE = "https://router.project-osrm.org";
const MIN_INTERVAL_MS = 500;

let lastRequestTime = 0;

async function snapToRoad(
  lat: number,
  lon: number,
  radiusMeters = 5000,
): Promise<{ lat: number; lon: number; distance: number } | null> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();

  try {
    const res = await fetch(
      `${OSRM_BASE}/nearest/v1/driving/${lon},${lat}?number=1`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!res.ok) return null;

    const data: { code: string; waypoints?: Array<{ location: [number, number]; distance: number }> } = await res.json();
    if (data.code !== "Ok" || !data.waypoints?.length) return null;

    const wp = data.waypoints[0];
    if (wp.distance > radiusMeters) {
      console.log(`  → Road too far: ${Math.round(wp.distance)}m away`);
      return null;
    }

    return {
      lat: wp.location[1],
      lon: wp.location[0],
      distance: Math.round(wp.distance),
    };
  } catch (err) {
    console.log(`  → OSRM error: ${err instanceof Error ? err.message : "unknown"}`);
    return null;
  }
}

async function main() {
  const destinations = await prisma.destination.findMany({
    where: { altitude: { gt: 3000 } },
    orderBy: { altitude: "desc" },
  });

  console.log(`Found ${destinations.length} high-altitude destinations (altitude > 3000m)`);

  let fixed = 0;
  let markedNotAccessible = 0;
  let errors = 0;

  for (let i = 0; i < destinations.length; i++) {
    const d = destinations[i];
    console.log(`\n[${i + 1}/${destinations.length}] ${d.name} (${d.altitude}m) @ ${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`);

    const snapped = await snapToRoad(d.latitude, d.longitude);

    if (snapped) {
      const diffHaversine = haversineKm(d.latitude, d.longitude, snapped.lat, snapped.lon);
      console.log(`  → Snapped to road ${snapped.distance}m away (${diffHaversine.toFixed(1)}km from original)`);

      await prisma.destination.update({
        where: { id: d.id },
        data: {
          latitude: snapped.lat,
          longitude: snapped.lon,
          routeAccessible: true,
          coordinateAccuracy: Math.max(0, 1 - snapped.distance / 10000),
          metadata: {
            ...((d.metadata as Record<string, unknown>) || {}),
            originalLat: d.latitude,
            originalLon: d.longitude,
            roadSnapDistanceMeters: snapped.distance,
            roadSnappedAt: new Date().toISOString(),
          },
        },
      });
      fixed++;
    } else {
      console.log(`  → No road found within 5km — marking not road-accessible`);
      await prisma.destination.update({
        where: { id: d.id },
        data: {
          routeAccessible: false,
          coordinateAccuracy: 0,
        },
      });
      markedNotAccessible++;
    }
  }

  console.log(`\n─── Done ───`);
  console.log(`Total: ${destinations.length}`);
  console.log(`Fixed (snapped to road): ${fixed}`);
  console.log(`Marked not road-accessible: ${markedNotAccessible}`);
  console.log(`Errors: ${errors}`);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
