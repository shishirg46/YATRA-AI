import { describe, it, expect } from "vitest";

function circularMonthDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

function logNorm(incidents: number, years: number): number {
  const max = years * 3;
  if (max <= 0) return 0;
  return Math.log(1 + incidents) / Math.log(1 + max);
}

function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function dedupeEvents(
  events: Array<{ date: string; type: string; description: string }>,
): Array<{ date: string; type: string; description: string }> {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.date}|${e.type}|${e.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function confidence(ok: number, max: number): number {
  return max > 0 ? Math.round((ok / max) * 100) / 100 : 0;
}

describe("circularMonthDiff", () => {
  it("same month returns 0", () => {
    expect(circularMonthDiff(5, 5)).toBe(0);
  });

  it("adjacent months forward", () => {
    expect(circularMonthDiff(1, 2)).toBe(1);
    expect(circularMonthDiff(6, 7)).toBe(1);
    expect(circularMonthDiff(11, 12)).toBe(1);
  });

  it("December (12) and January (1) are 1 apart", () => {
    expect(circularMonthDiff(12, 1)).toBe(1);
    expect(circularMonthDiff(1, 12)).toBe(1);
  });

  it("max distance is 6 (half-year)", () => {
    expect(circularMonthDiff(1, 7)).toBe(6);
    expect(circularMonthDiff(7, 1)).toBe(6);
    expect(circularMonthDiff(12, 6)).toBe(6);
  });

  it("11 and 1 are 2 apart (via wrap)", () => {
    expect(circularMonthDiff(11, 1)).toBe(2);
    expect(circularMonthDiff(1, 11)).toBe(2);
  });
});

describe("getLastDayOfMonth", () => {
  it("February 2024 (leap) has 29 days", () => {
    expect(getLastDayOfMonth(2024, 2)).toBe(29);
  });

  it("February 2025 (non-leap) has 28 days", () => {
    expect(getLastDayOfMonth(2025, 2)).toBe(28);
  });

  it("January has 31 days", () => {
    expect(getLastDayOfMonth(2025, 1)).toBe(31);
  });

  it("April has 30 days", () => {
    expect(getLastDayOfMonth(2025, 4)).toBe(30);
  });

  it("December has 31 days", () => {
    expect(getLastDayOfMonth(2025, 12)).toBe(31);
  });
});

describe("dedupeEvents", () => {
  it("removes exact duplicates", () => {
    const input = [
      { date: "2024-01-01", type: "Flood", description: "flood in Kailali" },
      { date: "2024-01-01", type: "Flood", description: "flood in Kailali" },
    ];
    expect(dedupeEvents(input)).toHaveLength(1);
  });

  it("keeps distinct events", () => {
    const input = [
      { date: "2024-01-01", type: "Flood", description: "flood in Kailali" },
      { date: "2024-06-15", type: "Landslide", description: "landslide in Sindhupalchok" },
    ];
    expect(dedupeEvents(input)).toHaveLength(2);
  });

  it("same date and type but different description are kept", () => {
    const input = [
      { date: "2024-01-01", type: "Flood", description: "flood in Kailali" },
      { date: "2024-01-01", type: "Flood", description: "flood in Bardiya" },
    ];
    expect(dedupeEvents(input)).toHaveLength(2);
  });

  it("preserves order", () => {
    const input = [
      { date: "2024-03-01", type: "Landslide", description: "first" },
      { date: "2024-01-01", type: "Flood", description: "second" },
    ];
    const result = dedupeEvents(input);
    expect(result[0].description).toBe("first");
  });
});

describe("logNorm", () => {
  it("0 incidents = 0 risk", () => {
    expect(logNorm(0, 5)).toBe(0);
  });

  it("monotonically increasing with incidents", () => {
    expect(logNorm(2, 5)).toBeGreaterThan(logNorm(1, 5));
    expect(logNorm(10, 5)).toBeGreaterThan(logNorm(5, 5));
  });

  it("returns 1 for max incidents", () => {
    expect(logNorm(15, 5)).toBeCloseTo(1, 1);
  });

  it("handles zero years gracefully", () => {
    expect(logNorm(5, 0)).toBe(0);
  });
});

describe("confidence", () => {
  it("full success returns 1.0", () => {
    expect(confidence(6, 6)).toBe(1);
  });

  it("half success returns 0.5", () => {
    expect(confidence(3, 6)).toBe(0.5);
  });

  it("no success returns 0", () => {
    expect(confidence(0, 6)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    expect(confidence(2, 3)).toBe(0.67);
  });

  it("handles zero max gracefully", () => {
    expect(confidence(0, 0)).toBe(0);
  });
});
