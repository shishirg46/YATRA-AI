"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlannerStore } from "@/lib/stores/planner";
import { planKeys } from "@/lib/query-keys";
import type { AnalysisPhase } from "@/lib/plan/pipeline-types";
import type { PlanReport } from "@/lib/types/plan-report";

// ── SSE buffer parser (transport only, no JSON parsing) ──────────────────

interface RawSSEEvent {
  event: string;
  data: string;
}

function parseSSEBuffer(buffer: string): { remainder: string; events: RawSSEEvent[] } {
  const parts = buffer.split("\n\n");
  const complete = parts.slice(0, -1);
  const remainder = parts[parts.length - 1] ?? "";

  const events: RawSSEEvent[] = [];

  for (const part of complete) {
    if (!part.trim()) continue;

    let eventType = "message";
    let dataValue = "";

    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        if (dataValue) dataValue += "\n";
        dataValue += line.slice(6);
      }
    }

    if (dataValue) {
      events.push({ event: eventType, data: dataValue });
    }
  }

  return { remainder, events };
}

// ── Hook ─────────────────────────────────────────────────────────────────

interface StartPlanBody {
  destinationId: string;
  startDate: string;
  endDate: string;
  tripType: "SOLO" | "GROUP";
  vehicle: string;
  travelStyle: string;
  budgetNPR: number;
  originLat: number | null;
  originLon: number | null;
  memberUsernames: string[];
}

export function usePlanStream() {
  const addPhase = usePlannerStore((s) => s.addPhase);
  const setComplete = usePlannerStore((s) => s.setComplete);
  const setError = usePlannerStore((s) => s.setError);
  const setStreamStatus = usePlannerStore((s) => s.setStreamStatus);
  const reset = usePlannerStore((s) => s.reset);

  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const lastHeartbeatRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    reset();
  }, [reset]);

  const restart = useCallback(
    (body: StartPlanBody) => {
      cancel();
      start(body);
    },
    [cancel],
  );

  const start = useCallback(
    async (body: StartPlanBody) => {
      reset();
      setStreamStatus("connecting");
      lastHeartbeatRef.current = 0;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/plan/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ message: "Request failed" }));
          setError(err.message ?? `Request failed (${response.status})`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError("Streaming not supported");
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let hasFirstProgress = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { remainder, events } = parseSSEBuffer(buffer);
          buffer = remainder;

          for (const evt of events) {
            switch (evt.event) {
              case "progress": {
                if (!hasFirstProgress) {
                  hasFirstProgress = true;
                  setStreamStatus("streaming");
                }
                try {
                  const phase = JSON.parse(evt.data) as AnalysisPhase;
                  addPhase(phase);
                } catch {
                  /* skip malformed progress */
                }
                break;
              }

              case "complete": {
                try {
                  const report = JSON.parse(evt.data) as PlanReport;
                  queryClient.setQueryData(
                    planKeys.analysis(body.destinationId, body.startDate, body.endDate),
                    report,
                  );
                  setComplete(report);
                } catch {
                  setError("Failed to parse analysis report");
                }
                break;
              }

              case "error": {
                try {
                  const { message } = JSON.parse(evt.data) as { message: string };
                  setError(message);
                } catch {
                  setError("An unknown error occurred");
                }
                break;
              }

              case "heartbeat": {
                lastHeartbeatRef.current = Date.now();
                break;
              }
            }
          }
        }

        // Stream ended but no "complete" or "error" event
        if (hasFirstProgress) {
          const status = usePlannerStore.getState().streamStatus;
          if (status !== "complete" && status !== "error") {
            setError("Stream ended unexpectedly");
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    },
    [addPhase, setComplete, setError, setStreamStatus, reset, queryClient],
  );

  return { start, cancel, restart };
}
