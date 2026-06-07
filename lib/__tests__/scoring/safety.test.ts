import { describe, it, expect } from "vitest";
import { computeSafetyScore, buildHealthFlags, type SafetyLevel } from "@/lib/scoring/safety";

const baseWeather = {
  temperature: 20, humidity: 60, rainfall: 0, windSpeed: 5, pressure: 1013,
};

const baseHazard = {
  floodIndex: 0, landslideIndex: 0, earthquakeIndex: 0, heatIndex: 0, airQuality: 0,
};

describe("computeSafetyScore", () => {
  it("returns SAFE for perfect conditions", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 500, districtName: "kathmandu", locationName: "Kathmandu",
    });
    expect(result.safetyLevel).toBe("SAFE");
    expect(result.safetyScore).toBeGreaterThanOrEqual(80);
  });

  it("penalizes extreme altitude", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 5500, districtName: "solukhumbu", locationName: "Everest Base Camp",
    });
    expect(result.decisionTrace.penalties.altitude).toBe(25);
  });

  it("penalizes high altitude (4500m)", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 4500, districtName: "solukhumbu", locationName: "EBC",
    });
    expect(result.decisionTrace.penalties.altitude).toBe(20);
  });

  it("penalizes moderate altitude (3500m)", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 3500, districtName: "kaski", locationName: "Annapurna Base Camp",
    });
    expect(result.decisionTrace.penalties.altitude).toBe(14);
  });

  it("penalizes 2500m altitude", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 2500, districtName: "kaski", locationName: "Pokhara",
    });
    expect(result.decisionTrace.penalties.altitude).toBe(7);
  });

  it("applies minimal altitude penalty at 1500m", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 1500, districtName: "kaski", locationName: "Pokhara",
    });
    expect(result.decisionTrace.penalties.altitude).toBe(2);
  });

  it("zero altitude penalty at sea level", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 100, districtName: "kaski", locationName: "Pokhara",
    });
    expect(result.decisionTrace.penalties.altitude).toBe(0);
  });

  it("applies high seismic zone penalty for Sindhupalchok", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 1000, districtName: "sindhupalchok", locationName: "Somewhere",
    });
    expect(result.decisionTrace.penalties.seismicZone).toBe(10);
  });

  it("applies moderate seismic zone penalty for Kathmandu", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 1400, districtName: "kathmandu", locationName: "Kathmandu",
    });
    expect(result.decisionTrace.penalties.seismicZone).toBe(5);
  });

  it("applies air quality penalty in Kathmandu Valley", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["GENERAL"], "live", "live", {
      altitude: 1400, districtName: "kathmandu", locationName: "Kathmandu",
    });
    expect(result.decisionTrace.penalties.airBaseline).toBe(8);
  });

  it("applies rainfall penalty proportionally", () => {
    const rainy = { ...baseWeather, rainfall: 50 };
    const result = computeSafetyScore(rainy, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 500, districtName: "chitwan", locationName: "Chitwan",
    });
    expect(result.decisionTrace.penalties.rainfall).toBeGreaterThan(0);
  });

  it("applies temperature extreme penalty for sub-zero", () => {
    const cold = { ...baseWeather, temperature: -10 };
    const result = computeSafetyScore(cold, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 3000, districtName: "mustang", locationName: "Mustang",
    });
    expect(result.decisionTrace.penalties.temperature).toBeGreaterThan(0);
  });

  it("applies temperature extreme penalty for extreme heat", () => {
    const hot = { ...baseWeather, temperature: 42 };
    const result = computeSafetyScore(hot, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 100, districtName: "banke", locationName: "Nepalgunj",
    });
    expect(result.decisionTrace.penalties.temperature).toBeGreaterThan(0);
  });

  it("multiplies landslide risk for trekking", () => {
    const hazards = { ...baseHazard, landslideIndex: 0.5 };
    const result = computeSafetyScore(baseWeather, hazards, ["TREKKING"], "live", "live", {
      altitude: 1000, districtName: "kaski", locationName: "Pokhara",
    });
    expect(result.decisionTrace.multipliers.landslide_trekking).toBe(1.8);
  });

  it("multiplies all penalties for solo travel", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["SOLO"], "live", "live", {
      altitude: 1000, districtName: "kaski", locationName: "Pokhara",
    });
    expect(result.decisionTrace.multipliers.solo).toBe(1.2);
  });

  it("applies heart condition multipliers", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM", "HEALTH:heart"], "live", "live", {
      altitude: 1000, districtName: "kaski", locationName: "Pokhara",
    });
    expect(result.decisionTrace.multipliers.temperature_heart).toBe(2.0);
    expect(result.decisionTrace.multipliers.altitude_heart).toBe(1.8);
  });

  it("applies asthma multipliers", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM", "HEALTH:asthma"], "live", "live", {
      altitude: 1000, districtName: "kathmandu", locationName: "Kathmandu",
    });
    expect(result.decisionTrace.multipliers.airQuality_asthma).toBe(2.0);
  });

  it("applies low fitness multipliers", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM", "HEALTH:low_fitness"], "live", "live", {
      altitude: 1000, districtName: "kaski", locationName: "Pokhara",
    });
    expect(result.decisionTrace.multipliers.altitude_lowfit).toBe(1.5);
  });

  it("caps max penalty at 100", () => {
    const badHazard = { floodIndex: 1, landslideIndex: 1, earthquakeIndex: 1, heatIndex: 1, airQuality: 1 };
    const result = computeSafetyScore(baseWeather, badHazard, ["SOLO"], "live", "live", {
      altitude: 5500, districtName: "solukhumbu", locationName: "Everest",
    });
    expect(result.safetyScore).toBeGreaterThanOrEqual(0);
    expect(result.decisionTrace.totalPenalty).toBeLessThanOrEqual(100);
  });

  it("returns EXTREME for worst case", () => {
    const badHazard = { floodIndex: 1, landslideIndex: 1, earthquakeIndex: 1, heatIndex: 1, airQuality: 1 };
    const badWeather = { temperature: -20, humidity: 90, rainfall: 200, windSpeed: 80, pressure: 900 };
    const result = computeSafetyScore(badWeather, badHazard, ["SOLO", "TREKKING"], "live", "live", {
      altitude: 5500, districtName: "solukhumbu", locationName: "Everest",
    });
    expect(result.safetyLevel).toBe("EXTREME");
    expect(result.safetyScore).toBeLessThanOrEqual(40);
  });

  it("adds reasoning for high rainfall", () => {
    const rainy = { ...baseWeather, rainfall: 100 };
    const result = computeSafetyScore(rainy, baseHazard, ["TOURISM"], "live", "live", {
      altitude: 500, districtName: "chitwan", locationName: "Chitwan",
    });
    expect(result.decisionTrace.reasoning.some((r) => r.includes("rainfall"))).toBe(true);
  });

  it("handles missing location gracefully", () => {
    const result = computeSafetyScore(baseWeather, baseHazard, ["TOURISM"], "live", "live", undefined);
    expect(result.safetyScore).toBeGreaterThanOrEqual(80);
  });

  it("includes hazard penalty reason when flood is high", () => {
    const hazards = { ...baseHazard, floodIndex: 0.8 };
    const result = computeSafetyScore(baseWeather, hazards, ["TOURISM"], "live", "live", {
      altitude: 500, districtName: "bara", locationName: "Bara",
    });
    expect(result.decisionTrace.penalties.flood).toBeGreaterThan(10);
  });
});

