/**
 * FILE: page.tsx
 * LOCATION: /app/plan/page.tsx
 */
"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter }             from "next/navigation";
import Link                                       from "next/link";
import {
  Mountain, Search, X, Calendar, MapPin, Users, User,
  ArrowLeft, Loader2, Shield, AlertTriangle, Zap, XCircle,
  CheckCircle2, Heart, Package, Navigation, Clock,
  CloudRain, Wind, Thermometer, Snowflake, Wallet,
  Sparkles, RefreshCw, ChevronDown, ChevronUp, ArrowRight,
  UserPlus, AlertCircle, TrendingDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DestinationResult {
  id: string; name: string; district: string; province: string; altitude: number | null;
  latitude?: number; longitude?: number;
}

interface MemberResult {
  id: string; name: string; username: string | null; image: string | null; status: string;
}

interface MemberAnalysis {
  userId: string; name: string; username: string | null; isLeader: boolean;
  score: number; level: string; topRisks: string[]; healthFlags: string[];
}

interface WeatherSnapshot {
  temperature: number;
  rainfall: number;
  windSpeed: number;
  description: string;
  source?: string;
  sourceLabel?: string;
  officialSource?: boolean;
  stationName?: string;
  stationDistanceKm?: number;
}

interface HazardSnapshot {
  floodIndex: number;
  landslideIndex: number;
  earthquakeIndex: number;
  airQuality: number;
}

interface RouteRisk {
  from: string;
  to: string;
  date: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
}

interface Alternative {
  id: string; name: string; district: string; province: string;
  altitude: number | null; safetyScore: number; safetyLevel: string;
  estimatedNPR: number; budgetFeasible: boolean;
}

interface PlanReport {
  destination:    { id: string; name: string; district: string; province: string; altitude: number | null };
  travelDate:     string;
  tripType:       string;
  liveWeather?:   WeatherSnapshot | null;
  liveHazard?:    HazardSnapshot | null;
  routeRisk?:     RouteRisk | null;
  season:         string;
  overallScore:   number;
  overallLevel:   "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  groupAvgScore:  number;
  confidence:     number;
  conflict:       boolean;
  mostVulnerableMember: { name: string; score: number; level: string; risks: string[] } | null;
  memberAnalyses: MemberAnalysis[];
  riskFactors:    { category: string; name: string; severity: string; score: number; description: string }[];
  healthAdvisories: { condition: string; risk: string; detail: string; affectedGroups: string[] }[];
  recommendations: { type: string; text: string }[];
  notableEvents:   { date: string; type: string; description: string; severity: string }[];
  seasonalContext: string;
  weatherStats:   { avgTempMax: number; avgTempMin: number; avgRainfall: number; avgWindSpeed: number; avgSnowfall: number; heavyRainProbability: number; freezingProbability: number; snowProbability: number; maxRainfall: number; minTemp: number; maxTemp: number; yearsAnalysed: number } | null;
  budget: { specified: number; estimatedTotal: number; estimatedDays: number; perPerson: number; breakdown: { accommodation: number; food: number; transport: number; label: string }; feasible: boolean; shortfall: number };
  alternatives:   Alternative[];
  ai: { verdict: string; whyUnsafe: string; groupConflict: string; riskExplanation: string; healthWarning: string; budgetAdvice: string; alternativeReason: string; topTip: string };
  pillarScores?: Array<{
    id: "route_historic" | "route_realtime" | "destination_safety" | "weather_safety" | "personal_safety";
    title: string;
    maxPoints: number;
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    summary: string;
  }>;
  routePillar?: {
    highway: string;
    breakpoints: string[];
    incidentBreakdown?: Array<{ section: string; total: number; roadAccidents: number; floods: number; landslides: number }>;
    segmentFlags: Array<{
      where: string;
      when: string;
      what: string;
      effect: string;
      status: "Clear" | "Advisory" | "Blocked";
      sources: string[];
    }>;
  };
  destinationPillar?: {
    historicProfile: string;
    realtimeSnapshot: string;
  };
  weatherPillar?: {
    deltas: { temperature: number; altitude: number; humidity: number; rainfallRatio: number };
    acclimatizationDays: number;
    forecastWeek?: Array<{
      date: string;
      weatherCode: number;
      tempMax: number;
      tempMin: number;
      rainProb: number;
      windMax: number;
      isTravelDate: boolean;
    }>;
  };
  personalPillar?: {
    clearance: string;
    flags: string[];
    soloSummary: string;
    guideRequired: boolean;
    emergencyPreparedness: {
      hospital: string;
      helicopter: string;
      mobileCoverage: "Good" | "Partial" | "None";
      pavedRoadAccessHours: number;
      evacuationWarning: string | null;
    };
  };
  analyzedAt:     string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const LEVEL_CFG = {
  SAFE:      { label: "Safe to Travel",          color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30", icon: Shield },
  CAUTION:   { label: "Travel with Caution",     color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/30",   icon: AlertTriangle },
  HIGH_RISK: { label: "High Risk — Reconsider",  color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/30",  icon: Zap },
  EXTREME:   { label: "Extreme — Do Not Travel", color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/30",     icon: XCircle },
} as const;

const SEVERITY_COLOR: Record<string, string> = {
  LOW:      "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  MEDIUM:   "text-amber-400   bg-amber-400/10   border-amber-400/20",
  HIGH:     "text-orange-400  bg-orange-400/10  border-orange-400/20",
  CRITICAL: "text-red-400     bg-red-400/10     border-red-400/20",
};

const REC_ICON: Record<string, typeof Package> = {
  GEAR: Package, TIMING: Clock, MEDICAL: Heart, ROUTE: Navigation, AVOID: XCircle,
};
const REC_COLOR: Record<string, string> = {
  GEAR: "text-sky-400", TIMING: "text-amber-400", MEDICAL: "text-rose-400", ROUTE: "text-purple-400", AVOID: "text-red-400",
};

// ── Small components ──────────────────────────────────────────────────────────

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#f59e0b" : score >= 40 ? "#fb923c" : "#f87171";
  const r = size * 0.4; const circ = 2 * Math.PI * r; const half = size / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={half} cy={half} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4.5"/>
        <circle cx={half} cy={half} r={r} fill="none" stroke={color} strokeWidth="4.5"
          strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-white" style={{ fontSize: size * 0.22 }}>{score}</span>
        <span className="font-body text-slate-500" style={{ fontSize: size * 0.12 }}>/100</span>
      </div>
    </div>
  );
}

function weatherEmoji(code: number) {
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "⛅";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌤️";
}

// Quick route safety check component
function QuickRouteCheck({ destination, travelDate, originLat, originLon }: {
  destination: DestinationResult;
  travelDate: string;
  originLat: number | null;
  originLon: number | null;
}) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{
    season: string;
    route?: { risk: string; reason: string; seasonalContext: string; floodRisk: number; landslideRisk: number };
    seasonalRisks: { name: string; severity: string; description: string }[];
    recommendations: string[];
  } | null>(null);

  useEffect(() => {
    if (!destination || !travelDate) return;

    async function checkRoute() {
      setLoading(true);
      try {
        const res = await fetch("/api/routes/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: originLat && originLon ? { lat: originLat, lon: originLon } : null,
            destination: {
              lat: destination.latitude || 0,
              lon: destination.longitude || 0,
              name: destination.name,
              district: destination.district,
              province: destination.province,
            },
            travelDate,
          }),
        });
        if (res.ok) {
          setResult(await res.json());
        }
      } catch (err) {
        console.error("Route check failed:", err);
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(checkRoute, 500);
    return () => clearTimeout(timer);
  }, [destination, travelDate, originLat, originLon]);

  if (loading) {
    return (
      <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-amber-400 animate-spin" />
          <span className="font-body text-xs text-slate-400">Checking route safety for {new Date(travelDate).toLocaleDateString("en-NP", { month: "long", day: "numeric" })}...</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const riskColor = result.route?.risk === "HIGH" ? "text-orange-400 bg-orange-400/10 border-orange-400/20"
    : result.route?.risk === "MEDIUM" ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
    : "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";

  const riskIcon = result.route?.risk === "HIGH" ? Zap
    : result.route?.risk === "MEDIUM" ? AlertTriangle
    : Shield;

  return (
    <div className="space-y-3">
      {/* Season indicator */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/50">
        <Calendar size={12} className="text-amber-400" />
        <span className="font-body text-xs text-slate-300">
          {result.season} · {new Date(travelDate).toLocaleDateString("en-NP", { month: "long", day: "numeric", year: "numeric" })}
        </span>
      </div>

      {/* Route risk indicator */}
      {result.route && (
        <div className={`p-3 rounded-xl border ${riskColor}`}>
          <div className="flex items-center gap-2 mb-1">
            {(() => { const Icon = riskIcon; return <Icon size={14} />; })()}
            <span className="font-body text-sm font-semibold uppercase">{result.route.risk} Risk</span>
          </div>
          <p className="font-body text-xs text-slate-300 leading-relaxed">{result.route.reason}</p>
        </div>
      )}

      {/* Seasonal risks */}
      {result.seasonalRisks.length > 0 && (
        <div className="space-y-2">
          {result.seasonalRisks.slice(0, 2).map((risk, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
              <AlertTriangle size={12} className={risk.severity === "HIGH" ? "text-orange-400" : "text-amber-400"} />
              <div>
                <p className="font-body text-xs text-white">{risk.name}</p>
                <p className="font-body text-[10px] text-slate-500">{risk.description.slice(0, 80)}...</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick recommendations */}
      {result.recommendations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {result.recommendations.slice(0, 2).map((rec, i) => (
            <span key={i} className="px-2 py-1 rounded-lg bg-slate-800/40 border border-slate-700/50 font-body text-[10px] text-slate-400">
              {rec}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children, defaultOpen = true, accent = false }: {
  title: string; icon: typeof Shield; children: React.ReactNode; defaultOpen?: boolean; accent?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`plan-card rounded-2xl overflow-hidden ${accent ? "border-red-500/25" : ""}`}
      style={accent ? { borderColor: "rgba(239,68,68,0.25)" } : {}}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Icon size={15} className={accent ? "text-red-400" : "text-amber-400"} />
          <span className="font-display font-bold text-white text-sm">{title}</span>
        </div>
        {open ? <ChevronUp size={15} className="text-slate-500"/> : <ChevronDown size={15} className="text-slate-500"/>}
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-800 space-y-3">{children}</div>}
    </div>
  );
}

// ── Destination search ────────────────────────────────────────────────────────

function DestSearch({ value, onChange }: {
  value: DestinationResult | null; onChange: (d: DestinationResult | null) => void;
}) {
  const [q, setQ]             = useState(value?.name ?? "");
  const [results, setResults] = useState<DestinationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const timer                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref                   = useRef<HTMLDivElement>(null);

  // Sync input text when value is set externally (e.g. from URL params)
  useEffect(() => {
    if (value?.name) setQ(value.name);
  }, [value?.name]);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim() || q === value?.name) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/destinations/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (res.ok) { setResults(await res.json()); setOpen(true); }
      } catch { /* silent */ } finally { setLoading(false); }
    }, 300);
  }, [q]);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="text" placeholder="Search destination…" value={q}
          onChange={(e) => { setQ(e.target.value); if (value) onChange(null); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="plan-input w-full pl-10 pr-9 py-3 text-sm rounded-xl" required />
        {loading
          ? <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin"/>
          : q ? <button onClick={() => { onChange(null); setQ(""); setResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={14}/></button>
          : null}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
          style={{ background: "rgba(10,15,30,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {results.map((d) => (
            <button key={d.id} onClick={() => { onChange(d); setQ(d.name); setOpen(false); setResults([]); }}
              className="w-full flex items-start gap-2 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-slate-800/60 last:border-0">
              <MapPin size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="font-body text-sm text-white">{d.name}</p>
                <p className="font-body text-xs text-slate-500">{d.district}, {d.province}{d.altitude ? ` · ${d.altitude.toLocaleString()}m` : ""}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Member search ─────────────────────────────────────────────────────────────

function MemberSearch({ members, onChange }: {
  members: MemberResult[];
  onChange: (m: MemberResult[]) => void;
}) {
  const [q,        setQ]        = useState("");
  const [results,  setResults]  = useState<MemberResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (res.ok) setResults(await res.json());
      } catch { /* silent */ } finally { setLoading(false); }
    }, 300);
  }, [q]);

  function add(u: MemberResult) {
    if (!u.username) return;
    if (members.some((m) => m.id === u.id)) return;
    onChange([...members, u]);
    setQ(""); setResults([]);
  }

  function remove(id: string) { onChange(members.filter((m) => m.id !== id)); }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
        <input type="text" placeholder="Search by username…" value={q} onChange={(e) => setQ(e.target.value)}
          className="plan-input w-full pl-9 pr-9 py-2.5 text-sm rounded-xl"/>
        {loading
          ? <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin"/>
          : q ? <button onClick={() => { setQ(""); setResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={13}/></button>
          : null}
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((u) => {
            const added = members.some((m) => m.id === u.id);
            return (
              <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <div>
                  <p className="font-body text-sm text-white">{u.name}</p>
                  {u.username && <p className="font-body text-xs text-slate-500">@{u.username}</p>}
                </div>
                <button type="button" onClick={() => add(u)} disabled={added || !u.username}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-body font-medium transition-all ${added ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 cursor-default" : "border-amber-500/25 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>
                  {added ? <><CheckCircle2 size={11}/> Added</> : <><UserPlus size={11}/> Add</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {members.length > 0 && (
        <div className="space-y-2">
          <p className="font-body text-xs text-slate-500 uppercase tracking-widest">Partners ({members.length})</p>
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-400/15 border border-amber-400/25 flex items-center justify-center flex-shrink-0">
                  <span className="font-display font-bold text-amber-400 text-xs">{m.name[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <p className="font-body text-sm text-white">{m.name}</p>
                  {m.username && <p className="font-body text-xs text-slate-500">@{m.username}</p>}
                </div>
              </div>
              <button type="button" onClick={() => remove(m.id)} className="p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all">
                <X size={13}/>
              </button>
            </div>
          ))}
        </div>
      )}

      {members.length === 0 && !q && (
        <p className="font-body text-xs text-slate-600 text-center py-3">
          Search for travel partners by username. Their health profiles will be included in the safety analysis.
        </p>
      )}
    </div>
  );
}

// ── Inner plan page ───────────────────────────────────────────────────────────

function PlanInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [destination, setDestination] = useState<DestinationResult | null>(null);
  const [travelDate,  setTravelDate]  = useState(searchParams.get("date") ?? "");
  const [tripType,    setTripType]    = useState<"SOLO" | "GROUP">(
    (searchParams.get("type") as "SOLO" | "GROUP") ?? "SOLO"
  );
  const [originLat, setOriginLat] = useState<number | null>(null);
  const [originLon, setOriginLon] = useState<number | null>(null);
  const [budgetNPR,   setBudgetNPR]   = useState("");
  const [members,     setMembers]     = useState<MemberResult[]>([]);
  const [submitting,  setSubmitting]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [updating,    setUpdating]    = useState(false);
  const [report,      setReport]      = useState<PlanReport | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [showAllRiskFactors, setShowAllRiskFactors] = useState(false);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [showAllHealthAdvisories, setShowAllHealthAdvisories] = useState(false);
  const ORIGIN_CACHE_KEY = "yatraai:last-origin";

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const destId   = searchParams.get("destination");
    const destName = searchParams.get("name");
    const urlDate  = searchParams.get("date");
    const urlType  = searchParams.get("type") as "SOLO" | "GROUP" | null;
    const qOriginLat = searchParams.get("originLat");
    const qOriginLon = searchParams.get("originLon");
    const qPlanId = searchParams.get("planId");

    if (destId && destName) {
      setDestination({ id: destId, name: destName, district: "", province: "", altitude: null });
    }
    if (urlDate)  setTravelDate(urlDate);
    if (urlType)  setTripType(urlType);
    if (qOriginLat && qOriginLon) {
      const lat = Number(qOriginLat);
      const lon = Number(qOriginLon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        setOriginLat(lat);
        setOriginLon(lon);
      }
    }
    if (!qOriginLat || !qOriginLon) {
      try {
        const cached = localStorage.getItem(ORIGIN_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as { lat?: number; lon?: number };
          if (Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lon)) {
            setOriginLat(parsed.lat as number);
            setOriginLon(parsed.lon as number);
          }
        }
      } catch {
        // ignore cache parse issues
      }
    }
    if (qPlanId) setSavedPlanId(qPlanId);
  }, []);

  function updatePlanIdInUrl(planId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("planId", planId);
    router.replace(`/plan?${params.toString()}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!destination) { setError("Please select a destination."); return; }
    if (!travelDate)  { setError("Travel date is required."); return; }
    if (tripType === "GROUP" && members.length === 0) { setError("Group trips require at least one partner."); return; }

    setSubmitting(true); setError(null); setReport(null);
    try {
      let requestOriginLat = originLat;
      let requestOriginLon = originLon;

      // Fallback for direct /plan URLs without origin params:
      // use browser geolocation at submit-time if permission exists.
      if ((requestOriginLat == null || requestOriginLon == null) && typeof navigator !== "undefined" && navigator.geolocation) {
        const geo = await new Promise<{ lat: number; lon: number } | null>((resolve) => {
          let done = false;
          const timer = setTimeout(() => {
            if (done) return;
            done = true;
            resolve(null);
          }, 4500);

          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
            },
            () => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              resolve(null);
            },
            {
              enableHighAccuracy: false,
              timeout: 4000,
              maximumAge: 120000,
            }
          );
        });
        if (geo) {
          requestOriginLat = geo.lat;
          requestOriginLon = geo.lon;
          setOriginLat(geo.lat);
          setOriginLon(geo.lon);
          try {
            localStorage.setItem(ORIGIN_CACHE_KEY, JSON.stringify({ lat: geo.lat, lon: geo.lon }));
          } catch {
            // ignore storage errors
          }
        }
      }

      const res = await fetch("/api/plan", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationId:   destination.id,
          travelDate,
          tripType,
          budgetNPR:       budgetNPR ? parseInt(budgetNPR, 10) : 0,
          memberUsernames: members.map((m) => m.username).filter(Boolean),
          originLat: requestOriginLat,
          originLon: requestOriginLon,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? "Analysis failed."); return; }
      setShowAllRiskFactors(false);
      setShowAllHealthAdvisories(false);
      setShowAllRecommendations(false);
      setReport(data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(`Failed: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  function buildPlanPayload(report: PlanReport, mode: "ANALYZED" | "PENDING") {
    return {
      title: `${report.destination.name} ${report.travelDate}`,
      tripType: report.tripType as "SOLO" | "GROUP",
      startDate: report.travelDate,
      endDate: report.travelDate,
      budgetNPR: report.budget?.specified ?? 0,
      stops: [
        {
          locationId: report.destination.id,
          stopOrder: 1,
          arrivalDate: report.travelDate,
          departureDate: report.travelDate,
        },
      ],
      memberUsernames: (report.memberAnalyses ?? [])
        .filter((m) => !m.isLeader && !!m.username)
        .map((m) => String(m.username)),
      status: mode,
      groupRiskResult: {
        overallLevel: report.overallLevel,
        overallScore: report.overallScore,
        confidence: report.confidence,
        routeRisk: report.routeRisk,
        riskFactors: report.riskFactors,
        recommendations: report.recommendations,
        analyzedAt: report.analyzedAt,
      },
      stopRiskSnapshot: {
        overallLevel: report.overallLevel,
        overallScore: report.overallScore,
        routeRisk: report.routeRisk,
        destination: report.destination,
        travelDate: report.travelDate,
      },
    };
  }

  async function handleSavePlan(mode: "ANALYZED" | "PENDING" = "ANALYZED") {
    if (!report) return;
    setSaving(true);
    setError(null);
    try {
      const payload = buildPlanPayload(report, mode);

      const res = await fetch("/api/trips", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Failed to save plan.");
        return;
      }
      setSavedPlanId(data.id);
      updatePlanIdInUrl(data.id);
      router.push(`/trips/${data.id}`);
    } catch (err) {
      setError(`Failed to save plan: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateExistingPlan() {
    if (!report || !savedPlanId) return;
    setUpdating(true);
    setError(null);
    try {
      const payload = buildPlanPayload(report, "ANALYZED");
      const res = await fetch(`/api/trips/${savedPlanId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Failed to update saved plan.");
        return;
      }
      updatePlanIdInUrl(savedPlanId);
      router.push(`/trips/${savedPlanId}`);
    } catch (err) {
      setError(`Failed to update saved plan: ${String(err)}`);
    } finally {
      setUpdating(false);
    }
  }

  // ── Result view ─────────────────────────────────────────────────────────────
  if (report) {
    const cfg       = LEVEL_CFG[report.overallLevel];
    const LevelIcon = cfg.icon;
    const isUnsafe  = report.overallLevel === "HIGH_RISK" || report.overallLevel === "EXTREME";
    const isGroup   = report.tripType === "GROUP";
    const riskFactorsVisible = showAllRiskFactors ? report.riskFactors : report.riskFactors.slice(0, 3);
    const healthAdvisoriesVisible = showAllHealthAdvisories ? report.healthAdvisories : report.healthAdvisories.slice(0, 2);
    const recommendationsVisible = showAllRecommendations ? report.recommendations : report.recommendations.slice(0, 4);

    return (
      <div className="max-w-3xl mx-auto px-4 pb-16 space-y-4">
        <div className="flex items-center justify-between py-4">
          <button onClick={() => setReport(null)} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-body text-sm">
            <ArrowLeft size={15}/> Edit plan
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSavePlan("ANALYZED")}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-body font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              {saving ? "Saving..." : "Save Plan"}
            </button>
            <button
              onClick={() => handleSavePlan("PENDING")}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/40 border border-slate-600/50 text-slate-200 hover:bg-slate-700/60 text-xs font-body font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
              Save Draft
            </button>
            {savedPlanId && (
              <button
                onClick={handleUpdateExistingPlan}
                disabled={updating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-body font-semibold disabled:opacity-50"
              >
                {updating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {updating ? "Updating..." : "Update Existing"}
              </button>
            )}
            <span className="font-body text-xs text-slate-600">Analysed {new Date(report.analyzedAt).toLocaleString()}</span>
          </div>
        </div>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className={`plan-card rounded-2xl p-6 ${isUnsafe ? "border-red-500/20" : ""}`}
          style={isUnsafe ? { borderColor: "rgba(239,68,68,0.2)" } : {}}>
          <div className="flex flex-col md:flex-row gap-5 items-start">
            <ScoreRing score={report.overallScore} size={84}/>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border font-body text-sm font-semibold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                  <LevelIcon size={13}/>{cfg.label}
                </span>
                {isGroup && (
                  <span className="font-body text-xs text-slate-500">
                    Group min: {report.overallScore} · avg: {report.groupAvgScore}
                  </span>
                )}
                <span className="font-body text-xs text-slate-500">{Math.round(report.confidence * 100)}% confidence</span>
              </div>
              <h2 className="font-display text-xl font-bold text-white mb-0.5">
                {report.destination.name}
                {report.destination.altitude && <span className="font-body font-normal text-slate-500 text-sm ml-2">{report.destination.altitude.toLocaleString()}m</span>}
              </h2>
              <p className="font-body text-xs text-slate-500 mb-3">
                {report.destination.district}, {report.destination.province} · {new Date(report.travelDate).toLocaleDateString("en-NP", { day: "numeric", month: "long", year: "numeric" })} · {report.season}
              </p>
              {report.ai.verdict && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <Sparkles size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
                  <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.verdict}</p>
                </div>
              )}

              {report.routeRisk && (
                <div className="mt-4 p-4 rounded-2xl bg-slate-900/80 border border-slate-700/70">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <p className="font-body text-sm text-white font-semibold">Live route risk</p>
                      <p className="font-body text-xs text-slate-500">Current segment risk from your home to the destination.</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-[0.18em] ${
                      report.routeRisk.risk === "HIGH" ? "bg-orange-500/10 text-orange-300 border border-orange-500/20" : report.routeRisk.risk === "MEDIUM" ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    }`}>
                      {report.routeRisk.risk}
                    </span>
                  </div>
                  <p className="font-body text-sm text-slate-400 leading-relaxed">{report.routeRisk.reason}</p>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-start gap-2">
            <Calendar size={13} className="text-slate-500 flex-shrink-0 mt-0.5"/>
            <p className="font-body text-xs text-slate-400 leading-relaxed">{report.seasonalContext}</p>
          </div>
        </div>

        {/* ── WHY UNSAFE — shown first and prominently ─────────────────────── */}
        {isUnsafe && report.ai.whyUnsafe && (
          <div className="plan-card rounded-2xl p-5" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={15} className="text-red-400"/>
              <h3 className="font-display font-bold text-red-300 text-sm">Why this destination is unsafe</h3>
            </div>
            <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.whyUnsafe}</p>
          </div>
        )}

        {/* ── ALTERNATIVES — shown immediately after why unsafe ────────────── */}
        {(report.overallLevel !== "SAFE" || report.conflict) && report.alternatives.length > 0 && (
          <div className="plan-card rounded-2xl p-5" style={{ borderColor: "rgba(52,211,153,0.2)" }}>
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown size={15} className="text-emerald-400"/>
              <h3 className="font-display font-bold text-white text-sm">Recommended alternatives</h3>
            </div>
            {report.ai.alternativeReason && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 mb-3">
                <Sparkles size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
                <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.alternativeReason}</p>
              </div>
            )}
            <div className="space-y-2">
              {report.alternatives.map((alt, i) => {
                const altColor = alt.safetyScore >= 80 ? "text-emerald-400" : "text-amber-400";
                const isTop    = i === 0;
                return (
                  <div key={alt.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isTop ? "bg-emerald-500/8 border-emerald-500/25" : "bg-slate-800/40 border-slate-700/50"}`}>
                    <div className="flex items-start gap-2 min-w-0">
                      {isTop && <span className="text-xs mt-0.5">⭐</span>}
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
                      <button onClick={() => {
                        setDestination({ id: alt.id, name: alt.name, district: alt.district, province: alt.province, altitude: alt.altitude });
                        setSavedPlanId(null);
                        setReport(null);
                        const params = new URLSearchParams(searchParams.toString());
                        params.delete("planId");
                        router.replace(`/plan?${params.toString()}`);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }} className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 text-xs font-body font-medium transition-all">
                        Plan this →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── GROUP conflict ───────────────────────────────────────────────── */}
        {isGroup && report.conflict && (
          <Section title="Group Conflict — Conservative Analysis" icon={AlertTriangle} accent>
            <div className="pt-3 space-y-3">
              {report.ai.groupConflict && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-orange-500/8 border border-orange-500/20">
                  <AlertCircle size={13} className="text-orange-400 flex-shrink-0 mt-0.5"/>
                  <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.groupConflict}</p>
                </div>
              )}
              <div className="space-y-2">
                {report.memberAnalyses.map((m) => {
                  const mc = LEVEL_CFG[m.level as keyof typeof LEVEL_CFG] ?? LEVEL_CFG["SAFE"];
                  const MIcon = mc.icon;
                  return (
                    <div key={m.userId} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${m.level === "HIGH_RISK" || m.level === "EXTREME" ? "bg-red-500/8 border-red-500/20" : "bg-slate-800/40 border-slate-700/50"}`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                          <span className="font-display font-bold text-slate-300 text-xs">{m.name[0]?.toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-body text-sm text-white truncate">{m.name}</p>
                            {m.isLeader && <span className="px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 font-body text-[10px] font-semibold">Leader</span>}
                          </div>
                          {m.healthFlags.length > 0 && <p className="font-body text-xs text-slate-500 truncate">{m.healthFlags[0]}</p>}
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
              <p className="font-body text-xs text-slate-600">
                Conservative rule: group safety = worst member score ({report.overallScore}/100). All members must be SAFE or CAUTION to proceed.
              </p>
            </div>
          </Section>
        )}

        {/* ── Group members (no conflict) ──────────────────────────────────── */}
        {isGroup && !report.conflict && report.memberAnalyses.length > 1 && (
          <Section title={`Group Analysis — ${report.memberAnalyses.length} members`} icon={Users}>
            <div className="space-y-2 pt-3">
              {report.memberAnalyses.map((m) => {
                const mc    = LEVEL_CFG[m.level as keyof typeof LEVEL_CFG] ?? LEVEL_CFG["SAFE"];
                const MIcon = mc.icon;
                return (
                  <div key={m.userId} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-800/40 border border-slate-700/50">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                        <span className="font-display font-bold text-slate-300 text-xs">{m.name[0]?.toUpperCase()}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="font-body text-sm text-white">{m.name}</p>
                          {m.isLeader && <span className="px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 font-body text-[10px] font-semibold">Leader</span>}
                        </div>
                        {m.topRisks.length > 0 && <p className="font-body text-xs text-slate-500">{m.topRisks[0]}</p>}
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
          </Section>
        )}

        {/* ── AI Risk explanation ──────────────────────────────────────────── */}
        {report.ai.riskExplanation && (
          <div className="plan-card rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="text-amber-400"/>
              <h3 className="font-display font-bold text-white text-sm">AI Risk Analysis</h3>
            </div>
            <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.riskExplanation}</p>
            {report.ai.topTip && (
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-start gap-2">
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0 mt-0.5"/>
                <p className="font-body text-sm text-emerald-300 leading-relaxed"><strong>Top tip:</strong> {report.ai.topTip}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Pillar scorecard ─────────────────────────────────────────────── */}
        {Array.isArray(report.pillarScores) && report.pillarScores.length > 0 && (
          <Section title="Pillar Scoring Model" icon={Shield} defaultOpen>
            <div className="pt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {report.pillarScores.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-body text-sm text-white font-semibold">{p.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      p.level === "LOW"
                        ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                        : p.level === "MEDIUM"
                        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                        : "text-red-300 border-red-500/30 bg-red-500/10"
                    }`}>
                      {p.score}/{p.maxPoints}
                    </span>
                  </div>
                  <p className="font-body text-xs text-slate-400 leading-relaxed">{p.summary}</p>
                  {p.id === "route_historic" && report.routePillar && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1">
                      <p className="font-body text-[11px] text-slate-500">{report.routePillar.highway}</p>
                      {(report.routePillar.segmentFlags ?? []).slice(0, 2).map((f, i) => (
                        <p key={`${f.where}-${i}`} className="font-body text-[11px] text-slate-300">
                          {f.where}: {f.effect}
                        </p>
                      ))}
                    </div>
                  )}
                  {p.id === "route_realtime" && report.routeRisk && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50">
                      <p className="font-body text-[11px] text-slate-300">{report.routeRisk.reason}</p>
                    </div>
                  )}
                  {p.id === "destination_safety" && report.destinationPillar && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1">
                      <p className="font-body text-[11px] text-slate-300">{report.destinationPillar.historicProfile}</p>
                      <p className="font-body text-[11px] text-slate-400">{report.destinationPillar.realtimeSnapshot}</p>
                    </div>
                  )}
                  {p.id === "weather_safety" && report.weatherPillar && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50">
                      <p className="font-body text-[11px] text-slate-300">
                        Temp Δ {report.weatherPillar.deltas.temperature.toFixed(1)}°C · Altitude Δ {Math.round(report.weatherPillar.deltas.altitude)}m ·
                        Humidity Δ {report.weatherPillar.deltas.humidity.toFixed(1)}%
                      </p>
                    </div>
                  )}
                  {p.id === "personal_safety" && report.personalPillar && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1">
                      <p className="font-body text-[11px] text-slate-300">{report.personalPillar.clearance}</p>
                      <p className="font-body text-[11px] text-slate-400">{report.personalPillar.soloSummary}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Health warning ───────────────────────────────────────────────── */}
        {report.ai.healthWarning && (
          <div className="plan-card rounded-2xl p-5" style={{ borderColor: "rgba(244,63,94,0.2)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Heart size={14} className="text-rose-400"/>
              <h3 className="font-display font-bold text-white text-sm">Health Advisory</h3>
            </div>
            <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.healthWarning}</p>
          </div>
        )}

        {/* ── Weather stats ────────────────────────────────────────────────── */}
        {report.weatherStats && (
          <Section title="Historical Weather for This Period" icon={CloudRain} defaultOpen={false}>
            <p className="font-body text-xs text-slate-500 pt-2">Based on {report.weatherStats.yearsAnalysed} years</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {[
                { icon: Thermometer, label: "Avg temp",    value: `${report.weatherStats.avgTempMax}°/${report.weatherStats.avgTempMin}°C` },
                { icon: CloudRain,   label: "Avg rain",    value: `${report.weatherStats.avgRainfall}mm` },
                { icon: Wind,        label: "Avg wind",    value: `${report.weatherStats.avgWindSpeed}m/s` },
                { icon: Snowflake,   label: "Snow chance", value: `${Math.round(report.weatherStats.snowProbability * 100)}%` },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800/50 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1"><s.icon size={12} className="text-amber-400"/><span className="font-body text-xs text-slate-500">{s.label}</span></div>
                  <p className="font-body text-sm font-semibold text-white">{s.value}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Risk factors ─────────────────────────────────────────────────── */}
        {report.riskFactors.length > 0 && (
          <Section title={`Risk Factors (${report.riskFactors.length})`} icon={AlertTriangle} defaultOpen={isUnsafe}>
            {riskFactorsVisible.map((f, i) => (
              <div key={i} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-body font-semibold text-sm text-white">{f.name}</span>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-body font-bold uppercase ${SEVERITY_COLOR[f.severity] ?? SEVERITY_COLOR["LOW"]}`}>{f.severity}</span>
                  </div>
                  <span className="font-body text-xs text-slate-500">-{f.score}pts</span>
                </div>
                <p className="font-body text-xs text-slate-400 leading-relaxed">{f.description}</p>
              </div>
            ))}
            {report.riskFactors.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllRiskFactors((v) => !v)}
                className="w-full py-2 rounded-xl border border-slate-700/50 bg-slate-800/30 text-slate-300 text-xs font-body hover:bg-slate-700/30"
              >
                {showAllRiskFactors ? "Show fewer risk factors" : `Show ${report.riskFactors.length - 3} more risk factors`}
              </button>
            )}
          </Section>
        )}

        {/* ── Health advisories ────────────────────────────────────────────── */}
        {report.healthAdvisories.length > 0 && (
          <Section title={`Health Advisories (${report.healthAdvisories.length})`} icon={Heart}>
            {healthAdvisoriesVisible.map((h, i) => (
              <div key={i} className={`p-3 rounded-xl border ${h.risk === "HIGH" ? "bg-red-500/8 border-red-500/20" : h.risk === "MEDIUM" ? "bg-amber-500/8 border-amber-500/20" : "bg-slate-800/40 border-slate-700/50"}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`font-body font-semibold text-sm ${h.risk === "HIGH" ? "text-red-400" : h.risk === "MEDIUM" ? "text-amber-400" : "text-slate-300"}`}>{h.condition}</span>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-body font-bold uppercase ${SEVERITY_COLOR[h.risk] ?? SEVERITY_COLOR["LOW"]}`}>{h.risk}</span>
                </div>
                <p className="font-body text-xs text-slate-400 leading-relaxed">{h.detail}</p>
              </div>
            ))}
            {report.healthAdvisories.length > 2 && (
              <button
                type="button"
                onClick={() => setShowAllHealthAdvisories((v) => !v)}
                className="w-full py-2 rounded-xl border border-slate-700/50 bg-slate-800/30 text-slate-300 text-xs font-body hover:bg-slate-700/30"
              >
                {showAllHealthAdvisories ? "Show fewer health advisories" : `Show ${report.healthAdvisories.length - 2} more health advisories`}
              </button>
            )}
          </Section>
        )}

        {/* ── Recommendations ──────────────────────────────────────────────── */}
        {report.recommendations.length > 0 && (
          <Section title={`Recommendations (${report.recommendations.length})`} icon={CheckCircle2} defaultOpen={false}>
            {recommendationsVisible.map((r, i) => {
              const Icon  = REC_ICON[r.type]  ?? Package;
              const color = REC_COLOR[r.type] ?? "text-slate-400";
              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-700/60 ${color}`}><Icon size={13}/></div>
                  <div>
                    <span className={`font-body text-[10px] font-bold uppercase tracking-wider ${color}`}>{r.type}</span>
                    <p className="font-body text-sm text-slate-300 mt-0.5 leading-relaxed">{r.text}</p>
                  </div>
                </div>
              );
            })}
            {report.recommendations.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllRecommendations((v) => !v)}
                className="w-full py-2 rounded-xl border border-slate-700/50 bg-slate-800/30 text-slate-300 text-xs font-body hover:bg-slate-700/30"
              >
                {showAllRecommendations ? "Show fewer recommendations" : `Show ${report.recommendations.length - 4} more recommendations`}
              </button>
            )}
          </Section>
        )}

        {/* ── Budget ───────────────────────────────────────────────────────── */}
        {report.budget.specified > 0 && (
          <div className={`plan-card rounded-2xl p-5 ${report.budget.feasible ? "border-emerald-500/20" : "border-orange-500/20"}`}
            style={{ borderColor: report.budget.feasible ? "rgba(52,211,153,0.2)" : "rgba(251,146,60,0.2)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Wallet size={14} className={report.budget.feasible ? "text-emerald-400" : "text-orange-400"}/>
              <h3 className="font-display font-bold text-white text-sm">Budget</h3>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: "Your budget",    value: `NPR ${report.budget.specified.toLocaleString()}` },
                { label: "Est. trip cost", value: `NPR ${report.budget.estimatedTotal.toLocaleString()}` },
                { label: isGroup ? "Per person" : "Duration", value: isGroup ? `NPR ${report.budget.perPerson.toLocaleString()}` : `${report.budget.estimatedDays} days` },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800/50 rounded-xl p-2.5 text-center">
                  <p className="font-body text-xs text-slate-500 mb-1">{s.label}</p>
                  <p className="font-body text-sm font-semibold text-white">{s.value}</p>
                </div>
              ))}
            </div>
            {!report.budget.feasible && <p className="font-body text-sm text-orange-400 mb-2">Shortfall: NPR {report.budget.shortfall.toLocaleString()}</p>}
            {report.ai.budgetAdvice && <p className="font-body text-sm text-slate-400 leading-relaxed">{report.ai.budgetAdvice}</p>}
          </div>
        )}

      </div>
    );
  }

  // ── Form view ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl mx-auto px-4 pb-16">
      <div className="plan-card rounded-2xl p-6 md:p-8">
        <div className="mb-6">
          <h2 className="font-display text-2xl font-bold text-white mb-1">
            Plan your <em className="shimmer-text not-italic">trip</em>
          </h2>
          <p className="font-body text-sm text-slate-400">Your health profile is loaded automatically. Fill in the required fields.</p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-body text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Destination */}
          <div className="grid gap-2">
            <label className="font-body text-xs text-slate-400 uppercase tracking-widest">
              Destination <span className="text-red-400">*</span>
            </label>
            <DestSearch value={destination} onChange={setDestination}/>
            {destination && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle2 size={12} className="text-emerald-400"/>
                <span className="font-body text-xs text-emerald-400">{destination.name}{destination.district ? `, ${destination.district}` : ""}{destination.altitude ? ` · ${destination.altitude.toLocaleString()}m` : ""}</span>
              </div>
            )}
          </div>

          {/* Travel date */}
          <div className="grid gap-2">
            <label className="font-body text-xs text-slate-400 uppercase tracking-widest">
              Travel date <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
              <input type="date" min={today} value={travelDate} onChange={(e) => setTravelDate(e.target.value)}
                required className="plan-input w-full pl-10 pr-3 py-3 text-sm rounded-xl" style={{ colorScheme: "dark" }}/>
            </div>
            <p className="font-body text-xs text-slate-600">Required — historical data is analysed for this specific date</p>
          </div>

          {/* Quick route safety check */}
          {destination && travelDate && (
            <QuickRouteCheck destination={destination} travelDate={travelDate} originLat={originLat} originLon={originLon} />
          )}

          {/* Trip type */}
          <div className="grid gap-2">
            <label className="font-body text-xs text-slate-400 uppercase tracking-widest">Trip type</label>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "SOLO",  icon: User,  label: "Solo",  desc: "Individual analysis" },
                { id: "GROUP", icon: Users, label: "Group", desc: "Consensus safety" },
              ] as const).map((t) => (
                <button key={t.id} type="button" onClick={() => setTripType(t.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${tripType === t.id ? "bg-amber-400/10 border-amber-400/35 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}>
                  <t.icon size={18}/>
                  <div>
                    <p className="font-body text-sm font-medium">{t.label}</p>
                    <p className="font-body text-xs opacity-60">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Group members — required for GROUP */}
          {tripType === "GROUP" && (
            <div className="grid gap-2">
              <label className="font-body text-xs text-slate-400 uppercase tracking-widest">
                Travel partners <span className="text-red-400">*</span>
                <span className="text-slate-600 normal-case tracking-normal font-normal ml-1">— at least one required</span>
              </label>
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                <MemberSearch members={members} onChange={setMembers}/>
              </div>
              <p className="font-body text-xs text-slate-600">
                Group safety uses conservative scoring — the group score equals the lowest individual score.
              </p>
            </div>
          )}

          {/* Budget */}
          <div className="grid gap-2">
            <label className="font-body text-xs text-slate-400 uppercase tracking-widest">
              Budget (NPR) <span className="text-slate-600 normal-case tracking-normal font-normal">— optional</span>
            </label>
            <div className="relative">
              <Wallet size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
              <input type="number" min="0" placeholder="e.g. 15000" value={budgetNPR}
                onChange={(e) => setBudgetNPR(e.target.value)}
                className="plan-input w-full pl-10 pr-3 py-3 text-sm rounded-xl"/>
            </div>
            {budgetNPR && tripType === "GROUP" && members.length > 0 && (
              <p className="font-body text-xs text-slate-500">
                ≈ NPR {Math.round(parseInt(budgetNPR) / (members.length + 1)).toLocaleString()} per person ({members.length + 1} travellers)
              </p>
            )}
          </div>

          {/* Info */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-800/60 border border-slate-700/50">
            <Sparkles size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
            <p className="font-body text-xs text-slate-400 leading-relaxed">
              Your health profile, fitness level, chronic conditions, and home location are loaded from your account. Partners&apos; profiles are fetched when you add them.
            </p>
          </div>

          <button type="submit" disabled={submitting || !destination || !travelDate || (tripType === "GROUP" && members.length === 0)}
            className="amber-btn w-full py-3.5 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            {submitting
              ? <><Loader2 size={15} className="animate-spin"/> Analysing {destination?.name}…</>
              : <><Sparkles size={15}/> Analyse Trip Safety <ArrowRight size={14}/></>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────────────────────

export default function PlanPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen" style={{ background: "#0a0f1e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}
        .font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        .shimmer-text{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b,#fbbf24);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite}
        .glow-dot{position:fixed;border-radius:9999px;filter:blur(100px);pointer-events:none;z-index:0}
        .nav-blur{background:rgba(10,15,30,.92);border-bottom:1px solid rgba(255,255,255,.06);backdrop-filter:blur(20px)}
        .plan-card{background:rgba(15,23,42,.8);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(16px)}
        .plan-input{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:white;font-family:'DM Sans',system-ui,sans-serif;transition:border-color .2s,box-shadow .2s}
        .plan-input:focus{border-color:rgba(245,158,11,.5);box-shadow:0 0 0 3px rgba(245,158,11,.08);outline:none}
        .plan-input::placeholder{color:rgba(255,255,255,.25)}
        .plan-input::-webkit-calendar-picker-indicator{filter:invert(1) opacity(0.5)}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s,transform .15s}
        .amber-btn:hover:not(:disabled){background:#fbbf24;box-shadow:0 0 28px rgba(245,158,11,.35);transform:translateY(-1px)}
      `}</style>
      <div className="glow-dot w-[400px] h-[300px] bg-amber-500/8 -top-20 -right-20"/>
      <div className="glow-dot w-[300px] h-[250px] bg-sky-500/5 bottom-0 -left-10"/>
      <nav className="nav-blur fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 md:px-8 h-16">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-body text-sm">
            <ArrowLeft size={15}/> Back
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <Mountain className="text-amber-400" size={20}/>
            <span className="font-display font-bold text-white">YatraAI</span>
          </Link>
        </div>
        <span className="font-body text-sm text-slate-400 hidden sm:block">Plan a Trip</span>
      </nav>
      <div className="pt-24 pb-8 relative z-10">
        <Suspense fallback={<div className="flex justify-center pt-20"><Loader2 size={32} className="text-amber-400 animate-spin"/></div>}>
          <PlanInner/>
        </Suspense>
      </div>
    </div>
  );
}
