import "dotenv/config";
import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  HIGHWAY_CORRIDORS,
  MOUNTAIN_PASSES,
  ADDITIONAL_TOURIST_NODES,
  JUNCTION_NODES,
} from "./data/nepal-highways";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ---- Types ----
type NodeType = "city" | "town" | "junction" | "highwaynode" | "mountainpass" | "touristspot";
type RoadType = "highway" | "feederroad" | "mountainroad" | "valleyroad";

interface RouteNode {
  id: number;
  name: string;
  lat: number;
  lon: number;
  type: NodeType;
  elevationestimate?: number;
  importance: number;
}

interface RouteEdge {
  from: number;
  to: number;
  distancekm: number;
  roadtype: RoadType;
  riskbase: number;
  landslidesusceptibility: number;
  floodrisk: number;
}

// ---- Helpers ----
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function interpolate(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  fraction: number
): { lat: number; lon: number } {
  return {
    lat: lat1 + (lat2 - lat1) * fraction,
    lon: lon1 + (lon2 - lon1) * fraction,
  };
}

function dedupKey(node: { lat: number; lon: number }): string {
  return `${Math.round(node.lat * 100)}_${Math.round(node.lon * 100)}`;
}

// ---- Main builder ----
async function buildGraph() {
  const skipElevation = process.argv.includes("--skip-elevation");
  console.log("=== Building Nepal Route Graph ===\n");

  // 1. Read existing data from DB
  console.log("Reading existing data from DB...");
  const destinations = await prisma.destination.findMany({
    where: { latitude: { not: 0 }, longitude: { not: 0 } },
    select: { id: true, name: true, latitude: true, longitude: true, destinationTier: true, category: true },
  });

  const places = await prisma.place.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  const locations = await prisma.location.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  console.log(`  Destinations: ${destinations.length}`);
  console.log(`  Places: ${places.length}`);
  console.log(`  Locations: ${locations.length}`);

  // 2. Build nodes
  const nodes: RouteNode[] = [];
  const seenKeys = new Set<string>();
  let nextId = 1;

  function addNode(name: string, lat: number, lon: number, type: NodeType, importance: number, force = false): number | null {
    const key = dedupKey({ lat, lon });
    if (seenKeys.has(key) && !force) return null;
    seenKeys.add(key);
    const id = nextId++;
    nodes.push({ id, name, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)), type, importance });
    return id;
  }

  // 2a. Add destinations
  const destTypeMap: Record<string, NodeType> = {
    CITY: "city",
    TOWN: "town",
    VILLAGE: "town",
    MUNICIPALITY: "town",
    RURAL_MUNICIPALITY: "town",
    NEIGHBORHOOD: "town",
    NATURAL: "touristspot",
    RELIGIOUS: "touristspot",
    CULTURAL: "touristspot",
    ADVENTURE: "touristspot",
    TREK: "touristspot",
    HISTORICAL: "touristspot",
  };

  for (const d of destinations) {
    const type = destTypeMap[d.category] || "town";
    const importance = d.destinationTier ?? 3;
    addNode(d.name, d.latitude!, d.longitude!, type as NodeType, Math.min(importance, 5));
  }

  // 2b. Add places
  for (const p of places) {
    addNode(p.name, p.latitude, p.longitude, "town", 3);
  }

  // 2c. Add locations
  for (const l of locations) {
    addNode(l.name, l.latitude, l.longitude, "town", 4);
  }

  console.log(`  Base nodes from DB: ${nodes.length}`);

  // 3. Generate highway corridor nodes with sampling
  interface NodeRef {
    id: number;
    name: string;
    lat: number;
    lon: number;
  }

  const corridorNodeMap = new Map<string, NodeRef[]>();

  for (const corridor of HIGHWAY_CORRIDORS) {
    const wp = corridor.waypoints;
    const corrNodes: NodeRef[] = [];

    for (let i = 0; i < wp.length - 1; i++) {
      const from = wp[i];
      const to = wp[i + 1];
      const dist = haversineKm(from.lat, from.lon, to.lat, to.lon);
      const numSegments = Math.max(1, Math.round(dist / corridor.sampleEveryKm));

      for (let s = 0; s <= numSegments; s++) {
        const frac = s / numSegments;
        const pt = interpolate(from.lat, from.lon, to.lat, to.lon, frac);
        const name = s === 0 ? from.name : s === numSegments ? to.name : `${corridor.name}_${i}_${s}`;
        const type: NodeType = s === 0 && from.type ? from.type : s === numSegments && to.type ? to.type : "highwaynode";
        const importance = s === 0 ? (from.importance ?? 3) : s === numSegments ? (to.importance ?? 3) : 2;

        const id = addNode(name, pt.lat, pt.lon, type, importance);
        if (id !== null) {
          corrNodes.push({ id, name, lat: pt.lat, lon: pt.lon });
        } else {
          // Node already exists — find it
          const existing = nodes.find((n) => dedupKey(n) === dedupKey({ lat: pt.lat, lon: pt.lon }));
          if (existing) {
            corrNodes.push({ id: existing.id, name: existing.name, lat: existing.lat, lon: existing.lon });
          }
        }
      }
    }

    corridorNodeMap.set(corridor.name, corrNodes);
    console.log(`  ${corridor.name}: ${corrNodes.length} nodes`);
  }

  // 3b. Add mountain passes
  for (const p of MOUNTAIN_PASSES) {
    addNode(p.name, p.lat, p.lon, "mountainpass", p.importance ?? 2);
  }

  // 3c. Add additional tourist nodes (skip if another node within 1.5km exists)
  for (const t of ADDITIONAL_TOURIST_NODES) {
    const existing = nodes.find((n) => haversineKm(n.lat, n.lon, t.lat, t.lon) < 1.5);
    if (existing) {
      // Update existing node type to tourist if it's more important
      existing.type = "touristspot";
      existing.importance = Math.max(existing.importance, t.importance ?? 3);
      continue;
    }
    addNode(t.name, t.lat, t.lon, "touristspot", t.importance ?? 3);
  }

  // 3d. Add standalone junction/hub nodes (skip if another node within 1km)
  let junctionAdded = 0;
  for (const j of JUNCTION_NODES) {
    const existing = nodes.find((n) => haversineKm(n.lat, n.lon, j.lat, j.lon) < 1);
    if (existing) {
      existing.type = "junction";
      existing.importance = Math.max(existing.importance, j.importance ?? 3);
      continue;
    }
    const id = addNode(j.name, j.lat, j.lon, j.type ?? "junction", j.importance ?? 3);
    if (id !== null) junctionAdded++;
  }
  console.log(`  Junction/hub nodes added: ${junctionAdded}`);

  console.log(`\n  Total nodes: ${nodes.length}`);

  // 4. Build edges
  const edges: RouteEdge[] = [];
  const edgeKeys = new Set<string>();

  function edgeKey(from: number, to: number): string {
    return `${Math.min(from, to)}_${Math.max(from, to)}`;
  }

  function addEdge(from: number, to: number, distancekm: number, roadtype: RoadType, riskbase: number = 3, landslidesusceptibility: number = 3, floodrisk: number = 3) {
    if (from === to) return;
    const key = edgeKey(from, to);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      from,
      to,
      distancekm: Number(distancekm.toFixed(2)),
      roadtype,
      riskbase: Math.min(5, Math.max(1, Math.round(riskbase))),
      landslidesusceptibility: Math.min(5, Math.max(1, Math.round(landslidesusceptibility))),
      floodrisk: Math.min(5, Math.max(1, Math.round(floodrisk))),
    });
  }

  // 4a. Along-corridor edges
  const roadTypeRisk: Record<string, { riskbase: number; landslide: number; flood: number }> = {
    highway: { riskbase: 2, landslide: 2, flood: 2 },
    feederroad: { riskbase: 3, landslide: 3, flood: 3 },
    mountainroad: { riskbase: 4, landslide: 4, flood: 3 },
    valleyroad: { riskbase: 2, landslide: 2, flood: 3 },
  };

  for (const corridor of HIGHWAY_CORRIDORS) {
    const corrNodes = corridorNodeMap.get(corridor.name) ?? [];
    const risk = roadTypeRisk[corridor.roadType] ?? { riskbase: 3, landslide: 3, flood: 3 };

    for (let i = 0; i < corrNodes.length - 1; i++) {
      const a = corrNodes[i];
      const b = corrNodes[i + 1];
      const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
      if (dist > 50) continue; // sanity check — skip unrealistic jumps
      addEdge(a.id, b.id, dist, corridor.roadType, risk.riskbase, risk.landslide, risk.flood);
    }
  }

  // 4b. Identify highway nodes and interchange nodes
  const highwayNodeIds = new Set<number>();
  for (const corridor of HIGHWAY_CORRIDORS) {
    const corrNodes = corridorNodeMap.get(corridor.name) ?? [];
    for (const n of corrNodes) highwayNodeIds.add(n.id);
  }

  // Find interchange nodes (appear in ≥2 corridors)
  const nodeCorridorCount = new Map<number, number>();
  for (const [, corrNodes] of corridorNodeMap) {
    const seenInCorr = new Set<number>();
    for (const cn of corrNodes) {
      if (!seenInCorr.has(cn.id)) {
        seenInCorr.add(cn.id);
        nodeCorridorCount.set(cn.id, (nodeCorridorCount.get(cn.id) ?? 0) + 1);
      }
    }
  }

  interface InterchangeNode { id: number; lat: number; lon: number; }
  const interchangeNodes: InterchangeNode[] = [];
  for (const [nid, count] of nodeCorridorCount) {
    if (count >= 2) {
      const node = nodes.find((n) => n.id === nid);
      if (node) {
        interchangeNodes.push({ id: node.id, lat: node.lat, lon: node.lon });
      }
    }
  }
  console.log(`  Interchange nodes (≥2 corridors): ${interchangeNodes.length}`);

  // Feeder connections: settlement → nearest highway node (max 20km to avoid shortcuts)
  const settlementNodes = nodes.filter((n) =>
    !highwayNodeIds.has(n.id) &&
    (n.type === "town" || n.type === "city")
  );

  const allHighwayNodes = nodes.filter((n) => highwayNodeIds.has(n.id));
  let feederCount = 0;

  for (const sn of settlementNodes) {
    let nearest: { dist: number; node: RouteNode } | null = null;
    for (const hn of allHighwayNodes) {
      if (hn.id === sn.id) continue;
      const dist = haversineKm(sn.lat, sn.lon, hn.lat, hn.lon);
      if (!nearest || dist < nearest.dist) {
        nearest = { dist, node: hn };
      }
    }
    if (nearest && nearest.dist <= 20 && nearest.dist > 0.1) {
      addEdge(sn.id, nearest.node.id, nearest.dist, "feederroad", 3, 3, 3);
      feederCount++;
    }
  }
  console.log(`  Feeder edges: ${feederCount}`);

  // 4c. Interchange edges: connect corridor intersection points
  if (interchangeNodes.length > 0) {
    for (const corridor of HIGHWAY_CORRIDORS) {
      const corrNodes = corridorNodeMap.get(corridor.name) ?? [];
      for (const cn of corrNodes) {
        const nearest = interchangeNodes.find(
          (inp) => haversineKm(cn.lat, cn.lon, inp.lat, inp.lon) < 3
        );
        if (nearest) {
          const dist = haversineKm(cn.lat, cn.lon, nearest.lat, nearest.lon);
          if (dist > 0.1 && dist < 10) {
            addEdge(cn.id, nearest.id, dist, "highway", 2, 2, 2);
          }
        }
      }
    }
  }

  // 4d. Cross-connect edges between nearby corridor nodes
  let crossCount = 0;
  const allCorridorIds = [...corridorNodeMap.keys()];
  if (allHighwayNodes.length > 0) {
    for (let ci = 0; ci < allCorridorIds.length; ci++) {
      const corrA = corridorNodeMap.get(allCorridorIds[ci]) ?? [];
      for (let cj = ci + 1; cj < allCorridorIds.length; cj++) {
        const corrB = corridorNodeMap.get(allCorridorIds[cj]) ?? [];
        const stepA = Math.max(1, Math.floor(corrA.length / 40));
        const stepB = Math.max(1, Math.floor(corrB.length / 40));
        for (let i = 0; i < corrA.length; i += stepA) {
          const a = corrA[i];
          for (let j = 0; j < corrB.length; j += stepB) {
            const b = corrB[j];
            if (a.id === b.id) continue;
            const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
            if (dist > 0.5 && dist < 12) {
              addEdge(a.id, b.id, dist, "valleyroad", 2, 2, 3);
              crossCount++;
            }
          }
        }
      }
    }
  }
  console.log(`  Cross-connect edges: ${crossCount}`);

  // 4e. Connect ALL nearby settlement nodes (within 5km) for denser graph
  let denseCount = 0;
  const settlementCheck = settlementNodes.filter((n) => !highwayNodeIds.has(n.id)).slice(0, 300);
  for (let i = 0; i < settlementCheck.length; i++) {
    const a = settlementCheck[i];
    for (let j = i + 1; j < settlementCheck.length && j < i + 50; j++) {
      const b = settlementCheck[j];
      const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
      if (dist > 0.5 && dist < 5) {
        addEdge(a.id, b.id, dist, "valleyroad", 3, 3, 3);
        denseCount++;
      }
    }
  }
  console.log(`  Dense settlement edges: ${denseCount}`);

  // 4e. Connect nearby mountain passes, tourist spots, and ALL remaining nodes to nearest highway node
  const unconnectedNodes = nodes.filter((n) => !highwayNodeIds.has(n.id));
  let passEdgeCount = 0;
  for (const pn of unconnectedNodes) {
    let nearest: { dist: number; node: RouteNode } | null = null;
    for (const hn of allHighwayNodes) {
      const dist = haversineKm(pn.lat, pn.lon, hn.lat, hn.lon);
      if (!nearest || dist < nearest.dist) {
        nearest = { dist, node: hn };
      }
    }
    const maxEdgeDist = pn.type === "mountainpass" ? 25 : 20;
    if (nearest && nearest.dist <= maxEdgeDist && nearest.dist > 0.1) {
      const rdType: RoadType = pn.type === "mountainpass" ? "mountainroad" : "feederroad";
      addEdge(pn.id, nearest.node.id, nearest.dist, rdType, 4, 4, 3);
      passEdgeCount++;
    }
  }
  console.log(`  All-nodes-to-highway edges: ${passEdgeCount}`);

  console.log(`\n  Total edges: ${edges.length}`);

  // 5. Ensure graph connectivity — connect orphan components
  const componentMap = findConnectedComponents(nodes, edges);
  const components = groupBy(componentMap);
  console.log(`\n  Connected components: ${components.length}`);

  if (components.length > 1) {
    console.log(`  WARNING: ${components.length} disconnected components!`);
    // Connect largest component to orphans
    const sorted = [...components].sort((a, b) => b.length - a.length);
    const mainComponent = new Set(sorted[0]);

    for (let i = 1; i < sorted.length; i++) {
      const orphan = sorted[i];
      // Find closest pair between main component and orphan
      let minDist = Infinity;
      let bestMain: RouteNode | null = null;
      let bestOrphan: RouteNode | null = null;

      for (const nid of orphan) {
        const on = nodes.find((n) => n.id === nid);
        if (!on) continue;
        for (const mid of mainComponent) {
          const mn = nodes.find((n) => n.id === mid);
          if (!mn) continue;
          const dist = haversineKm(on.lat, on.lon, mn.lat, mn.lon);
          if (dist < minDist) {
            minDist = dist;
            bestMain = mn;
            bestOrphan = on;
          }
        }
      }

      if (bestMain && bestOrphan && minDist < 100) {
        addEdge(bestMain.id, bestOrphan.id, minDist, "feederroad", 4, 4, 3);
        console.log(`  Connected orphan component: ${bestOrphan.name} → ${bestMain.name} (${minDist.toFixed(1)}km)`);
        for (const nid of orphan) mainComponent.add(nid);
      }
    }
  }

  // 6. Enrich with elevation using Open-Meteo API (skip with --skip-elevation flag)
  if (!skipElevation) {
    console.log("\n  Enriching with elevation data (Open-Meteo)...");
    const batchSize = 30;
    const BATCH_DELAY_MS = 1100;
    let enriched = 0;

    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);
      const url =
        `https://api.open-meteo.com/v1/elevation?latitude=${batch.map((n) => n.lat.toFixed(5)).join(",")}` +
        `&longitude=${batch.map((n) => n.lon.toFixed(5)).join(",")}`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error(`  Elevation API error ${res.status} at batch ${i}`);
          continue;
        }
        const data = await res.json();
        if (data.elevation?.length) {
          for (let j = 0; j < batch.length && j < data.elevation.length; j++) {
            batch[j].elevationestimate = Math.round(data.elevation[j]);
            enriched++;
          }
        }
      } catch (e) {
        console.error(`  Elevation fetch failed at batch ${i}: ${e}`);
      }

      if (i + batchSize < nodes.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
      if ((i / batchSize) % 5 === 0) {
        process.stdout.write(`  Elevation: ${Math.min(i + batchSize, nodes.length)}/${nodes.length} (${enriched} enriched)\n`);
      }
    }
    process.stdout.write(`  Elevation: ${nodes.length}/${nodes.length} (${enriched} enriched)\n`);
  } else {
    console.log("\n  Skipping elevation enrichment (--skip-elevation)");
  }

  // 7. Export
  const output = { nodes, edges };
  const outPath = join(process.cwd(), "nepal-route-graph.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n=== Graph exported to ${outPath} ===`);
  console.log(`  Nodes: ${nodes.length}, Edges: ${edges.length}`);

  // 8. Generate DB seed SQL
  const sqlPath = join(process.cwd(), "scripts", "seed-full-graph.sql");
  const sql = generateSeedSQL(nodes, edges);
  writeFileSync(sqlPath, sql);
  console.log(`  Seed SQL exported to ${sqlPath}`);

  await prisma.$disconnect();
}

