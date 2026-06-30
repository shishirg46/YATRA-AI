"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft, Loader2, Shield, AlertTriangle, Zap, XCircle,
  CheckCircle2, Heart, Package, Navigation, Clock,
  CloudRain, Wind, Thermometer, Snowflake, Wallet,
  Sparkles, RefreshCw, Users, AlertCircle, TrendingDown,
  Calendar, MapPin, Droplets, ChevronRight,
} from "lucide-react";
import ScoreRing from "@/app/plan/_components/ScoreRing";
import {
  PillarRadar, MemberBarChart, BudgetDonut, AlternativeComparison,
} from "@/app/plan/_components/PlanCharts";
import type { PlanReport } from "@/lib/types/plan-report";
import type { EnhancedRoad } from "@/lib/routing/types";

const RouteMapMini = dynamic(() => import("@/components/route-map-mini"), {
  ssr: false,
  loading: () => <div className="h-[208px] rounded-xl bg-slate-800/50 animate-pulse" />,
});

// ── Config ─────────────────────────────────────────────────────────────────

const LEVEL_CFG: Record<string, { label: string; color: string; bg: string; border: string; icon: typeof Shield }> = {
  SAFE:      { label: "Safe to Travel",          color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30", icon: Shield },
  CAUTION:   { label: "Travel with Caution",     color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/30",   icon: AlertTriangle },
  HIGH_RISK: { label: "High Risk — Reconsider",  color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/30",  icon: Zap },
  EXTREME:   { label: "Extreme — Do Not Travel", color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/30",     icon: XCircle },
};

const SEVERITY_COLOR: Record<string, string> = {
  LOW:      "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  MEDIUM:   "text-amber-400   bg-amber-400/10   border-amber-400/20",
  HIGH:     "text-orange-400  bg-orange-400/10  border-orange-400/20",
  EXTREME:  "text-red-400     bg-red-400/10     border-red-400/20",
  CRITICAL: "text-red-400     bg-red-400/10     border-red-400/20",
};

const REC_ICON: Record<string, typeof Package> = {
  GEAR: Package, TIMING: Clock, MEDICAL: Heart, ROUTE: Navigation, AVOID: XCircle,
};

const REC_COLOR: Record<string, string> = {
  GEAR: "text-sky-400", TIMING: "text-amber-400", MEDICAL: "text-rose-400", ROUTE: "text-purple-400", AVOID: "text-red-400",
};

// ── Props ──────────────────────────────────────────────────────────────────

interface PlanReportViewProps {
  report: PlanReport;
  isGroup: boolean;
  displayOriginLat?: number | null;
  displayOriginLon?: number | null;
  hasSavedPlan?: boolean;
  onBack: () => void;
  onSave: (mode: "ANALYZED" | "PENDING") => Promise<void>;
  onUpdate: () => Promise<void>;
  onPlanAlternative: (alt: { id: string; name: string; district: string; province: string; altitude: number | null }) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PlanReportView({
  report,
  isGroup,
  displayOriginLat,
  displayOriginLon,
  hasSavedPlan = false,
  onBack,
  onSave,
  onUpdate,
  onPlanAlternative,
}: PlanReportViewProps) {
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roads, setRoads] = useState<EnhancedRoad[] | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  useEffect(() => {
    if (!displayOriginLat || !displayOriginLon) return;
    let cancelled = false;
    setRouteLoading(true);
    fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startLat: displayOriginLat,
        startLon: displayOriginLon,
        endLat: report.destination.latitude,
        endLon: report.destination.longitude,
        destinationId: report.destination.id,
        destinationName: report.destination.name,
      }),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setRoads(data.roads ?? null); })
      .catch(() => { if (!cancelled) setRoads(null); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  }, [displayOriginLat, displayOriginLon, report.destination.latitude, report.destination.longitude, report.destination.id, report.destination.name]);

  const placeNames = useMemo(() => {
    if (!roads || roads.length === 0) return [];
    const names: string[] = [];
    for (const road of roads) {
      for (const seg of road.segments ?? []) {
        for (const sc of seg.subCoords ?? []) {
          if (sc.placeName && !names.includes(sc.placeName)) {
            names.push(sc.placeName);
          }
        }
      }
    }
    return names;
  }, [roads]);

  const cfg = LEVEL_CFG[report.overallLevel] ?? LEVEL_CFG.SAFE;
  const LevelIcon = cfg.icon;
  const isUnsafe = report.overallLevel === "HIGH_RISK" || report.overallLevel === "EXTREME";

  async function handleSave(mode: "ANALYZED" | "PENDING") {
    setSaving(true);
    setError(null);
    try { await onSave(mode); } catch { setError("Failed to save plan."); } finally { setSaving(false); }
  }

  async function handleUpdate() {
    setUpdating(true);
    setError(null);
    try { await onUpdate(); } catch { setError("Failed to update plan."); } finally { setUpdating(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="w-full pb-16 relative">
      <div className="glow-dot w-[500px] h-[400px] bg-amber-500/8 -top-32 -left-32" />
      <div className="glow-dot w-[400px] h-[300px] bg-sky-500/6 bottom-0 right-0" />

      <div className="max-w-7xl mx-auto relative z-10">

        {/* ── Header bar ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between py-4 anim">
          <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-body text-sm">
            <ArrowLeft size={15}/> Back
          </button>

          <div className="flex items-center gap-2">
            <button onClick={() => handleSave("ANALYZED")} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-body font-semibold disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              {saving ? "Saving..." : "Save Plan"}
            </button>
            <button onClick={() => handleSave("PENDING")} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/40 border border-slate-600/50 text-slate-200 hover:bg-slate-700/60 text-xs font-body font-semibold disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
              Save Draft
            </button>
            {hasSavedPlan && (
              <button onClick={handleUpdate} disabled={updating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-body font-semibold disabled:opacity-50">
                {updating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {updating ? "Updating..." : "Update Existing"}
              </button>
            )}
            <span className="font-body text-xs text-slate-600 hidden sm:inline">Analysed {new Date(report.analyzedAt).toLocaleString()}</span>
          </div>
        </div>

        {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-body anim">{error}</div>}

        {/* ── Two-column layout ─────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* ── Left: Sticky Side Panel ──────────────────────────────── */}
          <div className="w-full lg:w-[340px] lg:sticky lg:top-24 flex-shrink-0 space-y-3 anim" style={{ animationDelay: ".05s" }}>

            {/* Score overview */}
            <div className={`plan-card rounded-2xl overflow-hidden ${isUnsafe ? "border-red-500/20" : ""}`}>
              <div className="p-5 flex items-start gap-4">
                <ScoreRing score={report.overallScore} size={96} />
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-lg font-bold text-white truncate">
                    <span className="shimmer-text">{report.destination.name}</span>
                  </h1>
                  <p className="font-body text-xs text-slate-500 mt-0.5">
                    <MapPin size={10} className="inline mr-0.5" />
                    {report.destination.district}, {report.destination.province}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-body text-[10px] font-bold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                      <LevelIcon size={10}/>{cfg.label}
                    </span>
                    {report.confidence > 0 && <ConfidenceBadge report={report} />}
                  </div>
                </div>
              </div>
              <div className="px-5 pb-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-body text-slate-500">
                <span><Calendar size={10} className="inline mr-1 -mt-0.5" />
                  {new Date(report.travelDate).toLocaleDateString("en-NP", { day: "numeric", month: "short", year: "numeric" })}
                </span>
                <span>{report.season}</span>
                {isGroup && <span>{report.memberAnalyses.length} members</span>}
              </div>
              <div className="mx-5 mb-4 px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30 flex items-start gap-2">
                <Calendar size={12} className="text-slate-500 flex-shrink-0 mt-0.5" />
                <p className="font-body text-[11px] text-slate-400 leading-relaxed line-clamp-3">{report.seasonalContext}</p>
              </div>
            </div>

            {/* Live Weather */}
            {report.liveWeather && (
              <div className="plan-card rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <CloudRain size={12} className="text-sky-400" />
                  <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Live Weather</span>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{weatherEmoji(report.liveWeather.description)}</span>
                  <div>
                    <p className="font-display font-bold text-xl text-white">{report.liveWeather.temperature}°C</p>
                    <p className="font-body text-[11px] text-slate-400 capitalize">{report.liveWeather.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-body text-slate-500">
                  <span className="flex items-center gap-1"><Droplets size={11} className="text-blue-400"/>{report.liveWeather.humidity}%</span>
                  <span className="flex items-center gap-1"><Wind size={11} className="text-slate-400"/>{report.liveWeather.windSpeed}m/s</span>
                </div>
              </div>
            )}

            {/* Hazard */}
            {report.liveHazard && (
              <div className="plan-card rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <AlertTriangle size={12} className="text-orange-400" />
                  <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Hazard Indices</span>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Flood", value: report.liveHazard.floodIndex, color: "#3b82f6" },
                    { label: "Landslide", value: report.liveHazard.landslideIndex, color: "#f97316" },
                    { label: "Earthquake", value: report.liveHazard.earthquakeIndex, color: "#ef4444" },
                    { label: "Air Quality", value: report.liveHazard.airQuality, color: "#64748b" },
                  ].map((h) => {
                    const pct = Math.min(h.value * 100, 100);
                    return (
                      <div key={h.label}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-body text-[11px] text-slate-400">{h.label}</span>
                          <span className="font-body text-[10px] text-slate-500">{(h.value * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: h.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Route Assessment */}
            {report.routeAssessment ? (
              <div className="plan-card rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Navigation size={12} className="text-amber-400" />
                  <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Route Assessment</span>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Road Conditions", level: report.routeAssessment.roadConditions },
                    { label: "Seasonal Corridor Risk", level: report.routeAssessment.seasonalCorridorRisk },
                    { label: "Overall Route Outlook", level: report.routeAssessment.overall },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="font-body text-[11px] text-slate-400">{r.label}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        r.level === "EXTREME" ? "text-red-300 border-red-500/20 bg-red-500/10" :
                        r.level === "HIGH" ? "text-orange-300 border-orange-500/20 bg-orange-500/10" :
                        r.level === "MEDIUM" ? "text-amber-300 border-amber-500/20 bg-amber-500/10" :
                        "text-emerald-300 border-emerald-500/20 bg-emerald-500/10"
                      }`}>{r.level}</span>
                    </div>
                  ))}
                </div>
                {report.routeRisk?.reason && (
                  <p className="font-body text-[11px] text-slate-500 leading-relaxed mt-2 pt-2 border-t border-slate-700/50">{report.routeRisk.reason}</p>
                )}
              </div>
            ) : report.routeRisk && (
              <div className={`plan-card rounded-2xl p-4 ${report.routeRisk.risk === "HIGH" || report.routeRisk.risk === "MEDIUM" ? "border-orange-500/20" : "border-emerald-500/20"}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Navigation size={12} className={report.routeRisk.risk === "HIGH" ? "text-orange-400" : "text-emerald-400"} />
                    <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Route Risk</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    report.routeRisk.risk === "HIGH" ? "text-orange-300 border-orange-500/20 bg-orange-500/10" :
                    report.routeRisk.risk === "MEDIUM" ? "text-amber-300 border-amber-500/20 bg-amber-500/10" :
                    "text-emerald-300 border-emerald-500/20 bg-emerald-500/10"
                  }`}>{report.routeRisk.risk}</span>
                </div>
                <p className="font-body text-[11px] text-slate-400 leading-relaxed">{report.routeRisk.reason}</p>
              </div>
            )}

            {/* Trip Info */}
            <div className="plan-card rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-1.5">
                <Users size={12} className="text-indigo-400" />
                <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Trip</span>
              </div>
              <p className="font-body text-sm font-semibold text-white">{isGroup ? "Group Trip" : "Solo Trip"}</p>
              {isGroup && report.mostVulnerableMember && (
                <p className="font-body text-[11px] text-orange-400">Most vulnerable: {report.mostVulnerableMember.name} ({report.mostVulnerableMember.score})</p>
              )}
              {report.budget.specified > 0 && (
                <div className="flex items-center justify-between font-body text-xs">
                  <span className="text-slate-500">Budget:</span>
                  <span className="text-white font-semibold">NPR {report.budget.specified.toLocaleString()}</span>
                </div>
              )}
              {report.budget.specified > 0 && (
                <div className="flex items-center justify-between font-body text-xs">
                  <span className="text-slate-500">Est. cost:</span>
                  <span className={report.budget.feasible ? "text-emerald-400 font-semibold" : "text-orange-400 font-semibold"}>
                    NPR {report.budget.estimatedTotal.toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* AI Verdict (summary in panel) */}
            {report.ai.verdict && (
              <div className={`plan-card rounded-2xl p-4 ${isUnsafe ? "border-red-500/20" : "border-emerald-500/20"}`}>
                <div className="flex items-start gap-2">
                  <Sparkles size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="font-body text-xs text-slate-200 leading-relaxed line-clamp-4">{report.ai.verdict}</p>
                </div>
              </div>
            )}

            {/* Side panel save buttons at bottom */}
            <div className="plan-card rounded-2xl p-4 space-y-2">
              <button onClick={() => handleSave("ANALYZED")} disabled={saving}
                className="w-full py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-body font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                {saving ? "Saving..." : "Save Plan"}
              </button>
              <button onClick={() => handleSave("PENDING")} disabled={saving}
                className="w-full py-2.5 rounded-xl bg-slate-700/40 border border-slate-600/50 text-slate-200 hover:bg-slate-700/60 text-xs font-body font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Clock size={13} />}
                Save Draft
              </button>
              {hasSavedPlan && (
                <button onClick={handleUpdate} disabled={updating}
                  className="w-full py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-body font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all">
                  {updating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={13} />}
                  {updating ? "Updating..." : "Update Existing"}
                </button>
              )}
            </div>

          </div>

          {/* ── Right: Scrollable Data Area ───────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* 1. AI Verdict + Analysis (merged) */}
            {(report.ai.verdict || report.ai.riskExplanation) && (
              <div className={`plan-card rounded-2xl p-6 anim ${isUnsafe ? "border-red-500/20" : ""}`}
                style={{ animationDelay: ".08s" }}>
                <div className="flex items-start gap-3">
                  <Sparkles size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    {report.ai.verdict && (
                      <>
                        <h2 className="font-display font-bold text-white text-base mb-1">AI Verdict</h2>
                        <p className="font-body text-sm text-slate-200 leading-relaxed">{report.ai.verdict}</p>
                      </>
                    )}
                    {report.ai.riskExplanation && (
                      <div className="mt-4 p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                        <p className="font-body text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">Detailed Reasoning</p>
                        <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.riskExplanation}</p>
                      </div>
                    )}
                    {report.ai.alternativeReason && (
                      <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                        <TrendingDown size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                        <p className="font-body text-sm text-emerald-300 leading-relaxed">{report.ai.alternativeReason}</p>
                      </div>
                    )}
                    {report.ai.topTip && (
                      <div className="mt-3 flex items-start gap-2">
                        <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                        <p className="font-body text-sm text-emerald-300 leading-relaxed"><strong>Top tip:</strong> {report.ai.topTip}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. Risk Factors — all visible */}
            {report.riskFactors.length > 0 && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".16s" }}>
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle size={15} className="text-orange-400" />
                  <h2 className="font-display font-bold text-white text-base">Risk Factors ({report.riskFactors.length})</h2>
                </div>
                <div className="space-y-3">
                  {report.riskFactors.map((f, i) => {
                    const severityPct = f.severity === "CRITICAL" ? 100 : f.severity === "HIGH" ? 75 : f.severity === "MEDIUM" ? 50 : 25;
                    const barColor = f.severity === "CRITICAL" || f.severity === "HIGH" ? "bg-red-500" : f.severity === "MEDIUM" ? "bg-amber-500" : "bg-emerald-500";
                    return (
                      <div key={i} className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-body font-semibold text-sm text-white truncate">{f.name}</span>
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-body font-bold uppercase shrink-0 ${SEVERITY_COLOR[f.severity] ?? SEVERITY_COLOR.LOW}`}>{f.severity}</span>
                          </div>
                          <span className="font-body text-[11px] text-slate-500 font-mono shrink-0">-{f.score}pts</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-700/60 mb-1.5 overflow-hidden">
                          <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${severityPct}%` }} />
                        </div>
                        <p className="font-body text-xs text-slate-400 leading-relaxed">{f.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4. Pillar Scores */}
            {Array.isArray(report.pillarScores) && report.pillarScores.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 anim" style={{ animationDelay: ".2s" }}>
                <div className="lg:col-span-2">
                  <PillarRadar data={report.pillarScores} />
                </div>
                <div className="lg:col-span-2 plan-card rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield size={15} className="text-amber-400" />
                    <h2 className="font-display font-bold text-white text-base">Pillar Scoring</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {report.pillarScores.map((p) => (
                      <div key={p.id} className={`rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 ${p.id === "weather_safety" && report.weatherPillar?.breakdown ? "row-span-2" : ""}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-body text-sm text-white font-semibold">{p.title}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            p.level === "LOW" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                            : p.level === "MEDIUM" ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                            : "text-red-300 border-red-500/30 bg-red-500/10"
                          }`}>{p.score}/{p.maxPoints}</span>
                        </div>
                        <p className="font-body text-xs text-slate-400 leading-relaxed">{p.summary}</p>
                        {p.id === "weather_safety" && report.weatherPillar?.breakdown && (
                          <div className="mt-3 pt-2 border-t border-slate-700/50 space-y-1">
                            {report.weatherPillar.breakdown.map((b, i) => (
                              <div key={i} className="flex items-center justify-between font-body">
                                <span className={`text-[11px] ${b.type === "base" ? "text-slate-400 font-semibold" : b.type === "result" ? "text-white font-semibold" : "text-slate-500"}`}>
                                  {b.label}
                                </span>
                                <span className={`text-[11px] font-mono ${b.type === "result" ? "text-white font-bold" : b.value < 0 ? "text-red-400" : "text-slate-400"}`}>
                                  {b.value > 0 ? "+" : ""}{b.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 5. Group Analysis */}
            {isGroup && report.memberAnalyses.length > 0 && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".24s" }}>
                <div className="flex items-center gap-2 mb-4">
                  <Users size={15} className="text-indigo-400" />
                  <h2 className="font-display font-bold text-white text-base">Group Analysis ({report.memberAnalyses.length} members)</h2>
                </div>
                {report.memberAnalyses.length > 1 && <MemberBarChart members={report.memberAnalyses} />}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {report.memberAnalyses.map((m) => {
                    const mc = LEVEL_CFG[m.level] ?? LEVEL_CFG.SAFE;
                    const MIcon = mc.icon;
                    return (
                      <div key={m.userId} className={`flex items-center justify-between px-4 py-3 rounded-xl border ${m.level === "HIGH_RISK" || m.level === "EXTREME" ? "bg-red-500/8 border-red-500/20" : "bg-slate-800/40 border-slate-700/50"}`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                            <span className="font-display font-bold text-slate-300 text-sm">{m.name[0]?.toUpperCase()}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-body text-sm text-white truncate">{m.name}</p>
                              {m.isLeader && <span className="px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 font-body text-[9px] font-semibold">Leader</span>}
                            </div>
                            {m.healthFlags.length > 0 && <p className="font-body text-[11px] text-slate-500 truncate">{m.healthFlags[0]}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`font-display font-bold text-base ${mc.color}`}>{m.score}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-body font-bold ${mc.color} ${mc.bg} ${mc.border}`}>
                            <MIcon size={9}/>{mc.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {report.conflict && report.ai.groupConflict && (
                  <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-orange-500/8 border border-orange-500/20">
                    <AlertCircle size={13} className="text-orange-400 flex-shrink-0 mt-0.5" />
                    <p className="font-body text-xs text-slate-300 leading-relaxed">{report.ai.groupConflict}</p>
                  </div>
                )}
                <p className="font-body text-xs text-slate-600 mt-2">Conservative rule: group safety = worst member score ({report.overallScore}/100).</p>
              </div>
            )}

            {/* 6. Budget Breakdown */}
            {report.budget.specified > 0 && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".28s" }}>
                <div className="flex items-center gap-2 mb-4">
                  <Wallet size={15} className={report.budget.feasible ? "text-emerald-400" : "text-orange-400"} />
                  <h2 className="font-display font-bold text-white text-base">Budget Breakdown</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {[
                        { label: "Your budget", value: `NPR ${report.budget.specified.toLocaleString()}` },
                        { label: "Est. cost", value: `NPR ${report.budget.estimatedTotal.toLocaleString()}` },
                        { label: isGroup ? "Per person" : "Duration", value: isGroup ? `NPR ${report.budget.perPerson.toLocaleString()}` : `${report.budget.estimatedDays} days` },
                        { label: "Status", value: report.budget.feasible ? "Within budget" : `Shortfall ${report.budget.shortfall.toLocaleString()}` },
                      ].map((s) => (
                        <div key={s.label} className="bg-slate-800/50 rounded-xl p-3 text-center">
                          <p className="font-body text-[10px] text-slate-500 mb-1">{s.label}</p>
                          <p className={`font-body text-sm font-semibold ${s.label === "Status" ? (report.budget.feasible ? "text-emerald-400" : "text-orange-400") : "text-white"}`}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                    {report.ai.budgetAdvice && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                        <Sparkles size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="font-body text-xs text-slate-400 leading-relaxed">{report.ai.budgetAdvice}</p>
                      </div>
                    )}
                  </div>
                  <BudgetDonut breakdown={report.budget.breakdown} total={report.budget.estimatedTotal} />
                </div>
              </div>
            )}

            {/* 7. Recommended Alternatives */}
            {(report.overallLevel !== "SAFE" || report.conflict) && report.alternatives.length > 0 && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".32s" }}>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown size={16} className="text-emerald-400" />
                  <h2 className="font-display font-bold text-white text-base">Recommended Alternatives</h2>
                </div>
                {report.ai.alternativeReason && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 mb-4 mt-3">
                    <Sparkles size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.alternativeReason}</p>
                  </div>
                )}
                {report.alternatives.length > 1 && (
                  <div className="mb-4">
                    <AlternativeComparison alternatives={report.alternatives} />
                  </div>
                )}
                <div className="space-y-2">
                  {report.alternatives.map((alt, i) => {
                    const altColor = alt.safetyScore >= 80 ? "text-emerald-400" : "text-amber-400";
                    const isTop = i === 0;
                    return (
                      <div key={alt.id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${isTop ? "bg-emerald-500/8 border-emerald-500/25" : "bg-slate-800/40 border-slate-700/50"}`}>
                        <div className="flex items-start gap-2 min-w-0">
                          {isTop && <span className="text-sm mt-0.5">⭐</span>}
                          <div className="min-w-0">
                            <p className="font-body text-sm font-medium text-white truncate">{alt.name}</p>
                            <p className="font-body text-xs text-slate-500">{alt.district}{alt.altitude ? ` · ${alt.altitude.toLocaleString()}m` : ""}</p>
                            {alt.budgetFeasible && alt.estimatedNPR > 0 && (
                              <p className="font-body text-xs text-slate-600">~NPR {alt.estimatedNPR.toLocaleString()}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`font-display font-bold text-lg ${altColor}`}>{alt.safetyScore}</span>
                          <button onClick={() => onPlanAlternative(alt)}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 text-xs font-body font-medium transition-all">
                            Plan this →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 8. Route Overview */}
            {displayOriginLat && displayOriginLon && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".36s" }}>
                <div className="flex items-center gap-2 mb-4">
                  <Navigation size={15} className="text-amber-400" />
                  <h2 className="font-display font-bold text-white text-base">Route Overview</h2>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap text-xs font-body text-slate-400 mb-4">
                  <span className="text-white font-medium truncate max-w-[120px]">Your Location</span>
                  {placeNames.length > 0 ? placeNames.map((name, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <ChevronRight size={11} className="text-slate-600 flex-shrink-0" />
                      <span className="text-white font-medium truncate max-w-[100px]">{name}</span>
                    </span>
                  )) : roads && roads.length > 0 ? (
                    <span className="flex items-center gap-1.5">
                      <ChevronRight size={11} className="text-slate-600 flex-shrink-0" />
                      <span className="text-white font-medium truncate max-w-[120px]">{report.destination.name}</span>
                    </span>
                  ) : null}
                </div>
                {routeLoading ? (
                  <div className="h-[208px] rounded-xl bg-slate-800/50 animate-pulse" />
                ) : roads && roads.length > 0 ? (
                  <RouteMapMini roads={roads} />
                ) : (
                  <div className="h-[208px] rounded-xl bg-slate-800/30 border border-slate-700/30 flex items-center justify-center">
                    <p className="font-body text-xs text-slate-500">Map unavailable</p>
                  </div>
                )}
              </div>
            )}

            {/* 9. Health Advisories — all visible */}
            {report.healthAdvisories.length > 0 && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".44s" }}>
                <div className="flex items-center gap-2 mb-4">
                  <Heart size={15} className="text-rose-400" />
                  <h2 className="font-display font-bold text-white text-base">Health Advisories ({report.healthAdvisories.length})</h2>
                </div>
                {report.ai.healthWarning && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/8 border border-red-500/20 mb-3">
                    <Heart size={13} className="text-rose-400 flex-shrink-0 mt-0.5" />
                    <p className="font-body text-xs text-slate-300 leading-relaxed">{report.ai.healthWarning}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {report.healthAdvisories.map((h, i) => (
                    <div key={i} className={`p-4 rounded-xl border ${h.risk === "HIGH" ? "bg-red-500/8 border-red-500/20" : h.risk === "MEDIUM" ? "bg-amber-500/8 border-amber-500/20" : "bg-slate-800/40 border-slate-700/50"}`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`font-body font-semibold text-sm ${h.risk === "HIGH" ? "text-red-400" : h.risk === "MEDIUM" ? "text-amber-400" : "text-slate-300"}`}>{h.condition}</span>
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-body font-bold uppercase ${SEVERITY_COLOR[h.risk] ?? SEVERITY_COLOR.LOW}`}>{h.risk}</span>
                      </div>
                      <p className="font-body text-xs text-slate-400 leading-relaxed">{h.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 10. Recommendations — all visible */}
            {report.recommendations.length > 0 && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".48s" }}>
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 size={15} className="text-emerald-400" />
                  <h2 className="font-display font-bold text-white text-base">Recommendations ({report.recommendations.length})</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {report.recommendations.map((r, i) => {
                    const Icon = REC_ICON[r.type] ?? Package;
                    const color = REC_COLOR[r.type] ?? "text-slate-400";
                    return (
                      <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-700/60 ${color}`}><Icon size={14}/></div>
                        <div>
                          <span className={`font-body text-[10px] font-bold uppercase tracking-wider ${color}`}>{r.type}</span>
                          <p className="font-body text-sm text-slate-300 mt-0.5 leading-relaxed">{r.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 11. Weather Stats */}
            {report.weatherStats && (
              <div className="plan-card rounded-2xl p-6 anim" style={{ animationDelay: ".52s" }}>
                <div className="flex items-center gap-2 mb-4">
                  <CloudRain size={15} className="text-sky-400" />
                  <h2 className="font-display font-bold text-white text-base">Weather at destination</h2>
                </div>
                <p className="font-body text-xs text-slate-500 mb-3">Based on {report.weatherStats.yearsAnalysed} years of historical data</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { icon: Thermometer, label: "Avg temp", value: `${report.weatherStats.avgTempMax}°/${report.weatherStats.avgTempMin}°C` },
                    { icon: CloudRain, label: "Avg rain", value: `${report.weatherStats.avgRainfall}mm` },
                    { icon: Wind, label: "Avg wind", value: `${report.weatherStats.avgWindSpeed}m/s` },
                    { icon: Snowflake, label: "Snow chance", value: `${Math.round(report.weatherStats.snowProbability * 100)}%` },
                  ].map((s) => (
                    <div key={s.label} className="bg-slate-800/50 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1"><s.icon size={12} className="text-amber-400"/><span className="font-body text-[10px] text-slate-500">{s.label}</span></div>
                      <p className="font-body text-sm font-semibold text-white">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}



          </div>

        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ report: r }: { report: PlanReport }) {
  const parts: string[] = [];
  if (r.weatherStats) parts.push("historical weather");
  if (r.liveWeather) parts.push("live weather observations");
  if (r.liveHazard) parts.push("hazard data");
  if (r.routeRisk || r.routeAssessment) parts.push("route information");
  if (r.pillarScores) parts.push("scoring analysis");
  const sources = parts.length > 0 ? parts.join(", ") : "available data";
  return (
    <span className="group relative font-body text-[10px] text-slate-500 self-center cursor-default">
      {Math.round(r.confidence * 100)}% confidence
      <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 w-56 px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-[10px] text-slate-300 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 text-center">
        Based on {sources}
      </span>
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function weatherEmoji(desc: string): string {
  const wc = desc.toLowerCase();
  if (wc.includes("rain") || wc.includes("drizzle")) return "🌧";
  if (wc.includes("cloud") || wc.includes("overcast")) return "☁️";
  if (wc.includes("fog") || wc.includes("mist")) return "🌫";
  if (wc.includes("clear") || wc.includes("sunny")) return "☀️";
  if (wc.includes("snow")) return "❄️";
  return "🌤";
}
