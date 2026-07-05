"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

interface PlannerErrorProps {
  message: string;
  onRetry: () => void;
}

export function PlannerError({ message, onRetry }: PlannerErrorProps) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <AlertTriangle size={40} className="mx-auto mb-4 text-red-400" />
      <p className="font-body text-red-400 mb-6">{message}</p>
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onRetry}
          className="rounded-lg bg-amber-500 px-5 py-2 font-body text-sm font-medium text-slate-900 hover:bg-amber-400 transition-colors"
        >
          Retry
        </button>
        <Link
          href="/plan"
          className="font-body text-sm text-slate-400 hover:text-slate-300 underline transition-colors"
        >
          ← Back to plan form
        </Link>
      </div>
    </div>
  );
}
