"use client";

import type { StopAnalysis } from "@/lib/types/plan-report";
import { MapPin, Mountain, Droplets, Landmark, CloudRain, Sparkles } from "lucide-react";

interface StopAnalysisCardProps {
  analysis: StopAnalysis;
}

const TERRAIN_EMOJI: Record<string, string> = {
  Flat: "▬",
  Rolling: "〜",
  Hill: "🏔",
  "Steep Hill": "⛰",
  Mountain: "🗻",
};

export default function StopAnalysisCard({ analysis }: StopAnalysisCardProps) {
  const { terrain, elevation, historical, weather, explanation, name } = analysis;

  return (
    <div className="plan-card rounded-2xl p-5 border border-slate-700/40">
      <div className="flex items-start gap-3 mb-3">
        <MapPin size={15} className="text-rose-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-sm text-white">{name}</h3>
            <span className="text-[10px] font-body text-slate-600">15 km radius</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-body mb-3">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Mountain size={12} className="text-amber-400 flex-shrink-0" />
          <span className="text-slate-500">Terrain</span>
          <span className="text-white font-medium">{TERRAIN_EMOJI[terrain]} {terrain}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Landmark size={12} className="text-amber-400 flex-shrink-0" />
          <span className="text-slate-500">Elevation</span>
          <span className="text-white font-medium">{elevation.mean} m</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Droplets size={12} className="text-orange-400 flex-shrink-0" />
          <span className="text-slate-500">Landslides</span>
          <span className={`font-medium ${historical.landslides > 10 ? "text-orange-400" : "text-slate-300"}`}>
            {historical.landslides}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Droplets size={12} className="text-blue-400 flex-shrink-0" />
          <span className="text-slate-500">Floods</span>
          <span className={`font-medium ${historical.floods > 5 ? "text-blue-400" : "text-slate-300"}`}>
            {historical.floods}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <CloudRain size={12} className="text-sky-400 flex-shrink-0" />
          <span className="text-slate-500">Rain</span>
          <span className="text-white font-medium">{weather.rainfall} mm</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="text-sky-400 flex-shrink-0 text-[11px]">🌡</span>
          <span className="text-slate-500">Temp</span>
          <span className="text-white font-medium">{weather.temperature}°C</span>
        </div>
      </div>

      {explanation && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
          <Sparkles size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="font-body text-xs text-slate-300 leading-relaxed">{explanation}</p>
        </div>
      )}
    </div>
  );
}
