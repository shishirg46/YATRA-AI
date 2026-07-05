import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/explain/templates/renderer";

describe("renderTemplate", () => {
  it("replaces basic placeholders", () => {
    const result = renderTemplate("Heavy rainfall near {{segment}}.", { segment: "Mugling" });
    expect(result).toBe("Heavy rainfall near Mugling.");
  });

  it("replaces multiple placeholders", () => {
    const result = renderTemplate("{{destination}} in {{district}}.", {
      destination: "Pokhara",
      district: "Kaski",
    });
    expect(result).toBe("Pokhara in Kaski.");
  });

  it("handles optional placeholders gracefully when missing", () => {
    const result = renderTemplate("Road near {{segment?}} remains open.", {});
    expect(result).toBe("Road near  remains open.");
  });

  it("leaves required placeholders as-is when missing", () => {
    const result = renderTemplate("Heavy rainfall near {{segment}}.", {});
    expect(result).toBe("Heavy rainfall near {{segment}}.");
  });

  it("formats numbers", () => {
    const result = renderTemplate("Budget: NPR {{budget:currency}}.", { budget: 18500 });
    expect(result).toContain("18,500");
  });

  it("formats percentages", () => {
    const result = renderTemplate("Chance: {{pct:percentage}}.", { pct: 82.3 });
    expect(result).toContain("82%");
  });

  it("formats distances", () => {
    const result = renderTemplate("Distance: {{dist:distance}}.", { dist: 12.5 });
    expect(result).toContain("12.5 km");
  });

  it("formats temperatures", () => {
    const result = renderTemplate("Temp: {{temp:temperature}}.", { temp: 25 });
    expect(result).toContain("25°C");
  });

  it("handles empty template string", () => {
    expect(renderTemplate("", {})).toBe("");
  });

  it("handles template with no placeholders", () => {
    expect(renderTemplate("Static text here.", {})).toBe("Static text here.");
  });
});
