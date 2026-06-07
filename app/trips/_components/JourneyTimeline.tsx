"use client";

import { useState } from "react";
import {
  MapPin, ArrowRight, AlertCircle, Users,
  ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";

type SafetyLevel = "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
type MemberStatus = "PENDING" | "ACCEPTED" | "DECLINED";

interface MemberResult {
  userId: string;
  name: string;
  safetyScore: number;
  safetyLevel: SafetyLevel;
  topRisks: string[];
  healthFlags: string[];
}

interface Alternative {
  locationId: string;
  name: string;
  district: string;
  safetyScore: number;
  reason: string;
}

interface StopAnalysis {
  stop: { locationName: string; district: string; altitude: number | null; arrivalDate: string; departureDate: string };
  memberResults: MemberResult[];
  groupScore: number;
  minScore: number;
  groupLevel: SafetyLevel;
  conflict: boolean;
  conflictReason: string;
  alternatives: Alternative[];
}

interface RouteSegment {
  from: string;
  to: string;
  date: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
}

interface StopData {
  stopOrder: number;
  arrivalDate: string;
  departureDate: string;
  location: { id: string; name: string; altitude: number | null; district: { name: string; province: { name: string } } };
}

interface JourneyTimelineProps {
  stops: StopData[];
  stopAnalyses?: StopAnalysis[];
  routeSegments?: RouteSegment[];
}

const LEVEL_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  SAFE:      { label: "Safe",      color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25" },
  CAUTION:   { label: "Caution",   color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/25" },
  HIGH_RISK: { label: "High Risk", color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/25" },
  EXTREME:   { label: "Extreme",   color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/25" },
};

const SEGMENT_COLORS: Record<string, string> = {
  LOW: "#34d399",
  MEDIUM: "#f59e0b",
  HIGH: "#ef4444",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

export function JourneyTimeline({ stops, stopAnalyses, routeSegments }: JourneyTimelineProps) {
  return (
    <div className="relative pl-10 pb-2">
      {/* Vertical line base */}
      <div className="absolute left-[15px] top-3 bottom-3 w-0.5 bg-slate-700/50" />

      {stops.map((stop, i) => {
        const analysis = stopAnalyses?.[i];
        const segment = routeSegments?.[i - 1];
        const cfg = analysis ? LEVEL_CFG[analysis.groupLevel] : null;

        return (
          <div key={i} className="relative">
            {/* Connector segment line (between stops) */}
            {i > 0 && segment && (
              <div
                className="absolute left-[15px] -top-6 w-0.5 h-6 -translate-x-px z-10"
                style={{
                  background: `linear-gradient(to bottom, ${SEGMENT_COLORS[segment.risk] || "#334155"}, transparent)`,
                  opacity: 0.7,
                }}
              />
            )}

            {/* Node circle */}
            <div
              className={`absolute left-0 top-1 w-[30px] h-[30px] rounded-full border-2 flex items-center justify-center z-20 bg-slate-900 ${
                cfg
                  ? cfg.border.replace("border-", "border-")
                  : "border-slate-600"
              }`}
              style={{
                borderColor: cfg
                  ? LEVEL_CFG[analysis!.groupLevel].border.replace("border-", "").replace("/25", "/50")
                  : "#475569",
              }}
            >
              <span className={`font-display font-bold text-xs ${cfg ? cfg.color : "text-slate-400"}`}>
                {i + 1}
              </span>
            </div>

            {/* Content card */}
            <div className="ml-4 pb-6">
              <StopCard
                stop={stop}
                analysis={analysis}
                segment={segment}
                isFirst={i === 0}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StopCard({
  stop,
  analysis,
  segment,
  isFirst,
}: {
  stop: StopData;
  analysis?: StopAnalysis;
  segment?: RouteSegment;
  isFirst: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = analysis ? LEVEL_CFG[analysis.groupLevel] : null;

  return (
    <div className={`rounded-xl border transition-all ${
      analysis?.conflict
        ? "border-orange-500/25 bg-orange-500/5"
        : "border-slate-700/50 bg-slate-800/40"
    }`}>
      {/* Segment connector label */}
      {!isFirst && segment && (
        <div className={`flex items-center gap-1.5 px-3 py-1.5 -mt-3 -ml-2 mb-3 rounded-r-lg border text-[10px] font-body font-medium w-fit ${
          segment.risk === "HIGH" ? "bg-red-500/15 border-red-500/20 text-red-400"
          : segment.risk === "MEDIUM" ? "bg-amber-500/15 border-amber-500/20 text-amber-400"
          : "bg-slate-800 border-slate-700/50 text-slate-500"
        }`}>
          <ArrowRight size={10} />
          <span>Route risk: {segment.risk} · {segment.reason}</span>
        </div>
      )}

      {/* Stop header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-body font-semibold text-white text-sm truncate">{stop.location.name}</p>
              {cfg && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-body font-bold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                  {cfg.label}
                </span>
              )}
            </div>
            <p className="font-body text-xs text-slate-500 mt-0.5">
              {stop.location.district.name}, {stop.location.district.province.name}
              {stop.location.altitude ? ` · ${stop.location.altitude.toLocaleString()}m` : ""}
            </p>
            <p className="font-body text-xs text-slate-600 mt-1">
              {formatDate(stop.arrivalDate)} → {formatDate(stop.departureDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {analysis && (
            <span className={`font-display font-bold text-base ${cfg?.color || "text-slate-400"}`}>
              {analysis.groupScore}
            </span>
          )}
          {expanded ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800 space-y-3">
          {/* Per-member results */}
          {analysis && analysis.memberResults.length > 0 && (
            <div>
              <p className="font-body text-[10px] text-slate-600 uppercase tracking-widest mb-1.5">Member risk at this stop</p>
              <div className="space-y-1">
                {analysis.memberResults.map((mr) => {
                  const mc = LEVEL_CFG[mr.safetyLevel];
                  return (
                    <div key={mr.userId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/50">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                          <span className="font-display font-bold text-slate-300 text-[10px]">{mr.name[0]?.toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-body text-xs text-slate-300 truncate">{mr.name}</p>
                          {mr.healthFlags.length > 0 && (
                            <p className="font-body text-[10px] text-slate-600 truncate">{mr.healthFlags.join(" · ")}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-display font-bold text-sm ${mc.color}`}>{mr.safetyScore}</span>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-body font-bold ${mc.color} ${mc.bg} ${mc.border}`}>
                          {mc.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Score summary */}
          {analysis && (
            <div className="flex items-center gap-3 text-xs font-body text-slate-500">
              <span>Min: <strong className="text-slate-300">{analysis.minScore}</strong></span>
              <span>Avg: <strong className="text-slate-300">{analysis.groupScore}</strong></span>
            </div>
          )}

          {/* Conflict warning */}
          {analysis?.conflict && (
            <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <div className="flex items-start gap-2">
                <AlertCircle size={13} className="text-orange-400 shrink-0 mt-0.5" />
                <p className="font-body text-xs text-orange-300 leading-relaxed">{analysis.conflictReason}</p>
              </div>
            </div>
          )}

          {/* Alternatives */}
          {analysis?.alternatives && analysis.alternatives.length > 0 && (
            <div>
              <p className="font-body text-[10px] text-slate-600 uppercase tracking-widest mb-1.5">Safer alternatives</p>
              <div className="space-y-1">
                {analysis.alternatives.slice(0, 3).map((alt) => (
                  <div key={alt.locationId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40">
                    <div className="flex items-center gap-2">
                      <MapPin size={11} className="text-emerald-400" />
                      <div>
                        <p className="font-body text-xs text-white">{alt.name}</p>
                        <p className="font-body text-[10px] text-slate-500">{alt.district}</p>
                      </div>
                    </div>
                    <span className="font-display font-bold text-sm text-emerald-400">{alt.safetyScore}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
