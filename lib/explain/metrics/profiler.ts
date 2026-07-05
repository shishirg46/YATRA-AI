import type { EngineMeta } from "../types";
import { Timer } from "./timer";

export const ENGINE_VERSION = "2.0.0";

export class Profiler {
  private timer: Timer;
  private _templatesUsed = 0;
  private _conditionsEvaluated = 0;
  private _templateVersion = 0;

  constructor(templateVersion: number) {
    this.timer = new Timer();
    this._templateVersion = templateVersion;
  }

  recordTemplateUsed(): void {
    this._templatesUsed++;
  }

  recordConditionsEvaluated(count: number): void {
    this._conditionsEvaluated += count;
  }

  getMeta(): EngineMeta {
    return {
      engineVersion: ENGINE_VERSION,
      templateVersion: this._templateVersion,
      generationTimeMs: Math.round(this.timer.elapsed),
      templatesUsed: this._templatesUsed,
      evaluatedConditions: this._conditionsEvaluated,
    };
  }
}
