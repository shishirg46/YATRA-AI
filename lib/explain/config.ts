export const PROMPT_VERSION = "v1" as const;
export const CACHE_VERSION = "narrative-v1" as const;

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const narrativeConfig = {
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  groqTimeoutMs: positiveInt(process.env.GROQ_TIMEOUT_MS, 10_000),

  cache: {
    ttlMs: positiveInt(process.env.CACHE_TTL_MS, 60 * 60 * 1000),
    maxEntries: positiveInt(process.env.CACHE_MAX_ENTRIES, 100),
    version: CACHE_VERSION,
  },

  testing: {
    groqBaseUrl: process.env.TEST_GROQ_BASE_URL,
    badJson: process.env.TEST_GROQ_BAD_JSON === "1",
  },
};
