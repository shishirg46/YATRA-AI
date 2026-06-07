"use client";

import { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft, Mountain, AlertTriangle, Navigation } from "lucide-react";

const STEPS = [
  {
    title: "Find Your Destination",
    description: "Search any destination, district, or province in Nepal. Use the filter to sort by safety level — Safe, Caution, High Risk, or Extreme.",
    icon: Mountain,
    highlight: "search-area",
    position: "bottom" as const,
  },
  {
    title: "Emergency Actions",
    description: "Tap the red SOS button anytime to alert your emergency contacts with your location. It's always accessible from the bottom-right corner.",
    icon: AlertTriangle,
    highlight: "fab-area",
    position: "top" as const,
  },
  {
    title: "Set Your Origin",
    description: "Set your starting point to get personalized route safety data. Use auto-detect or search manually — your location powers smarter recommendations.",
    icon: Navigation,
    highlight: "origin-area",
    position: "bottom" as const,
  },
];

export function FirstRunCoachmarks() {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const seen = localStorage.getItem("yatraCoachmarkSeen");
    if (!seen) setDismissed(false);
  }, []);

  function dismiss() {
    setDismissed(true);
    localStorage.setItem("yatraCoachmarkSeen", "true");
  }

  if (dismissed) return null;

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={dismiss} />

      <div className="absolute inset-0 flex items-end md:items-center justify-center pointer-events-none pb-28 md:pb-0">
        <div
          className="pointer-events-auto mx-4 max-w-md w-full bg-slate-900 border border-slate-700/60 rounded-2xl p-5 shadow-2xl shadow-black/50 backdrop-blur-xl"
          style={{ animation: "coachFadeUp .3s ease both" }}
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/25 flex items-center justify-center shrink-0">
              <Icon size={20} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="font-display font-bold text-white text-sm">{current.title}</p>
                <span className="text-xs text-slate-600 font-body">Step {step + 1}/{STEPS.length}</span>
              </div>
              <p className="font-body text-sm text-slate-400 leading-relaxed">{current.description}</p>

              {/* Step dots */}
              <div className="flex items-center gap-1.5 mt-4 mb-4">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-amber-400" : "w-1.5 bg-slate-700"}`}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between">
                <button onClick={dismiss} className="font-body text-xs text-slate-500 hover:text-slate-300 transition-colors">
                  Skip tour
                </button>
                <div className="flex items-center gap-2">
                  {step > 0 && (
                    <button
                      onClick={() => setStep(step - 1)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700/50 text-slate-300 hover:text-white hover:border-slate-500 transition-all font-body text-xs"
                    >
                      <ChevronLeft size={12} /> Back
                    </button>
                  )}
                  {step < STEPS.length - 1 ? (
                    <button
                      onClick={() => setStep(step + 1)}
                      className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition-all font-body text-xs"
                    >
                      Next <ChevronRight size={12} />
                    </button>
                  ) : (
                    <button
                      onClick={dismiss}
                      className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition-all font-body text-xs"
                    >
                      Got it!
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes coachFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
