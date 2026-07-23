import type { AiNarrativeProvider, AiNarrativeResult, AiNarrativeDiagnostics } from "./types";
import type { EvaluatorInput } from "../types";
import { ExplanationEngine } from "../engine";
import { TemplateCache } from "../templates/cache";
import { explanationToAiResult } from "../mapper";

export const templateProvider: AiNarrativeProvider<EvaluatorInput> = {
  name: "template",

  isAvailable(): boolean {
    return true;
  },

  async generate(
    input: EvaluatorInput,
    _signal?: AbortSignal,
  ): Promise<{
    result: AiNarrativeResult;
    diagnostics: Partial<AiNarrativeDiagnostics>;
  }> {
    if (!TemplateCache.instance.size) {
      const { prisma } = await import("@/lib/prisma");
      try {
        await TemplateCache.initialize(prisma);
      } catch (err) {
        console.error("[template-provider] TemplateCache init failed:", err);
      }
    }

    const engine = new ExplanationEngine(TemplateCache.instance);
    const report = await engine.run(input);

    const hasAlternatives = (input.alternatives?.length ?? 0) > 0;
    const topAlt = hasAlternatives && input.alternatives?.[0]
      ? {
          name: input.alternatives[0].name,
          district: input.alternatives[0].district,
          safetyScore: input.alternatives[0].safetyScore,
        }
      : undefined;

    const mapped = explanationToAiResult(report, hasAlternatives, topAlt);

    const diagnostics: Partial<AiNarrativeDiagnostics> = {
      provider: "deterministic" as const,
      model: "explanation-engine-v2",
      fallbackUsed: true,
    };

    return { result: mapped.ai, diagnostics };
  },
};
