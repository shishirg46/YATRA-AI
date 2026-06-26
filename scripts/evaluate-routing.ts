import { runRoute, type RoutingMode, type RouteResult, type RouteMetrics } from "./route-engine";

interface TestCase {
  name: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  mode: RoutingMode;
  preferRoad: string;
  expectFound: boolean;
  minContinuity: number;
  maxDeviation: number;
  maxRoadChanges: number;
}

const TEST_CASES: TestCase[] = [
  {
    name: "NH01-east-west-balanced",
    startLat: 26.681, startLon: 87.349,
    endLat: 28.92, endLon: 80.21,
    mode: "balanced", preferRoad: "NH01",
    expectFound: true, minContinuity: 0.30, maxDeviation: 0.20, maxRoadChanges: -1,
  },
  {
    name: "NH01-east-west-strict",
    startLat: 26.681, startLon: 87.349,
    endLat: 28.92, endLon: 80.21,
    mode: "strict-road", preferRoad: "NH01",
    expectFound: true, minContinuity: 1.0, maxDeviation: 0.20, maxRoadChanges: 0,
  },
  {
    name: "NH01-east-west-fastest",
    startLat: 26.681, startLon: 87.349,
    endLat: 28.92, endLon: 80.21,
    mode: "fastest", preferRoad: "NH01",
    expectFound: true, minContinuity: 0.20, maxDeviation: 0.20, maxRoadChanges: -1,
  },
  {
    name: "NH01-east-west-highway",
    startLat: 26.681, startLon: 87.349,
    endLat: 28.92, endLon: 80.21,
    mode: "highway-preferred", preferRoad: "NH01",
    expectFound: true, minContinuity: 0.30, maxDeviation: 0.20, maxRoadChanges: -1,
  },
  {
    name: "Hetauda-short",
    startLat: 27.42, startLon: 85.03,
    endLat: 27.30, endLon: 84.96,
    mode: "balanced", preferRoad: "NH01",
    expectFound: true, minContinuity: 0.10, maxDeviation: 0.80, maxRoadChanges: -1,
  },
  {
    name: "NH04-mountain",
    startLat: 28.20, startLon: 83.98,
    endLat: 28.27, endLon: 83.60,
    mode: "balanced", preferRoad: "NH04",
    expectFound: true, minContinuity: 0, maxDeviation: 0.20, maxRoadChanges: -1,
  },
];

interface TestResult {
  name: string;
  passed: boolean;
  details: string[];
  stats?: RouteResult["statistics"];
}

function runTestCase(tc: TestCase): TestResult {
  const details: string[] = [];
  const result = runRoute({
    startLat: tc.startLat,
    startLon: tc.startLon,
    endLat: tc.endLat,
    endLon: tc.endLon,
    mode: tc.mode,
    preferRoad: tc.preferRoad,
  });

  if (!tc.expectFound) {
    if (!result.found) return { name: tc.name, passed: true, details: ["Correctly: no path found"] };
    return {
      name: tc.name, passed: false,
      details: [`Expected no path but found one (dist=${result.statistics.totalDistanceKm.toFixed(0)}km)`],
      stats: result.statistics,
    };
  }

  if (!result.found) {
    return { name: tc.name, passed: false, details: ["Expected path but none found"], stats: result.statistics };
  }

  const m = result.statistics.metrics;
  if (!m) {
    return { name: tc.name, passed: false, details: ["No metrics computed"], stats: result.statistics };
  }

  const s = result.statistics;
  let pass = true;

  if (m.continuityScore < tc.minContinuity) {
    pass = false;
    details.push(`Continuity ${(m.continuityScore * 100).toFixed(0)}% < min ${(tc.minContinuity * 100).toFixed(0)}%`);
  }
  if (m.deviationScore > tc.maxDeviation) {
    pass = false;
    details.push(`Deviation ${m.deviationScore.toFixed(3)} > max ${tc.maxDeviation.toFixed(3)}`);
  }
  if (tc.maxRoadChanges >= 0 && s.roadChanges > tc.maxRoadChanges) {
    pass = false;
    details.push(`Road changes ${s.roadChanges} > max ${tc.maxRoadChanges}`);
  }

  const info = `dist=${s.totalDistanceKm.toFixed(0)}km wt=${s.totalWeight.toFixed(0)} changes=${s.roadChanges} cont=${(m.continuityScore * 100).toFixed(0)}% dev=${m.deviationScore.toFixed(3)}`;
  if (pass) details.push(info);
  else details.unshift(info);

  return { name: tc.name, passed: pass, details, stats: result.statistics };
}

function main() {
  console.log("┌────────────────────────────────────────────────────────────────┐");
  console.log("│               Routing Evaluation Harness                      │");
  console.log("├────────────────────────────────────────────────────────────────┤");
  console.log("│ Running test cases...                                        │");

  const results = TEST_CASES.map(runTestCase);

  console.log("├────────────────────────────────────────────────────────────────┤");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    const first = r.details[0] ?? "";
    console.log(`│ ${icon} ${r.name.padEnd(30)} ${first.padEnd(45)} │`);
    for (let i = 1; i < r.details.length; i++) {
      console.log(`│       ${r.details[i].padEnd(68)} │`);
    }
  }

  console.log("├────────────────────────────────────────────────────────────────┤");
  console.log(`│ Passed: ${passed}/${TEST_CASES.length}${failed.length > 0 ? `  Failed: ${failed.map((f) => f.name).join(", ")}` : "  All passed!"}`);
  if (failed.length > 0) {
    console.log(`│ ${new Date().toISOString().split("T")[0]} — ${failed.length} regression(s)`);
    process.exit(1);
  }
  console.log(`│ ${new Date().toISOString().split("T")[0]} — stable`);
  console.log("└────────────────────────────────────────────────────────────────┘");
}

main();
