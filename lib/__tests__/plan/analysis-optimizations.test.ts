import { beforeEach, describe, expect, it, vi } from "vitest";

import { assessRoute, tryGenerateRouteIntelligence } from "@/lib/plan/resolver";
import { shouldRunAlternativeAnalysis } from "@/lib/plan/alternatives";
import { generateRouteIntelligence } from "@/lib/route-intelligence";

vi.mock("@/lib/route-intelligence", () => ({
  generateRouteIntelligence: vi.fn(),
}));

describe("analysis optimizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses supplied route intelligence instead of recomputing it", async () => {
    const mockGenerateRouteIntelligence = vi.mocked(generateRouteIntelligence);
    mockGenerateRouteIntelligence.mockResolvedValue({
      origin: { lat: 27.7, lon: 85.3, name: "Kathmandu" },
      destination: { lat: 28.2, lon: 83.9, name: "Pokhara" },
      departureDate: "2026-07-10",
      routes: [],
      bestRoute: null,
      generatedAt: new Date().toISOString(),
    } as any);

    const routeIntelligence = {
      origin: { lat: 27.7, lon: 85.3, name: "Kathmandu" },
      destination: { lat: 28.2, lon: 83.9, name: "Pokhara" },
      departureDate: "2026-07-10",
      routes: [
        {
          id: "route-1",
          name: "Primary route",
          description: "",
          waypoints: [],
          distance: 200,
          duration: 6,
          riskScore: 10,
          riskLevel: "LOW",
          hazards: { landslideZones: [], floodZones: [], activeAlerts: [], weatherRisk: "low", historicalRisk: 0.1 },
          segments: [],
          source: "test",
        },
      ],
      bestRoute: {
        id: "route-1",
        name: "Primary route",
        description: "",
        waypoints: [],
        distance: 200,
        duration: 6,
        riskScore: 10,
        riskLevel: "LOW",
        hazards: { landslideZones: [], floodZones: [], activeAlerts: [], weatherRisk: "low", historicalRisk: 0.1 },
        segments: [],
        source: "test",
      },
      generatedAt: new Date().toISOString(),
    } as any;

    const result = await assessRoute(
      {
        name: "Kathmandu",
        latitude: 27.7172,
        longitude: 85.324,
        altitude: 1400,
        district: { name: "Kathmandu", province: { name: "Bagmati" } },
      },
      {
        id: "dest-1",
        name: "Pokhara",
        latitude: 28.2096,
        longitude: 83.9856,
        altitude: 822,
        district: { name: "Kaski", province: { name: "Gandaki" } },
      },
      "2026-07-10",
      { routeIntelligence },
    );

    expect(mockGenerateRouteIntelligence).not.toHaveBeenCalled();
    expect(result?.risk).toBe("LOW");
  });

  it("returns null route intelligence when generation fails", async () => {
    const mockGenerateRouteIntelligence = vi.mocked(generateRouteIntelligence);
    mockGenerateRouteIntelligence.mockRejectedValueOnce(new Error("Origin is outside Nepal"));

    await expect(
      tryGenerateRouteIntelligence(
        { lat: 27.7, lon: 85.3, name: "Kathmandu" },
        { lat: 28.2, lon: 83.9, name: "Pokhara" },
        "2026-07-10",
        { destinationId: "dest-1" },
      ),
    ).resolves.toBeNull();
  });

  it("skips alternative analysis for safe destinations", () => {
    expect(shouldRunAlternativeAnalysis("SAFE")).toBe(false);
    expect(shouldRunAlternativeAnalysis("CAUTION")).toBe(true);
    expect(shouldRunAlternativeAnalysis("HIGH_RISK")).toBe(true);
  });
});
