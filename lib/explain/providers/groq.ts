import Groq from "groq-sdk";
import {
  RateLimitError,
  APIConnectionTimeoutError,
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
} from "groq-sdk";

import type {
  AiNarrativeProvider,
  AiNarrativeResult,
  AiNarrativeDiagnostics,
  CondensedNarrativeInput,
  ProviderErrorCode,
} from "./types";
import { AiNarrativeResultSchema } from "./types";
import { narrativeConfig, PROMPT_VERSION } from "../config";

function classifyError(err: unknown): ProviderErrorCode {
  if (err instanceof APIUserAbortError) return "timeout";
  if (err instanceof APIConnectionTimeoutError) return "timeout";
  if (err instanceof APIConnectionError) return "network";
  if (err instanceof RateLimitError) return "429";
  if (err instanceof AuthenticationError) return "auth";
  if (err instanceof BadRequestError) return "bad_request";
  if (err instanceof InternalServerError) return "server_error";

  const status = (err as any)?.status;
  if (status === 401) return "auth";
  if (status === 429) return "429";
  if (status && status >= 400 && status < 500) return "bad_request";
  if (status && status >= 500) return "server_error";

  return "unexpected";
}

function buildPrompt(input: CondensedNarrativeInput): string {
  return `You are a Nepal travel safety advisor. Analyze this trip data and return a JSON object with exactly these 8 fields: verdict, whyUnsafe, groupConflict, riskExplanation, healthWarning, budgetAdvice, alternativeReason, topTip.

Trip data:
${JSON.stringify(input, null, 2)}

Rules:
- Be honest, specific, and compassionate.
- No generic filler. Short paragraphs.
- Always prioritise safety.
- Return ONLY valid JSON, no markdown, no code fences.`;
}

function parseResponse(raw: string): AiNarrativeResult {
  const cleaned = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/\s*```/g, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  return AiNarrativeResultSchema.parse(parsed);
}

let client: Groq | null = null;

function getClient(): Groq {
  if (!client) {
    const opts: ConstructorParameters<typeof Groq>[0] = {
      apiKey: narrativeConfig.groqApiKey,
      timeout: narrativeConfig.groqTimeoutMs,
      maxRetries: 0,
    };
    if (narrativeConfig.testing.groqBaseUrl) {
      opts.baseURL = narrativeConfig.testing.groqBaseUrl;
    }
    client = new Groq(opts);
  }
  return client;
}

export const groqProvider: AiNarrativeProvider<CondensedNarrativeInput> = {
  name: "groq",

  isAvailable(): boolean {
    return !!narrativeConfig.groqApiKey;
  },

  async generate(
    input: CondensedNarrativeInput,
    signal?: AbortSignal,
  ): Promise<{
    result: AiNarrativeResult;
    diagnostics: Partial<AiNarrativeDiagnostics>;
  }> {
    const model = narrativeConfig.groqModel;
    const prompt = buildPrompt(input);

    const startTime = performance.now();

    try {
      const completion = await getClient().chat.completions.create(
        {
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a Nepal travel safety advisor. Always respond with valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: 1024,
        },
        { signal },
      );

      const choice = completion.choices?.[0];
      const raw = choice?.message?.content ?? "";

      let processed = raw;
      if (narrativeConfig.testing.badJson) {
        processed = raw.replace(/"/g, "'");
      }

      const result = parseResponse(processed);

      const diagnostics: Partial<AiNarrativeDiagnostics> = {
        provider: "groq" as const,
        model,
        promptVersion: PROMPT_VERSION,
        promptTokens: completion.usage?.prompt_tokens ?? undefined,
        completionTokens: completion.usage?.completion_tokens ?? undefined,
        totalTokens: completion.usage?.total_tokens ?? undefined,
        finishReason: choice?.finish_reason ?? undefined,
      };

      return { result, diagnostics };
    } catch (err) {
      console.error("[groq] Raw error object:", err);
      console.error("[groq] Error details:", {
        name: (err as any)?.name,
        message: (err as any)?.message,
        status: (err as any)?.status,
        code: (err as any)?.code,
        type: (err as any)?.type,
      });

      const code = classifyError(err);
      const wrapped = new Error(`Groq provider failed: ${code}`, { cause: err });
      (wrapped as any).code = code;
      throw wrapped;
    }
  },
};
