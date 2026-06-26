#!/usr/bin/env npx tsx
/**
 * OSM Road Import Script
 *
 * Reads the Nepal OSM PBF extract via pbf2json and populates:
 *   - OsmWay table (topology authority)
 *   - RouteNode table (spatial records with osmWayId, sequenceIndex, roadClass)
 *
 * Usage:
 *   npx tsx scripts/import-osm-roads.ts [--pbf /path/to/nepal-latest.osm.pbf]
 *
 * Dependencies:
 *   - pbf2json (npm) — pre-built binary for fast PBF parsing
 *   - @prisma/client
 */
import "dotenv/config";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const GRAPH_VERSION = "v1";
const IMPORT_BATCH_ID = crypto.randomUUID();

const ROAD_CLASSES = new Set([
  "motorway", "trunk",
  "primary", "secondary", "tertiary",
]);

// Values that map to the simplified road class
const HIGHWAY_VALUE_TO_CLASS: Record<string, string> = {
  motorway: "motorway",
  motorway_link: "motorway",
  trunk: "trunk",
  trunk_link: "trunk",
  primary: "primary",
  primary_link: "primary",
  secondary: "secondary",
  secondary_link: "secondary",
  tertiary: "tertiary",
  tertiary_link: "tertiary",
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface PbfNode {
  id: number;
  type: "node";
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

interface PbfWay {
  id: number;
  type: "way";
  tags: Record<string, string>;
  nodes: Array<{ lat: string; lon: string }>;
}

type PbfEntity = PbfNode | PbfWay;

/** Batch processor for upserts into DB */
class BatchInserter {
  private wayBuffer: Array<{
    id: string; name: string | null; roadClass: string;
    oneWay: boolean; tags: Record<string, string>;
  }> = [];
  private nodeBuffer: Array<{
    id: string; lat: number; lon: number; osmWayId: string;
    sequenceIndex: number; roadClass: string; name: string;
  }> = [];
  private batchSize: number;
  private onFlush: (ways: typeof this.wayBuffer, nodes: typeof this.nodeBuffer) => Promise<void>;

  constructor(
    batchSize: number,
    onFlush: (ways: typeof this.wayBuffer, nodes: typeof this.nodeBuffer) => Promise<void>,
  ) {
    this.batchSize = batchSize;
    this.onFlush = onFlush;
  }

  async addWay(
    id: string, name: string | null, roadClass: string,
    oneWay: boolean, tags: Record<string, string>,
  ) {
    this.wayBuffer.push({ id, name, roadClass, oneWay, tags });
    if (this.wayBuffer.length >= this.batchSize) await this.flush();
  }

  async addNode(
    id: string, lat: number, lon: number, osmWayId: string,
    sequenceIndex: number, roadClass: string, name: string,
  ) {
    this.nodeBuffer.push({ id, lat, lon, osmWayId, sequenceIndex, roadClass, name });
    if (this.nodeBuffer.length >= this.batchSize) await this.flush();
  }

  async flush() {
    if (this.wayBuffer.length === 0 && this.nodeBuffer.length === 0) return;
    const ways = [...this.wayBuffer];
    const nodes = [...this.nodeBuffer];
    this.wayBuffer = [];
    this.nodeBuffer = [];
    await this.onFlush(ways, nodes);
  }
}

async function findPbfFile(args: string[]): Promise<string> {
  const pbfArg = args.find((a) => a.startsWith("--pbf="));
  if (pbfArg) return pbfArg.slice("--pbf=".length);

  const defaults = [
    "/tmp/nepal-latest.osm.pbf",
    join(__dirname, "data/nepal-latest.osm.pbf"),
  ];
  for (const p of defaults) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "PBF file not found.\n" +
    "  Download: wget https://download.geofabrik.de/asia/nepal-latest.osm.pbf -O /tmp/nepal-latest.osm.pbf\n" +
    "  Or pass:  --pbf=/path/to/file.osm.pbf"
  );
}

function getRoadClass(tags: Record<string, string>): string | null {
  const highway = tags.highway;
  if (!highway) return null;
  const cls = HIGHWAY_VALUE_TO_CLASS[highway];
  if (!cls || !ROAD_CLASSES.has(cls)) return null;
  return cls;
}

async function main() {
  const pbfPath = await findPbfFile(process.argv.slice(2));

  console.log(`\n=== OSM Road Import ===`);
  console.log(`PBF:        ${pbfPath}`);
  console.log(`Version:    ${GRAPH_VERSION}`);
  console.log(`Batch ID:   ${IMPORT_BATCH_ID}\n`);

  // Clear existing OSM data for this graph version
  console.log("Clearing existing data...");
  await prisma.edgeCache.deleteMany({ where: { graphVersion: GRAPH_VERSION } });
  await prisma.routeNode.updateMany({
    where: { osmWayId: { not: null } },
    data: { osmWayId: null, sequenceIndex: null, roadClass: null, isJunctionNode: false },
  });
  await prisma.osmWay.deleteMany({ where: { graphVersion: GRAPH_VERSION } });
  console.log("Done.\n");

  let wayCount = 0;
  let nodeCount = 0;
  const roadClassCounts: Record<string, number> = {};
  const nodeWays = new Map<string, Set<string>>(); // coordKey → Set<wayId>

  const inserter = new BatchInserter(250, async (ways, nodes) => {
    await prisma.$transaction(async (tx) => {
      // Upsert ways
      for (const w of ways) {
        await tx.osmWay.upsert({
          where: { id: w.id },
          create: {
            id: w.id,
            name: w.name,
            roadClass: w.roadClass,
            oneWay: w.oneWay,
            graphVersion: GRAPH_VERSION,
            importBatchId: IMPORT_BATCH_ID,
            isActive: true,
          },
          update: {
            name: w.name,
            roadClass: w.roadClass,
            oneWay: w.oneWay,
            graphVersion: GRAPH_VERSION,
            importBatchId: IMPORT_BATCH_ID,
            isActive: true,
          },
        });
      }

      // Upsert nodes
      for (const n of nodes) {
        await tx.routeNode.upsert({
          where: { id: n.id },
          create: {
            id: n.id,
            name: n.name,
            type: "ROUTE_NODE",
            latitude: n.lat,
            longitude: n.lon,
            osmWayId: n.osmWayId,
            sequenceIndex: n.sequenceIndex,
            roadClass: n.roadClass,
            isActive: true,
          },
          update: {
            latitude: n.lat,
            longitude: n.lon,
            osmWayId: n.osmWayId,
            sequenceIndex: n.sequenceIndex,
            roadClass: n.roadClass,
            isActive: true,
          },
        });
      }
    });
  });

  // Use pbf2json via its npm API (child process wrapper)
  const pbf2json = require("pbf2json");

  const stream = pbf2json.createReadStream({
    file: pbfPath,
    tags: ["highway"],
    waynodes: true,
  });

  console.log("Processing PBF (this may take several minutes)...");

  for await (const entity of stream) {
    if (entity.type === "way") {
      const way = entity as PbfWay;
      const roadClass = getRoadClass(way.tags);
      if (!roadClass) continue;

      const wayId = way.id.toString();
      const wayName = way.tags.name ?? way.tags.ref ?? null;

      await inserter.addWay(wayId, wayName, roadClass, way.tags.oneway === "yes", way.tags);
      wayCount++;
      roadClassCounts[roadClass] = (roadClassCounts[roadClass] ?? 0) + 1;

      // Insert nodes with sequence index
      for (let seq = 0; seq < way.nodes.length; seq++) {
        const node = way.nodes[seq];
        const lat = parseFloat(node.lat);
        const lon = parseFloat(node.lon);
        const nodeId = `${wayId}:${seq}`;

        // Track for junction detection
        const coordKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
        if (!nodeWays.has(coordKey)) nodeWays.set(coordKey, new Set());
        nodeWays.get(coordKey)!.add(wayId);

        const name = wayName ? `${wayName} ${seq}` : `${wayId}:${seq}`;
        await inserter.addNode(nodeId, lat, lon, wayId, seq, roadClass, name);
        nodeCount++;
      }

      if (wayCount % 50 === 0) {
        process.stdout.write(`\r  Ways: ${wayCount} | Nodes: ${nodeCount}`);
      }
    }
  }

  await inserter.flush();

  console.log(`\r  Ways: ${wayCount} | Nodes: ${nodeCount} (done)`);

  // Phase 2: Mark junction nodes
  console.log("\nMarking junction nodes...");
  let junctionCount = 0;

  for (const [coordKey, wayIds] of nodeWays) {
    if (wayIds.size < 2) continue;

    // Find node IDs at this coordinate (across different ways)
    const [latStr, lonStr] = coordKey.split(",");
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    // Use a coordinate tolerance of ~10m
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM route_node
       WHERE ABS(latitude - $1) < 0.001 AND ABS(longitude - $2) < 0.001
       LIMIT 10`,
      lat, lon
    );

    if (rows.length >= 2) {
      await prisma.routeNode.updateMany({
        where: { id: { in: rows.map(r => r.id) } },
        data: { isJunctionNode: true },
      });
      junctionCount++;
    }
  }

  // Summary
  console.log(`\n=== Import Complete ===`);
  console.log(`Graph Version: ${GRAPH_VERSION}`);
  console.log(`Batch ID:      ${IMPORT_BATCH_ID}`);
  console.log(`Ways:          ${wayCount}`);
  console.log(`Nodes:         ${nodeCount}`);
  console.log(`Junctions:     ${junctionCount}`);
  console.log(`Road classes:  ${JSON.stringify(roadClassCounts)}`);

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("\nImport failed:", err);
  process.exit(1);
});
