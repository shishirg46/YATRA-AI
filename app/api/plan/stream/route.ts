/**
 * POST /api/plan/stream
 *
 * SSE endpoint. Emits:
 *   progress  → AnalysisPhase (as emitted by the pipeline)
 *   complete  → AnalysisResult (full payload, identical to POST /api/plan)
 *   error     → { message: string; code: "FATAL_ANALYSIS" | "INTERNAL_ERROR" }
 *   heartbeat → { timestamp: number }
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { withRateLimit } from "@/lib/rate-limit";
import { runAnalysis } from "@/lib/plan/pipeline";
import { parsePlanRequest } from "@/lib/plan/parse-plan-request";
import { FatalAnalysisError } from "@/lib/plan/pipeline-types";
import type { AnalysisPhase } from "@/lib/plan/pipeline-types";

// ── SSE helpers ───────────────────────────────────────────────────────────

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown,
) {
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  } catch {
    /* client disconnected */
  }
}

function sendProgress(c: ReadableStreamDefaultController, e: TextEncoder, phase: AnalysisPhase) {
  sendEvent(c, e, "progress", phase);
}

function sendComplete(c: ReadableStreamDefaultController, e: TextEncoder, result: unknown) {
  sendEvent(c, e, "complete", result);
}

function sendError(c: ReadableStreamDefaultController, e: TextEncoder, payload: { message: string; code: string }) {
  sendEvent(c, e, "error", payload);
}

function sendHeartbeat(c: ReadableStreamDefaultController, e: TextEncoder) {
  sendEvent(c, e, "heartbeat", { timestamp: Date.now() });
}

// ── Handler ───────────────────────────────────────────────────────────────

async function planStreamHandler(req: NextRequest) {
  const parsed = await parsePlanRequest(req);
  if (!parsed.ok) return parsed.response;

  const debug =
    process.env.NODE_ENV !== "production" ||
    process.env.ANALYSIS_DEBUG === "1";

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      const safeClose = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      heartbeatTimer = setInterval(() => {
        if (!closed) sendHeartbeat(controller, encoder);
      }, 15_000);

      req.signal.addEventListener("abort", () => safeClose(), { once: true });

      try {
        const analysis = await runAnalysis(parsed.ctx, {
          debug,
          signal: req.signal,
          onProgress: (phase) => {
            if (!closed) sendProgress(controller, encoder, phase);
          },
        });

        if (!closed) sendComplete(controller, encoder, analysis);
      } catch (err) {
        if (closed) return;

        if (err instanceof Error && err.name === "AbortError") {
          safeClose();
          return;
        }

        if (err instanceof FatalAnalysisError) {
          sendError(controller, encoder, { message: err.message, code: "FATAL_ANALYSIS" });
        } else {
          console.error("[api/plan/stream] Unexpected error:", err);
          sendError(controller, encoder, { message: "An unexpected error occurred.", code: "INTERNAL_ERROR" });
        }
      } finally {
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const POST = withRateLimit(planStreamHandler, { max: 10, windowSeconds: 60 });
