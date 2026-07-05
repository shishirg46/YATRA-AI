import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatCurrency,
  formatDate,
  formatDistance,
  formatTemperature,
  formatPercentage,
} from "@/lib/explain/utils/formatters";

describe("formatters", () => {
  describe("formatNumber", () => {
    it("formats with en-IN locale", () => {
      expect(formatNumber(12345)).toBe("12,345");
    });
  });

  describe("formatCurrency", () => {
    it("formats NPR currency", () => {
      const result = formatCurrency(18500);
      expect(result).toContain("18,500");
    });
  });

  describe("formatDate", () => {
    it("formats a date string", () => {
      const result = formatDate("2026-07-15");
      expect(result).toContain("Jul");
      expect(result).toContain("2026");
    });
  });

  describe("formatDistance", () => {
    it("formats kilometers", () => {
      expect(formatDistance(12.5)).toContain("12.5");
      expect(formatDistance(12.5)).toContain("km");
    });

    it("formats meters for small distances", () => {
      expect(formatDistance(0.5)).toContain("500");
      expect(formatDistance(0.5)).toContain("m");
    });
  });

  describe("formatTemperature", () => {
    it("formats with °C", () => {
      expect(formatTemperature(25)).toBe("25°C");
    });
  });

  describe("formatPercentage", () => {
    it("formats with %", () => {
      expect(formatPercentage(82.3)).toBe("82%");
    });
  });
});
