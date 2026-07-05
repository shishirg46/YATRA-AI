"use client";

import { Check, Loader2, AlertTriangle, XCircle, Circle } from "lucide-react";
import type { AnalysisPhase } from "@/lib/plan/pipeline-types";

interface PlannerStageProps {
  phase: AnalysisPhase;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Circle size={18} className="text-slate-500" />,
  running: <Loader2 size={18} className="text-amber-400 animate-spin" />,
  completed: <Check size={18} className="text-emerald-400" />,
  warning: <AlertTriangle size={18} className="text-amber-400" />,
  failed: <XCircle size={18} className="text-red-400" />,
};

export function PlannerStage({ phase }: PlannerStageProps) {
  const icon = STATUS_ICONS[phase.status] ?? STATUS_ICONS.pending;
  const duration =
    phase.status === "completed" && phase.durationMs
      ? `${(phase.durationMs / 1000).toFixed(1)}s`
      : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3">
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 font-body text-sm text-slate-200">{phase.label}</span>
      {duration && (
        <span className="flex-shrink-0 font-mono text-xs text-slate-500">{duration}</span>
      )}
    </div>
  );
}
