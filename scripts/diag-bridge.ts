import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { buildAdjacency } from "@/lib/routing/adjacency";

async function main() {
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");

  // Count bridge edges
  let bridgeCount = 0;
  let junctionCount = 0;
  for (const [, edges] of graph.adjacency) {
    for (const e of edges) {
      if (e.wayId === "bridge") bridgeCount++;
      else if (e.wayId === "junction") junctionCount++;
    }
  }
  // Each edge pair creates two directed entries, so divide by 2
  console.log(`Bridge edges (undirected): ${bridgeCount / 2}`);
  console.log(`Junction edges (undirected): ${junctionCount / 2}`);
  console.log(`Total adjacency entries: ${Array.from(graph.adjacency.values()).reduce((s, e) => s + e.length, 0)}`);
}
main().catch(console.error);
