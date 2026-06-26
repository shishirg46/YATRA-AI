import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { buildAdjacency } from "@/lib/routing/adjacency";
import { haversineKm } from "@/lib/routing/geo";

async function main() {
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");

  // Find all endpoints (degree ≤ 1 considering only same-way edges)
  const endpoints: Array<{ id: string; lat: number; lon: number; wayId: string }> = [];
  for (const [id, edges] of graph.adjacency) {
    const sameWayEdges = edges.filter(e => e.wayId !== "junction" && e.wayId !== "bridge");
    if (sameWayEdges.length <= 1) {
      const node = graph.nodes.get(id);
      if (node) {
        endpoints.push({ id, lat: node.lat, lon: node.lon, wayId: id.split(":")[0] });
      }
    }
  }
  console.log(`Endpoints: ${endpoints.length}`);

  // Spatial grouping in 0.01° grid cells (~1km)
  const cells = new Map<string, typeof endpoints>();
  for (const ep of endpoints) {
    const key = `${Math.round(ep.lat / 0.01)},${Math.round(ep.lon / 0.01)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(ep);
  }
  console.log(`Grid cells: ${cells.size}`);

  // For each cell, check distances to endpoints in the same and adjacent cells
  let closePairs = 0;
  let sumDist = 0;
  const dists: number[] = [];
  const thresholdKm = 0.05; // 50m

  for (const [key, eps] of cells) {
    const [clat, clon] = key.split(",").map(Number);
    const neighborKeys = [key];
    for (const dlat of [-1, 0, 1]) {
      for (const dlon of [-1, 0, 1]) {
        if (dlat === 0 && dlon === 0) continue;
        neighborKeys.push(`${clat + dlat},${clon + dlon}`);
      }
    }

    const neighbors: typeof endpoints = [];
    for (const nk of neighborKeys) {
      const cell = cells.get(nk);
      if (cell) neighbors.push(...cell);
    }

    for (let i = 0; i < eps.length; i++) {
      for (let j = 0; j < neighbors.length; j++) {
        const a = eps[i];
        const b = neighbors[j];
        if (a.id <= b.id) continue;
        if (a.wayId === b.wayId) continue;

        const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
        if (dist < thresholdKm) {
          closePairs++;
          sumDist += dist;
          dists.push(dist);
        }
      }
    }
  }

  dists.sort((a, b) => a - b);
  console.log(`Close endpoint pairs (<50m): ${closePairs}`);
  if (dists.length > 0) {
    console.log(`Min dist: ${(dists[0] * 1000).toFixed(1)}m`);
    console.log(`Median dist: ${(dists[Math.floor(dists.length / 2)] * 1000).toFixed(1)}m`);
    console.log(`Max dist: ${(dists[dists.length - 1] * 1000).toFixed(1)}m`);
    console.log(`Mean dist: ${(sumDist / dists.length * 1000).toFixed(1)}m`);
    
    // Histogram
    const h = [5, 10, 20, 30, 50];
    for (const b of h) {
      const c = dists.filter(d => d * 1000 <= b).length;
      console.log(`  ≤${b}m: ${c} (${(c/dists.length*100).toFixed(1)}%)`);
    }
  }
}
main().catch(console.error);
