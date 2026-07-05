"use client";

import { useMemo } from "react";
import { usePlannerStore } from "@/lib/stores/planner";
import { PlannerStage } from "./PlannerStage";

const DEFAULT_MESSAGES: Record<string, string> = {
  destination: "Checking destination safety…",
  route: "Analysing route conditions…",
  evidence: "Gathering weather and hazard data…",
  travellers: "Evaluating traveller profiles…",
  pillars: "Computing safety pillars…",
  budget: "Calculating budget feasibility…",
  alternatives: "Finding safer alternatives…",
  ai: "Asking the safety advisor…",
  response: "Finalizing report…",
};

export function PlannerProgress() {
  const phases = usePlannerStore((s) => s.phases);

  const sortedPhases = useMemo(
    () => [...phases].sort((a, b) => a.step - b.step),
    [phases],
  );

  const currentPhase = sortedPhases.find((p) => p.status === "running") ?? sortedPhases.at(-1);

  return (
    <div className="mx-auto max-w-lg py-12">
      <h2 className="font-display text-xl text-amber-400 mb-2">
        Analysing your trip
      </h2>
      <p className="font-body text-sm text-slate-400 mb-8">
        {currentPhase?.message ?? DEFAULT_MESSAGES[currentPhase?.stageName ?? ""] ?? "Working…"}
      </p>

      <div className="space-y-3">
        {sortedPhases.map((phase) => (
          <PlannerStage key={`${phase.step}-${phase.stageName}`} phase={phase} />
        ))}
      </div>
    </div>
  );
}
