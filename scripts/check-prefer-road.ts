/**
 * Check if preferRoad can generate distinct alternative routes
 */
import { runRoute } from "@/scripts/route-engine";
import { abstractionFromRouteResult, classifyRouteIntent } from "@/lib/routing/route-abstraction";

async function main() {
  const originLat = 26.66;
  const originLon = 87.27;
  const destLat = 26.798;
  const destLon = 86.941;

  // Try different preferRoad values to force different highway choices
  const configs = [
    { mode: "balanced" as const, preferRoad: "NH09" },
    { mode: "balanced" as const, preferRoad: "NH01" },
    { mode: "balanced" as const, preferRoad: "NH16" },
    { mode: "fastest" as const, preferRoad: "NH09" },
    { mode: "fastest" as const, preferRoad: "NH01" },
    { mode: "highway-preferred" as const, preferRoad: "NH09" },
    { mode: "highway-preferred" as const, preferRoad: "NH01" },
    { mode: "strict-road" as const, preferRoad: "NH09" },
    { mode: "strict-road" as const, preferRoad: "NH01" },
    { mode: "strict-road" as const, preferRoad: "NH16" },
    { mode: "balanced" as const, preferRoad: "NH08" },
    { mode: "fastest" as const, preferRoad: "NH08" },
  ];

  const seen = new Set<string>();

  for (const cfg of configs) {
    const result = runRoute({
      startLat: originLat, startLon: originLon,
      endLat: destLat, endLon: destLon,
      mode: cfg.mode,
      preferRoad: cfg.preferRoad,
    });
    if (!result.found || result.statistics.totalDistanceKm <= 0) continue;

    const sig = result.roadSequence.map((rs: any) => rs.roadCode).join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);

    console.log(`${"=".repeat(70)}`);
    console.log(`mode=${cfg.mode} preferRoad=${cfg.preferRoad}`);
    console.log(`Distance: ${result.statistics.totalDistanceKm.toFixed(1)} km`);
    console.log(`Road changes: ${result.statistics.roadChanges}`);
    console.log(`Road chain: ${result.roadSequence.map((rs: any) => rs.roadCode).join(" → ")}`);
    for (const rs of result.roadSequence) {
      console.log(`  ${rs.roadCode}: ${rs.fromPlace} → ${rs.toPlace}`);
    }
  }
}

main().catch(console.error);
