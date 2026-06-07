import { describe, it, expect } from "vitest";
import { computeRouteRisk } from "@/lib/scoring/route-risk";

describe("computeRouteRisk", () => {
  const baseParams = {
    originLat: 27.7172, originLon: 85.3240, // Kathmandu
    destLat: 28.2096, destLon: 83.9856,     // Pokhara
    originAlt: 1400, destAlt: 1400,
    originDistrict: "kathmandu", destDistrict: "kaski",
    isMonsoon: false, purposes: [],
  };

  it("returns a score between 0 and 100", () => {
    const result = computeRouteRisk(baseParams);
    expect(result.routeRiskScore).toBeGreaterThanOrEqual(0);
    expect(result.routeRiskScore).toBeLessThanOrEqual(100);
  });

  it("returns a valid level", () => {
    const result = computeRouteRisk(baseParams);
    expect(["SAFE", "CAUTION", "HIGH_RISK", "EXTREME"]).toContain(result.routeRiskLevel);
  });

  it("includes distance in result", () => {
    const result = computeRouteRisk(baseParams);
    expect(result.routeDistanceKm).toBeGreaterThan(0);
  });

  it("penalizes longer routes more", () => {
    const short = computeRouteRisk({
      ...baseParams,
      destLat: 27.73, destLon: 85.33, // very close to origin
    });
    const long = computeRouteRisk({
      ...baseParams,
      destLat: 29.5, destLon: 82.0, // far away
    });
    expect(long.routeRiskScore).toBeLessThan(short.routeRiskScore);
  });

  it("penalizes monsoon more", () => {
    const dry = computeRouteRisk(baseParams);
    const wet = computeRouteRisk({ ...baseParams, isMonsoon: true });
    expect(wet.routeRiskScore).toBeLessThanOrEqual(dry.routeRiskScore);
  });

  it("penalizes high altitude destinations", () => {
    const low = computeRouteRisk({ ...baseParams, destAlt: 500 });
    const high = computeRouteRisk({ ...baseParams, destAlt: 4500 });
    expect(high.routeRiskScore).toBeLessThanOrEqual(low.routeRiskScore);
  });

  it("applies trekking multiplier", () => {
    const normal = computeRouteRisk(baseParams);
    const trekking = computeRouteRisk({ ...baseParams, purposes: ["TREKKING"] });
    expect(trekking.routeRiskScore).toBeLessThanOrEqual(normal.routeRiskScore);
  });

  it("applies solo multiplier", () => {
    const normal = computeRouteRisk(baseParams);
    const solo = computeRouteRisk({ ...baseParams, purposes: ["SOLO"] });
    expect(solo.routeRiskScore).toBeLessThanOrEqual(normal.routeRiskScore);
  });

  it("applies health multipliers", () => {
    const normal = computeRouteRisk(baseParams);
    const heart = computeRouteRisk({ ...baseParams, purposes: ["HEALTH:heart"] });
    expect(heart.routeRiskScore).toBeLessThanOrEqual(normal.routeRiskScore);
  });

  it("penalizes high seismic origin district", () => {
    const result = computeRouteRisk({
      ...baseParams,
      originDistrict: "gorkha",
      destDistrict: "kaski",
    });
    expect(result.routeRiskScore).toBeLessThan(100);
  });

  it("penalizes high seismic destination district", () => {
    const result = computeRouteRisk({
      ...baseParams,
      originDistrict: "kathmandu",
      destDistrict: "solukhumbu",
    });
    expect(result.routeRiskScore).toBeLessThan(100);
  });

  it("incorporates real-time hazard data", () => {
    const hazard = { floodIndex: 0.8, landslideIndex: 0.7, earthquakeIndex: 0.3, heatIndex: 0, airQuality: 0 };
    const result = computeRouteRisk({ ...baseParams, originHazard: hazard });
    expect(result.routeRiskScore).toBeLessThan(100);
  });

  it("incorporates community hazard penalty", () => {
    const result = computeRouteRisk({ ...baseParams, communityHazardPenalty: 10 });
    expect(result.decisionTrace.reasoning.some((r) => r.includes("Community"))).toBe(true);
  });

  it("returns reasoning array", () => {
    const result = computeRouteRisk(baseParams);
    expect(result.decisionTrace.reasoning.length).toBeGreaterThan(0);
  });

  it("returns dataSource string", () => {
    const result = computeRouteRisk(baseParams);
    expect(typeof result.dataSource).toBe("string");
    expect(result.dataSource.length).toBeGreaterThan(0);
  });

  it("handles zero-distance edge case", () => {
    const result = computeRouteRisk({
      ...baseParams,
      destLat: baseParams.originLat,
      destLon: baseParams.originLon,
    });
    expect(result.routeRiskScore).toBeGreaterThan(0);
    expect(result.routeDistanceKm).toBeLessThan(1);
  });
});
