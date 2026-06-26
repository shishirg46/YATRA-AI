#!/usr/bin/env npx tsx
/**
 * Re-detect junction nodes with the correct tolerance.
 *
 * The original import used `toFixed(5)` (~1.1m) for junction clustering,
 * but the adjacency builder uses 10m grid cells. This mismatch caused
 * many real intersections to be missed.
 *
 * This script re-scans all route nodes, groups them by 10m grid cells,
 * and marks any cell with nodes from ≥2 distinct OSM ways as a junction.
 *
 * Run after import, before routing.
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const BATCH_SIZE = 5000;
const TOLERANCE = 0.0001; // ~10m, matching adjacency.ts

const url = new URL(process.env.DATABASE_URL!);
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port, 10) || 5432,
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  max: 3,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("Fetching all active route nodes...");
  const nodes = await prisma.routeNode.findMany({
    where: { isActive: true, osmWayId: { not: null } },
    select: { id: true, latitude: true, longitude: true, osmWayId: true, isJunctionNode: true },
  });
  console.log(`Total nodes: ${nodes.length}`);

  // Group by 10m grid cell
  console.log("Grouping by 10m grid cells...");
  const cells = new Map<string, Map<string, string[]>>(); // cellKey → Map<wayId → nodeIds[]>

  for (const n of nodes) {
    if (n.latitude == null || n.longitude == null || !n.osmWayId) continue;
    const lat = Math.round(n.latitude / TOLERANCE) * TOLERANCE;
    const lon = Math.round(n.longitude / TOLERANCE) * TOLERANCE;
    const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    if (!cells.has(key)) cells.set(key, new Map());
    const cell = cells.get(key)!;
    if (!cell.has(n.osmWayId)) cell.set(n.osmWayId, []);
    cell.get(n.osmWayId)!.push(n.id);
  }

  console.log(`Grid cells with nodes: ${cells.size}`);

  // Find cells with ≥2 distinct ways
  const junctionCells: Array<{ key: string; wayCount: number; nodeIds: string[] }> = [];
  for (const [key, byWay] of cells) {
    if (byWay.size >= 2) {
      const nodeIds = Array.from(byWay.values()).flat();
      junctionCells.push({ key, wayCount: byWay.size, nodeIds });
    }
  }

  console.log(`Cells with ≥2 ways (junctions): ${junctionCells.length}`);

  // Reset all existing junction flags
  console.log("Resetting all junction flags...");
  await prisma.routeNode.updateMany({
    where: { isJunctionNode: true },
    data: { isJunctionNode: false },
  });

  // Mark new junctions in batches
  let totalMarked = 0;
  for (let i = 0; i < junctionCells.length; i += BATCH_SIZE) {
    const batch = junctionCells.slice(i, i + BATCH_SIZE);
    const allIds = batch.flatMap(c => c.nodeIds);

    await prisma.routeNode.updateMany({
      where: { id: { in: allIds } },
      data: { isJunctionNode: true },
    });

    totalMarked += allIds.length;
    const pct = ((i + batch.length) / junctionCells.length * 100).toFixed(1);
    process.stdout.write(`\r  ${pct}% — ${totalMarked} nodes marked as junctions`);
  }

  console.log(`\n\nDone. ${junctionCells.length} junction cells, ${totalMarked} junction nodes.`);
  console.log("Adjacency cache will rebuild on next route request.");

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