describe("scoreToLevel (via computeSafetyScore)", () => {
  function levelFor(altitude: number, rainfall: number): SafetyLevel {
    const w = { ...baseWeather, rainfall };
    return computeSafetyScore(w, baseHazard, ["TOURISM"], "live", "live", {
      altitude, districtName: "kaski", locationName: "Test",
    }).safetyLevel;
  }

  it("returns SAFE for low altitude no rain", () => {
    expect(levelFor(500, 0)).toBe("SAFE");
  });

  it("returns CAUTION for moderate altitude with rain", () => {
    expect(levelFor(500, 100)).toBe("CAUTION");
  });

  it("returns HIGH_RISK for high altitude heavy rain", () => {
    expect(levelFor(4000, 100)).toBe("HIGH_RISK");
  });
});

describe("buildHealthFlags", () => {
  it("returns low_fitness flag", () => {
    const flags = buildHealthFlags({ fitnessLevel: "LOW", mobilityLimited: false, chronicConditions: [] });
    expect(flags).toContain("HEALTH:low_fitness");
  });

  it("returns heart flag for heart condition", () => {
    const flags = buildHealthFlags({ fitnessLevel: "MODERATE", mobilityLimited: false, chronicConditions: ["heart"] });
    expect(flags).toContain("HEALTH:heart");
  });

  it("returns heart flag for hypertension", () => {
    const flags = buildHealthFlags({ fitnessLevel: "MODERATE", mobilityLimited: false, chronicConditions: ["hypertension"] });
    expect(flags).toContain("HEALTH:heart");
  });

  it("returns asthma flag", () => {
    const flags = buildHealthFlags({ fitnessLevel: "MODERATE", mobilityLimited: false, chronicConditions: ["asthma"] });
    expect(flags).toContain("HEALTH:asthma");
  });

  it("returns diabetes flag", () => {
    const flags = buildHealthFlags({ fitnessLevel: "MODERATE", mobilityLimited: false, chronicConditions: ["diabetes"] });
    expect(flags).toContain("HEALTH:diabetes");
  });

  it("returns mobility flag", () => {
    const flags = buildHealthFlags({ fitnessLevel: "MODERATE", mobilityLimited: true, chronicConditions: [] });
    expect(flags).toContain("HEALTH:mobility");
  });

  it("returns empty array for healthy user", () => {
    const flags = buildHealthFlags({ fitnessLevel: "HIGH", mobilityLimited: false, chronicConditions: [] });
    expect(flags).toEqual([]);
  });

  it("deduplicates flags (heart + hypertension)", () => {
    const flags = buildHealthFlags({ fitnessLevel: "LOW", mobilityLimited: false, chronicConditions: ["heart", "hypertension"] });
    const heartCount = flags.filter((f) => f === "HEALTH:heart").length;
    expect(heartCount).toBe(1);
  });
});
