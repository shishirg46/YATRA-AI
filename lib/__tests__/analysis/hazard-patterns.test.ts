import { describe, expect, it } from "vitest";
import { computeRealtimeRisk, hydrateSegmentHazardInput } from "@/lib/analysis/hazard-patterns";

describe("hydrateSegmentHazardInput", () => {
  it("prefers live weather and hazard values over stale segment payload values", () => {
    const segment = {
      index: 0,
      fromLat: 27.7,
      fromLon: 85.3,
      toLat: 27.72,
      toLon: 85.31,
      floodIndex: 0.2,
      landslideIndex: 0.1,
      rainfall: 5,
    };

    const weather = {
      temperature: 24,
      humidity: 85,
      rainfall: 82,
      windSpeed: 10,
      description: "Heavy rain",
      source: "dhm-mfd-api",
      timestamp: new Date().toISOString(),
      sourceLabel: "Nepal DHM",
      officialSource: true,
    };

    const hazard = {
      floodIndex: 0.9,
      landslideIndex: 0.8,
      earthquakeIndex: 0.1,
      stormIndex: 0,
      accidentIndex: 0,
      heatIndex: 0,
      airQuality: 0.6,
      source: "db",
      floodCount: 3,
      landslideCount: 4,
      earthquakeCount: 1,
      stormCount: 0,
      accidentCount: 0,
    };

    const hydrated = hydrateSegmentHazardInput(segment, weather, hazard);

    expect(hydrated.floodIndex).toBe(0.9);
    expect(hydrated.landslideIndex).toBe(0.8);
    expect(hydrated.rainfall).toBe(82);
    expect(hydrated.weather?.sourceLabel).toBe("Nepal DHM");
    expect(hydrated.hazard?.source).toBe("db");
  });

  it("does not mark mild conditions as harsh", () => {
    const result = computeRealtimeRisk({
      index: 1,
      fromLat: 27.7,
      fromLon: 85.3,
      toLat: 27.72,
      toLon: 85.31,
      floodIndex: 0.8,
      landslideIndex: 0.6,
      rainfall: 45,
    }, 1);

    expect(result).toBeUndefined();
  });
});
