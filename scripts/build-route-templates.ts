import "dotenv/config";

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SNAPSHOT_SOURCE = "seeded-osrm-template-v1";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchRoutePoints(origin: { lat: number; lon: number }, destination: { lat: number; lon: number }) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json() as { code?: string; routes?: Array<{ distance: number; geometry: { coordinates: [number, number][] } }> };
  if (data.code !== "Ok" || !data.routes?.length) return null;
  return data.routes[0];
}

function sampleCoords(coords: [number, number][], maxPoints = 18): Array<{ lat: number; lon: number; kmFromStart: number }> {
  if (coords.length < 2) return [];
  const step = Math.max(1, Math.ceil(coords.length / maxPoints));
  const sampled: Array<{ lat: number; lon: number; kmFromStart: number }> = [];
  let kmFromStart = 0;
  let prev = { lat: coords[0][1], lon: coords[0][0] };
  sampled.push({ lat: prev.lat, lon: prev.lon, kmFromStart: 0 });

  for (let i = 1; i < coords.length; i++) {
    const cur = { lat: coords[i][1], lon: coords[i][0] };
    kmFromStart += haversineKm(prev.lat, prev.lon, cur.lat, cur.lon);
    if (i % step === 0 || i === coords.length - 1) {
      sampled.push({ lat: cur.lat, lon: cur.lon, kmFromStart: Math.round(kmFromStart * 100) / 100 });
    }
    prev = cur;
  }

  return sampled;
}

async function nearestLocation(lat: number, lon: number, locations: Array<{ id: string; name: string; latitude: number; longitude: number }>, maxKm = 15) {
  let best: { id: string; name: string } | null = null;
  let minDist = Infinity;
  for (const loc of locations) {
    const d = haversineKm(lat, lon, loc.latitude, loc.longitude);
    if (d < minDist) {
      minDist = d;
      best = { id: loc.id, name: loc.name };
    }
  }
  return minDist <= maxKm ? best : null;
}

async function main() {
  const prismaAny = prisma as any;
  if (!prismaAny.routeTemplate || !prismaAny.routeTemplatePoint) {
    throw new Error("Prisma client is missing RouteTemplate models. Run: npx prisma migrate dev && npx prisma generate");
  }

  const locations = await prisma.location.findMany({
    select: { id: true, name: true, latitude: true, longitude: true, district: { select: { name: true } } },
    where: {
      OR: [
        { name: { contains: "Bazaar", mode: "insensitive" } },
        { name: { contains: "Junction", mode: "insensitive" } },
        { name: { contains: "Market", mode: "insensitive" } },
      ],
    },
    take: 40,
  });

  if (locations.length < 2) {
    console.log("Not enough locations to build templates.");
    return;
  }

  let created = 0;
  let failed = 0;

  const candidates: Array<{ a: (typeof locations)[number]; b: (typeof locations)[number] }> = [];
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const a = locations[i];
      const b = locations[j];
      const d = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
      if (d >= 40 && d <= 320) candidates.push({ a, b });
      if (candidates.length >= 24) break;
    }
    if (candidates.length >= 24) break;
  }

  console.log(`Building ${candidates.length} stored route templates...`);

  for (const pair of candidates) {
    try {
      const route = await fetchRoutePoints(
        { lat: pair.a.latitude, lon: pair.a.longitude },
        { lat: pair.b.latitude, lon: pair.b.longitude }
      );
      if (!route) {
        failed++;
        continue;
      }

      const sampled = sampleCoords(route.geometry.coordinates, 18);
      if (sampled.length < 2) {
        failed++;
        continue;
      }

      const name = `${pair.a.name} to ${pair.b.name} Route`;
      const template = await prismaAny.routeTemplate.upsert({
        where: {
          originLocationId_destinationLocationId_name: {
            originLocationId: pair.a.id,
            destinationLocationId: pair.b.id,
            name,
          },
        },
        create: {
          originLocationId: pair.a.id,
          destinationLocationId: pair.b.id,
          name,
          distanceKm: route.distance / 1000,
          source: SNAPSHOT_SOURCE,
          isActive: true,
        },
        update: {
          distanceKm: route.distance / 1000,
          source: SNAPSHOT_SOURCE,
          isActive: true,
        },
      });

      await prismaAny.routeTemplatePoint.deleteMany({ where: { routeTemplateId: template.id } });

      for (let i = 0; i < sampled.length; i++) {
        const p = sampled[i];
        const near = await nearestLocation(p.lat, p.lon, locations as any, 20);
        await prismaAny.routeTemplatePoint.create({
          data: {
            routeTemplateId: template.id,
            seq: i,
            lat: p.lat,
            lon: p.lon,
            kmFromStart: p.kmFromStart,
            placeName: near?.name ?? null,
            matchedLocationId: near?.id ?? null,
          },
        });
      }

      created++;
      console.log(`- ${name}: ${sampled.length} points`);
    } catch (error) {
      failed++;
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`- FAILED ${pair.a.name} -> ${pair.b.name}: ${reason}`);
    }

    await sleep(350);
  }

  console.log(`\nDone. created=${created}, failed=${failed}`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error("build-route-templates failed:", err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
