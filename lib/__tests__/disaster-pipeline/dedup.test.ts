import { describe, it, expect } from "vitest";

describe("dedupeRealtimeEvents", () => {
  function dedupeRealtimeEvents(
    rows: Array<{ type: string; lat: number; lon: number }>,
  ): Array<{ type: string; lat: number; lon: number }> {
    const seen = new Set<string>();
    const out: Array<{ type: string; lat: number; lon: number }> = [];
    for (const r of rows) {
      const key = `${r.type}:${r.lat.toFixed(4)}:${r.lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  it("removes exact duplicates", () => {
    const input = [
      { type: "FLOOD" as const, lat: 27.7172, lon: 85.3240 },
      { type: "FLOOD" as const, lat: 27.7172, lon: 85.3240 },
    ];
    expect(dedupeRealtimeEvents(input)).toHaveLength(1);
  });

  it("keeps distinct events", () => {
    const input = [
      { type: "FLOOD" as const, lat: 27.7172, lon: 85.3240 },
      { type: "LANDSLIDE" as const, lat: 28.0000, lon: 84.0000 },
    ];
    expect(dedupeRealtimeEvents(input)).toHaveLength(2);
  });

  it("dedupes by type+lat+lon rounded to 4 decimals", () => {
    const input = [
      { type: "FLOOD" as const, lat: 27.71725, lon: 85.32405 },
      { type: "FLOOD" as const, lat: 27.71724, lon: 85.32404 },
    ];
    const result = dedupeRealtimeEvents(input);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(27.71725);
    expect(result[0].lon).toBe(85.32405);
  });

  it("same lat/lon different types are kept", () => {
    const input = [
      { type: "FLOOD" as const, lat: 27.7172, lon: 85.3240 },
      { type: "LANDSLIDE" as const, lat: 27.7172, lon: 85.3240 },
    ];
    expect(dedupeRealtimeEvents(input)).toHaveLength(2);
  });

  it("handles empty array", () => {
    expect(dedupeRealtimeEvents([])).toHaveLength(0);
  });
});
