import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type RouteEndpoint = {
  name: string;
  district?: string;
};

type ManualRoute = {
  name: string;
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  points?: Array<{ lat: number; lon: number; name?: string }>;
  sampleMaxPoints?: number;
};

type ProvinceRouteConfig = {
  province: string;
  sourceTag?: string;
  includeAllProvinceLocations?: boolean;
  generateFromHub?: boolean;
  hub?: RouteEndpoint;
  excludeLocationNames?: string[];
  manualRoutes?: ManualRoute[];
};

type DBLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  district: { name: string; province: { name: string } };
};

const DEFAULT_SOURCE = "province-json-v1";
const ROUTES_DIR = path.resolve(process.cwd(), "scripts/routes");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function sampleCoords(coords: [number, number][], maxPoints = 20): Array<{ lat: number; lon: number; kmFromStart: number }> {
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

async function fetchOsrmRoute(origin: DBLocation, destination: DBLocation) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) return null;

  const data = await res.json() as { code?: string; routes?: Array<{ distance: number; geometry: { coordinates: [number, number][] } }> };
  if (data.code !== "Ok" || !data.routes?.length) return null;
  return data.routes[0];
}

async function fetchOsrmRouteWithRetry(origin: DBLocation, destination: DBLocation, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const route = await fetchOsrmRoute(origin, destination);
      if (route) return route;
    } catch {
      // noop, retry below
    }
    if (i < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * i));
    }
  }
  return null;
}

function buildFallbackPoints(origin: DBLocation, destination: DBLocation) {
  const total = haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
  const midLat = (origin.latitude + destination.latitude) / 2;
  const midLon = (origin.longitude + destination.longitude) / 2;
  return [
    { lat: origin.latitude, lon: origin.longitude, kmFromStart: 0 },
    { lat: midLat, lon: midLon, kmFromStart: Math.round((total / 2) * 100) / 100 },
    { lat: destination.latitude, lon: destination.longitude, kmFromStart: Math.round(total * 100) / 100 },
  ];
}

async function readConfigs(): Promise<ProvinceRouteConfig[]> {
  const entries = await fs.readdir(ROUTES_DIR);
  const jsonFiles = entries.filter((f) => f.endsWith(".json"));
  const configs: ProvinceRouteConfig[] = [];

  for (const file of jsonFiles) {
    const fullPath = path.join(ROUTES_DIR, file);
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw) as ProvinceRouteConfig;
    configs.push(parsed);
  }

  return configs;
}

function findLocation(locations: DBLocation[], endpoint: RouteEndpoint): DBLocation | null {
  const exactDistrict = endpoint.district
    ? locations.find((l) => l.name.toLowerCase() === endpoint.name.toLowerCase() && l.district.name.toLowerCase() === endpoint.district!.toLowerCase())
    : null;
  if (exactDistrict) return exactDistrict;
  return locations.find((l) => l.name.toLowerCase() === endpoint.name.toLowerCase()) ?? null;
}

async function nearestLocationByPoint(lat: number, lon: number, locations: DBLocation[], maxKm = 20) {
  let best: DBLocation | null = null;
  let minDist = Infinity;
  for (const loc of locations) {
    const d = haversineKm(lat, lon, loc.latitude, loc.longitude);
    if (d < minDist) {
      minDist = d;
      best = loc;
    }
  }
  return minDist <= maxKm ? best : null;
}

async function upsertTemplate(
  routeName: string,
  sourceTag: string,
  origin: DBLocation,
  destination: DBLocation,
  points: Array<{ lat: number; lon: number; kmFromStart: number; placeName?: string; matchedLocationId?: string | null }>,
  distanceKm: number
) {
  const prismaAny = prisma as any;
  const template = await prismaAny.routeTemplate.upsert({
    where: {
      originLocationId_destinationLocationId_name: {
        originLocationId: origin.id,
        destinationLocationId: destination.id,
        name: routeName,
      },
    },
    create: {
      originLocationId: origin.id,
      destinationLocationId: destination.id,
      name: routeName,
      source: sourceTag,
      distanceKm,
      isActive: true,
    },
    update: {
      source: sourceTag,
      distanceKm,
      isActive: true,
    },
  });

  await prismaAny.routeTemplatePoint.deleteMany({ where: { routeTemplateId: template.id } });

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    await prismaAny.routeTemplatePoint.create({
      data: {
        routeTemplateId: template.id,
        seq: i,
        lat: p.lat,
        lon: p.lon,
        kmFromStart: p.kmFromStart,
        placeName: p.placeName ?? null,
        matchedLocationId: p.matchedLocationId ?? null,
      },
    });
  }
}

