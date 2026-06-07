"use client";

import Link from "next/link";
import { Sparkles, MapPin, AlertTriangle, ChevronRight } from "lucide-react";
import { AiRecommendation } from "./types";

export function RecommendationsCarousel({
  recommendations,
  summary,
  aiUsed,
  savedIds,
  onToggleSave,
}: {
  recommendations: AiRecommendation[];
  summary: string;
  aiUsed: boolean;
  savedIds: string[];
  onToggleSave?: (id: string, saved: boolean) => void;
}) {
  if (!recommendations.length) return null;

  return (
    <div className="mb-8" style={{ animation: "fadeUp .6s .15s ease both" }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-amber-400" />
          <h2 className="font-display text-lg font-bold text-white">AI Recommendations</h2>
          {aiUsed && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-body bg-amber-400/10 text-amber-400 border border-amber-400/20 uppercase tracking-wider">
              AI
            </span>
          )}
        </div>
        <div className="flex-1 h-px bg-slate-800" />
        <span className="font-body text-xs text-slate-500 truncate max-w-xs">{summary}</span>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {recommendations.map((rec) => {
          const isSaved = savedIds.includes(rec.id);

          return (
            <Link
              key={rec.id}
              href={`/destinations/${rec.name.replace(/ /g, '_')}`}
              className="flex-shrink-0 w-72 group"
            >
              <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 hover:bg-slate-800/80 hover:border-amber-500/30 transition-all p-4 h-full flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display font-bold text-white text-base leading-tight group-hover:text-amber-400 transition-colors">
                    {rec.name}
                  </h3>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs font-body font-semibold text-amber-400">{rec.matchScore}</span>
                    <span className="text-[10px] text-slate-600">/100</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                  <MapPin size={10} />
                  {rec.district}
                </div>

                <p className="font-body text-xs text-slate-300 leading-relaxed flex-1">
                  {rec.whyVisit}
                </p>

                {rec.caution && (
                  <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-400/5 border border-amber-400/15">
                    <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
                    <span className="font-body text-[11px] text-amber-300/90">{rec.caution}</span>
                  </div>
                )}

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-700/50">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const next = !isSaved;
                      onToggleSave?.(rec.id, next);
                      fetch("/api/user/saved-destinations", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ destinationId: rec.id }),
                      }).catch(() => {});
                    }}
                    className={`text-xs transition-colors ${
                      isSaved ? "text-rose-400" : "text-slate-600 hover:text-rose-400/70"
                    }`}
                  >
                    {isSaved ? "♥ Saved" : "♡ Save"}
                  </button>
                  <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-400 group-hover:gap-1 transition-all">
                    Details <ChevronRight size={11} />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
