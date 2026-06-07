import { describe, it, expect } from "vitest";
import { generateDynamicAlerts } from "@/lib/alert-engine";

describe("generateDynamicAlerts", () => {
  const baseInput = {
    routePoints: [
      { lat: 27.7, lon: 85.3 },
      { lat: 27.71, lon: 85.29 },
    ],
    clusters: [],
  };

  it("returns empty alerts for no clusters", async () => {
    const result = await generateDynamicAlerts(baseInput);
    expect(result.alerts).toEqual([]);
  });

  it("returns empty alerts for null/undefined input", async () => {
    const result1 = await generateDynamicAlerts(null as any);
    expect(result1.alerts).toEqual([]);

    const result2 = await generateDynamicAlerts(undefined as any);
    expect(result2.alerts).toEqual([]);
  });

  it("returns empty alerts for empty route", async () => {
    const result = await generateDynamicAlerts({ routePoints: [], clusters: [] });
    expect(result.alerts).toEqual([]);
  });

  it("returns empty alerts for clusters far from route", async () => {
    const result = await generateDynamicAlerts({
      ...baseInput,
      clusters: [
        { type: "landslide", lat: 20, lon: 80, count: 10, recent: true, severityScore: 0.9 },
      ],
    });
    expect(result.alerts).toEqual([]);
  });

  it("detects landslide-prone zone", async () => {
    const result = await generateDynamicAlerts({
      ...baseInput,
      clusters: [
        { type: "landslide", lat: 27.705, lon: 85.295, count: 5, recent: true, severityScore: 0.5 },
      ],
    });
    expect(result.alerts.some((a) => a.includes("Landslide"))).toBe(true);
  });

  it("detects flood history in Terai belt", async () => {
    const result = await generateDynamicAlerts({
      ...baseInput,
      clusters: [
        { type: "flood", lat: 27.705, lon: 85.295, count: 3, recent: true, severityScore: 0.6, region: "Terai" },
      ],
    });
    expect(result.alerts.some((a) => a.includes("Flood"))).toBe(true);
  });

  it("detects seismic activity", async () => {
    const result = await generateDynamicAlerts({
      ...baseInput,
      clusters: [
        { type: "earthquake", lat: 27.705, lon: 85.295, count: 3, recent: true, severityScore: 0.6 },
      ],
    });
    expect(result.alerts.some((a) => a.includes("Seismic"))).toBe(true);
  });

  it("detects recent hazard activity", async () => {
    const result = await generateDynamicAlerts({
      ...baseInput,
      clusters: [
        { type: "flood", lat: 27.705, lon: 85.295, count: 2, recent: true, severityScore: 0.3 },
      ],
    });
    expect(result.alerts.some((a) => a.includes("Flood"))).toBe(true);
  });

  it("adds weather-based alert for heavy rain in Hill region", async () => {
    const result = await generateDynamicAlerts({
      ...baseInput,
      clusters: [
        { type: "landslide", lat: 27.705, lon: 85.295, count: 2, recent: true, severityScore: 0.3 },
      ],
      weather: { rain_mm_per_hr: 30 },
    });
    expect(result.alerts.some((a) => a.includes("landslide"))).toBe(true);
  });

  it("deduplicates alerts", async () => {
    const result = await generateDynamicAlerts({
      ...baseInput,
      clusters: [
        { type: "landslide", lat: 27.8, lon: 85.2, count: 5, recent: true, severityScore: 0.5 },
        { type: "landslide", lat: 27.81, lon: 85.19, count: 5, recent: true, severityScore: 0.5 },
      ],
    });
    const landslideAlerts = result.alerts.filter((a) => a.includes("Landslide"));
    expect(landslideAlerts.length).toBeLessThanOrEqual(1);
  });
});
