import { describe, it, expect } from "vitest";
import { haversineKm, isValidLatLon, isPointInNepal, distanceToSegmentKm, nameSimilarity } from "@/lib/routing/geo";

describe("haversineKm", () => {
  it("returns 0 for same point", () => {
    expect(haversineKm(27.7, 85.3, 27.7, 85.3)).toBe(0);
  });

  it("calculates Kathmandu-Pokhara distance (~200km)", () => {
    const dist = haversineKm(27.7172, 85.3240, 28.2096, 83.9856);
    expect(dist).toBeGreaterThan(140);
    expect(dist).toBeLessThan(220);
  });

  it("calculates known Earth distance (London-Paris ~344km)", () => {
    const dist = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(400);
  });

  it("handles antipodal points", () => {
    const dist = haversineKm(0, 0, 0, 180);
    expect(dist).toBeCloseTo(20015, -2);
  });

  it("handles zero latitude difference", () => {
    const dist = haversineKm(27.7, 85.3, 27.7, 86.3);
    expect(dist).toBeGreaterThan(0);
  });
});

describe("isValidLatLon", () => {
  it("returns true for valid coordinates", () => {
    expect(isValidLatLon(27.7, 85.3)).toBe(true);
  });

  it("returns false for out-of-range latitude", () => {
    expect(isValidLatLon(100, 85.3)).toBe(false);
  });

  it("returns false for out-of-range longitude", () => {
    expect(isValidLatLon(27.7, 200)).toBe(false);
  });

  it("returns false for NaN", () => {
    expect(isValidLatLon(NaN, 85.3)).toBe(false);
  });

  it("returns false for Infinity", () => {
    expect(isValidLatLon(27.7, Infinity)).toBe(false);
  });

  it("accepts boundary values", () => {
    expect(isValidLatLon(90, 180)).toBe(true);
    expect(isValidLatLon(-90, -180)).toBe(true);
  });
});

describe("isPointInNepal", () => {
  it("returns true for Kathmandu", () => {
    expect(isPointInNepal(27.7172, 85.3240)).toBe(true);
  });

  it("returns true for Pokhara", () => {
    expect(isPointInNepal(28.2096, 83.9856)).toBe(true);
  });

  it("returns false for London", () => {
    expect(isPointInNepal(51.5074, -0.1278)).toBe(false);
  });

  it("returns false for New Delhi", () => {
    expect(isPointInNepal(28.6139, 77.2090)).toBe(false);
  });
});

describe("distanceToSegmentKm", () => {
  it("returns 0 for point on segment endpoint", () => {
    const dist = distanceToSegmentKm(27.7, 85.3, 27.7, 85.3, 28.2, 84.0);
    expect(dist).toBeLessThan(1);
  });

  it("returns positive distance for point off segment", () => {
    const dist = distanceToSegmentKm(27.7, 85.3, 28.2, 84.0, 28.5, 83.5);
    expect(dist).toBeGreaterThan(0);
  });

  it("handles very short segment", () => {
    const dist = distanceToSegmentKm(27.7, 85.3, 27.71, 85.31, 27.71, 85.31);
    expect(dist).toBeGreaterThan(0);
  });
});

describe("nameSimilarity", () => {
  it("returns 1 for exact match", () => {
    expect(nameSimilarity("Kathmandu", "Kathmandu")).toBe(1);
  });

  it("returns 0.85 for substring match", () => {
    expect(nameSimilarity("Pokhara", "Pokhara Valley")).toBe(0.85);
  });

  it("returns 0 for completely different names", () => {
    expect(nameSimilarity("Kathmandu", "Pokhara")).toBe(0);
  });

  it("handles case differences", () => {
    expect(nameSimilarity("kathmandu", "Kathmandu")).toBe(1);
  });

  it("handles punctuation", () => {
    expect(nameSimilarity("Kathmandu!", "Kathmandu")).toBe(1);
  });
});
