import "dotenv/config";
import { buildAdjacency } from "../lib/routing/adjacency";

async function main() {
  const start = Date.now();
  const adj = await buildAdjacency();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  let totalEdges = 0;
  let maxEdges = 0;
  let junctionEdges = 0;
  let maxNodeId = "";

  for (const [id, edges] of adj.adjacency) {
    totalEdges += edges.length;
    const jc = edges.filter(e => e.wayId === "junction").length;
    junctionEdges += jc;
    if (edges.length > maxEdges) {
      maxEdges = edges.length;
      maxNodeId = id;
    }
  }

  console.log(`Build time:       ${elapsed}s`);
  console.log(`Nodes:            ${adj.nodes.size}`);
  console.log(`Total edges:      ${totalEdges}`);
  console.log(`Junction edges:   ${junctionEdges}`);
  console.log(`Avg edges/node:   ${(totalEdges / adj.nodes.size).toFixed(1)}`);
  console.log(`Max edges/node:   ${maxEdges} (${maxNodeId})`);
  console.log(`Graph version:    ${adj.graphVersion}`);
}

main().catch(console.error);
