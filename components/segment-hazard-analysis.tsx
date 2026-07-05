"use client";

import {
  AlertTriangle, Shield, AlertCircle, ShieldCheck,
  ChevronDown, ChevronUp, Loader2, RefreshCw,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";

interface HistoricPattern {
  type: string;
  total: number;
  monsoon: number;
  dry: number;
}

interface HazardPatterns {
  realtime?: { severity: "HIGH"; reasons: string[] };
  historic?: {
    severity: "HIGH" | "MEDIUM" | "LOW";
    patterns: HistoricPattern[];
  };
  terrain: "Terai" | "Hill" | "Mountain";
  season: "Monsoon" | "Dry";
}

interface SegmentData {
  index: number;
  from: string;
  to: string;
  distanceKm: number;
  riskLevel: string;
  riskScore: number;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
}

interface LiveHazard {
  floodIndex?: number;
  landslideIndex?: number;
  earthquakeIndex?: number;
  airQuality?: number;
}

interface LiveWeather {
  rainfall?: number;
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  description?: string;
}

interface RoadGroup {
  name: string;
  segments: SegmentData[];
}

interface SegmentHazardAnalysisProps {
  roads: RoadGroup[];
  liveHazard?: LiveHazard | null;
  liveWeather?: LiveWeather | null;
}

const TERRAIN_ICON: Record<string, string> = {
  Terai: "🌾",
  Hill: "🏔️",
  Mountain: "❄️",
};

const SEVERITY_STYLE: Record<string, string> = {
  HIGH: "text-red-400 bg-red-500/10 border-red-500/20",
  MEDIUM: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  LOW: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

function SegmentCard({
  seg,
  patterns,
  defaultOpen,
}: {
  seg: SegmentData;
  patterns: HazardPatterns | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!patterns) return null;

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-body text-xs text-slate-500 w-5 shrink-0">
            {seg.index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-body text-sm text-white truncate">
              {seg.from === seg.to ? seg.from : <>{seg.from} <span className="text-slate-600">→</span> {seg.to}</>}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              {patterns.realtime && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                  🔴 Harsh Conditions
                </span>
              )}
              {patterns.historic && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                    SEVERITY_STYLE[patterns.historic.severity]
                  }`}
                >
                  🟡 Historic Pattern — {patterns.historic.severity}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-body text-[11px] text-slate-500">
            {seg.distanceKm} km
          </span>
          {open ? (
            <ChevronUp size={14} className="text-slate-500" />
          ) : (
            <ChevronDown size={14} className="text-slate-500" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700/30 space-y-3 pt-3">
          {patterns.realtime && (
            <div className="p-3 rounded-xl bg-red-500/8 border border-red-500/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle size={13} className="text-red-400 shrink-0" />
                <span className="font-body text-xs font-bold text-red-400">
                  Harsh Conditions — Active Now
                </span>
              </div>
              <ul className="space-y-1">
                {patterns.realtime.reasons.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] text-red-300/80"
                  >
                    <span className="text-red-400 mt-0.5">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {patterns.historic && patterns.historic.patterns.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
              <div className="flex items-center gap-1.5 mb-2">
                <AlertCircle size={13} className="text-amber-400 shrink-0" />
                <span className="font-body text-xs font-bold text-amber-400">
                  Historic Pattern — {patterns.historic.severity} Caution
                </span>
              </div>
              <div className="space-y-1.5">
                {patterns.historic.patterns.map((p, i) => (
                  <div key={i} className="text-[11px] text-amber-300/70 space-y-0.5">
                    <p>
                      <span className="font-medium text-amber-300 capitalize">
                        {p.type}
                      </span>
                      {" — "}
                      {p.total} incident{p.total !== 1 ? "s" : ""} nearby
                    </p>
                    <div className="flex items-center gap-3 pl-3">
                      <span className="text-amber-400/60">
                        🌧 {p.monsoon} in monsoon
                      </span>
                      <span className="text-amber-400/40">
                        ☀️ {p.dry} in dry season
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span>
              {TERRAIN_ICON[patterns.terrain]} {patterns.terrain}
            </span>
            <span>·</span>
            <span>📅 {patterns.season}</span>
            <span>·</span>
            <span>Risk: {seg.riskLevel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function sortSegments(
  segs: SegmentData[],
  map: Map<number, HazardPatterns>,
): SegmentData[] {
  return [...segs].sort((a, b) => {
    const ap = map.get(a.index);
    const bp = map.get(b.index);
    const aRt = ap?.realtime ? 2 : 0;
    const bRt = bp?.realtime ? 2 : 0;
    const aHs = ap?.historic?.severity === "HIGH" ? 1 : 0;
    const bHs = bp?.historic?.severity === "HIGH" ? 1 : 0;
    return bRt + bHs - (aRt + aHs);
  });
}

export default function SegmentHazardAnalysis({
  roads,
  liveHazard,
  liveWeather,
}: SegmentHazardAnalysisProps) {
  const [patternsMap, setPatternsMap] = useState<
    Map<number, HazardPatterns>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSegments = useMemo(
    () => roads.flatMap((r) => r.segments),
    [roads],
  );

  const fetchKey = JSON.stringify({
    segments: allSegments.map((s) => ({
      index: s.index,
      fromLat: s.fromLat,
      fromLon: s.fromLon,
      toLat: s.toLat,
      toLon: s.toLon,
      floodIndex: liveHazard?.floodIndex ?? 0,
      landslideIndex: liveHazard?.landslideIndex ?? 0,
      rainfall: liveWeather?.rainfall ?? 0,
    })),
  });

  const fetchPatterns = useCallback(() => {
    if (allSegments.length === 0) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/segments/hazard-patterns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: fetchKey,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const map = new Map<number, HazardPatterns>();
        for (const p of data.patterns ?? []) {
          map.set(p.index, p.pattern);
        }
        setPatternsMap(map);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load hazard patterns");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  useEffect(() => {
    const cleanup = fetchPatterns();
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const withPatterns = useMemo(
    () => allSegments.filter((s) => {
      const p = patternsMap.get(s.index);
      return p?.realtime || p?.historic;
    }),
    [allSegments, patternsMap],
  );

  const realtimeCount = useMemo(
    () => allSegments.filter((s) => patternsMap.get(s.index)?.realtime).length,
    [allSegments, patternsMap],
  );

  const historicCount = useMemo(
    () => allSegments.filter((s) => patternsMap.get(s.index)?.historic).length,
    [allSegments, patternsMap],
  );

  const hasAnyData = withPatterns.length > 0;

  const localLoading = loading && patternsMap.size === 0;

  return (
    <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".38s" }}>
      <div className="flex items-center gap-2 mb-4">
        <Shield size={15} className="text-amber-400" />
        <h2 className="font-display font-bold text-white text-base">
          Segment Hazard Analysis
        </h2>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4 text-[11px] font-body text-slate-400">
        <span>{allSegments.length} segments</span>
        {loading && (
          <span className="flex items-center gap-1 text-amber-400">
            <Loader2 size={11} className="animate-spin" />
            Analysing...
          </span>
        )}
        {realtimeCount > 0 && (
          <span className="text-red-400 font-semibold">
            🔴 {realtimeCount} with harsh conditions
          </span>
        )}
        {historicCount > 0 && (
          <span className="text-amber-400 font-semibold">
            🟡 {historicCount} with historic patterns
          </span>
        )}
        {!hasAnyData && !localLoading && !error && (
          <span className="text-emerald-400 font-semibold">
            ✅ No hazards detected
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span className="font-body text-xs font-semibold text-red-400">Failed to analyse segments</span>
          </div>
          <p className="font-body text-[11px] text-red-300/70 mb-3">{error}</p>
          <button
            onClick={fetchPatterns}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-body font-medium bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 transition-all"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}

      {/* Skeleton loading */}
      {localLoading && !error && (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-5 h-4 rounded bg-slate-700/60" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-slate-700/60" />
                  <div className="flex gap-2">
                    <div className="h-4 w-24 rounded-full bg-slate-700/60" />
                    <div className="h-4 w-32 rounded-full bg-slate-700/50" />
                  </div>
                </div>
                <div className="h-3 w-12 rounded bg-slate-700/60" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!hasAnyData && !localLoading && !error && allSegments.length > 0 && (
        <div className="py-8 text-center">
          <ShieldCheck size={32} className="text-emerald-400/50 mx-auto mb-3" />
          <p className="font-body text-sm text-slate-500">
            No significant hazard patterns detected for these segments.
          </p>
          <p className="font-body text-[11px] text-slate-600 mt-1">
            Route appears clear based on current data.
          </p>
        </div>
      )}

      {/* Segment cards */}
      {hasAnyData && !error && (
        <div className="space-y-4">
          {roads.map((road, ri) => {
            const roadSegmentsWithPatterns = road.segments.filter((s) => {
              const p = patternsMap.get(s.index);
              return p?.realtime || p?.historic;
            });
            if (roadSegmentsWithPatterns.length === 0) return null;

            const sorted = sortSegments(roadSegmentsWithPatterns, patternsMap);

            return (
              <div key={`${ri}-${road.name}`}>
                <h3 className="font-display font-bold text-[13px] text-white mb-2 flex items-center gap-1.5">
                  🛣️ {road.name}
                </h3>
                <div className="space-y-2">
                  {sorted.map((seg) => (
                    <SegmentCard
                      key={`${ri}-${seg.index}`}
                      seg={seg}
                      patterns={patternsMap.get(seg.index) ?? null}
                      defaultOpen={
                        !!patternsMap.get(seg.index)?.realtime ||
                        patternsMap.get(seg.index)?.historic?.severity === "HIGH"
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="font-body text-[10px] text-slate-600 mt-3">
        Data source: BIPAD disaster records 2020–2026 · Live hazard sensors
      </p>
    </div>
  );
}
