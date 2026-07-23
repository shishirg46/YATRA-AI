"use client";

import { useState } from "react";
import {
  ChevronDown, ChevronUp, Navigation, AlertTriangle, Shield,
} from "lucide-react";

interface SegmentRow {
  index: number;
  from: string;
  to: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  distanceKm: number;
  riskLevel: string;
  riskScore: number;
  gradient: number | null;
  roadSurface: { highway: string; surface: string | null; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME" } | null;
  riverProximityKm: number | null;
  elevationStart: number | null;
  elevationEnd: number | null;
  hazards: string[];
  floodIndex: number;
  landslideIndex: number;
  earthquakeIndex: number;
  temperature: number;
  rainfall: number;
  windSpeed: number;
}

const RISK_BADGE: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  LOW:      { label: "Low",      color: "text-emerald-300", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  MEDIUM:   { label: "Medium",   color: "text-amber-300",   bg: "bg-amber-500/10",   dot: "bg-amber-400" },
  HIGH:     { label: "High",     color: "text-orange-300",  bg: "bg-orange-500/10",  dot: "bg-orange-400" },
  EXTREME:  { label: "Extreme",  color: "text-red-300",     bg: "bg-red-500/10",     dot: "bg-red-400" },
};

function HazardBar({ value, label }: { value: number; label: string }) {
  const pct = Math.min(value * 100, 100);
  const barColor = pct > 60 ? "bg-red-500" : pct > 30 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-body text-[10px] text-slate-500 w-12 shrink-0">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-slate-700/60 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SegmentCard({ seg, defaultOpen }: { seg: SegmentRow; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const badge = RISK_BADGE[seg.riskLevel] ?? RISK_BADGE.LOW;

  const hazardCount = [seg.floodIndex, seg.landslideIndex, seg.earthquakeIndex].filter((v) => v > 0.1).length;

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left">
        <div className={`w-2 h-2 rounded-full shrink-0 ${badge.dot}`} />
        <span className="font-body text-xs text-slate-500 w-5 shrink-0">{seg.index + 1}</span>
        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 items-center">
          <p className="font-body text-sm text-white truncate">
            {seg.from} <span className="text-slate-600">→</span> {seg.to}
          </p>
          <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.color} ${badge.bg} border-current`}>
            {badge.label}
          </span>
          <span className="font-body text-[11px] text-slate-500 hidden md:block">{seg.distanceKm} km</span>
          {seg.gradient !== null && Math.abs(seg.gradient) > 1 && (
            <span className="font-body text-[11px] text-slate-400 hidden md:block">
              {seg.gradient >= 0 ? "+" : ""}{seg.gradient}%
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500 shrink-0" /> : <ChevronDown size={14} className="text-slate-500 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700/30 grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
          {/* Left: hazards + weather */}
          <div className="space-y-2">
            <p className="font-body text-[10px] text-slate-600 uppercase tracking-widest">Segment Hazard (realtime)</p>
            <HazardBar value={seg.floodIndex} label="Flood" />
            <HazardBar value={seg.landslideIndex} label="Landslide" />
            <HazardBar value={seg.earthquakeIndex} label="Earthquake" />
            {seg.rainfall > 0 && (
              <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400">
                <span>🌧 {seg.temperature}°C</span>
                <span className="text-slate-600">·</span>
                <span>{seg.rainfall}mm/h</span>
                <span className="text-slate-600">·</span>
                <span>{Math.round(seg.windSpeed * 3.6)}km/h</span>
              </div>
            )}
          </div>

          {/* Right: road + terrain details */}
          <div className="space-y-1.5">
            {seg.roadSurface && (
              <div className="flex items-center gap-2">
                <Navigation size={11} className="text-slate-500 shrink-0" />
                <span className="font-body text-xs text-slate-300 capitalize">
                  {seg.roadSurface.highway}
                  {seg.roadSurface.surface ? ` / ${seg.roadSurface.surface}` : ""}
                </span>
              </div>
            )}
            {seg.riverProximityKm !== null && seg.riverProximityKm < 5 && (
              <div className="flex items-center gap-2">
                <span className="text-xs">🌊</span>
                <span className="font-body text-xs text-slate-300">
                  River {Math.round(seg.riverProximityKm * 1000)}m
                </span>
              </div>
            )}
            {seg.gradient !== null && (
              <div className="flex items-center gap-2">
                <span className="font-body text-[11px] text-slate-500">Grade</span>
                <span className={`font-body text-xs font-medium ${Math.abs(seg.gradient) > 8 ? "text-orange-400" : "text-slate-300"}`}>
                  {seg.gradient >= 0 ? "+" : ""}{seg.gradient}%
                </span>
              </div>
            )}
            {seg.elevationStart !== null && seg.elevationEnd !== null && (
              <div className="flex items-center gap-2">
                <span className="font-body text-[11px] text-slate-500">Elev</span>
                <span className="font-body text-xs text-slate-300">
                  {seg.elevationStart}m → {seg.elevationEnd}m
                </span>
              </div>
            )}
            {seg.hazards.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {seg.hazards.slice(0, 4).map((h, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-body bg-slate-700/60 text-slate-400">{h}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SegmentDataTable({ segments }: { segments: SegmentRow[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!segments.length) return null;

  const visible = showAll ? segments : segments.slice(0, 6);

  return (
    <div className="plan-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Navigation size={15} className="text-amber-400" />
          <h3 className="font-display font-bold text-white text-sm">
            Route Segments ({segments.length})
          </h3>
        </div>
        {segments.length > 6 && (
          <button onClick={() => setShowAll(!showAll)}
            className="text-xs font-body text-amber-400 hover:text-amber-300 transition-colors">
            {showAll ? "Show fewer" : `Show all ${segments.length}`}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((seg) => (
          <SegmentCard key={seg.index} seg={seg} defaultOpen={seg.riskLevel === "HIGH" || seg.riskLevel === "EXTREME" || seg.index < 1} />
        ))}
      </div>
    </div>
  );
}
