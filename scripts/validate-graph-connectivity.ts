import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { buildAdjacency } from "@/lib/routing/adjacency";
import { haversineKm } from "@/lib/routing/geo";

interface ValidationResult {
  totalNodes: number;
  componentCount: number;
  largestComponentRatio: number;
  largestComponentWays: number;
  orphanJunctionCount: number;
  totalJunctionCount: number;
  meanDegree: number;
  maxDegree: number;
  degreeHistogram: Record<string, number>;
  passed: boolean;
  warnings: string[];
}

async function validate(): Promise<ValidationResult> {
  const warnings: string[] = [];
  console.time("build");
  const graph = await buildAdjacency();
  console.timeEnd("build");

  const { nodes, adjacency } = graph;
  const totalNodes = nodes.size;

  // Find all connected components
  const visited = new Set<string>();
  const components: Array<{ size: number; ways: number }> = [];

  for (const id of nodes.keys()) {
    if (visited.has(id)) continue;
    const queue = [id];
    visited.add(id);
    let size = 0;
    const ways = new Set<string>();
    while (queue.length) {
      const c = queue.shift()!;
      size++;
      ways.add(c.split(":")[0]);
      for (const e of adjacency.get(c) ?? []) {
        if (!visited.has(e.to)) { visited.add(e.to); queue.push(e.to); }
      }
    }
    components.push({ size, ways: ways.size });
  }

  components.sort((a, b) => b.size - a.size);
  const largestComponentRatio = (components[0]?.size ?? 0) / totalNodes;
  const largestComponentWays = components[0]?.ways ?? 0;
  const componentCount = components.length;

  if (largestComponentRatio < 0.3) {
    warnings.push(`Largest component: ${(largestComponentRatio * 100).toFixed(1)}% (threshold: 30%)`);
  }

  // Degree statistics
  let degreeSum = 0;
  let maxDegree = 0;
  const degreeHistogram: Record<string, number> = {};

  for (const [, edges] of adjacency) {
    const deg = edges.length;
    degreeSum += deg;
    if (deg > maxDegree) maxDegree = deg;
    const bucket = deg <= 5 ? String(deg) : deg <= 10 ? "6-10" : deg <= 20 ? "11-20" : "21+";
    degreeHistogram[bucket] = (degreeHistogram[bucket] ?? 0) + 1;
  }

  const meanDegree = Math.round((degreeSum / totalNodes) * 100) / 100;

  // Orphan junctions
  let orphanJunctionCount = 0;
  let totalJunctionCount = 0;
  for (const node of nodes.values()) {
    if (node.isJunction) {
      totalJunctionCount++;
      const deg = adjacency.get(node.id)?.length ?? 0;
      if (deg < 2) orphanJunctionCount++;
    }
  }

  if (totalJunctionCount > 0 && orphanJunctionCount / totalJunctionCount > 0.05) {
    warnings.push(`${orphanJunctionCount}/${totalJunctionCount} junctions have degree < 2`);
  }

  const passed =
    (totalJunctionCount === 0 || orphanJunctionCount / totalJunctionCount <= 0.05);

  return {
    totalNodes,
    componentCount,
    largestComponentRatio,
    largestComponentWays,
    orphanJunctionCount,
    totalJunctionCount,
    meanDegree,
    maxDegree,
    degreeHistogram,
    passed,
    warnings,
  };
}

async function main() {
  console.log("Graph connectivity validation...\n");
  const r = await validate();

  console.log("\n=== GRAPH HEALTH REPORT ===");
  console.log(`Total nodes:         ${r.totalNodes}`);
  console.log(`Components:          ${r.componentCount}`);
  console.log(`Largest component:   ${(r.largestComponentRatio * 100).toFixed(1)}% (${r.largestComponentWays} ways)`);
  console.log(`Junctions:           ${r.totalJunctionCount} total, ${r.orphanJunctionCount} orphan`);
  console.log(`Mean degree:         ${r.meanDegree}`);
  console.log(`Max degree:          ${r.maxDegree}`);
  console.log(`Degree histogram:    ${JSON.stringify(r.degreeHistogram)}`);

  if (r.warnings.length > 0) {
    console.log(`\nWARNINGS:`);
    for (const w of r.warnings) console.log(`  - ${w}`);
  }

  console.log(`\nOverall: ${r.passed ? "PASS" : "FAIL"}`);
  process.exit(r.passed ? 0 : 1);
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
