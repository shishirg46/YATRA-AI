// AI client with multi-provider support + response caching
// Primary: Ollama (free, no API key; set OLLAMA_BASE_URL for remote hosting)
// Fallback: Groq → Gemini → Claude (if API keys configured)
// Set AI_PROVIDER env to override provider

import { aiCache } from "@/lib/cache";

const AI_PROVIDER = process.env.AI_PROVIDER ?? "ollama";

interface AiOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
  stream?: boolean;
}

const PROVIDER_ORDER: string[] = ["ollama", "groq", "gemini", "claude"];

const DEFAULT_OPTS: Record<string, AiOptions> = {
  ollama: { model: process.env.OLLAMA_MODEL ?? "llama3.2:latest", maxTokens: 2048, temperature: 0.3 },
  groq: { model: "llama-3.3-70b-versatile", maxTokens: 1200, temperature: 0.7 },
  gemini: { model: "gemini-2.0-flash", maxTokens: 1200, temperature: 0.7 },
  claude: { model: "claude-sonnet-4-20250514", maxTokens: 1200, temperature: 0.7 },
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function hashStr(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) & 0xffffffff;
  }
  return `ai:${hash.toString(36)}`;
}

function cacheKey(prompt: string, opts?: AiOptions): string {
  return hashStr(`${AI_PROVIDER}|${opts?.system ?? ""}|${prompt}`);
}

export async function callAI(prompt: string, opts?: AiOptions): Promise<string> {
  if (opts?.stream) {
    const stream = await callAIStream(prompt, opts);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    return result;
  }

  const key = cacheKey(prompt, opts);
  const cached = await aiCache.get<string>(key);
  if (cached !== null) return cached;

  // Try the configured provider first, then fall back
  const providers = [AI_PROVIDER, ...PROVIDER_ORDER.filter((p) => p !== AI_PROVIDER)];

  for (const provider of providers) {
    const apiKey = getKeyForProvider(provider);
    if (!apiKey) continue;

    const merged = { ...(DEFAULT_OPTS[provider] ?? DEFAULT_OPTS.groq), ...opts };

    try {
      const text = await callProvider(provider, prompt, merged);
      if (text) {
        await aiCache.set(key, text, CACHE_TTL_MS);
        return text;
      }
      // Empty response — cascade to next provider
    } catch (err) {
      console.warn(`[ai] ${provider} failed, trying next provider:`, err instanceof Error ? err.message : err);
    }
  }

  console.warn(`[ai] All providers failed for prompt: ${prompt.slice(0, 100)}...`);
  return "";
}

export async function callAIStream(
  prompt: string,
  opts?: AiOptions,
): Promise<ReadableStream<Uint8Array>> {
  const merged = { ...DEFAULT_OPTS.ollama, ...opts, stream: true };
  return callOllamaStream(prompt, merged);
}

function getKeyForProvider(provider: string): string | null {
  switch (provider) {
    case "ollama": return "local"; // no key needed
    case "groq":  return process.env.GROQ_API_KEY ?? null;
    case "gemini": return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    case "claude": return process.env.ANTHROPIC_API_KEY || null;
    default:      return null;
  }
}

async function callProvider(provider: string, prompt: string, opts: AiOptions): Promise<string> {
  switch (provider) {
    case "ollama": return callOllama(prompt, opts);
    case "groq":  return callGroq(prompt, opts);
    case "gemini": return callGemini(prompt, opts);
    case "claude": return callClaude(prompt, opts);
    default:      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// ── Ollama (local, free, runs on your machine) ───────────────────────────

async function callOllama(prompt: string, opts: AiOptions): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = opts.model ?? "llama3.2";

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 256,
      temperature: opts.temperature ?? 0.3,
      options: { num_ctx: 2048, num_batch: 512 },
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: prompt },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callOllamaStream(
  prompt: string,
  opts: AiOptions,
): Promise<ReadableStream<Uint8Array>> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = opts.model ?? "llama3.2";

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 256,
      temperature: opts.temperature ?? 0.3,
      options: { num_ctx: 2048, num_batch: 512 },
      messages: [
        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: prompt },
      ],
      stream: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${body.slice(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson")) {
    // SSE stream from Ollama
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    (async () => {
      try {
        if (!res.body) throw new Error("Ollama returned empty body");
        const reader = res.body.getReader();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? "";
                if (content) {
                  await writer.write(encoder.encode(content));
                }
              } catch {
                // skip malformed JSON lines
              }
            }
          }
        }
      } catch (err) {
        console.error("[ollama-stream] Error:", err);
      } finally {
        await writer.close();
      }
    })();

    return readable;
  }

  // Non-streaming response (fallback)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

// ── Groq (free, Llama 3 models, OpenAI-compatible API) ────────────────────

async function callGroq(prompt: string, opts: AiOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    keepalive: true,
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
    keepalive: true,
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
    keepalive: true,
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
