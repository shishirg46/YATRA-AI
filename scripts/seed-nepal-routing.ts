/**
 * Seeds Nepal admin hierarchy (7 provinces, 77 districts) and route graph.
 * Run: npx tsx scripts/seed-nepal-routing.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient, PlaceType } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type AdminData = {
  provinces: { name: string; districts: string[] }[];
};

type RouteData = {
  nodes: { key: string; name: string; type: string; lat: number; lon: number; isHub: boolean }[];
  edges: { from: string; to: string; km: number; road?: string }[];
  localPlaces: {
    name: string;
    type: string;
    lat: number;
    lon: number;
    district: string;
    parentNode: string;
  }[];
};

async function main() {
  const adminPath = join(__dirname, "data/nepal-admin.json");
  const routePath = join(__dirname, "data/nepal-route-nodes.json");
  const admin = JSON.parse(readFileSync(adminPath, "utf-8")) as AdminData;
  const route = JSON.parse(readFileSync(routePath, "utf-8")) as RouteData;

  const provincePlaceIds = new Map<string, string>();
  const districtPlaceIds = new Map<string, string>();

  for (const prov of admin.provinces) {
    const provinceRecord = await prisma.province.upsert({
      where: { name: prov.name },
      create: { name: prov.name },
      update: {},
    });

    const provPlace = await prisma.place.upsert({
      where: { id: `prov-${prov.name.toLowerCase()}` },
      create: {
        id: `prov-${prov.name.toLowerCase()}`,
        name: prov.name,
        type: PlaceType.PROVINCE,
        latitude: 28,
        longitude: 84,
      },
      update: { name: prov.name },
    });
    provincePlaceIds.set(prov.name, provPlace.id);

    for (const distName of prov.districts) {
      const districtRecord = await prisma.district.upsert({
        where: { name_provinceId: { name: distName, provinceId: provinceRecord.id } },
        create: { name: distName, provinceId: provinceRecord.id },
        update: {},
      });

      const distKey = `${prov.name}:${distName}`;
      const distPlace = await prisma.place.upsert({
        where: { id: `dist-${distName.toLowerCase().replace(/\s+/g, "-")}-${prov.name.toLowerCase()}` },
        create: {
          id: `dist-${distName.toLowerCase().replace(/\s+/g, "-")}-${prov.name.toLowerCase()}`,
          name: distName,
          type: PlaceType.DISTRICT,
          latitude: 28,
          longitude: 84,
          parentId: provPlace.id,
          districtId: districtRecord.id,
        },
        update: {
          parentId: provPlace.id,
          districtId: districtRecord.id,
        },
      });
      districtPlaceIds.set(distKey, distPlace.id);
    }
  }

  console.log(`Seeded ${provincePlaceIds.size} provinces and ${districtPlaceIds.size} districts`);

  const nodeIds = new Map<string, string>();

  for (const n of route.nodes) {
    const node = await prisma.routeNode.upsert({
      where: { id: `node-${n.key}` },
      create: {
        id: `node-${n.key}`,
        name: n.name,
        type: n.type as PlaceType,
        latitude: n.lat,
        longitude: n.lon,
        isHub: n.isHub,
        isActive: true,
      },
      update: {
        name: n.name,
        latitude: n.lat,
        longitude: n.lon,
        isHub: n.isHub,
        isActive: true,
      },
    });
    nodeIds.set(n.key, node.id);

    await prisma.place.upsert({
      where: { id: `place-node-${n.key}` },
      create: {
        id: `place-node-${n.key}`,
        name: n.name,
        type: n.type as PlaceType,
        latitude: n.lat,
        longitude: n.lon,
      },
      update: { latitude: n.lat, longitude: n.lon },
    });
  }

  for (const e of route.edges) {
    const fromId = nodeIds.get(e.from);
    const toId = nodeIds.get(e.to);
    if (!fromId || !toId) continue;

    await prisma.routeEdge.upsert({
      where: { fromNodeId_toNodeId: { fromNodeId: fromId, toNodeId: toId } },
      create: {
        fromNodeId: fromId,
        toNodeId: toId,
        distanceKm: e.km,
        roadName: e.road ?? null,
        isBidirectional: true,
      },
      update: { distanceKm: e.km, roadName: e.road ?? null },
    });

    await prisma.routeEdge.upsert({
      where: { fromNodeId_toNodeId: { fromNodeId: toId, toNodeId: fromId } },
      create: {
        fromNodeId: toId,
        toNodeId: fromId,
        distanceKm: e.km,
        roadName: e.road ?? null,
        isBidirectional: true,
      },
      update: { distanceKm: e.km, roadName: e.road ?? null },
    });
  }

  for (const lp of route.localPlaces) {
    const distKey = [...districtPlaceIds.entries()].find(([k]) => k.endsWith(`:${lp.district}`))?.[1];
    const parentNodeId = nodeIds.get(lp.parentNode);

    await prisma.place.upsert({
      where: { id: `local-${lp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` },
      create: {
        id: `local-${lp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: lp.name,
        type: lp.type as PlaceType,
        latitude: lp.lat,
        longitude: lp.lon,
        districtId: distKey ? (await prisma.place.findUnique({ where: { id: distKey }, select: { districtId: true } }))?.districtId ?? undefined : undefined,
        parentId: parentNodeId ? `place-node-${lp.parentNode}` : undefined,
      },
      update: {
        latitude: lp.lat,
        longitude: lp.lon,
      },
    });
  }

  console.log(`Seeded ${nodeIds.size} route nodes and ${route.edges.length * 2} directed edges`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
