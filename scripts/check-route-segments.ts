/**
 * Quick script: check what segments are produced for Morang → Gaighat
 * via both DOR and non-DOR paths.
 */
import { buildSegmentedRoute } from "@/lib/routing/route-service";

async function main() {
  // Morang → Gaighat approximate coordinates
  const originLat = 26.457;
  const originLon = 87.279;
  const destLat = 26.798;
  const destLon = 86.941;

  console.log("=== DOR path ===");
  const built = await buildSegmentedRoute({
    originLat,
    originLon,
    originName: "Morang",
    destinationLat: destLat,
    destinationLon: destLon,
    destinationName: "Gaighat",
    vehicle: "car",
    dorRoutingMode: "balanced",
  });

  console.log("Provenance:", JSON.stringify(built.provenance, null, 2));
  console.log("Source:", built.source);
  console.log("Distance:", built.distance, "m");
  console.log("Duration:", built.duration, "s");
  console.log("");

  if (built.abstraction?.highwaySegments?.length) {
    console.log("HIGHWAY SEGMENTS (abstraction):");
    for (const hs of built.abstraction.highwaySegments) {
      console.log(`  ${hs.roadCode}: ${hs.fromPlace} → ${hs.toPlace} (${hs.distanceKm.toFixed(1)} km, ${hs.nodeCount} nodes)`);
    }
    console.log("");
    console.log("Road chain:", built.abstraction.roadChain.join(" → "));
  } else {
    console.log("No abstraction.highwaySegments");
  }

  console.log("");

  // Also check raw segments for comparison
  if (built.segments.length > 0) {
    console.log("RAW SEGMENTS (built.segments) — first 10:");
    for (const s of built.segments.slice(0, 10)) {
      console.log(`  ${s.from.name} → ${s.to.name} (${(s.distance / 1000).toFixed(2)} km)`);
    }
    if (built.segments.length > 10) {
      console.log(`  ... and ${built.segments.length - 10} more`);
    }
  }

  console.log("");
  console.log("=== Non-DOR path (OSRM) ===");
  const osrmBuilt = await buildSegmentedRoute({
    originLat,
    originLon,
    originName: "Morang",
    destinationLat: destLat,
    destinationLon: destLon,
    destinationName: "Gaighat",
    vehicle: "car",
  });

  console.log("Provenance:", JSON.stringify(osrmBuilt.provenance, null, 2));
  console.log("Source:", osrmBuilt.source);
  if (osrmBuilt.abstraction?.highwaySegments?.length) {
    console.log("HIGHWAY SEGMENTS:");
    for (const hs of osrmBuilt.abstraction.highwaySegments) {
      console.log(`  ${hs.roadCode}: ${hs.fromPlace} → ${hs.toPlace} (${hs.distanceKm.toFixed(1)} km)`);
    }
  } else {
    console.log("No abstraction.highwaySegments (expected — OSRM doesn't produce abstraction)");
  }
  if (osrmBuilt.segments.length > 0) {
    console.log("RAW SEGMENTS — first 10:");
    for (const s of osrmBuilt.segments.slice(0, 10)) {
      console.log(`  ${s.from.name} → ${s.to.name} (${(s.distance / 1000).toFixed(2)} km)`);
    }
    if (osrmBuilt.segments.length > 10) {
      console.log(`  ... and ${osrmBuilt.segments.length - 10} more`);
    }
  }
}

main().catch(console.error);
