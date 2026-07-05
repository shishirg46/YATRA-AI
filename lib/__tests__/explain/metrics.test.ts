import { describe, it, expect } from "vitest";
import { Timer } from "@/lib/explain/metrics/timer";
import { Profiler, ENGINE_VERSION } from "@/lib/explain/metrics/profiler";

describe("Timer", () => {
  it("measures elapsed time", () => {
    const timer = new Timer();
    const elapsed = timer.elapsed;
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it("stop() returns final time", () => {
    const timer = new Timer();
    const stopped = timer.stop();
    expect(stopped).toBeGreaterThanOrEqual(0);
    expect(timer.elapsed).toBe(stopped);
  });

  it("stop() is idempotent", () => {
    const timer = new Timer();
    const first = timer.stop();
    const second = timer.stop();
    expect(first).toBe(second);
  });
});

describe("Profiler", () => {
  it("starts with correct template version", () => {
    const p = new Profiler(3);
    const meta = p.getMeta();
    expect(meta.templateVersion).toBe(3);
  });

  it("records templates used", () => {
    const p = new Profiler(1);
    p.recordTemplateUsed();
    p.recordTemplateUsed();
    p.recordTemplateUsed();
    expect(p.getMeta().templatesUsed).toBe(3);
  });

  it("records conditions evaluated", () => {
    const p = new Profiler(1);
    p.recordConditionsEvaluated(7);
    expect(p.getMeta().evaluatedConditions).toBe(7);
  });

  it("uses correct engine version", () => {
    const p = new Profiler(1);
    expect(p.getMeta().engineVersion).toBe(ENGINE_VERSION);
  });

  it("generationTimeMs is a positive number", () => {
    const p = new Profiler(1);
    expect(p.getMeta().generationTimeMs).toBeGreaterThanOrEqual(0);
  });
});