// ---- Helpers ----
function findConnectedComponents(nodes: RouteNode[], edges: RouteEdge[]): Map<number, number> {
  const adjacency = new Map<number, number[]>();
  for (const n of nodes) adjacency.set(n.id, []);

  for (const e of edges) {
    adjacency.get(e.from)?.push(e.to);
    adjacency.get(e.to)?.push(e.from);
  }

  const component = new Map<number, number>();
  let compId = 0;

  for (const n of nodes) {
    if (component.has(n.id)) continue;
    const stack = [n.id];
    component.set(n.id, compId);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const neighbor of adjacency.get(cur) ?? []) {
        if (!component.has(neighbor)) {
          component.set(neighbor, compId);
          stack.push(neighbor);
        }
      }
    }
    compId++;
  }

  return component;
}

function groupBy(componentMap: Map<number, number>): number[][] {
  const groups = new Map<number, number[]>();
  for (const [nodeId, compId] of componentMap) {
    if (!groups.has(compId)) groups.set(compId, []);
    groups.get(compId)!.push(nodeId);
  }
  return [...groups.values()];
}

function generateSeedSQL(nodes: RouteNode[], edges: RouteEdge[]): string {
  const lines: string[] = [];
  lines.push("-- Nepal Full Route Graph Seed");
  lines.push("-- Generated by build-full-nepal-graph.ts");
  lines.push("");
  lines.push("BEGIN;");
  lines.push("");
  lines.push("-- Clear existing data");
  lines.push("DELETE FROM route_edge;");
  lines.push("DELETE FROM route_node;");
  lines.push("");

  // Nodes
  lines.push("-- Insert route nodes");
  for (const n of nodes) {
    const nodeId = `node-${n.id}`;
    const rawType = n.type.toUpperCase();
    // Map to valid PlaceType enum values
    const type = rawType === "TOURISTSPOT" ? "TOWN"
      : rawType === "MOUNTAINPASS" ? "TOWN"
      : rawType === "HIGHWAYNODE" ? "ROUTE_NODE"
      : rawType === "JUNCTION" ? "JUNCTION"
      : rawType === "CITY" ? "TOWN"
      : rawType === "TOWN" ? "TOWN"
      : "ROUTE_NODE";
    const isHub = n.importance >= 4 ? "true" : "false";
    const name = n.name.replace(/'/g, "''");
    const elev = n.elevationestimate ?? "NULL";
    lines.push(
      `INSERT INTO route_node (id, name, type, latitude, longitude, "isHub", "isActive", "elevationM", "createdAt", "updatedAt")`
    );
    lines.push(
      `VALUES ('${nodeId}', '${name}', '${type}', ${n.lat}, ${n.lon}, ${isHub}, true, ${elev}, NOW(), NOW())`
    );
    lines.push(`ON CONFLICT (id) DO UPDATE SET latitude = ${n.lat}, longitude = ${n.lon};`);
  }

  lines.push("");

  // Edges
  lines.push("-- Insert route edges");
  let edgeCount = 0;
  for (const e of edges) {
    const fromId = `node-${e.from}`;
    const toId = `node-${e.to}`;
    const roadName = e.roadtype === "highway" ? "'Highway'" : e.roadtype === "feederroad" ? "'Feeder Road'" : e.roadtype === "mountainroad" ? "'Mountain Road'" : "'Valley Road'";
    lines.push(
      `INSERT INTO route_edge (id, "fromNodeId", "toNodeId", "distanceKm", "roadName", "isBidirectional")`
    );
    lines.push(
      `VALUES (gen_random_uuid()::text, '${fromId}', '${toId}', ${e.distancekm}, ${roadName}, true)`
    );
    lines.push(`ON CONFLICT ("fromNodeId", "toNodeId") DO NOTHING;`);
    edgeCount++;
    if (edgeCount % 500 === 0) {
      lines.push(`-- ${edgeCount} edges inserted so far`);
    }
  }

  lines.push("");
  lines.push("COMMIT;");
  lines.push("");
  lines.push(`-- Summary: ${nodes.length} nodes, ${edges.length} edges`);

  return lines.join("\n");
}

// Run
buildGraph().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
