"use client";

import { useEffect } from "react";
import { Mountain } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ErrorPage]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="flex items-center gap-2 text-amber-400 mb-6">
        <Mountain size={28} />
        <span className="font-display font-bold text-xl">YatraAI</span>
      </div>
      <h1 className="text-2xl font-display font-bold text-foreground mb-2">
        Something went wrong
      </h1>
      <p className="text-muted-foreground text-center max-w-md mb-8 font-body text-sm">
        An unexpected error occurred. Please try again, or contact support if the
        problem persists.
      </p>
      <button
        onClick={() => reset()}
        className="px-6 py-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl font-medium text-sm hover:bg-amber-500/20 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
