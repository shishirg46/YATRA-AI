import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { buildAdjacency } from "@/lib/routing/adjacency";

async function main() {
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");

  // Find component 2 (166 ways)
  const visited = new Set<string>();
  const components: { size: number; ways: Set<string> }[] = [];

  for (const id of graph.nodes.keys()) {
    if (visited.has(id)) continue;
    const queue = [id];
    visited.add(id);
    const compNodes: string[] = [];
    const compWays = new Set<string>();
    while (queue.length) {
      const c = queue.shift()!;
      compNodes.push(c);
      compWays.add(c.split(":")[0]);
      for (const e of graph.adjacency.get(c) ?? []) {
        if (!visited.has(e.to)) { visited.add(e.to); queue.push(e.to); }
      }
    }
    components.push({ size: compNodes.length, ways: compWays });
  }

  components.sort((a, b) => b.size - a.size);
  
  // For component 2 (index 1), check how junctions connect its ways
  const comp2 = components[1];
  console.log(`Component 2: ${comp2.size} nodes, ${comp2.ways.size} ways`);
  
  // For each way in this component, count how many junction connections it has
  const wayJunctionCount = new Map<string, number>();
  const waySameWayCount = new Map<string, number>();
  
  for (const wayId of comp2.ways) {
    // Find a node from this way
    let junctionEdges = 0;
    let sameWayEdges = 0;
    for (const [id, edges] of graph.adjacency) {
      if (!id.startsWith(wayId)) continue;
      for (const e of edges) {
        if (e.wayId === "junction") junctionEdges++;
        else sameWayEdges++;
      }
    }
    wayJunctionCount.set(wayId, junctionEdges);
    waySameWayCount.set(wayId, sameWayEdges);
  }

  const junctionArray = Array.from(wayJunctionCount.entries()).sort((a, b) => b[1] - a[1]);
  console.log("\nTop 10 ways by junction degree:");
  for (const [way, deg] of junctionArray.slice(0, 10)) {
    const name = Array.from(graph.nodes.values()).find(n => n.id.startsWith(way))?.name ?? "?";
    console.log(`  Way ${way} ("${name}"): ${deg} junction edges, ${waySameWayCount.get(way)} same-way edges`);
  }

  const bottom10 = junctionArray.filter(([_, d]) => d > 0).slice(-10);
  console.log("\nBottom 10 ways by junction degree:");
  for (const [way, deg] of bottom10) {
    console.log(`  Way ${way}: ${deg} junction edges`);
  }

  // Check how many ways have 0 junction connections
  const noJunction = Array.from(wayJunctionCount.entries()).filter(([_, d]) => d === 0).length;
  console.log(`\nWays with 0 junction connections: ${noJunction} / ${comp2.ways.size}`);

  // For component 1 (largest), show the 18 ways and their connections
  const comp1 = components[0];
  console.log(`\n\nComponent 1 (largest): ${comp1.size} nodes, ${comp1.ways.size} ways`);
  const c1Junction = new Map<string, number>();
  for (const wayId of comp1.ways) {
    let j = 0;
    for (const [id, edges] of graph.adjacency) {
      if (!id.startsWith(wayId)) continue;
      for (const e of edges) {
        if (e.wayId === "junction") j++;
      }
    }
    c1Junction.set(wayId, j);
  }
  const c1Arr = Array.from(c1Junction.entries()).sort((a, b) => b[1] - a[1]);
  console.log("All ways in component 1:");
  for (const [way, deg] of c1Arr) {
    const node = Array.from(graph.nodes.values()).find(n => n.id.startsWith(way));
    console.log(`  Way ${way.slice(0,25)} "${node?.name?.slice(0,25) ?? '?'}" class=${node?.roadClass} junction_deg=${deg}`);
  }
}
main().catch(console.error);
