import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { buildAdjacency } from "@/lib/routing/adjacency";

async function main() {
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");

  // Find largest component by exhaustive BFS
  const visited = new Set<string>();
  const components: { size: number; ways: Set<string>; nodes: string[] }[] = [];

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
    components.push({ size: compNodes.length, ways: compWays, nodes: compNodes });
  }

  components.sort((a, b) => b.size - a.size);
  const largest = components[0];
  console.log(`Largest component: ${largest.size} nodes, ${largest.ways.size} ways`);

  // Show class breakdown of ways in largest component
  const classCount: Record<string, number> = {};
  for (const wayId of largest.ways) {
    const sampleNode = largest.nodes.find(n => n.startsWith(wayId));
    if (sampleNode) {
      const node = graph.nodes.get(sampleNode);
      if (node) {
        classCount[node.roadClass] = (classCount[node.roadClass] ?? 0) + 1;
      }
    }
  }
  console.log("Road class breakdown:", JSON.stringify(classCount));

  // Check a few sample components to understand composition
  for (let i = 1; i < Math.min(10, components.length); i++) {
    const c = components[i];
    const classes: Record<string, number> = {};
    for (const wayId of c.ways) {
      const sampleNode = c.nodes.find(n => n.startsWith(wayId));
      if (sampleNode) {
        const node = graph.nodes.get(sampleNode);
        if (node) classes[node.roadClass] = (classes[node.roadClass] ?? 0) + 1;
      }
    }
    console.log(`Component ${i}: ${c.size} nodes, ${c.ways.size} ways, classes: ${JSON.stringify(classes)}`);
  }

  // Check if there's ONE component that contains trunk roads
  const trunkComponents = components.filter(c => {
    const sampleNode = c.nodes.find(n => graph.nodes.get(n)?.roadClass === "trunk");
    return sampleNode !== undefined;
  });
  console.log(`\nComponents containing trunk roads: ${trunkComponents.length}`);
  console.log(`Largest trunk component: ${trunkComponents[0]?.size ?? 0} nodes`);
}
main().catch(console.error);
