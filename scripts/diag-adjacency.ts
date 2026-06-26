import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { buildAdjacency } from "@/lib/routing/adjacency";

async function main() {
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");
  console.log("Nodes:", graph.nodes.size);

  // Find max-degree node
  let maxDeg = 0, seed = "";
  for (const [id, edges] of graph.adjacency) {
    if (edges.length > maxDeg) { maxDeg = edges.length; seed = id; }
  }
  console.log("Max degree:", maxDeg, "seed:", seed.slice(0,25));

  const seedNode = graph.nodes.get(seed);
  console.log("Seed node:", JSON.stringify(seedNode));

  const seedEdges = graph.adjacency.get(seed) ?? [];
  console.log("Seed edges:", seedEdges.length);
  // Categorize edges
  const sameWay = seedEdges.filter(e => e.wayId !== "junction");
  const junction = seedEdges.filter(e => e.wayId === "junction");
  console.log("  Same way edges:", sameWay.length);
  console.log("  Junction edges:", junction.length);
  console.log("  Junction targets:", junction.map(e => e.to.slice(0,20)).join(", "));

  // For each junction neighbor, check their way size
  for (const j of junction.slice(0, 5)) {
    const neighbor = graph.nodes.get(j.to);
    const neighborEdges = graph.adjacency.get(j.to) ?? [];
    const neighborJunctionEdges = neighborEdges.filter(e => e.wayId === "junction").length;
    console.log(`  Neighbor ${j.to.slice(0,20)}: deg=${neighborEdges.length}, junction_deg=${neighborJunctionEdges}`);
  }

  // BFS from seed
  const visited = new Set<string>();
  const queue = [seed];
  visited.add(seed);
  while (queue.length) {
    const c = queue.shift()!;
    for (const e of graph.adjacency.get(c) ?? []) {
      if (!visited.has(e.to)) { visited.add(e.to); queue.push(e.to); }
    }
  }
  console.log("BFS reachable:", visited.size);

  // Check how many unique way IDs are in the reachable set
  const wayIds = new Set<string>();
  const coordClusters = new Map<string, number>();
  for (const id of visited) {
    const node = graph.nodes.get(id);
    if (node) {
      // determine way ID from node ID (format: wayId:seq)
      const wayId = id.split(":")[0];
      wayIds.add(wayId);
      const key = `${Math.round(node.lat / 0.0001) * 0.0001},${Math.round(node.lon / 0.0001) * 0.0001}`;
      coordClusters.set(key, (coordClusters.get(key) ?? 0) + 1);
    }
  }
  console.log("Unique ways in BFS:", wayIds.size);
  console.log("Unique coord clusters in BFS:", coordClusters.size);

  // Also check total unique ways
  const allWayIds = new Set<string>();
  for (const id of graph.nodes.keys()) {
    allWayIds.add(id.split(":")[0]);
  }
  console.log("Total unique ways in graph:", allWayIds.size);

  // Check total junction clusters
  const jClusters = new Map<string, number>();
  for (const node of graph.nodes.values()) {
    if (node.isJunction) {
      const key = `${Math.round(node.lat / 0.0001) * 0.0001},${Math.round(node.lon / 0.0001) * 0.0001}`;
      jClusters.set(key, (jClusters.get(key) ?? 0) + 1);
    }
  }
  const multi = Array.from(jClusters.values()).filter(c => c >= 2).length;
  console.log(`Junction clusters: ${jClusters.size} total, ${multi} with ≥2 nodes`);
}
main().catch(console.error);