async function main() {
  const prismaAny = prisma as any;
  if (!prismaAny.routeTemplate || !prismaAny.routeTemplatePoint) {
    throw new Error("Prisma client missing route template models. Run prisma generate.");
  }

  const configs = await readConfigs();
  if (!configs.length) {
    console.log("No route config files found in scripts/routes.");
    return;
  }

  const locations = await prisma.location.findMany({
    include: { district: { include: { province: true } } },
  }) as unknown as DBLocation[];

  let createdOrUpdated = 0;
  let failed = 0;

  for (const cfg of configs) {
    const sourceTag = cfg.sourceTag ?? DEFAULT_SOURCE;
    const provinceLocations = locations.filter((l) => l.district.province.name.toLowerCase() === cfg.province.toLowerCase());
    if (!provinceLocations.length) {
      console.log(`- skipped ${cfg.province}: no DB locations found`);
      continue;
    }

    console.log(`\nProvince: ${cfg.province} (${provinceLocations.length} locations)`);

    if (cfg.includeAllProvinceLocations && cfg.hub && cfg.generateFromHub === true) {
      const hub = findLocation(provinceLocations, cfg.hub);
      if (!hub) {
        console.log(`- hub not found: ${cfg.hub.name}`);
      } else {
        const excludeSet = new Set((cfg.excludeLocationNames ?? []).map((n) => n.toLowerCase()));
        for (const loc of provinceLocations) {
          if (loc.id === hub.id) continue;
          if (excludeSet.has(loc.name.toLowerCase())) continue;

          try {
            const directKm = haversineKm(hub.latitude, hub.longitude, loc.latitude, loc.longitude);
            const route = await fetchOsrmRouteWithRetry(hub, loc, 4);
            if (!route) {
              if (directKm <= 6) {
                const fallback = buildFallbackPoints(hub, loc);
                const points = await Promise.all(fallback.map(async (p) => {
                  const nearest = await nearestLocationByPoint(p.lat, p.lon, provinceLocations, 20);
                  return { ...p, placeName: nearest?.name, matchedLocationId: nearest?.id ?? null };
                }));
                await upsertTemplate(
                  `${hub.name} to ${loc.name} Route`,
                  `${sourceTag}:fallback-short`,
                  hub,
                  loc,
                  points,
                  directKm
                );
                createdOrUpdated++;
                console.log(`- ${hub.name} -> ${loc.name}: fallback-short ${points.length} points`);
                continue;
              }
              failed++;
              console.log(`- FAILED ${hub.name} -> ${loc.name}: osrm unavailable`);
              continue;
            }

            const sampled = sampleCoords(route.geometry.coordinates, 20);
            const points = await Promise.all(sampled.map(async (p) => {
              const nearest = await nearestLocationByPoint(p.lat, p.lon, provinceLocations, 20);
              return {
                ...p,
                placeName: nearest?.name,
                matchedLocationId: nearest?.id ?? null,
              };
            }));

            await upsertTemplate(
              `${hub.name} to ${loc.name} Route`,
              sourceTag,
              hub,
              loc,
              points,
              route.distance / 1000
            );
            createdOrUpdated++;
            console.log(`- ${hub.name} -> ${loc.name}: ${points.length} points`);
          } catch (error) {
            failed++;
            console.log(`- FAILED ${hub.name} -> ${loc.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } else if (cfg.includeAllProvinceLocations && cfg.hub && cfg.generateFromHub !== true) {
      console.log(`- skipped hub generation for ${cfg.province} (set generateFromHub=true to enable)`);
    }

    for (const manual of cfg.manualRoutes ?? []) {
      const origin = findLocation(provinceLocations, manual.origin) ?? findLocation(locations, manual.origin);
      const destination = findLocation(provinceLocations, manual.destination) ?? findLocation(locations, manual.destination);

      if (!origin || !destination) {
        failed++;
        console.log(`- FAILED ${manual.name}: origin or destination missing in DB`);
        continue;
      }

      try {
        let points: Array<{ lat: number; lon: number; kmFromStart: number; placeName?: string; matchedLocationId?: string | null }> = [];
        let distanceKm = haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude);

        if (manual.points?.length && manual.points.length >= 2) {
          let km = 0;
          for (let i = 0; i < manual.points.length; i++) {
            const pt = manual.points[i];
            if (i > 0) {
              km += haversineKm(manual.points[i - 1].lat, manual.points[i - 1].lon, pt.lat, pt.lon);
            }
            const nearest = await nearestLocationByPoint(pt.lat, pt.lon, locations, 20);
            points.push({
              lat: pt.lat,
              lon: pt.lon,
              kmFromStart: Math.round(km * 100) / 100,
              placeName: pt.name ?? nearest?.name,
              matchedLocationId: nearest?.id ?? null,
            });
          }
          distanceKm = km;
        } else {
          const route = await fetchOsrmRouteWithRetry(origin, destination, 4);
          if (!route) {
            const directKm = haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
            if (directKm <= 6) {
              const fallback = buildFallbackPoints(origin, destination);
              points = await Promise.all(fallback.map(async (p) => {
                const nearest = await nearestLocationByPoint(p.lat, p.lon, locations, 20);
                return { ...p, placeName: nearest?.name, matchedLocationId: nearest?.id ?? null };
              }));
              distanceKm = directKm;
            } else {
              failed++;
              console.log(`- FAILED ${manual.name}: osrm unavailable`);
              continue;
            }
          }
          if (route) {
            const sampled = sampleCoords(route.geometry.coordinates, manual.sampleMaxPoints ?? 20);
            points = await Promise.all(sampled.map(async (p) => {
              const nearest = await nearestLocationByPoint(p.lat, p.lon, locations, 20);
              return {
                ...p,
                placeName: nearest?.name,
                matchedLocationId: nearest?.id ?? null,
              };
            }));
            distanceKm = route.distance / 1000;
          }
        }

        await upsertTemplate(manual.name, sourceTag, origin, destination, points, distanceKm);
        createdOrUpdated++;
        console.log(`- manual ${manual.name}: ${points.length} points`);
      } catch (error) {
        failed++;
        console.log(`- FAILED manual ${manual.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`\nRoute template sync done. created/updated=${createdOrUpdated}, failed=${failed}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error) => {
  console.error("sync-route-templates-from-json failed:", error);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
