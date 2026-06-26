import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { buildRouteUltraFast } from "@/lib/route-intelligence";

async function main() {
  console.log("[DIAG] Starting Ratuwamai-7 → Hile via buildRouteUltraFast");
  const startTime = Date.now();

  try {
    const result = await buildRouteUltraFast(
      { lat: 26.68, lon: 87.32, name: "Ratuwamai-7" },
      { lat: 27.042, lon: 87.35, name: "Hile" },
      new Date().toISOString().slice(0, 10),
      { vehicle: "car" },
    );
    console.log("[DIAG] Completed in", Date.now() - startTime, "ms");

    for (const route of result.routes) {
      console.log("[DIAG] Route name:", route.name);
      console.log("[DIAG] Route source:", route.source);
      console.log("[DIAG] Route distance:", route.distance);
      console.log("[DIAG] Segments:", JSON.stringify(route.segments.map(s => ({
        from: s.startPoint.name,
        to: s.endPoint.name,
        idx: s.index,
      }))));
      console.log("[DIAG] Waypoints:", JSON.stringify(route.waypoints.map(w => w.name).filter(Boolean)));
      console.log("[DIAG] Encoded polyline length:", route.encodedPolyline?.length ?? 0);
    }
  } catch (err) {
    console.log("[DIAG] Failed after", Date.now() - startTime, "ms");
    console.error("[DIAG] Error:", err);
  }
}

main();
