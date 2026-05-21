// AI client with multi-provider support + response caching
// Default: Groq (free, 30 req/min, no credit card needed)
// Fallbacks: Gemini → Claude (if configured)

const AI_PROVIDER = process.env.AI_PROVIDER ?? "groq";

interface AiOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

const PROVIDER_ORDER: string[] = ["groq", "gemini", "claude"];

const DEFAULT_OPTS: Record<string, AiOptions> = {
  groq: { model: "llama-3.3-70b-versatile", maxTokens: 1200, temperature: 0.7 },
  gemini: { model: "gemini-2.0-flash", maxTokens: 1200, temperature: 0.7 },
  claude: { model: "claude-sonnet-4-20250514", maxTokens: 1200, temperature: 0.7 },
};

// Simple in-memory cache keyed by prompt hash to avoid hitting rate limits
const responseCache = new Map<string, { text: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(prompt: string, opts?: AiOptions): string {
  return `${AI_PROVIDER}|${opts?.system ?? ""}|${prompt.slice(0, 200)}`;
}

export async function callAI(prompt: string, opts?: AiOptions): Promise<string> {
  const key = cacheKey(prompt, opts);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.text;

  // Try the configured provider first, then fall back
  const providers = [AI_PROVIDER, ...PROVIDER_ORDER.filter((p) => p !== AI_PROVIDER)];

  for (const provider of providers) {
    const apiKey = getKeyForProvider(provider);
    if (!apiKey) continue;

    const merged = { ...(DEFAULT_OPTS[provider] ?? DEFAULT_OPTS.groq), ...opts };

    try {
      const text = await callProvider(provider, prompt, merged);
      if (text) {
        responseCache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
        return text;
      }
    } catch (err) {
      console.warn(`[ai] ${provider} failed, trying next provider:`, err instanceof Error ? err.message : err);
    }
  }

  console.warn(`[ai] All providers failed for prompt: ${prompt.slice(0, 100)}...`);
  return "";
}

function getKeyForProvider(provider: string): string | null {
  switch (provider) {
    case "groq":  return process.env.GROQ_API_KEY ?? null;
    case "gemini": return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    case "claude": return process.env.ANTHROPIC_API_KEY || null;
    default:      return null;
  }
}

async function callProvider(provider: string, prompt: string, opts: AiOptions): Promise<string> {
  switch (provider) {
    case "groq":  return callGroq(prompt, opts);
    case "gemini": return callGemini(prompt, opts);
    case "claude": return callClaude(prompt, opts);
    default:      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// ── Groq (free, Llama 3 models, OpenAI-compatible API) ────────────────────

async function callGroq(prompt: string, opts: AiOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model ?? "llama-3.3-70b-versatile",
      max_tokens: opts.maxTokens ?? 1200,
      temperature: opts.temperature ?? 0.7,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error(`Groq rate limited: ${body.slice(0, 200)}`);
    console.error(`[ai] Groq error ${res.status}: ${body}`);
    return "";
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Gemini (free tier, 60 req/min) ────────────────────────────────────────

async function callGemini(prompt: string, opts: AiOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const model = opts.model ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 1200, temperature: opts.temperature ?? 0.7 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error(`Gemini rate limited: ${body.slice(0, 200)}`);
    console.error(`[ai] Gemini error ${res.status}: ${body}`);
    return "";
  }

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── Claude (requires credits) ────────────────────────────────────────────

async function callClaude(prompt: string, opts: AiOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      model: opts.model ?? "claude-sonnet-4-20250514",
      max_tokens: opts.maxTokens ?? 1200,
      system: opts.system ?? "",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error(`Claude rate limited: ${body.slice(0, 200)}`);
    console.error(`[ai] Claude error ${res.status}: ${body}`);
    return "";
  }

  const data = await res.json() as { content?: { type: string; text: string }[] };
  return data.content?.find((b) => b.type === "text")?.text ?? "";
}
