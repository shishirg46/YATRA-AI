import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { buildAdjacency } from "@/lib/routing/adjacency";

async function main() {
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");

  // Find all components
  const visited = new Set<string>();
  const components: Array<{ nodes: string[]; ways: Set<string> }> = [];
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
    components.push({ nodes: compNodes, ways: compWays });
  }
  components.sort((a, b) => b.nodes.length - a.nodes.length);

  console.log(`Total components: ${components.length}`);
  console.log(`Largest: ${components[0].nodes.length} nodes, ${components[0].ways.size} ways`);
  console.log(`2nd: ${components[1]?.nodes.length} nodes, ${components[1]?.ways.size} ways`);
  console.log(`3rd: ${components[2]?.nodes.length} nodes, ${components[2]?.ways.size} ways`);

  // For each component, find the nearest endpoint from any other component
  const endpoints: Array<{ id: string; lat: number; lon: number; wayId: string; compIdx: number }> = [];
  for (let ci = 0; ci < components.length; ci++) {
    const comp = components[ci];
    for (const id of comp.nodes) {
      const edges = graph.adjacency.get(id) ?? [];
      const sameWayEdges = edges.filter(e => e.wayId !== "junction" && e.wayId !== "bridge");
      if (sameWayEdges.length <= 1) {
        const node = graph.nodes.get(id);
        if (node) {
          endpoints.push({ id, lat: node.lat, lon: node.lon, wayId: id.split(":")[0], compIdx: ci });
        }
      }
    }
  }

  console.log(`\nEndpoints total: ${endpoints.length}`);

  // For each component, find nearest endpoint from a different component
  let couldConnect = 0;
  let totalGap = 0;
  const gaps: number[] = [];
  
  for (let ci = 0; ci < Math.min(components.length, 100); ci++) {
    const compEndpoints = endpoints.filter(e => e.compIdx === ci);
    const otherEndpoints = endpoints.filter(e => e.compIdx !== ci);
    
    let minDist = Infinity;
    let minOther: typeof endpoints[0] | null = null;
    
    for (const ep of compEndpoints.slice(0, 20)) { // sample 20 per component
      for (const other of otherEndpoints) {
        const d = Math.sqrt((ep.lat - other.lat)**2 + (ep.lon - other.lon)**2);
        if (d < minDist) { minDist = d; minOther = other; }
      }
    }
    
    if (minOther) {
      const dKm = Math.sqrt((compEndpoints[0].lat - minOther.lat)**2 + (compEndpoints[0].lon - minOther.lon)**2) * 111;
      gaps.push(dKm);
      if (dKm < 0.5) { // within 500m
        couldConnect++;
        totalGap += dKm;
      }
    }
  }

  gaps.sort((a, b) => a - b);
  console.log(`\nGap analysis (sampled 100 components):`);
  console.log(`Components within 500m of another: ${couldConnect}`);
  if (gaps.length > 0) {
    console.log(`Min gap: ${(gaps[0] * 1000).toFixed(0)}m`);
    console.log(`Median gap: ${(gaps[Math.floor(gaps.length / 2)] * 1000).toFixed(0)}m`);
    console.log(`Max gap: ${(gaps[gaps.length - 1] * 1000).toFixed(0)}m`);
    // Histogram
    const buckets = [50, 100, 200, 500, 1000, 5000];
    for (const b of buckets) {
      const c = gaps.filter(g => g * 1000 <= b).length;
      console.log(`  ≤${b}m: ${c} (${(c/gaps.length*100).toFixed(1)}%)`);
    }
  }
}
main().catch(console.error);
