/**
 * Check route alternatives for Urlarbari → Gaighat
 */
import { buildSegmentedRoute } from "@/lib/routing/route-service";
import { runRoute } from "@/scripts/route-engine";
import { abstractionFromRouteResult, classifyRouteIntent, type EdgeShape } from "@/lib/routing/route-abstraction";

async function main() {
  // Urlarbari → Gaighat
  const originLat = 26.66;
  const originLon = 87.27;
  const destLat = 26.798;
  const destLon = 86.941;

  const modes = ["fastest", "balanced", "highway-preferred"] as const;
  const seen = new Set<string>();

  console.log("=== Route Alternatives for Urlarbari → Gaighat ===\n");

  for (const mode of modes) {
    const result = runRoute({ startLat: originLat, startLon: originLon, endLat: destLat, endLon: destLon, mode });
    if (!result.found || result.statistics.totalDistanceKm <= 0) {
      console.log(`[${mode}] No path found`);
      continue;
    }

    const sig = result.roadSequence.map((rs: any) => rs.roadCode).join("|");
    if (seen.has(sig)) {
      console.log(`[${mode}] Duplicate (same as previous)`);
      continue;
    }
    seen.add(sig);

    const intent = classifyRouteIntent(result.statistics.metrics, mode);
    console.log(`\n${"=".repeat(70)}`);
    console.log(`Route via mode: ${mode}`);
    console.log(`Intent: ${intent}`);
    console.log(`Distance: ${result.statistics.totalDistanceKm.toFixed(1)} km`);
    console.log(`Road changes: ${result.statistics.roadChanges}`);
    console.log(`Metrics:`, JSON.stringify(result.statistics.metrics, null, 2));
    console.log(`\nRoad sequence:`);
    for (const rs of result.roadSequence) {
      console.log(`  ${rs.roadCode}: ${rs.fromPlace} → ${rs.toPlace} (${rs.edgeType})`);
    }
    console.log(`\nTrace edges (path):`);
    for (const edge of result.path.edges) {
      const rc = (edge as any).roadCode ?? (edge as any).fromRoad ?? "?";
      const dist = (edge as any).distanceKm ?? 0;
      const fromRoad = (edge as any).fromRoad;
      const isCross = fromRoad && !(edge as any).roadCode;
      if (isCross) {
        console.log(`  ${fromRoad} → ${(edge as any).toRoad} [CROSS] ${dist.toFixed(2)} km`);
      } else {
        console.log(`  ${rc} ${dist.toFixed(2)} km`);
      }
    }

    // Build abstraction to check highway segments
    const abstraction = abstractionFromRouteResult(
      result.path.nodes,
      result.path.edges as unknown as EdgeShape[],
      result.roadSequence,
      result.statistics,
      "Urlarbari",
      "Gaighat",
      intent,
    );

    console.log(`\nAbstraction highway segments:`);
    for (const hs of abstraction.highwaySegments) {
      console.log(`  ${hs.roadCode}: ${hs.fromPlace} → ${hs.toPlace} (${hs.distanceKm.toFixed(1)} km, ${hs.nodeCount} nodes)`);
    }
    console.log(`Road chain: ${abstraction.roadChain.join(" → ")}`);
  }
}

main().catch(console.error);
