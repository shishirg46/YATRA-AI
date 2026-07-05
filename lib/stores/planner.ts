import { create } from "zustand";
import type { AnalysisPhase } from "@/lib/plan/pipeline-types";
import type { PlanReport } from "@/lib/types/plan-report";

export type StreamStatus = "idle" | "connecting" | "streaming" | "complete" | "error";

export interface PlannerState {
  streamStatus: StreamStatus;
  phases: AnalysisPhase[];
  report: PlanReport | null;
  error: string | null;

  addPhase: (phase: AnalysisPhase) => void;
  setComplete: (report: PlanReport) => void;
  setError: (message: string) => void;
  setStreamStatus: (status: StreamStatus) => void;
  reset: () => void;
}

export const usePlannerStore = create<PlannerState>((set) => ({
  streamStatus: "idle",
  phases: [],
  report: null,
  error: null,

  addPhase: (phase) =>
    set((state) => {
      const i = state.phases.findIndex(
        (p) => p.step === phase.step && p.stageName === phase.stageName,
      );
      if (i >= 0) {
        const next = [...state.phases];
        next[i] = phase;
        return { phases: next };
      }
      return { phases: [...state.phases, phase] };
    }),

  setComplete: (report) =>
    set((state) => {
      if (state.streamStatus === "complete") return state;
      return { report, streamStatus: "complete" as const };
    }),

  setError: (message) => set({ error: message, streamStatus: "error" as const }),

  setStreamStatus: (streamStatus) => set({ streamStatus }),

  reset: () =>
    set({
      streamStatus: "idle",
      phases: [],
      report: null,
      error: null,
    }),
}));
