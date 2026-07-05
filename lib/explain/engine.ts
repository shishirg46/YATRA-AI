import type {
  ExplanationReport,
  ExplanationContext,
  ExplanationItem,
  Evaluator,
  EvaluatorInput,
  DebugTrace,
} from "./types";

import { TemplateCache } from "./templates/cache";
import { renderResults } from "./templates/renderer";
import { selectTemplates } from "./templates/selector";
import { deduplicate } from "./utils/deduplicate";
import filterSegments from "./utils/filterSegments";
import { assemble } from "./utils/assemble";
import { buildSummary } from "./summary/summary";
import { computeConfidence } from "./confidence/confidence";
import { Profiler } from "./metrics/profiler";

import { weatherEvaluator } from "./conditions/weather";
import { routeEvaluator } from "./conditions/route";
import { healthEvaluator } from "./conditions/health";
import { budgetEvaluator } from "./conditions/budget";
import { destinationEvaluator } from "./conditions/destination";
import { seasonalEvaluator } from "./conditions/seasonal";
import { groupEvaluator } from "./conditions/group";

const DEFAULT_EVALUATORS: Evaluator[] = [
  weatherEvaluator,
  routeEvaluator,
  healthEvaluator,
  budgetEvaluator,
  destinationEvaluator,
  seasonalEvaluator,
  groupEvaluator,
];

export class ExplanationEngine {
  private readonly evaluators: Evaluator[];

  constructor(
    private cache: TemplateCache,
    evaluators?: Evaluator[],
  ) {
    this.evaluators = evaluators ?? DEFAULT_EVALUATORS;
  }

  static async create(
    cache?: TemplateCache,
    evaluators?: Evaluator[],
  ): Promise<ExplanationEngine> {
    const c = cache ?? TemplateCache.instance;
    return new ExplanationEngine(c, evaluators);
  }

  async run(input: EvaluatorInput): Promise<ExplanationReport> {
    const ctx: ExplanationContext = {
      report: input,
      now: new Date(),
      debug: process.env.NODE_ENV === "development",
    };

    const profiler = new Profiler(this.cache.templateVersion);
    const debugTraces: DebugTrace[] = [];

    const raw = this.collect(ctx, profiler);
    const deduped = deduplicate(raw);
    const filtered = filterSegments(deduped);
    const ranked = this.prioritize(filtered);
    const rendered = this.renderWithTracking(ranked, ctx, debugTraces, profiler);
    const summaryText = buildSummary(rendered, ctx, this.cache);
    const confidence = computeConfidence(ctx);
    const meta = profiler.getMeta();

    const topTip = this.extractTopTip(rendered);

    return assemble({
      rendered,
      summaryText,
      confidence,
      meta,
      debugTraces,
      topTip,
    });
  }

  private collect(ctx: ExplanationContext, profiler: Profiler): import("./types").EvaluatorResult[] {
    const all: import("./types").EvaluatorResult[] = [];

    for (const evaluator of this.evaluators) {
      try {
        const results = evaluator(ctx);
        all.push(...results);
      } catch (err) {
        console.error(`[ExplanationEngine] Evaluator error: ${err}`);
      }
    }

    profiler.recordConditionsEvaluated(all.length);
    return all;
  }

  private prioritize(results: import("./types").EvaluatorResult[]): import("./types").EvaluatorResult[] {
    return [...results].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;

      const severityOrder: Record<string, number> = {
        EXTREME: 4,
        HIGH: 3,
        MEDIUM: 2,
        LOW: 1,
      };
      return (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0);
    });
  }

  private renderWithTracking(
    results: import("./types").EvaluatorResult[],
    ctx: ExplanationContext,
    debugTraces: DebugTrace[],
    profiler: Profiler,
  ): ExplanationItem[] {
    const rendered = renderResults(results, ctx, this.cache);

    for (const r of rendered) {
      profiler.recordTemplateUsed();
      debugTraces.push(r.item.debugTrace);
    }

    return rendered.map((r) => r.item);
  }

  private extractTopTip(items: ExplanationItem[]): string {
    const sorted = [...items]
      .filter((item) => !this.isBroadSeasonalTip(item))
      .sort((a, b) => b.priority - a.priority);
    if (sorted.length === 0) return "";
    const top = sorted[0];

    const topTipTemplates = this.cache.get("top_tip", "top_tip_default");
    if (topTipTemplates.length > 0) {
      const selected = this.cache.getLeastRecentlyUsed(topTipTemplates);
      this.cache.markUsed(selected.id);
      return selected.template.replace(/\{\{tip\}\}/g, top.text);
    }

    return top.text;
  }

  private isBroadSeasonalTip(item: ExplanationItem): boolean {
    return [
      "monsoon_active",
      "winter_season",
      "peak_travel_season",
    ].includes(item.condition);
  }
}
