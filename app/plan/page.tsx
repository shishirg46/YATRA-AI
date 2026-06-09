/**
 * FILE: page.tsx
 * LOCATION: /app/plan/page.tsx
 */
"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter }             from "next/navigation";
import Link                                       from "next/link";
import { AppShell } from "@/components/app-shell";
import RouteMapLoader from "@/components/route-map-loader";
import SegmentDataTable from "./_components/SegmentDataTable";
import ScoreRing from "./_components/ScoreRing";
import Section from "./_components/Section";
import QuickRouteCheck from "./_components/QuickRouteCheck";
import DestSearch from "./_components/DestSearch";
import MemberSearch from "./_components/MemberSearch";
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
  humidity: number;
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
  destination:    { id: string; name: string; district: string; province: string; latitude: number; longitude: number; altitude: number | null };
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
  segmentDetails?: Array<{
    index: number;
    from: string; to: string;
    fromLat: number; fromLon: number; toLat: number; toLon: number;
    distanceKm: number;
    riskLevel: string; riskScore: number;
    gradient: number | null;
    roadSurface: { highway: string; surface: string | null; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME" } | null;
    riverProximityKm: number | null;
    elevationStart: number | null; elevationEnd: number | null;
    hazards: string[];
    floodIndex: number; landslideIndex: number; earthquakeIndex: number;
    temperature: number; rainfall: number; windSpeed: number;
  }>;
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


// ── Route preview map (collapsible) ──────────────────────────────────────────

function RoutePreviewMap({ startLat, startLon, endLat, endLon, originName, destinationName, riskLevel }: {
  startLat: number; startLon: number; endLat: number; endLon: number;
  originName: string; destinationName: string; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
}) {
  const [showMap, setShowMap] = useState(false);
  return (
    <div className="plan-card rounded-2xl overflow-hidden">
      <button onClick={() => setShowMap(!showMap)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <MapPin size={15} className="text-amber-400" />
          <span className="font-display font-bold text-white text-sm">Map View</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-body text-[10px] text-slate-500">{showMap ? "Hide" : "Show"}</span>
          {showMap ? <ChevronUp size={15} className="text-slate-500"/> : <ChevronDown size={15} className="text-slate-500"/>}
        </div>
      </button>
      {showMap && (
        <div className="border-t border-slate-800 p-5">
          <RouteMapLoader
            startLat={startLat} startLon={startLon}
            endLat={endLat} endLon={endLon}
            originName={originName} destinationName={destinationName}
            riskLevel={riskLevel}
          />
        </div>
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
  const [activeTab, setActiveTab] = useState("overview");
  const [showAllRiskFactors, setShowAllRiskFactors] = useState(false);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [showAllHealthAdvisories, setShowAllHealthAdvisories] = useState(false);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [displayOriginLat, setDisplayOriginLat] = useState<number | null>(null);
  const [displayOriginLon, setDisplayOriginLon] = useState<number | null>(null);
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

    setSubmitting(true); setError(null); setReport(null); setLocationWarning(null);
    try {
      let requestOriginLat = originLat;
      let requestOriginLon = originLon;

      // Fallback for direct /plan URLs without origin params:
      // use browser geolocation at submit-time if permission exists.
      if ((requestOriginLat == null || requestOriginLon == null) && typeof navigator !== "undefined" && navigator.geolocation) {
        const geo = await new Promise<{ lat: number; lon: number; accuracy: number } | null>((resolve) => {
          let done = false;
          const timer = setTimeout(() => {
            if (done) return;
            done = true;
            setLocationWarning("Location request timed out. Proceeding without precise origin location.");
            resolve(null);
          }, 4500);

          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              
              const accuracy = pos.coords.accuracy;
              console.log(`Geolocation received. Accuracy: ${accuracy.toFixed(1)}m`);
              
              // If accuracy is extremely poor (>10km), warn and reject
              if (!Number.isFinite(accuracy) || accuracy > 10000) {
                setLocationWarning(
                  `Location accuracy is very low (${accuracy > 10000 ? (accuracy / 1000).toFixed(0) + "km" : Math.round(accuracy) + "m"}). ` +
                  `Move to an open area or enable high-accuracy location, then try again.`
                );
                resolve(null);
                return;
              }
              
              // If accuracy is suboptimal but usable (150m - 10km), warn but accept
              if (accuracy > 150) {
                setLocationWarning(
                  `Location accuracy is moderate (${accuracy.toFixed(0)}m). Results may be less precise. ` +
                  `For better accuracy, move to an open area with clear sky view.`
                );
              }
              
              resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy });
            },
            (error) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              
              let warningMsg = "Could not access device location. ";
              if (error.code === 1) {
                warningMsg += "Location permission denied. Grant location access in your browser settings.";
              } else if (error.code === 2) {
                warningMsg += "Location unavailable. Move outdoors and ensure location services are enabled.";
              } else if (error.code === 3) {
                warningMsg += "Location request timed out.";
              }
              
              setLocationWarning(warningMsg);
              resolve(null);
            },
            {
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 0,
            }
          );
        });
        if (geo) {
          requestOriginLat = geo.lat;
          requestOriginLon = geo.lon;
          setOriginLat(geo.lat);
          setOriginLon(geo.lon);
          setDisplayOriginLat(geo.lat);
          setDisplayOriginLon(geo.lon);
          console.log(`Using geolocation: lat=${geo.lat}, lon=${geo.lon}, accuracy=${geo.accuracy.toFixed(1)}m`);
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
      setDisplayOriginLat(requestOriginLat);
      setDisplayOriginLon(requestOriginLon);
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
      <div className="w-full pb-16">
        <div className="max-w-7xl mx-auto">

        {/* ── Header ─────────────────────────────────────────────────────── */}
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

        {/* ── HERO ──────────────────────────────────────────────────────────── */}
        <div className={`plan-card rounded-2xl overflow-hidden ${isUnsafe ? "border-red-500/20" : ""}`}
          style={isUnsafe ? { borderColor: "rgba(239,68,68,0.2)" } : {}}>
          <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-white truncate">{report.destination.name}</h1>
              <p className="font-body text-xs text-slate-500 mt-0.5">
                <MapPin size={11} className="inline mr-1 -mt-0.5" />
                {report.destination.district}, {report.destination.province}
                {report.destination.altitude ? <><span className="mx-1.5 text-slate-600">·</span>{report.destination.altitude.toLocaleString()}m</> : ""}
              </p>
            </div>
            <ScoreRing score={report.overallScore} size={68}/>
          </div>
          <div className="px-5 pb-2 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border font-body text-xs font-bold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
              <LevelIcon size={12}/>{cfg.label}
            </span>
            <span className="font-body text-[11px] text-slate-500">
              <Calendar size={10} className="inline mr-1 -mt-0.5" />
              {new Date(report.travelDate).toLocaleDateString("en-NP", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <span className="font-body text-[11px] text-slate-500">{report.season}</span>
            <span className="font-body text-[11px] text-slate-600">{Math.round(report.confidence * 100)}% confidence</span>
            {isGroup && <span className="font-body text-[11px] text-slate-500">Group avg: {report.groupAvgScore}/100</span>}
          </div>
          {report.ai.verdict && (
            <div className="mx-5 mb-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <div className="flex items-start gap-2">
                <Sparkles size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="font-body text-sm text-slate-200 leading-relaxed">{report.ai.verdict}</p>
              </div>
            </div>
          )}
          <div className="px-5 pb-5 grid grid-cols-2 gap-2">
            {report.liveWeather && (
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <CloudRain size={11} className="text-sky-400" />
                  <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Weather</span>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    const wc = report.liveWeather!.description.toLowerCase();
                    const emoji = wc.includes("rain") || wc.includes("drizzle") ? "🌧" :
                      wc.includes("cloud") || wc.includes("overcast") ? "☁️" :
                      wc.includes("fog") || wc.includes("mist") ? "🌫" :
                      wc.includes("clear") || wc.includes("sunny") ? "☀️" :
                      wc.includes("snow") ? "❄️" : "🌤";
                    return <span className="text-lg">{emoji}</span>;
                  })()}
                  <div>
                    <p className="font-body text-sm font-semibold text-white">{report.liveWeather.temperature}°C</p>
                    <p className="font-body text-[10px] text-slate-500 capitalize">{report.liveWeather.description}</p>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-3 text-[10px] text-slate-500">
                  <span>💧 {report.liveWeather.humidity}%</span>
                  <span>💨 {report.liveWeather.windSpeed}m/s</span>
                </div>
              </div>
            )}
            {report.liveHazard && (
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle size={11} className="text-orange-400" />
                  <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Hazard</span>
                </div>
                <div className="space-y-1">
                  {[["🌊 Flood", report.liveHazard.floodIndex], ["🏔 Landslide", report.liveHazard.landslideIndex], ["🌋 EQ", report.liveHazard.earthquakeIndex], ["💨 AQI", report.liveHazard.airQuality]].map(([label, val]) => {
                    const numVal = val as number;
                    const pct = Math.min(numVal * 100, 100);
                    const barColor = pct > 60 ? "bg-red-500" : pct > 30 ? "bg-amber-500" : "bg-emerald-500";
                    return (
                      <div key={label as string} className="flex items-center gap-2">
                        <span className="font-body text-[10px] text-slate-400 w-16 shrink-0">{label as string}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {report.routeRisk && (
              <div className={`rounded-xl p-3 border ${report.routeRisk.risk === "HIGH" || report.routeRisk.risk === "MEDIUM" ? "bg-orange-500/8 border-orange-500/20" : "bg-emerald-500/8 border-emerald-500/20"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Navigation size={11} className={report.routeRisk.risk === "HIGH" ? "text-orange-400" : "text-emerald-400"} />
                    <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Route Risk</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    report.routeRisk.risk === "HIGH" ? "text-orange-300 border-orange-500/20 bg-orange-500/10" :
                    report.routeRisk.risk === "MEDIUM" ? "text-amber-300 border-amber-500/20 bg-amber-500/10" :
                    "text-emerald-300 border-emerald-500/20 bg-emerald-500/10"
                  }`}>{report.routeRisk.risk}</span>
                </div>
                <p className="font-body text-[11px] text-slate-400 leading-relaxed line-clamp-2">{report.routeRisk.reason}</p>
              </div>
            )}
            <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Users size={11} className="text-indigo-400" />
                <span className="font-body text-[10px] text-slate-500 uppercase tracking-wider">Trip</span>
              </div>
              <p className="font-body text-sm font-semibold text-white">{isGroup ? "Group Trip" : "Solo Trip"}</p>
              {isGroup && report.mostVulnerableMember && (
                <p className="font-body text-[10px] text-orange-400 mt-0.5">Most vulnerable: {report.mostVulnerableMember.name}</p>
              )}
              {report.budget.specified > 0 && (
                <p className="font-body text-[10px] text-slate-500 mt-0.5">Budget: NPR {report.budget.specified.toLocaleString()}</p>
              )}
            </div>
          </div>
          <div className="mx-5 mb-4 px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30 flex items-start gap-2">
            <Calendar size={12} className="text-slate-500 flex-shrink-0 mt-0.5" />
            <p className="font-body text-[11px] text-slate-400 leading-relaxed">{report.seasonalContext}</p>
          </div>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mt-6 mb-4 border-b border-slate-800 overflow-x-auto">
          {[
            { id: "overview", label: "Overview", icon: Shield },
            { id: "risks", label: "Risks", icon: AlertTriangle },
            { id: "health", label: "Health", icon: Heart },
            ...(isGroup ? [{ id: "group", label: "Group", icon: Users }] : []),
            { id: "budget", label: "Budget", icon: Wallet },
            { id: "advice", label: "Advice", icon: CheckCircle2 },
          ].map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-body font-semibold border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? "border-amber-400 text-amber-300"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}>
                <TabIcon size={13}/>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Tab: Overview ────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {isUnsafe && report.ai.whyUnsafe && (
              <div className="plan-card rounded-2xl p-5" style={{ borderColor: "rgba(239,68,68,0.35)", background: "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                    <AlertCircle size={13} className="text-red-400" />
                  </div>
                  <h3 className="font-display font-bold text-sm text-red-300">Not recommended — here&apos;s why</h3>
                </div>
                <p className="font-body text-sm text-slate-300 leading-relaxed ml-8">{report.ai.whyUnsafe}</p>
              </div>
            )}
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
            {report.segmentDetails && report.segmentDetails.length > 0 && (
              <SegmentDataTable segments={report.segmentDetails} />
            )}
            {displayOriginLat && displayOriginLon && (
              <RoutePreviewMap
                startLat={displayOriginLat} startLon={displayOriginLon}
                endLat={report.destination.latitude} endLon={report.destination.longitude}
                originName="Your Location" destinationName={report.destination.name}
                riskLevel={report.overallLevel === "SAFE" ? "LOW" : report.overallLevel === "CAUTION" ? "MEDIUM" : report.overallLevel === "HIGH_RISK" ? "HIGH" : "EXTREME"}
              />
            )}
          </div>
        )}

        {/* ── Tab: Risks ──────────────────────────────────────────────── */}
        {activeTab === "risks" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {report.riskFactors.length > 0 && (
              <Section title={`Risk Factors (${report.riskFactors.length})`} icon={AlertTriangle} defaultOpen={isUnsafe}>
                <div className="pt-3 space-y-2">
                  {riskFactorsVisible.map((f, i) => {
                    const severityPct = f.severity === "CRITICAL" ? 100 : f.severity === "HIGH" ? 75 : f.severity === "MEDIUM" ? 50 : 25;
                    const barColor = f.severity === "CRITICAL" || f.severity === "HIGH" ? "bg-red-500" : f.severity === "MEDIUM" ? "bg-amber-500" : "bg-emerald-500";
                    return (
                      <div key={i} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-body font-semibold text-sm text-white truncate">{f.name}</span>
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-body font-bold uppercase shrink-0 ${SEVERITY_COLOR[f.severity] ?? SEVERITY_COLOR["LOW"]}`}>{f.severity}</span>
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
                {report.riskFactors.length > 3 && (
                  <button type="button" onClick={() => setShowAllRiskFactors((v) => !v)}
                    className="w-full py-2 rounded-xl border border-slate-700/50 bg-slate-800/30 text-slate-300 text-xs font-body hover:bg-slate-700/30 transition-colors">
                    {showAllRiskFactors ? "Show fewer" : `Show ${report.riskFactors.length - 3} more`}
                  </button>
                )}
              </Section>
            )}
            {report.weatherStats && (
              <Section title="Historical Weather" icon={CloudRain} defaultOpen={false}>
                <p className="font-body text-xs text-slate-500 pt-2">Based on {report.weatherStats.yearsAnalysed} years</p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    { icon: Thermometer, label: "Avg temp", value: `${report.weatherStats.avgTempMax}°/${report.weatherStats.avgTempMin}°C` },
                    { icon: CloudRain, label: "Avg rain", value: `${report.weatherStats.avgRainfall}mm` },
                    { icon: Wind, label: "Avg wind", value: `${report.weatherStats.avgWindSpeed}m/s` },
                    { icon: Snowflake, label: "Snow chance", value: `${Math.round(report.weatherStats.snowProbability * 100)}%` },
                  ].map((s) => (
                    <div key={s.label} className="bg-slate-800/50 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1"><s.icon size={12} className="text-amber-400"/><span className="font-body text-xs text-slate-500">{s.label}</span></div>
                      <p className="font-body text-sm font-semibold text-white">{s.value}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {Array.isArray(report.pillarScores) && report.pillarScores.length > 0 && (
              <Section title="Pillar Scoring" icon={Shield} defaultOpen>
                <div className="pt-3 space-y-2">
                  {report.pillarScores.map((p) => (
                    <div key={p.id} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="font-body text-sm text-white font-semibold">{p.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          p.level === "LOW" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                          : p.level === "MEDIUM" ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                          : "text-red-300 border-red-500/30 bg-red-500/10"
                        }`}>{p.score}/{p.maxPoints}</span>
                      </div>
                      <p className="font-body text-xs text-slate-400 leading-relaxed">{p.summary}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ── Tab: Health ─────────────────────────────────────────────── */}
        {activeTab === "health" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {report.ai.healthWarning && (
              <div className="plan-card rounded-2xl p-5" style={{ borderColor: "rgba(244,63,94,0.2)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <Heart size={14} className="text-rose-400"/>
                  <h3 className="font-display font-bold text-white text-sm">Health Advisory</h3>
                </div>
                <p className="font-body text-sm text-slate-300 leading-relaxed">{report.ai.healthWarning}</p>
              </div>
            )}
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
                  <button type="button" onClick={() => setShowAllHealthAdvisories((v) => !v)}
                    className="w-full py-2 rounded-xl border border-slate-700/50 bg-slate-800/30 text-slate-300 text-xs font-body hover:bg-slate-700/30">
                    {showAllHealthAdvisories ? "Show fewer" : `Show ${report.healthAdvisories.length - 2} more`}
                  </button>
                )}
              </Section>
            )}
          </div>
        )}

        {/* ── Tab: Group ─────────────────────────────────────────────── */}
        {activeTab === "group" && isGroup && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {report.conflict ? (
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
                    Conservative rule: group safety = worst member score ({report.overallScore}/100).
                  </p>
                </div>
              </Section>
            ) : report.memberAnalyses.length > 1 && (
              <Section title={`Group Analysis — ${report.memberAnalyses.length} members`} icon={Users}>
                <div className="space-y-2 pt-3">
                  {report.memberAnalyses.map((m) => {
                    const mc = LEVEL_CFG[m.level as keyof typeof LEVEL_CFG] ?? LEVEL_CFG["SAFE"];
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
          </div>
        )}

        {/* ── Tab: Budget ────────────────────────────────────────────── */}
        {activeTab === "budget" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {report.budget.specified > 0 && (
              <div className={`plan-card rounded-2xl p-5 ${report.budget.feasible ? "border-emerald-500/20" : "border-orange-500/20"}`}
                style={{ borderColor: report.budget.feasible ? "rgba(52,211,153,0.2)" : "rgba(251,146,60,0.2)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={14} className={report.budget.feasible ? "text-emerald-400" : "text-orange-400"}/>
                  <h3 className="font-display font-bold text-white text-sm">Budget</h3>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: "Your budget", value: `NPR ${report.budget.specified.toLocaleString()}` },
                    { label: "Est. cost", value: `NPR ${report.budget.estimatedTotal.toLocaleString()}` },
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
            {(report.overallLevel !== "SAFE" || report.conflict) && report.alternatives.length > 0 && (
              <div className="plan-card rounded-2xl p-5" style={{ borderColor: "rgba(52,211,153,0.2)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown size={15} className="text-emerald-400"/>
                  <h3 className="font-display font-bold text-white text-sm">Alternatives</h3>
                </div>
                <div className="space-y-2">
                  {report.alternatives.map((alt, i) => (
                    <div key={alt.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                      <div>
                        <p className="font-body text-sm text-white">{alt.name}</p>
                        <p className="font-body text-xs text-slate-500">
                          {alt.safetyScore}/100 · ~NPR {alt.estimatedNPR.toLocaleString()}
                        </p>
                      </div>
                      <button onClick={() => {
                        setDestination({ id: alt.id, name: alt.name, district: alt.district, province: alt.province, altitude: alt.altitude });
                        setSavedPlanId(null); setReport(null);
                        const params = new URLSearchParams(searchParams.toString());
                        params.delete("planId");
                        router.replace(`/plan?${params.toString()}`);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }} className="px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 text-xs font-body font-medium transition-all">
                        Plan this →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Advice ────────────────────────────────────────────── */}
        {activeTab === "advice" && (
          <div className="space-y-4">
            {report.recommendations.length > 0 && (
              <div className="plan-card rounded-2xl p-5">
                <h3 className="font-display font-bold text-white text-sm mb-3">Recommendations</h3>
                <div className="space-y-2">
                  {recommendationsVisible.map((r, i) => {
                    const Icon = REC_ICON[r.type] ?? Package;
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
                </div>
                {report.recommendations.length > 4 && (
                  <button type="button" onClick={() => setShowAllRecommendations((v) => !v)}
                    className="w-full mt-2 py-2 rounded-xl border border-slate-700/50 bg-slate-800/30 text-slate-300 text-xs font-body hover:bg-slate-700/30">
                    {showAllRecommendations ? "Show fewer" : `Show ${report.recommendations.length - 4} more`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

      </div>
      </div>
    );
  }

  // ── Form view ─────────────────────────────────────────────────────────────

  if (submitting) {
    return (
      <div className="w-full pb-16">
        <div className="max-w-7xl mx-auto">
        {/* Skeleton: hero card */}
        <div className="plan-card rounded-2xl p-6 animate-pulse">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="h-5 w-48 rounded bg-slate-700/60" />
              <div className="h-3 w-32 rounded bg-slate-700/40" />
              <div className="flex gap-2">
                <div className="h-6 w-28 rounded-full bg-slate-700/50" />
                <div className="h-6 w-20 rounded-full bg-slate-700/30" />
              </div>
            </div>
            <div className="w-16 h-16 rounded-full bg-slate-700/50" />
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-12 w-full rounded-xl bg-slate-700/30" />
            <div className="h-12 w-full rounded-xl bg-slate-700/20" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="h-24 rounded-xl bg-slate-700/30" />
            <div className="h-24 rounded-xl bg-slate-700/30" />
            <div className="h-24 rounded-xl bg-slate-700/30" />
            <div className="h-24 rounded-xl bg-slate-700/30" />
          </div>
        </div>
        {/* Skeleton: AI verdict */}
        <div className="plan-card rounded-2xl p-5 animate-pulse">
          <div className="h-3 w-36 rounded bg-slate-700/40 mb-3" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-slate-700/30" />
            <div className="h-3 w-4/5 rounded bg-slate-700/30" />
            <div className="h-3 w-3/5 rounded bg-slate-700/30" />
          </div>
        </div>
        <div className="flex justify-center pt-2">
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 size={14} className="animate-spin" />
            <span className="font-body text-xs">Analysing trip safety for {destination?.name}…</span>
          </div>
        </div>
      </div>
      </div>
    );
  }

  return (
    <div className="w-full pb-16">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* ── Left sidebar — sticky form ── */}
          <div className="w-full lg:w-96 lg:sticky lg:top-24 flex-shrink-0">
            <div className="plan-card rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="font-display text-xl font-bold text-white">
                  Plan your <em className="shimmer-text not-italic">trip</em>
                </h2>
                <p className="font-body text-xs text-slate-400 mt-1">Health profile loaded automatically.</p>
              </div>

              {error && (
                <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-body text-xs">{error}</div>
              )}

              {locationWarning && (
                <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 font-body text-xs flex items-start gap-2">
                  <AlertCircle size={12} className="flex-shrink-0 mt-0.5"/>
                  <div>{locationWarning}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">

                {/* Destination */}
                <div className="grid gap-1.5">
                  <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                    Destination <span className="text-red-400">*</span>
                  </label>
                  <DestSearch value={destination} onChange={setDestination}/>
                  {destination && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <CheckCircle2 size={10} className="text-emerald-400"/>
                      <span className="font-body text-[11px] text-emerald-400 truncate">{destination.name}{destination.district ? `, ${destination.district}` : ""}</span>
                    </div>
                  )}
                </div>

                {/* Travel date */}
                <div className="grid gap-1.5">
                  <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                    Travel date <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                    <input type="date" min={today} value={travelDate} onChange={(e) => setTravelDate(e.target.value)}
                      required className="plan-input w-full pl-9 pr-3 py-2.5 text-sm rounded-xl" style={{ colorScheme: "dark" }}/>
                  </div>
                </div>

                {/* Trip type */}
                <div className="grid gap-1.5">
                  <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">Trip type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: "SOLO",  icon: User,  label: "Solo",  desc: "Individual" },
                      { id: "GROUP", icon: Users, label: "Group", desc: "Consensus" },
                    ] as const).map((t) => (
                      <button key={t.id} type="button" onClick={() => setTripType(t.id)}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${tripType === t.id ? "bg-amber-400/10 border-amber-400/35 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}>
                        <t.icon size={15}/>
                        <div>
                          <p className="font-body text-xs font-medium">{t.label}</p>
                          <p className="font-body text-[10px] opacity-60">{t.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Group members — required for GROUP */}
                {tripType === "GROUP" && (
                  <div className="grid gap-1.5">
                    <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                      Partners <span className="text-red-400">*</span>
                      <span className="text-slate-600 normal-case tracking-normal font-normal ml-1">— at least one</span>
                    </label>
                    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                      <MemberSearch members={members} onChange={setMembers}/>
                    </div>
                  </div>
                )}

                {/* Budget */}
                <div className="grid gap-1.5">
                  <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                    Budget (NPR) <span className="text-slate-600 normal-case tracking-normal font-normal">— optional</span>
                  </label>
                  <div className="relative">
                    <Wallet size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                    <input type="number" min="0" placeholder="e.g. 15000" value={budgetNPR}
                      onChange={(e) => setBudgetNPR(e.target.value)}
                      className="plan-input w-full pl-9 pr-3 py-2.5 text-sm rounded-xl"/>
                  </div>
                </div>

                <button type="submit" disabled={submitting || !destination || !travelDate || (tripType === "GROUP" && members.length === 0)}
                  className="amber-btn w-full py-3 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                  {submitting
                    ? <><Loader2 size={14} className="animate-spin"/> Analysing…</>
                    : <><Sparkles size={14}/> Analyse Trip Safety <ArrowRight size={13}/></>}
                </button>
              </form>
            </div>
          </div>

          {/* ── Right main content — preview & info ── */}
          <div className="flex-1 min-w-0 space-y-4">
            {destination && travelDate && (
              <div className="plan-card rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Navigation size={14} className="text-amber-400"/>
                  <h3 className="font-display font-bold text-white text-sm">Route Preview</h3>
                </div>
                <QuickRouteCheck destination={destination} travelDate={travelDate} originLat={originLat} originLon={originLon} />
              </div>
            )}

            {!destination && (
              <div className="plan-card rounded-2xl p-8 text-center">
                <Mountain size={40} className="text-slate-700 mx-auto mb-3"/>
                <h3 className="font-display font-bold text-white text-base mb-1">Plan Your Adventure</h3>
                <p className="font-body text-sm text-slate-500 max-w-md mx-auto">
                  Select a destination and fill in the details on the left to get a comprehensive safety analysis.
                </p>
              </div>
            )}

            <div className="plan-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-amber-400 flex-shrink-0"/>
                <p className="font-body text-sm text-slate-400 leading-relaxed">
                  Your health profile, fitness level, and chronic conditions are loaded from your account.
                  Partners&apos; profiles are fetched when you add them. The group score uses conservative
                  scoring — the group score equals the lowest individual score.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────────────────────

export default function PlanPage() {
  return (
    <AppShell active="plan" title="Plan a Trip" subpage contentClassName="pt-20 w-full px-4 md:px-6 lg:px-8 pb-20 relative z-10">
      <Suspense fallback={<div className="flex justify-center pt-20"><Loader2 size={32} className="text-amber-400 animate-spin"/></div>}>
        <PlanInner/>
      </Suspense>
    </AppShell>
  );
}
