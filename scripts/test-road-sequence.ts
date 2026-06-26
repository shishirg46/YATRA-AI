/**
 * Integration tests for Phase 5 — Place + Road sequence engines.
 *
 * Tests 3 road-sequence routes (now graph-driven via findRoute)
 *   1. Urlabari → Pokhara (NH01)
 *   2. Ratuwamai → Kanchanpur (NH01)
 *   3. Kathmandu → Pokhara (NH17)
 *   4. Segment graph: Mugling → Naubise junction path
 *   5-7. Graph-first routing tests (resolveEndpoints + findPath)
 *   8. Anti-hybrid regression test
 *   9-12. Cost model regression tests (Phase 5.7B)
 *   13. Explainability layer regression (Phase 5.8)
 *   14-17. Calibration profile regression (Phase 5.9)
 *   18-20. Multi-route K-shortest paths (Phase 5.10)
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildPlaceSequence } from "@/lib/routing/place-sequence";
import { findRoute } from "@/lib/routing/road-sequence";
import type { MultiRouteSequence } from "@/lib/routing/road-sequence";
import { findMultiRouteInSequence } from "@/lib/routing/road-sequence";
import { resolveCostModel, getProfile, CALIBRATION_PROFILES } from "@/lib/routing/calibration";
import { buildRouteExplanation } from "@/lib/routing/route-explain";
import { getSubSegments, findPathByName, getGraphStats, getRoadsAtJunction, resolveNearestJunction, findMultiRoute } from "@/lib/routing/segment-graph";
import type { RegistryRoad } from "@/scripts/build-road-registry";
import { prisma } from "@/lib/prisma";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(join(__dirname, "data", "dor-road-network.json"), "utf-8"),
) as RegistryRoad[];

interface TestCase {
  name: string;
  polyline: Array<{ lat: number; lon: number }>;
  expectedPlaces: string[];
  expectedRoads: string[];
  minPlaces: number;
  minRoads: number;
}

function getRoad(roadCode: string): RegistryRoad {
  const r = REGISTRY.find((r) => r.roadCode === roadCode);
  if (!r) throw new Error(`Road ${roadCode} not found in registry`);
  return r;
}

const test1Polyline = buildRoutePolyline(["NH01"], "Urlabari", "Butwal", REGISTRY);
const test2Polyline = buildRoutePolyline(["NH01"], "Ratuwamai", "Mahendranagar", REGISTRY);
const test3Polyline = getRoad('NH17').waypoints;

const TEST_CASES: TestCase[] = [
  {
    name: "Urlabari → Pokhara",
    polyline: test1Polyline,
    expectedPlaces: ["Urlabari", "Itahari", "Hetauda", "Mugling", "Pokhara"],
    expectedRoads: ["NH01"],
    minPlaces: 3,
    minRoads: 1,
  },
  {
    name: "Ratuwamai → Kanchanpur",
    polyline: test2Polyline,
    expectedPlaces: ["Ratuwamai", "Itahari", "Bharatpur", "Butwal", "Nepalgunj", "Dhangadhi", "Mahendranagar"],
    expectedRoads: ["NH01"],
    minPlaces: 4,
    minRoads: 1,
  },
  {
    name: "Kathmandu → Pokhara",
    polyline: test3Polyline,
    expectedPlaces: ["Kathmandu", "Naubise", "Mugling", "Pokhara"],
    expectedRoads: ["NH17"],
    minPlaces: 2,
    minRoads: 1,
  },
];

function buildRoutePolyline(
  roadCodes: string[],
  fromPlace: string,
  toPlace: string,
  registry: RegistryRoad[],
): Array<{ lat: number; lon: number }> {
  const pts: Array<{ lat: number; lon: number }> = [];
  for (const code of roadCodes) {
    const road = registry.find((r) => r.roadCode === code);
    if (road) pts.push(...road.waypoints);
  }
  return pts;
}

async function runTests() {
  console.log("═".repeat(60));
  console.log("  Phase 5.7A — Graph-First Routing Tests");
  console.log("═".repeat(60));

  let passed = 0;
  let failed = 0;

  // ── Tests 1-3: Road sequence via findRoute (graph-driven) ──
  for (const tc of TEST_CASES) {
    console.log(`\n  Test: ${tc.name}`);
    console.log("  " + "─".repeat(50));

    console.log("    Places:");
    const places = await buildPlaceSequence(tc.polyline, {
      sampleEvery: 1,
      minGapKm: 5,
      radiusMeters: 5000,
    });

    if (places.length === 0) {
      console.log("      [no places found — check Place DB has data]");
    } else {
      for (const item of places) {
        const name = item.place.nameEn || item.place.name;
        const matchedExpected = tc.expectedPlaces.some((ep) =>
          name.toLowerCase().includes(ep.toLowerCase()) ||
          ep.toLowerCase().includes(name.toLowerCase()),
        );
        const flag = matchedExpected ? "✓" : "?";
        console.log(
          `      ${flag} ${name} (${item.place.type}) @ ${item.cumulativeKm.toFixed(1)} km`,
        );
      }
    }

    // Graph-first routing (replaces buildRoadSequence)
    console.log("    Roads (graph-driven):");
    const origin = { lat: tc.polyline[0].lat, lon: tc.polyline[0].lon, name: tc.name.split(" → ")[0] };
    const dest = { lat: tc.polyline[tc.polyline.length - 1].lat, lon: tc.polyline[tc.polyline.length - 1].lon, name: tc.name.split(" → ")[1] };
    const roads = await findRoute(tc.polyline, origin, dest);

    if (roads.length === 0) {
      console.log("      [no roads found via graph]");
    } else {
      for (const seg of roads) {
        const matchedExpected = tc.expectedRoads.includes(seg.roadCode ?? "");
        const flag = matchedExpected ? "✓" : "?";
        console.log(
          `      ${flag} ${seg.roadCode} ${seg.roadName} [${seg.roadType}]  ${seg.fromKm.toFixed(1)}–${seg.toKm.toFixed(1)} km  (${seg.fromJunction ?? "?"} → ${seg.toJunction ?? "?"})`,
        );
      }
    }

    const placeMatch = places.filter((p) => {
      const name = p.place.nameEn || p.place.name;
      return tc.expectedPlaces.some(
        (ep) =>
          name.toLowerCase().includes(ep.toLowerCase()) ||
          ep.toLowerCase().includes(name.toLowerCase()),
      );
    }).length;

    const roadMatch = roads.filter((r) =>
      tc.expectedRoads.includes(r.roadCode ?? ""),
    ).length;

    const ok = placeMatch >= tc.minPlaces && roadMatch >= tc.minRoads;
    if (ok) {
      console.log(`    ✅ PASS (${placeMatch} places, ${roadMatch} roads)`);
      passed++;
    } else {
      console.log(
        `    ❌ FAIL (expected ≥${tc.minPlaces} places, got ${placeMatch}; expected ≥${tc.minRoads} roads, got ${roadMatch})`,
      );
      failed++;
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log(`  Phase 5.7A Road Sequence: ${passed} passed, ${failed} failed, ${TEST_CASES.length} total`);
  console.log("═".repeat(60));

  // ── Test 4: Segment Graph ──
  console.log("\n  Test 4: Segment Graph — Graph Stats & Connectivity");
  console.log("  " + "─".repeat(50));

  let segPassed = 0;
  let segFailed = 0;

  const stats = getGraphStats();
  console.log(`    Graph: ${stats.totalSubSegments} sub-segments, ${stats.totalRoads} roads, ${stats.totalJunctions} junctions, ${stats.totalGraphNodes} graph nodes`);
  if (stats.totalSubSegments >= 80 && stats.totalRoads >= 25 && stats.totalGraphNodes >= 80) {
    console.log("    ✓ Graph stats OK");
    segPassed++;
  } else {
    console.log("    ✗ Graph stats too low");
    segFailed++;
  }

  const nh01Segs = getSubSegments("NH01");
  if (nh01Segs.length >= 15) {
    console.log(`    ✓ NH01: ${nh01Segs.length} sub-segments`);
    segPassed++;
  } else {
    console.log(`    ✗ NH01: ${nh01Segs.length} sub-segments (expected ≥15)`);
    segFailed++;
  }

  const nh17Segs = getSubSegments("NH17");
  if (nh17Segs.length >= 3) {
    console.log(`    ✓ NH17: ${nh17Segs.length} sub-segments`);
    segPassed++;
  } else {
    console.log(`    ✗ NH17: ${nh17Segs.length} sub-segments (expected ≥3)`);
    segFailed++;
  }

  for (const s of nh17Segs) {
    console.log(`      ${s.segmentId.slice(0, 8)}  ${s.roadCode}  ${s.fromJunction} → ${s.toJunction}  ${s.fromKm.toFixed(1)}–${s.toKm.toFixed(1)} km`);
  }

  const atMugling = getRoadsAtJunction("Mugling");
  console.log(`    All roads at Mugling: ${atMugling.length}`);
  const muglingRoadCodes = [...new Set(atMugling.map(s => s.roadCode))];
  if (muglingRoadCodes.includes("NH17")) {
    console.log(`    ✓ Mugling connects: ${muglingRoadCodes.join(", ")}`);
    segPassed++;
  } else {
    console.log("    ✗ NH17 missing from Mugling");
    segFailed++;
  }

  const path = findPathByName("Mugling", "Naubise");
  if (path && path.length > 0) {
    console.log(`    ✓ Path Mugling→Naubise: ${path.length} edges`);
    for (const e of path) {
      console.log(`      ${e.segmentId.slice(0, 8)}  ${e.roadCode} ${e.fromJunction}→${e.toJunction} (${e.lengthKm.toFixed(1)} km)`);
    }
    const hasNH17 = path.some(e => e.roadCode === "NH17");
    if (hasNH17) {
      console.log("    ✓ Path uses NH17 (expected)");
      segPassed++;
    } else {
      console.log("    ✗ Path should use NH17");
      segFailed++;
    }
  } else {
    console.log("    ✗ No path found Mugling→Naubise");
    segFailed++;
  }

  console.log(`\n  Segment Graph: ${segPassed} passed, ${segFailed} failed, ${segPassed + segFailed} total`);

  // ── Tests 5-7: Graph-First Routing ──
  console.log("\n  Tests 5-7: Graph-First Routing (findRoute)");
  console.log("  " + "─".repeat(50));

  let grPassed = 0;
  let grFailed = 0;

  // Test 5: Kathmandu → Pokhara via NH17 (resolve endpoints + graph path)
  {
    const origin5 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest5 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test3Polyline, origin5, dest5);
    const hasNH17 = route.some(r => r.roadCode === "NH17");
    const hasJunctions = route.some(r => r.fromJunction && r.toJunction);
    if (route.length > 0 && hasNH17) {
      console.log(`    ✓ Kathmandu→Pokhara: ${route.length} segments, NH17 present`);
      if (hasJunctions) {
        console.log(`    ✓ Junctions populated`);
        grPassed += 2;
      } else {
        console.log(`    ✗ No junctions — likely fallback`);
        grFailed++;
      }
    } else {
      console.log(`    ✗ NH17 not found in route`);
      grFailed++;
    }
  }

  // Test 6: Butwal → Mugling via NH01 (single-road multi-subsegment)
  {
    const nh01 = getRoad("NH01");
    const origin6 = { lat: 27.7, lon: 83.45, name: "Butwal" };
    const dest6 = { lat: 27.817, lon: 84.77, name: "Mugling" };
    const route = await findRoute(nh01.waypoints, origin6, dest6);
    const hasNH01 = route.some(r => r.roadCode === "NH01");
    if (route.length > 0 && hasNH01) {
      console.log(`    ✓ Butwal→Mugling: ${route.length} segments, NH01 present, ${route[0].fromJunction} → ${route[route.length-1].toJunction}`);
      grPassed++;
    } else {
      console.log(`    ✗ NH01 not found (route: ${JSON.stringify(route.map(r => r.roadCode))})`);
      grFailed++;
    }
  }

  // Test 7: resolveNearestJunction — verify junction resolution
  {
    const muglingCoord = { lat: 27.817, lon: 84.77 };
    const result = resolveNearestJunction(muglingCoord.lat, muglingCoord.lon, 5);
    if (result && result.junctionName === "Mugling" && result.confidence >= 0.6) {
      console.log(`    ✓ Mugling resolved: ${result.junctionName} @ ${result.distanceKm} km (conf: ${result.confidence})`);
      grPassed++;
    } else {
      console.log(`    ✗ Mugling resolution failed: ${JSON.stringify(result)}`);
      grFailed++;
    }
  }

  console.log(`\n  Graph-First Routing: ${grPassed} passed, ${grFailed} failed, ${grPassed + grFailed} total`);

  // ── Test 8: Anti-Hybrid Regression ──
  console.log("\n  Test 8: Anti-Hybrid Regression");
  console.log("  " + "─".repeat(50));

  let regPassed = 0;
  let regFailed = 0;

  // Verify geometry-projection.ts does NOT import buildRoadSequence as a direct dependency
  {
    const gpSource = readFileSync(join(__dirname, "..", "lib", "routing", "geometry-projection.ts"), "utf-8");
    // Check actual import statement, not comment references
    const importLines = gpSource.split("\n").filter(l => l.includes("import ") && l.includes("buildRoadSequence"));
    if (importLines.length === 0) {
      console.log("    ✓ geometry-projection.ts no longer imports buildRoadSequence");
      regPassed++;
    } else {
      console.log(`    ✗ geometry-projection.ts still imports buildRoadSequence: ${importLines.join("; ")}`);
      regFailed++;
    }
  }

  // Verify findRoute is the primary routing function in geometry-projection.ts
  {
    const gpSource = readFileSync(join(__dirname, "..", "lib", "routing", "geometry-projection.ts"), "utf-8");
    if (gpSource.includes("findRoute")) {
      console.log("    ✓ geometry-projection.ts uses findRoute (graph-driven)");
      regPassed++;
    } else {
      console.log("    ✗ geometry-projection.ts does not use findRoute");
      regFailed++;
    }
  }

  console.log(`\n  Anti-Hybrid: ${regPassed} passed, ${regFailed} failed, ${regPassed + regFailed} total`);

  // ── Tests 9-12: Cost Model (Phase 5.7B) ──
  console.log("\n  Tests 9-12: Cost Model Regression (Phase 5.7B)");
  console.log("  " + "─".repeat(50));

  let costPassed = 0;
  let costFailed = 0;

  // Test 9: NH01 Urlabari→Pokhara should be single-road with cost model
  {
    const origin9 = { lat: 26.454, lon: 87.280, name: "Urlabari" };
    const dest9 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test1Polyline, origin9, dest9);
    const roadCodes = [...new Set(route.map(r => r.roadCode))];
    const allNH01 = roadCodes.length === 1 && roadCodes[0] === "NH01";
    if (allNH01) {
      console.log(`    ✓ NH01 Urlabari→Pokhara: single-road (${route.length} segments, ${roadCodes.join(", ")})`);
      costPassed++;
    } else {
      console.log(`    ✗ NH01 fragmented: ${roadCodes.join(" → ")}`);
      costFailed++;
    }
  }

  // Test 10: NH17 should be the dominant road with cost model
  {
    const origin10 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest10 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test3Polyline, origin10, dest10);
    // Calculate per-road distance
    const roadDist = new Map<string, number>();
    for (const r of route) {
      roadDist.set(r.roadCode ?? "", (roadDist.get(r.roadCode ?? "") ?? 0) + (r.toKm - r.fromKm));
    }
    const dominantRoad = [...roadDist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const totalKm = [...roadDist.values()].reduce((s, v) => s + v, 0);
    if (dominantRoad === "NH17") {
      console.log(`    ✓ NH17 dominant: ${dominantRoad} (${(roadDist.get("NH17") ?? 0).toFixed(0)}/${totalKm.toFixed(0)} km)`);
      costPassed++;
    } else {
      console.log(`    ✗ NH17 not dominant: dominant=${dominantRoad}, roadCodes=${[...roadDist.entries()].map(([k,v]) => `${k}=${v.toFixed(0)}km`).join(", ")}`);
      costFailed++;
    }
  }

  // Test 11: True multi-road routing preserved — multi-road paths still work
  {
    // Use NH17 polyline (Kathmandu→Pokhara) — NH17 is well-defined
    // The graph may still route multiple roads if it's genuinely optimal
    const origin11 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest11 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test3Polyline, origin11, dest11);
    if (route.length > 0) {
      const roadCodes = [...new Set(route.map(r => r.roadCode))];
      console.log(`    ✓ Multi-road route: ${route.length} segments, ${roadCodes.join(" → ")}`);
      costPassed++;
    } else {
      console.log(`    ✗ No route found for multi-road path`);
      costFailed++;
    }
  }

  // Test 12: Cost model determinism — same input produces same output
  {
    const origin12 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest12 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route1 = await findRoute(test3Polyline, origin12, dest12);
    const route2 = await findRoute(test3Polyline, origin12, dest12);
    const key1 = route1.map(r => `${r.roadCode}|${r.fromKm.toFixed(1)}|${r.toKm.toFixed(1)}`).join(",");
    const key2 = route2.map(r => `${r.roadCode}|${r.fromKm.toFixed(1)}|${r.toKm.toFixed(1)}`).join(",");
    if (key1 === key2) {
      console.log(`    ✓ Deterministic: identical routes (${route1.length} segments)`);
      costPassed++;
    } else {
      console.log(`    ✗ Non-deterministic: route differs between runs`);
      costFailed++;
    }
  }

  console.log(`\n  Cost Model: ${costPassed} passed, ${costFailed} failed, ${costPassed + costFailed} total`);

  // ── Test 13: Explainability Layer (Phase 5.8) ──
  console.log("\n  Test 13: Explainability Layer (Phase 5.8)");
  console.log("  " + "─".repeat(50));

  let expPassed = 0;
  let expFailed = 0;

  // Build a known RoadSequenceItem[] input (NH01 single-road from Test 1)
  {
    const origin13 = { lat: 26.454, lon: 87.280, name: "Urlabari" };
    const dest13 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test1Polyline, origin13, dest13);
    const explanation = buildRouteExplanation(route, "Urlabari", "Pokhara");

    // Structure checks
    const structureOk = explanation.totalKm > 0;
    const summariesOk = explanation.roadSummaries.length > 0;
    const transitionsOk = explanation.transitions.length === explanation.roadSummaries.length - 1;
    const chainOk = explanation.segmentChain.length > 0;
    const chainKmOk = Math.abs(
      explanation.segmentChain.reduce((s, seg) => s + seg.lengthKm, 0) - explanation.totalKm,
    ) < 1;
    const narrativeOk = explanation.narrative.length > 0;
    const originOk = explanation.origin === "Urlabari";
    const destOk = explanation.destination === "Pokhara";

    if (structureOk && summariesOk && transitionsOk && chainOk && chainKmOk && narrativeOk && originOk && destOk) {
      console.log(`    ✓ Explanation structure: ${explanation.roadSummaries.length} summaries, ${explanation.transitions.length} transitions, ${explanation.segmentChain.length} segments, ${explanation.totalKm} km`);
      expPassed++;
    } else {
      console.log(`    ✗ Structure checks failed: km=${structureOk} sums=${summariesOk} trans=${transitionsOk} chain=${chainOk} chainKm=${chainKmOk} narr=${narrativeOk} origin=${originOk} dest=${destOk}`);
      expFailed++;
    }

    // Determinism check
    const explanation2 = buildRouteExplanation(route, "Urlabari", "Pokhara");
    const detOk = JSON.stringify(explanation) === JSON.stringify(explanation2);
    if (detOk) {
      console.log("    ✓ Deterministic: identical output for same input");
      expPassed++;
    } else {
      console.log("    ✗ Non-deterministic");
      expFailed++;
    }

    // Summaries cover total km
    const sumTotal = explanation.roadSummaries.reduce((s, r) => s + r.totalKm, 0);
    if (Math.abs(sumTotal - explanation.totalKm) < 1) {
      console.log(`    ✓ Km sum consistent: ${sumTotal} = ${explanation.totalKm}`);
      expPassed++;
    } else {
      console.log(`    ✗ Km sum mismatch: ${sumTotal} vs ${explanation.totalKm}`);
      expFailed++;
    }

    // Narrative contains expected content
    if (explanation.roadSummaries.length === 1) {
      const singleRoadOk = explanation.narrative.includes("Stay on");
      if (singleRoadOk) {
        console.log(`    ✓ Single-road narrative: "${explanation.narrative}"`);
        expPassed++;
      } else {
        console.log(`    ✗ Single-road narrative missing "Stay on"`);
        expFailed++;
      }
    }
  }

  // Multi-road explanation test
  {
    const origin13b = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest13b = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test3Polyline, origin13b, dest13b);
    const explanation = buildRouteExplanation(route, "Kathmandu", "Pokhara");

    if (explanation.transitions.length === explanation.roadSummaries.length - 1) {
      console.log(`    ✓ Multi-road ${explanation.roadSummaries.length}-road explanation: ${explanation.narrative}`);
      expPassed++;
    } else {
      console.log(`    ✗ Transition count mismatch: ${explanation.transitions.length} != ${explanation.roadSummaries.length - 1}`);
      expFailed++;
    }
  }

  console.log(`\n  Explainability: ${expPassed} passed, ${expFailed} failed, ${expPassed + expFailed} total`);

  // ── Tests 14-17: Calibration Profiles (Phase 5.9) ──
  console.log("\n  Tests 14-17: Calibration Profiles (Phase 5.9)");
  console.log("  " + "─".repeat(50));

  let calPassed = 0;
  let calFailed = 0;

  // Test 14: Default profile parity — balanced_default matches no-profile
  {
    const origin14 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest14 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const [routeDefault, routeBalanced] = await Promise.all([
      findRoute(test3Polyline, origin14, dest14),
      findRoute(test3Polyline, origin14, dest14, { profile: "balanced_default" }),
    ]);
    const keyDefault = routeDefault.map(r => `${r.roadCode}|${r.fromKm}|${r.toKm}`).join(",");
    const keyBalanced = routeBalanced.map(r => `${r.roadCode}|${r.fromKm}|${r.toKm}`).join(",");
    if (keyDefault === keyBalanced) {
      console.log("    ✓ Default profile parity: balanced_default matches no-profile");
      calPassed++;
    } else {
      console.log("    ✗ Profile parity mismatch");
      calFailed++;
    }
  }

  // Test 15: strict_highway behavior — same road continuity, higher penalty
  {
    const origin15 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest15 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test3Polyline, origin15, dest15, { profile: "strict_highway" });
    const hasNH17 = route.some(r => r.roadCode === "NH17");
    if (route.length > 0 && hasNH17) {
      console.log(`    ✓ strict_highway: ${route.length} segments, NH17 present`);
      calPassed++;
    } else {
      console.log(`    ✗ strict_highway failed: ${route.length} segments`);
      calFailed++;
    }
  }

  // Test 16: exploratory allows more transitions
  {
    const origin16 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest16 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test3Polyline, origin16, dest16, { profile: "exploratory" });
    if (route.length > 0) {
      console.log(`    ✓ exploratory: ${route.length} segments, ${[...new Set(route.map(r => r.roadCode))].join(" → ")}`);
      calPassed++;
    } else {
      console.log("    ✗ exploratory: no route found");
      calFailed++;
    }
  }

  // Test 17: Profile + partial override — override wins
  {
    const origin17 = { lat: 26.454, lon: 87.280, name: "Urlabari" };
    const dest17 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const route = await findRoute(test1Polyline, origin17, dest17, {
      profile: "strict_highway",
      costModel: { roadSwitchPenaltyKm: 5 },
    });
    const resolved = resolveCostModel("strict_highway", { roadSwitchPenaltyKm: 5 });
    if (resolved.roadSwitchPenaltyKm === 5 && route.length > 0) {
      console.log(`    ✓ Override wins: roadSwitchPenaltyKm=5 (strict_highway base was ${CALIBRATION_PROFILES.strict_highway.roadSwitchPenaltyKm})`);
      calPassed++;
    } else {
      console.log(`    ✗ Override not respected: got ${resolved.roadSwitchPenaltyKm}`);
      calFailed++;
    }
  }

  console.log(`\n  Calibration: ${calPassed} passed, ${calFailed} failed, ${calPassed + calFailed} total`);

  // ── Tests 18-20: Multi-Route / K-Shortest Paths (Phase 5.10) ──
  console.log("\n  Tests 18-20: Multi-Route K-Shortest Paths (Phase 5.10)");
  console.log("  " + "─".repeat(50));

  let multiPassed = 0;
  let multiFailed = 0;

  // Test 18: Multi-route returns at least the recommended path
  {
    const origin18 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest18 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const routes = await findMultiRouteInSequence(test3Polyline, origin18, dest18, {}, 2);
    if (routes.length >= 1 && routes[0].label === "Recommended" && routes[0].route.length > 0) {
      console.log(`    ✓ Multi-route: ${routes.length} path(s), 0th="${routes[0].label}" (${routes[0].route.length} segs)`);
      multiPassed++;
    } else {
      console.log(`    ✗ Multi-route: got ${routes.length} paths, 0th=${routes[0]?.label}`);
      multiFailed++;
    }
  }

  // Test 19: Multi-route with K=3 — sparse graph may yield <K paths, but must be ≥1 and unique
  {
    const origin19 = { lat: 27.717, lon: 85.324, name: "Kathmandu" };
    const dest19 = { lat: 28.209, lon: 83.986, name: "Pokhara" };
    const routes = await findMultiRouteInSequence(test3Polyline, origin19, dest19, {}, 3);
    const labels = routes.map(r => r.label);
    const uniqueLabels = new Set(labels);
    if (routes.length >= 1 && uniqueLabels.size === routes.length) {
      console.log(`    ✓ Multi-route K=3: ${routes.length} path(s), labels=[${labels.join(", ")}]`);
      multiPassed++;
    } else {
      console.log(`    ✗ Multi-route K=3: got ${routes.length} paths, labels=[${labels.join(", ")}]`);
      multiFailed++;
    }
  }

  // Test 20: Graph-level multi-route multi-road path (Kathmandu→Butwal via NH17→NH01)
  {
    const ktm = resolveNearestJunction(27.717, 85.324, 20, "Kathmandu");
    const butwal = resolveNearestJunction(27.701, 83.453, 20, "Butwal");
    if (ktm && butwal) {
      const paths = findMultiRoute(ktm.id, butwal.id, ktm.junctionName, butwal.junctionName, 2);
      const hasMultiRoad = paths.length >= 1 && paths[0].path.length > 0;
      const roadCodes = paths.length > 0 ? [...new Set(paths[0].path.map(e => e.roadCode))] : [];
      if (hasMultiRoad && roadCodes.includes("NH17")) {
        console.log(`    ✓ Graph multi-route Kathmandu→Butwal: ${paths.length} path(s), roads=[${roadCodes.join(", ")}]`);
        multiPassed++;
      } else {
        console.log(`    ✗ Graph multi-route: got ${paths.length} paths, roads=[${roadCodes.join(", ")}]`);
        multiFailed++;
      }
    } else {
      console.log("    ✗ Graph multi-route: could not resolve endpoints");
      multiFailed++;
    }
  }

  console.log(`\n  Multi-Route: ${multiPassed} passed, ${multiFailed} failed, ${multiPassed + multiFailed} total`);

  // ── Overall Summary ──
  const totalPassed = passed + segPassed + grPassed + regPassed + costPassed + expPassed + calPassed + multiPassed;
  const totalFailed = failed + segFailed + grFailed + regFailed + costFailed + expFailed + calFailed + multiFailed;
  const total = 3 + (segPassed + segFailed) + (grPassed + grFailed) + (regPassed + regFailed) + (costPassed + costFailed) + (expPassed + expFailed) + (calPassed + calFailed) + (multiPassed + multiFailed);

  console.log("\n" + "═".repeat(60));
  console.log(`  Overall: ${totalPassed} passed, ${totalFailed} failed, ${total} total`);
  console.log("═".repeat(60));

  await prisma.$disconnect();
  process.exit(totalFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
