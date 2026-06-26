import { describe, it, expect } from "vitest";
import { computeEdgeWeight, monsoonPenalty, riskPenalty, roadQualityPenalty, directionPenalty } from "@/lib/routing/routing-config";

describe("computeEdgeWeight", () => {
  const baseParams = {
    distanceKm: 10,
    reliabilityScore: 0.85,
    landslideRisk: 0.1,
    floodRisk: 0.1,
    monsoonVulnerability: 0.1,
    roadCondition: "GOOD",
    distToDestCurrentKm: 50,
    distToDestNextKm: 40,
    isMonsoon: false,
  };

  it("returns finite weight for normal conditions", () => {
    const weight = computeEdgeWeight(baseParams);
    expect(Number.isFinite(weight)).toBe(true);
    expect(weight).toBeGreaterThan(0);
  });

  it("returns Infinity for impassable monsoon edge", () => {
    const weight = computeEdgeWeight({
      ...baseParams,
      monsoonVulnerability: 0.9,
      isMonsoon: true,
    });
    expect(weight).toBe(Infinity);
  });

  it("shorter distance produces lower cost", () => {
    const short = computeEdgeWeight({ ...baseParams, distanceKm: 5 });
    const long = computeEdgeWeight({ ...baseParams, distanceKm: 50 });
    expect(short).toBeLessThan(long);
  });

  it("high landslide risk increases cost", () => {
    const safe = computeEdgeWeight({ ...baseParams, landslideRisk: 0 });
    const risky = computeEdgeWeight({ ...baseParams, landslideRisk: 0.9 });
    expect(risky).toBeGreaterThan(safe);
  });

  it("poor reliability increases cost", () => {
    const good = computeEdgeWeight({ ...baseParams, reliabilityScore: 0.95 });
    const bad = computeEdgeWeight({ ...baseParams, reliabilityScore: 0.2 });
    expect(bad).toBeGreaterThan(good);
  });

  it("direction toward destination gives lower cost", () => {
    const toward = computeEdgeWeight({ ...baseParams, distToDestCurrentKm: 50, distToDestNextKm: 30 });
    const away = computeEdgeWeight({ ...baseParams, distToDestCurrentKm: 50, distToDestNextKm: 55 });
    expect(toward).toBeLessThan(away);
  });
});

describe("monsoonPenalty", () => {
  it("returns 0 for low vulnerability", () => {
    expect(monsoonPenalty(0.1)).toBe(0);
  });

  it("returns 50 for medium vulnerability", () => {
    expect(monsoonPenalty(0.4)).toBe(50);
  });

  it("returns 200 for high vulnerability", () => {
    expect(monsoonPenalty(0.7)).toBe(200);
  });

  it("returns Infinity for blocked", () => {
    expect(monsoonPenalty(0.9)).toBe(Infinity);
  });

  it("handles null input", () => {
    expect(monsoonPenalty(null)).toBe(0);
  });
});

describe("riskPenalty", () => {
  it("returns 0 for zero risk", () => {
    expect(riskPenalty({ landslideRisk: 0, floodRisk: 0, monsoonVulnerability: 0 })).toBe(0);
  });

  it("returns positive for high landslide", () => {
    const penalty = riskPenalty({ landslideRisk: 1, floodRisk: 0, monsoonVulnerability: 0 });
    expect(penalty).toBe(2); // (1*0.4 + 0 + 0) * 5
  });
});

describe("roadQualityPenalty", () => {
  it("returns 0.15 for 0.85 reliability", () => {
    expect(roadQualityPenalty(0.85)).toBeCloseTo(0.15);
  });

  it("returns 0.5 for null reliability", () => {
    expect(roadQualityPenalty(null)).toBe(0.5);
  });
});

describe("directionPenalty", () => {
  it("returns 0 for perfect heading toward destination", () => {
    expect(directionPenalty(100, 90, 10)).toBe(0); // (100-90)/10 = 1, max(0, 1-1) = 0
  });

  it("returns 0 when moving toward destination", () => {
    const result = directionPenalty(50, 40, 10);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("handles zero edge distance", () => {
    expect(directionPenalty(10, 5, 0)).toBe(0);
  });
});
