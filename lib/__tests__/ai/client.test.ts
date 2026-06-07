import { describe, it, expect, vi, beforeEach } from "vitest";
import { callAI, callAIStream } from "@/lib/ai/client";

vi.mock("@/lib/cache", () => ({
  aiCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("callAI", () => {
  it("returns cached response without calling provider", async () => {
    const { aiCache } = await import("@/lib/cache");
    (aiCache.get as any).mockResolvedValue("cached response");

    const result = await callAI("test prompt");

    expect(result).toBe("cached response");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls provider and caches the result", async () => {
    const { aiCache } = await import("@/lib/cache");
    (aiCache.get as any).mockResolvedValue(null);
    (aiCache.set as any).mockResolvedValue(undefined);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Ollama response" } }],
      }),
    });

    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.AI_PROVIDER = "ollama";

    const result = await callAI("test");

    expect(result).toBe("Ollama response");
    expect(aiCache.set).toHaveBeenCalledWith(expect.any(String), "Ollama response", expect.any(Number));
  });

  it("returns empty string when all providers fail", async () => {
    const { aiCache } = await import("@/lib/cache");
    (aiCache.get as any).mockResolvedValue(null);

    mockFetch.mockRejectedValue(new Error("Network error"));
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.AI_PROVIDER = "ollama";

    // Free up the GROQ key env so it tries ollama only
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await callAI("test");
    expect(result).toBe("");
  });

  it("returns empty string when provider returns empty", async () => {
    const { aiCache } = await import("@/lib/cache");
    (aiCache.get as any).mockResolvedValue(null);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
    });

    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.AI_PROVIDER = "ollama";

    const result = await callAI("test");
    expect(result).toBe("");
  });
});

describe("callAIStream", () => {
  it("returns a ReadableStream", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([["content-type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"test\"}}]}\n\n"));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
    });

    process.env.OLLAMA_BASE_URL = "http://localhost:11434";

    const stream = await callAIStream("test");
    expect(stream).toBeInstanceOf(ReadableStream);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    expect(result).toBe("test");
  });
});
