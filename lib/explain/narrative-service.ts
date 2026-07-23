import type { EvaluatorInput } from "./types";
import type { AiNarrativeResult, AiNarrativeDiagnostics, ProviderError, CondensedNarrativeInput } from "./providers/types";
import { emptyAiNarrativeResult } from "./providers/types";
import { sha256 } from "./utils/hash";
import { narrativeCache } from "./providers/cache";
import { groqProvider } from "./providers/groq";
import { templateProvider } from "./providers/template";
import { condenseInput } from "./condense";
import { classifyError } from "./providers";

const aiProviders: readonly { name: string; isAvailable(): boolean; generate(input: CondensedNarrativeInput, signal?: AbortSignal): Promise<{ result: AiNarrativeResult; diagnostics: Partial<AiNarrativeDiagnostics> }> }[] = [
  groqProvider,
] as const;

const fallbackProviders: readonly { name: string; isAvailable(): boolean; generate(input: EvaluatorInput, signal?: AbortSignal): Promise<{ result: AiNarrativeResult; diagnostics: Partial<AiNarrativeDiagnostics> }> }[] = [
  templateProvider,
] as const;

export async function generateAiNarrative(
  input: EvaluatorInput,
  options?: { signal?: AbortSignal },
): Promise<{ result: AiNarrativeResult; diagnostics: AiNarrativeDiagnostics }> {
  const startTime = performance.now();
  const condensed = condenseInput(input);
  const cacheKey = narrativeCache.key(sha256(JSON.stringify(condensed)));
  const errors: ProviderError[] = [];

  const cached = narrativeCache.get(cacheKey);
  if (cached) {
    return {
      result: cached.result,
      diagnostics: {
        ...cached.diagnostics as Partial<AiNarrativeDiagnostics>,
        durationMs: performance.now() - startTime,
        cacheHit: true,
      } as AiNarrativeDiagnostics,
    };
  }

  for (const provider of aiProviders) {
    if (!provider.isAvailable()) continue;
    try {
      const output = await provider.generate(condensed, options?.signal);
      const diagnostics: AiNarrativeDiagnostics = {
        provider: "groq",
        model: output.diagnostics.model ?? "unknown",
        durationMs: performance.now() - startTime,
        fallbackUsed: false,
        cacheHit: false,
        promptVersion: output.diagnostics.promptVersion,
        promptTokens: output.diagnostics.promptTokens,
        completionTokens: output.diagnostics.completionTokens,
        totalTokens: output.diagnostics.totalTokens,
        finishReason: output.diagnostics.finishReason,
      };
      narrativeCache.set(cacheKey, {
        result: output.result,
        diagnostics: { provider: "groq", model: diagnostics.model },
      });
      return { result: output.result, diagnostics };
    } catch (err) {
      errors.push({ provider: provider.name, code: classifyError(err) });
      console.warn(`[narrative] ${provider.name} failed:`, (err as Error)?.message);
    }
  }

  for (const provider of fallbackProviders) {
    if (!provider.isAvailable()) continue;
    try {
      const output = await provider.generate(input, options?.signal);
      const diagnostics: AiNarrativeDiagnostics = {
        provider: "deterministic",
        model: output.diagnostics.model ?? "explanation-engine-v2",
        durationMs: performance.now() - startTime,
        fallbackUsed: errors.length > 0,
        cacheHit: false,
        errors: errors.length > 0 ? errors : undefined,
      };
      narrativeCache.set(cacheKey, {
        result: output.result,
        diagnostics: { provider: "deterministic", model: diagnostics.model },
      });
      return { result: output.result, diagnostics };
    } catch (err) {
      errors.push({ provider: provider.name, code: classifyError(err) });
    }
  }

  return {
    result: emptyAiNarrativeResult(),
    diagnostics: {
      provider: "none",
      model: "none",
      durationMs: performance.now() - startTime,
      fallbackUsed: false,
      cacheHit: false,
      errors,
    },
  };
}
