import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { buildAdjacency } from "@/lib/routing/adjacency";

async function main() {
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");
  console.log("Nodes:", graph.nodes.size);

  // Sample nodes evenly from the graph for BFS seeds
  const allIds = Array.from(graph.nodes.keys());
  const sampleStep = Math.max(1, Math.floor(allIds.length / 200));
  const seeds = [];
  for (let i = 0; i < allIds.length; i += sampleStep) {
    seeds.push(allIds[i]);
  }
  console.log(`Sampling ${seeds.length} BFS seeds...`);

  // Find all connected components by BFS from every unvisited node
  const visited = new Set<string>();
  const components: number[] = [];

  for (const id of graph.nodes.keys()) {
    if (visited.has(id)) continue;
    
    // BFS
    const queue = [id];
    visited.add(id);
    let size = 0;
    while (queue.length) {
      const c = queue.shift()!;
      size++;
      for (const e of graph.adjacency.get(c) ?? []) {
        if (!visited.has(e.to)) { visited.add(e.to); queue.push(e.to); }
      }
    }
    components.push(size);
  }

  components.sort((a, b) => b - a);
  const compOver100 = components.filter(c => c >= 100);
  const compOver1000 = components.filter(c => c >= 1000);

  console.log(`Total components: ${components.length}`);
  console.log(`Largest component: ${components[0]} nodes (${(components[0] / graph.nodes.size * 100).toFixed(1)}%)`);
  console.log(`2nd largest: ${components[1] ?? 0}`);
  console.log(`3rd largest: ${components[2] ?? 0}`);
  console.log(`Components ≥100 nodes: ${compOver100.length}`);
  console.log(`Components ≥1000 nodes: ${compOver1000.length}`);
  console.log(`Components with 1 node (isolated): ${components.filter(c => c === 1).length}`);

  // Check component sizes distribution
  const buckets = [1, 2, 5, 10, 50, 100, 500];
  for (const b of buckets) {
    const count = components.filter(c => c === b).length;
    if (count > 0) console.log(`  Exactly ${b} nodes: ${count} components`);
  }
}
main().catch(console.error);
