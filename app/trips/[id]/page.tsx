/**
 * FILE: page.tsx
 * LOCATION: /app/trips/[id]/page.tsx
 * PURPOSE: Single trip detail — route, group analysis, member management
 *
 * SECTIONS:
 *  1. Trip header — title, dates, status, overall group score
 *  2. AI group verdict + route warning
 *  3. Route timeline — each stop with per-member risk breakdown
 *  4. Route segments — travel legs risk
 *  5. Group members — leader can invite more, members can accept/decline
 *  6. Budget breakdown
 *  7. Run analysis button (leader only)
 */
"use client";

import { useState, useEffect, use } from "react";
import Link                          from "next/link";
import { useRouter }                 from "next/navigation";
import RouteMapLoader                from "@/components/route-map-loader";
import {
  Mountain, ArrowLeft, MapPin, Calendar, Users, User,
  Shield, AlertTriangle, Zap, XCircle, CheckCircle2,
  Loader2, RefreshCw, Sparkles, Heart, ArrowRight,
  Clock, UserPlus, X, Check, Wallet, ChevronDown,
  ChevronUp, AlertCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SafetyLevel = "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
type MemberStatus = "PENDING" | "ACCEPTED" | "DECLINED";

interface MemberStopResult {
  userId:      string;
  name:        string;
  safetyScore: number;
  safetyLevel: SafetyLevel;
  topRisks:    string[];
  healthFlags: string[];
}

interface AlternativeStop {
  locationId:  string;
  name:        string;
  district:    string;
  safetyScore: number;
  reason:      string;
}

interface StopAnalysis {
  stop:          { locationName: string; district: string; altitude: number | null; arrivalDate: string; departureDate: string };
  memberResults: MemberStopResult[];
  groupScore:    number;
  minScore:      number;
  groupLevel:    SafetyLevel;
  conflict:      boolean;
  conflictReason: string;
  alternatives:  AlternativeStop[];
}

interface RouteSegment {
  from:   string;
  to:     string;
  date:   string;
  risk:   "LOW" | "MEDIUM" | "HIGH";
  reason: string;
}

interface GroupRiskResult {
  stopAnalyses:       StopAnalysis[];
  routeSegments:      RouteSegment[];
  overallGroupScore:  number;
  overallGroupLevel:  SafetyLevel;
  budgetPerPerson:    number | null;
  budgetFeasible:     boolean;
  ai: {
    groupVerdict:    string;
    conflictSummary: string;
    routeWarning:    string;
    budgetNote:      string;
    topGroupTip:     string;
  };
}

interface TripMember {
  id:          string;
  status:      MemberStatus;
  invitedAt:   string;
  respondedAt: string | null;
  user:        { id: string; name: string; username: string | null; image: string | null };
}

interface TripStop {
  stopOrder:     number;
  arrivalDate:   string;
  departureDate: string;
  location:      { id: string; name: string; altitude: number | null; district: { name: string; province: { name: string } } };
}

interface TripPlan {
  id:              string;
  title:           string;
  tripType:        "SOLO" | "GROUP";
  status:          string;
  startDate:       string;
  endDate:         string;
  budgetNPR:       number | null;
  groupRiskResult: GroupRiskResult | null;
  leader:          { id: string; name: string; username: string | null; image: string | null };
  stops:           TripStop[];
  members:         TripMember[];
  currentUserId:   string;
  isLeader:        boolean;
  myMembership:    TripMember | null;
}

// ── Config ────────────────────────────────────────────────────────────────────

const LEVEL_CFG = {
  SAFE:      { label: "Safe",      color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25", icon: Shield },
  CAUTION:   { label: "Caution",   color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/25",   icon: AlertTriangle },
  HIGH_RISK: { label: "High Risk", color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/25",  icon: Zap },
  EXTREME:   { label: "Extreme",   color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/25",     icon: XCircle },
} as const;

function LevelBadge({ level, score }: { level: SafetyLevel; score?: number }) {
  const cfg  = LEVEL_CFG[level];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-body text-xs font-semibold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <Icon size={11} />{cfg.label}{score !== undefined ? ` (${score})` : ""}
    </span>
  );
}

function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#f59e0b" : score >= 40 ? "#fb923c" : "#f87171";
  const r = size * 0.4; const circ = 2 * Math.PI * r; const half = size / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={half} cy={half} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4"/>
        <circle cx={half} cy={half} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-white" style={{ fontSize: size * 0.22 }}>{score}</span>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: typeof Shield; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="trip-card rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-amber-400" />
          <span className="font-display font-bold text-white text-sm">{title}</span>
        </div>
        {open ? <ChevronUp size={15} className="text-slate-500"/> : <ChevronDown size={15} className="text-slate-500"/>}
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-800 space-y-3">{children}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = use(params);
  const router   = useRouter();

  const [plan,      setPlan]      = useState<TripPlan | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting,  setInviting]  = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/trips/${id}`, { credentials: "include" });
      if (res.status === 401) { setError("Please sign in to view this trip."); return; }
      if (res.status === 403) { setError("You don't have access to this trip."); return; }
      if (res.status === 404) { setError("Trip not found."); return; }
      if (!res.ok) { setError("Failed to load trip."); return; }
      setPlan(await res.json());
    } catch { setError("Network error — please try again."); } finally { setLoading(false); }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/trips/${id}/analyze`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) await load();
      else { const d = await res.json(); setError(d.message ?? "Analysis failed."); }
    } catch { setError("Analysis failed."); } finally { setAnalyzing(false); }
  }

  async function invite() {
    if (!inviteUsername.trim()) return;
    setInviting(true); setInviteErr(null);
    try {
      const res = await fetch(`/api/trips/${id}/invite`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername.trim().replace(/^@/, "") }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteErr(data.message); return; }
      setInviteUsername(""); await load();
    } catch { setInviteErr("Failed to invite."); } finally { setInviting(false); }
  }

  async function respond(action: "accept" | "decline") {
    setResponding(true);
    try {
      const res = await fetch(`/api/trips/${id}/respond`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await load();
    } catch { /* silent */ } finally { setResponding(false); }
  }

  // ── Loading / Error ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1e" }}>
      <Loader2 size={36} className="text-amber-400 animate-spin" />
    </div>
  );

  if (error || !plan) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1e" }}>
      <div className="text-center max-w-sm px-4">
        <XCircle className="text-red-400 mx-auto mb-4" size={40} />
        <p className="font-body text-slate-300 mb-4 text-sm">{error}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => router.back()} className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white font-body text-sm transition-colors"><ArrowLeft size={14} className="inline mr-1"/>Back</button>
          <button onClick={load} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm transition-colors"><RefreshCw size={14} className="inline mr-1"/>Retry</button>
        </div>
      </div>
    </div>
  );

  const risk    = plan.groupRiskResult;
  const overall = risk?.overallGroupLevel ?? null;
  const overallCfg = overall ? LEVEL_CFG[overall] : null;
  const OverallIcon = overallCfg?.icon;
  const acceptedMembers = plan.members.filter((m) => m.status === "ACCEPTED");
  const pendingMembers  = plan.members.filter((m) => m.status === "PENDING");
  const myInvite        = plan.myMembership?.status === "PENDING";

  return (
    <div className="min-h-screen" style={{ background: "#0a0f1e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}
        .font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .anim{animation:fadeUp .4s ease both}
        .nav-blur{background:rgba(10,15,30,.92);border-bottom:1px solid rgba(255,255,255,.06);backdrop-filter:blur(20px)}
        .trip-card{background:rgba(15,23,42,.8);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px)}
        .trip-input{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:white;font-family:'DM Sans',system-ui,sans-serif;transition:border-color .2s}
        .trip-input:focus{border-color:rgba(245,158,11,.5);box-shadow:0 0 0 3px rgba(245,158,11,.08);outline:none}
        .trip-input::placeholder{color:rgba(255,255,255,.25)}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s}
        .amber-btn:hover:not(:disabled){background:#fbbf24;box-shadow:0 0 24px rgba(245,158,11,.3)}
        .glow-dot{position:fixed;border-radius:9999px;filter:blur(100px);pointer-events:none;z-index:0}
      `}</style>

      <div className="glow-dot w-[400px] h-[300px] bg-amber-500/7 -top-20 -left-20"/>

      {/* Navbar */}
      <nav className="nav-blur fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 md:px-8 h-16">
        <div className="flex items-center gap-3">
          <Link href="/trips" className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-body text-sm">
            <ArrowLeft size={15}/> Your Plans
          </Link>
          <span className="text-slate-700">·</span>
          <div className="flex items-center gap-2">
            <Mountain className="text-amber-400" size={18}/>
            <span className="font-display font-bold text-white">YatraAI</span>
          </div>
        </div>
        {plan.isLeader && (
          <button onClick={runAnalysis} disabled={analyzing}
            className="amber-btn flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
            {analyzing ? <><Loader2 size={14} className="animate-spin"/> Analysing…</> : <><Sparkles size={14}/> Run Analysis</>}
          </button>
        )}
      </nav>

      <div className="pt-20 max-w-3xl mx-auto px-4 md:px-8 pb-16 relative z-10 space-y-5">

        {/* ── Pending invitation banner ────────────────────────────────── */}
        {myInvite && (
          <div className="trip-card rounded-2xl p-5 border-purple-400/30 anim" style={{ borderColor: "rgba(167,139,250,0.3)" }}>
            <div className="flex items-start gap-3 mb-4">
              <UserPlus size={18} className="text-purple-400 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="font-display font-bold text-white mb-0.5">{plan.leader.name} invited you to join</p>
                <p className="font-body text-sm text-slate-400">{plan.title} · {plan.stops.length} stop{plan.stops.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => respond("decline")} disabled={responding}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20 font-body text-sm font-medium transition-all disabled:opacity-50">
                <X size={14}/> Decline
              </button>
              <button onClick={() => respond("accept")} disabled={responding}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-body text-sm font-medium transition-all disabled:opacity-50">
                {responding ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>} Accept & Join
              </button>
            </div>
          </div>
        )}

        {/* ── Hero card ──────────────────────────────────────────────────── */}
        <div className="trip-card rounded-2xl p-6 anim">
          <div className="flex flex-col md:flex-row gap-5 items-start">
            {risk && <ScoreRing score={risk.overallGroupScore} size={80}/>}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {overallCfg && OverallIcon && (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border font-body text-sm font-semibold ${overallCfg.color} ${overallCfg.bg} ${overallCfg.border}`}>
                    <OverallIcon size={13}/>{overallCfg.label} for Group
                  </span>
                )}
                {!risk && (
                  <span className="px-3 py-1 rounded-full bg-slate-700/50 border border-slate-600/40 text-slate-400 font-body text-xs">
                    Analysis not run yet
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-body font-semibold uppercase ${plan.tripType === "GROUP" ? "bg-sky-400/10 border-sky-400/20 text-sky-400" : "bg-slate-700/50 border-slate-600/40 text-slate-400"}`}>
                  {plan.tripType}
                </span>
              </div>
              <h1 className="font-display text-2xl font-bold text-white mb-1">{plan.title}</h1>
              <div className="flex items-center gap-3 flex-wrap text-slate-500 font-body text-xs">
                <span className="flex items-center gap-1"><Calendar size={11}/>{new Date(plan.startDate).toLocaleDateString()} → {new Date(plan.endDate).toLocaleDateString()}</span>
                <span className="flex items-center gap-1"><MapPin size={11}/>{plan.stops.length} stops</span>
                <span className="flex items-center gap-1"><Users size={11}/>{acceptedMembers.length + 1} members</span>
                {plan.budgetNPR && <span className="flex items-center gap-1"><Wallet size={11}/>NPR {plan.budgetNPR.toLocaleString()}</span>}
              </div>

              {/* AI verdict */}
              {risk?.ai?.groupVerdict && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <Sparkles size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
                  <p className="font-body text-sm text-slate-300 leading-relaxed">{risk.ai.groupVerdict}</p>
                </div>
              )}
            </div>
          </div>

          {/* AI extra summaries */}
          {risk?.ai && (risk.ai.conflictSummary || risk.ai.routeWarning || risk.ai.topGroupTip) && (
            <div className="mt-5 pt-5 border-t border-slate-800 space-y-3">
              {risk.ai.conflictSummary && (
                <div className="flex items-start gap-2">
                  <Heart size={13} className="text-rose-400 flex-shrink-0 mt-0.5"/>
                  <p className="font-body text-xs text-slate-400 leading-relaxed">{risk.ai.conflictSummary}</p>
                </div>
              )}
              {risk.ai.routeWarning && (
                <div className="flex items-start gap-2">
                  <AlertTriangle size={13} className="text-orange-400 flex-shrink-0 mt-0.5"/>
                  <p className="font-body text-xs text-slate-400 leading-relaxed">{risk.ai.routeWarning}</p>
                </div>
              )}
              {risk.ai.topGroupTip && (
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0 mt-0.5"/>
                  <p className="font-body text-xs text-emerald-300 leading-relaxed"><strong>Top tip:</strong> {risk.ai.topGroupTip}</p>
                </div>
              )}
            </div>
          )}

          {/* Run analysis prompt */}
          {!risk && plan.isLeader && (
            <div className="mt-5 pt-5 border-t border-slate-800 flex items-center justify-between gap-4">
              <p className="font-body text-sm text-slate-400">Run the group safety analysis to see risk scores for each stop and member.</p>
              <button onClick={runAnalysis} disabled={analyzing}
                className="amber-btn shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
                {analyzing ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
                {analyzing ? "Analysing…" : "Analyse Now"}
              </button>
            </div>
          )}
        </div>

        {/* ── Route map ──────────────────────────────────────────────────── */}
        {plan.stops.length >= 1 && plan.stops[0].location && (
          <div className="trip-card rounded-2xl p-6 anim">
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={15} className="text-amber-400" />
              <span className="font-display font-bold text-white text-sm">Route Map</span>
            </div>
            <RouteMapLoader
              startLat={28.2296} // Kathmandu default
              startLon={85.3240}
              endLat={plan.stops[plan.stops.length - 1].location?.id === plan.stops[0].location?.id ? 27.9 : 27.7}
              endLon={plan.stops[plan.stops.length - 1].location?.id === plan.stops[0].location?.id ? 85.9 : 85.3}
              originName={plan.stops[0].location.name}
              destinationName={plan.stops[plan.stops.length - 1].location.name}
              riskLevel={risk?.overallGroupLevel || "MEDIUM"}
            />
          </div>
        )}

        {/* ── Route stops with per-stop analysis ────────────────────────── */}
        <Section title={`Route (${plan.stops.length} stops)`} icon={MapPin}>
          <div className="space-y-4 pt-3">
            {plan.stops.map((stop, i) => {
              const stopAnalysis = risk?.stopAnalyses?.[i];
              const stopCfg      = stopAnalysis ? LEVEL_CFG[stopAnalysis.groupLevel] : null;
              const StopIcon     = stopCfg?.icon;

              return (
                <div key={i}>
                  {/* Connector */}
                  {i > 0 && (
                    <div className="flex items-center gap-2 mb-4 ml-3">
                      {(() => {
                        const seg = risk?.routeSegments?.[i - 1];
                        return seg ? (
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-body ${
                            seg.risk === "HIGH"   ? "bg-red-500/10 border-red-500/20 text-red-400"
                            : seg.risk === "MEDIUM" ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                            : "bg-slate-800/60 border-slate-700/50 text-slate-500"
                          }`}>
                            <ArrowRight size={11}/>
                            <span>{seg.risk} route risk · {seg.reason}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-slate-700"><ArrowRight size={11}/><span className="font-body text-xs">Travel segment</span></div>
                        );
                      })()}
                    </div>
                  )}

                  <div className={`p-4 rounded-xl border ${stopAnalysis?.conflict ? "border-orange-500/25 bg-orange-500/5" : "border-slate-700/50 bg-slate-800/40"}`}>
                    {/* Stop header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full bg-amber-400/15 border border-amber-400/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="font-display font-bold text-amber-400 text-xs">{i + 1}</span>
                        </div>
                        <div>
                          <p className="font-body font-semibold text-white">{stop.location.name}</p>
                          <p className="font-body text-xs text-slate-500">{stop.location.district.name}, {stop.location.district.province.name}{stop.location.altitude ? ` · ${stop.location.altitude.toLocaleString()}m` : ""}</p>
                          <p className="font-body text-xs text-slate-600 mt-0.5">
                            {new Date(stop.arrivalDate).toLocaleDateString()} → {new Date(stop.departureDate).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      {stopAnalysis && stopCfg && StopIcon && (
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-body font-bold ${stopCfg.color} ${stopCfg.bg} ${stopCfg.border}`}>
                            <StopIcon size={10}/>{stopCfg.label}
                          </span>
                          <span className="font-body text-xs text-slate-500">min: {stopAnalysis.minScore} · avg: {stopAnalysis.groupScore}</span>
                        </div>
                      )}
                    </div>

                    {/* Per-member results */}
                    {stopAnalysis && stopAnalysis.memberResults.length > 0 && (
                      <div className="space-y-2 mb-3">
                        <p className="font-body text-xs text-slate-600 uppercase tracking-widest">Member risk at this stop</p>
                        {stopAnalysis.memberResults.map((mr) => {
                          const mc  = LEVEL_CFG[mr.safetyLevel];
                          const MIcon = mc.icon;
                          return (
                            <div key={mr.userId} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900/50">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
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
                                  <MIcon size={9}/>{mc.label}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Conflict warning */}
                    {stopAnalysis?.conflict && (
                      <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 mb-3">
                        <div className="flex items-start gap-2">
                          <AlertCircle size={13} className="text-orange-400 flex-shrink-0 mt-0.5"/>
                          <p className="font-body text-xs text-orange-300 leading-relaxed">{stopAnalysis.conflictReason}</p>
                        </div>
                      </div>
                    )}

                    {/* Alternatives */}
                    {stopAnalysis?.alternatives && stopAnalysis.alternatives.length > 0 && (
                      <div>
                        <p className="font-body text-xs text-slate-600 uppercase tracking-widest mb-2">Safer alternatives</p>
                        <div className="space-y-1.5">
                          {stopAnalysis.alternatives.slice(0, 3).map((alt) => (
                            <div key={alt.locationId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40">
                              <div className="flex items-center gap-2">
                                <MapPin size={11} className="text-emerald-400"/>
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
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Group members ──────────────────────────────────────────────── */}
        <Section title={`Group Members (${acceptedMembers.length + 1})`} icon={Users}>
          <div className="space-y-2 pt-3">
            {/* Leader */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-amber-400/5 border border-amber-400/20">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-amber-400/20 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
                  <span className="font-display font-bold text-amber-400 text-xs">{plan.leader.name[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <p className="font-body text-sm text-white">{plan.leader.name}</p>
                  {plan.leader.username && <p className="font-body text-xs text-slate-500">@{plan.leader.username}</p>}
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/25 text-amber-400 font-body text-[10px] font-semibold">Leader</span>
            </div>

            {/* Members */}
            {plan.members.map((m) => (
              <div key={m.id} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${
                m.status === "ACCEPTED" ? "bg-slate-800/40 border-slate-700/50"
                : m.status === "PENDING" ? "bg-purple-500/5 border-purple-500/20"
                : "bg-slate-800/20 border-slate-700/30 opacity-50"
              }`}>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-slate-700/60 border border-slate-600/40 flex items-center justify-center flex-shrink-0">
                    <span className="font-display font-bold text-slate-300 text-xs">{m.user.name[0]?.toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="font-body text-sm text-white">{m.user.name}</p>
                    {m.user.username && <p className="font-body text-xs text-slate-500">@{m.user.username}</p>}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full border font-body text-[10px] font-semibold ${
                  m.status === "ACCEPTED" ? "bg-emerald-400/10 border-emerald-400/25 text-emerald-400"
                  : m.status === "PENDING"  ? "bg-purple-400/10 border-purple-400/25 text-purple-400"
                  : "bg-slate-700/50 border-slate-600/40 text-slate-500"
                }`}>
                  {m.status}
                </span>
              </div>
            ))}

            {/* Invite more (leader only) */}
            {plan.isLeader && plan.tripType === "GROUP" && (
              <div className="pt-2">
                <p className="font-body text-xs text-slate-500 uppercase tracking-widest mb-2">Invite by username</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-body text-sm">@</span>
                    <input type="text" placeholder="username" value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && invite()}
                      className="trip-input w-full pl-7 pr-3 py-2.5 text-sm rounded-xl" />
                  </div>
                  <button onClick={invite} disabled={inviting || !inviteUsername.trim()}
                    className="amber-btn px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-40">
                    {inviting ? <Loader2 size={14} className="animate-spin"/> : <UserPlus size={14}/>}
                    Invite
                  </button>
                </div>
                {inviteErr && <p className="font-body text-xs text-red-400 mt-1.5">{inviteErr}</p>}
                {pendingMembers.length > 0 && (
                  <p className="font-body text-xs text-slate-600 mt-2">{pendingMembers.length} pending response{pendingMembers.length !== 1 ? "s" : ""}</p>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* ── Budget ─────────────────────────────────────────────────────── */}
        {plan.budgetNPR && (
          <Section title="Budget" icon={Wallet} defaultOpen={false}>
            <div className="grid grid-cols-2 gap-3 pt-3">
              <div className="bg-slate-800/50 rounded-xl p-3 text-center">
                <p className="font-body text-xs text-slate-500 mb-1">Total budget</p>
                <p className="font-body font-semibold text-white">NPR {plan.budgetNPR.toLocaleString()}</p>
              </div>
              {risk?.budgetPerPerson && (
                <div className="bg-slate-800/50 rounded-xl p-3 text-center">
                  <p className="font-body text-xs text-slate-500 mb-1">Per person</p>
                  <p className={`font-body font-semibold ${risk.budgetFeasible ? "text-emerald-400" : "text-orange-400"}`}>
                    NPR {risk.budgetPerPerson.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
            {risk?.ai?.budgetNote && (
              <p className="font-body text-sm text-slate-400 leading-relaxed">{risk.ai.budgetNote}</p>
            )}
          </Section>
        )}

      </div>
    </div>
  );
}
