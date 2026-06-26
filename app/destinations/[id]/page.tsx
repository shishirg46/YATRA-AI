"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mountain, ArrowLeft, Shield, AlertTriangle, Zap, XCircle,
  MapPin, Thermometer, Droplets, Wind, CloudRain, Gauge,
  Calendar, Route, Compass, RefreshCw, Loader2, ChevronDown, ChevronUp,
  TrendingUp, Activity, Navigation, ExternalLink, Camera,
} from "lucide-react";
import { Sparkline, BarChart, HazardBars, PenaltyBreakdown } from "./_components/charts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DestData {
  location: { id: string; name: string; district: string; province: string; altitude: number | null; latitude: number; longitude: number; image: string | null };
  safety: { score: number; level: string; confidence: number; penalties: Record<string, number>; reasoning: string[] };
  liveWeather: { temperature: number; humidity: number; rainfall: number; windSpeed: number; pressure: number; description?: string; source?: string; sourceLabel?: string; officialSource?: boolean };
  liveHazard: { floodIndex: number; landslideIndex: number; earthquakeIndex: number; airQuality: number };
  weatherHistory: { recordedAt: string; temperature: number; rainfall: number; windSpeed: number }[];
  hazardHistory: { recordedAt: string; floodIndex: number; landslideIndex: number }[];
  assessmentHistory: { createdAt: string; safetyScore: number; safetyLevel: string }[];
  seasonalGuide: { current: string; best: string; worst: string; seasons: { name: string; months: string; risk: string; description: string }[] };
  connectedRoutes: { id: string; name: string; distanceKm: number | null; from: { id: string; name: string }; to: { id: string; name: string } }[];
  nearbyDestinations: { id: string; name: string; district: string; altitude: number | null; safetyScore: number | null; safetyLevel: string | null }[];
  assessedAt: string;
}
interface DestinationInsights {
  overview: string;
  sources: { name: string; url: string; snippet: string }[];
  photos: { url: string; thumbUrl?: string; title?: string; sourceUrl: string }[];
  fetchedAt: string;
}
interface EnrichedPlaceDetails {
  name: string;
  description: string;
  image: string;
  images: string[];
  wikipediaUrl?: string;
  coordinates?: { lat: number; lng: number };
  source: "wikipedia" | "cloudinary-cache" | "osm";
}

const LEVEL_CFG: Record<string, { label: string; color: string; bg: string; border: string; Icon: typeof Shield }> = {
  SAFE:      { label: "Safe",      color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25", Icon: Shield },
  CAUTION:   { label: "Caution",   color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/25",   Icon: AlertTriangle },
  HIGH_RISK: { label: "High Risk", color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/25",  Icon: Zap },
  EXTREME:   { label: "Extreme",   color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/25",     Icon: XCircle },
};

const RISK_COLORS: Record<string, string> = { LOW: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20", MEDIUM: "text-amber-400 bg-amber-400/10 border-amber-400/20", HIGH: "text-red-400 bg-red-400/10 border-red-400/20" };

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 100 }: { score: number; size?: number }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#f59e0b" : score >= 40 ? "#fb923c" : "#f87171";
  const r = size * 0.4; const circ = 2 * Math.PI * r; const half = size / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={half} cy={half} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
        <circle cx={half} cy={half} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${(score / 100) * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-white" style={{ fontSize: size * 0.26 }}>{score}</span>
        <span className="font-body text-slate-500" style={{ fontSize: size * 0.12 }}>/100</span>
      </div>
    </div>
  );
}

// ── Collapsible Section ──────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: typeof Shield; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="detail-card rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-amber-400" />
          <span className="font-display font-bold text-white text-sm">{title}</span>
        </div>
        {open ? <ChevronUp size={15} className="text-slate-500" /> : <ChevronDown size={15} className="text-slate-500" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-800">{children}</div>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DestinationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<DestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<DestinationInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [enriched, setEnriched] = useState<EnrichedPlaceDetails | null>(null);

  useEffect(() => { params.then(p => setId(p.id)); }, [params]);

  useEffect(() => {
    if (!id) return;
    setLoading(true); setError(null);
    fetch(`/api/destinations/${id}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) { router.push("/sign-in"); return; }
          const fallbackRes = await fetch(`/api/place-details?name=${encodeURIComponent(id)}`, { credentials: "include" });
          if (fallbackRes.ok) {
            const enrichedPayload = (await fallbackRes.json()) as EnrichedPlaceDetails;
            setEnriched(enrichedPayload);
            setData(null);
            return;
          }
          const j = await res.json().catch(() => ({}));
          setError((j as { message?: string }).message ?? "Failed to load.");
          return;
        }
        setData(await res.json());
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadingInsights(true);
    fetch(`/api/destinations/${id}/insights`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return;
        const payload = (await res.json()) as DestinationInsights;
        if (!cancelled) setInsights(payload);
      })
      .catch(() => {
        if (!cancelled) setInsights(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingInsights(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1e" }}>
      <div className="text-center">
        <Mountain className="text-amber-400 mx-auto mb-4 animate-pulse" size={40} />
        <p className="font-body text-slate-400 text-sm">Loading destination…</p>
      </div>
    </div>
  );

  if (enriched && !data) return (
    <div className="min-h-screen" style={{ background: "#0a0f1e" }}>
      <div className="pt-12 max-w-4xl mx-auto px-4 md:px-8 pb-16 space-y-5">
        <button onClick={() => router.back()} className="flex items-center gap-1 font-body text-sm text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="detail-card rounded-2xl p-6 md:p-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">{enriched.name}</h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enriched.image} alt={enriched.name} className="w-full h-64 md:h-80 object-cover rounded-xl border border-slate-700/40 mb-4" />
          <p className="font-body text-sm text-slate-300 leading-relaxed mb-4">{enriched.description}</p>
          <div className="flex flex-wrap gap-3 text-xs font-body text-slate-400">
            <span className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700">Source: {enriched.source}</span>
            {enriched.coordinates && (
              <span className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700">
                {enriched.coordinates.lat.toFixed(4)}, {enriched.coordinates.lng.toFixed(4)}
              </span>
            )}
            {enriched.wikipediaUrl && (
              <a href={enriched.wikipediaUrl} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700 hover:border-amber-400/30 hover:text-amber-300">
                Wikipedia
              </a>
            )}
          </div>
        </div>
        {enriched.images.length > 0 && (
          <div className="detail-card rounded-2xl p-6">
            <h2 className="font-display text-xl font-bold text-white mb-4">Gallery</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {enriched.images.map((img, idx) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${img}-${idx}`} src={img} alt={`${enriched.name} ${idx + 1}`} className="w-full h-32 object-cover rounded-lg border border-slate-700/40" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1e" }}>
      <div className="text-center max-w-sm px-4">
        <XCircle className="text-red-400 mx-auto mb-4" size={40} />
        <p className="font-body text-slate-300 mb-4 text-sm">{error}</p>
        <button onClick={() => router.back()} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm">
          <ArrowLeft size={14} className="inline mr-1" /> Go Back
        </button>
      </div>
    </div>
  );

  const { location: loc, safety, liveWeather, liveHazard, weatherHistory, hazardHistory, assessmentHistory, seasonalGuide, connectedRoutes, nearbyDestinations } = data;
  const cfg = LEVEL_CFG[safety.level] ?? LEVEL_CFG.SAFE;
  const LevelIcon = cfg.Icon;

  return (
    <div className="min-h-screen" style={{ background: "#0a0f1e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}
        .font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        .anim{animation:fadeUp .5s ease both}
        .shimmer-text{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b,#fbbf24);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite}
        .nav-blur{background:rgba(10,15,30,.92);border-bottom:1px solid rgba(255,255,255,.06);backdrop-filter:blur(20px)}
        .detail-card{background:rgba(15,23,42,.7);border:1px solid rgba(255,255,255,.07);backdrop-filter:blur(12px)}
        .glow-dot{position:fixed;border-radius:9999px;filter:blur(100px);pointer-events:none;z-index:0}
      `}</style>

      <div className="glow-dot w-[500px] h-[400px] bg-amber-500/8 -top-32 -left-32" />
      <div className="glow-dot w-[400px] h-[300px] bg-sky-500/6 bottom-0 right-0" />

      {/* Nav */}
      <nav className="nav-blur fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 md:px-8 h-16">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Mountain className="text-amber-400" size={20} />
            <span className="font-display font-bold text-white">YatraAI</span>
          </Link>
          <span className="text-slate-700">·</span>
          <button onClick={() => router.back()} className="flex items-center gap-1 font-body text-sm text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Back
          </button>
        </div>
        <Link href={`/plan?destination=${loc.id}&name=${encodeURIComponent(loc.name)}`}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm transition-all hover:shadow-lg hover:shadow-amber-500/20">
          <Compass size={14} /> Plan a Trip
        </Link>
      </nav>

      <div className="pt-20 max-w-4xl mx-auto px-4 md:px-8 pb-16 relative z-10 space-y-5">

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div className="detail-card rounded-2xl overflow-hidden anim">
          {loc.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={loc.image} alt={loc.name} className="w-full h-56 md:h-72 object-cover border-b border-slate-700/40" loading="lazy" />
          )}
          <div className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <ScoreRing score={safety.score} size={110} />
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-3xl md:text-4xl font-bold text-white mb-2">
                  <span className="shimmer-text">{loc.name}</span>
                </h1>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border font-body text-sm font-semibold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                    <LevelIcon size={13} />{cfg.label}
                  </span>
                  <span className="font-body text-xs text-slate-500">{Math.round(safety.confidence * 100)}% confidence</span>
                </div>
                <div className="flex items-center gap-4 flex-wrap text-slate-400 font-body text-sm">
                  <span className="flex items-center gap-1"><MapPin size={13} className="text-amber-400" />{loc.district}, {loc.province}</span>
                  {loc.altitude && <span className="flex items-center gap-1"><Mountain size={13} className="text-slate-500" />{loc.altitude.toLocaleString()}m</span>}
                  <span className="flex items-center gap-1"><Calendar size={13} className="text-slate-500" />{seasonalGuide.current}</span>
                </div>
                <p className="font-body text-xs text-slate-600 mt-2">
                  Assessed {new Date(data.assessedAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Photo Gallery ────────────────────────────────────────────── */}
        {insights?.photos && insights.photos.length > 0 && (
          <div className="detail-card rounded-2xl p-5 anim" style={{ animationDelay: ".05s" }}>
            <div className="flex items-center gap-2 mb-4">
              <Camera size={15} className="text-amber-400" />
              <span className="font-display font-bold text-white text-sm">Photos</span>
              <span className="font-body text-[10px] text-slate-500 ml-auto">{insights.photos.length} images</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {insights.photos.map((p, idx) => (
                <a
                  key={`${p.url}-${idx}`}
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative rounded-xl overflow-hidden border border-slate-700/40 bg-slate-900/50 aspect-[4/3]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbUrl || p.url}
                    alt={p.title || loc.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading={idx < 3 ? "eager" : "lazy"}
                  />
                  {p.title && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 to-transparent p-2">
                      <p className="font-body text-[10px] text-slate-200 truncate">{p.title}</p>
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── Live Conditions ──────────────────────────────────────────── */}
        <div className="grid md:grid-cols-2 gap-4 anim" style={{ animationDelay: ".1s" }}>
          {/* Weather */}
          <div className="detail-card rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <CloudRain size={15} className="text-sky-400" />
              <span className="font-display font-bold text-white text-sm">Live Weather</span>
              {liveWeather.sourceLabel && <span className="font-body text-[10px] text-sky-400/70 ml-auto">{liveWeather.sourceLabel}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Thermometer, label: "Temperature", value: `${(liveWeather.temperature as number).toFixed(1)}°C`, color: "text-orange-400" },
                { icon: Droplets, label: "Humidity", value: `${(liveWeather.humidity as number).toFixed(0)}%`, color: "text-blue-400" },
                { icon: CloudRain, label: "Rainfall", value: `${(liveWeather.rainfall as number).toFixed(1)}mm`, color: "text-sky-400" },
                { icon: Wind, label: "Wind", value: `${(liveWeather.windSpeed as number).toFixed(1)}m/s`, color: "text-slate-300" },
              ].map(w => (
                <div key={w.label} className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/40">
                  <div className="flex items-center gap-1.5 mb-1">
                    <w.icon size={12} className={w.color} />
                    <span className="font-body text-[10px] text-slate-500 uppercase tracking-widest">{w.label}</span>
                  </div>
                  <span className={`font-display font-bold text-lg ${w.color}`}>{w.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hazard */}
          <div className="detail-card rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={15} className="text-orange-400" />
              <span className="font-display font-bold text-white text-sm">Hazard Indices</span>
            </div>
            <HazardBars data={[
              { label: "Flood Risk", value: liveHazard.floodIndex, color: "#3b82f6" },
              { label: "Landslide Risk", value: liveHazard.landslideIndex, color: "#f97316" },
              { label: "Earthquake", value: liveHazard.earthquakeIndex, color: "#ef4444" },
              { label: "Air Quality", value: liveHazard.airQuality, color: "#64748b" },
            ]} />
          </div>
        </div>

        {/* ── Safety Breakdown ─────────────────────────────────────────── */}
        <Section title="Safety Score Breakdown" icon={Shield} defaultOpen>
          <div className="pt-4 space-y-4">
            <PenaltyBreakdown penalties={safety.penalties} />
            {safety.reasoning.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="font-body text-[10px] text-slate-600 uppercase tracking-widest">Reasoning</p>
                {safety.reasoning.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/30">
                    <span className="text-amber-400 text-xs mt-0.5">•</span>
                    <span className="font-body text-xs text-slate-400 leading-relaxed">{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* ── Weather History ──────────────────────────────────────────── */}
        {weatherHistory.length > 2 && (
          <Section title="Weather History" icon={Thermometer} defaultOpen={false}>
            <div className="pt-4 grid md:grid-cols-2 gap-4">
              <div>
                <p className="font-body text-xs text-slate-500 mb-2">Temperature Trend</p>
                <Sparkline data={weatherHistory.map(w => ({ value: w.temperature }))} color="#fb923c" width={340} height={60} />
                <div className="flex justify-between mt-1">
                  <span className="font-body text-[10px] text-slate-600">{new Date(weatherHistory[0]?.recordedAt).toLocaleDateString()}</span>
                  <span className="font-body text-[10px] text-slate-600">{new Date(weatherHistory[weatherHistory.length - 1]?.recordedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div>
                <p className="font-body text-xs text-slate-500 mb-2">Rainfall</p>
                <BarChart data={weatherHistory.map(w => ({ value: w.rainfall }))} color="#38bdf8" width={340} height={60} />
              </div>
            </div>
          </Section>
        )}

        {/* ── Safety Score Trend ───────────────────────────────────────── */}
        {assessmentHistory.length > 2 && (
          <Section title="Safety Score Trend" icon={TrendingUp} defaultOpen={false}>
            <div className="pt-4">
              <Sparkline data={assessmentHistory.map(a => ({ value: a.safetyScore }))} color="#34d399" width={500} height={70} />
              <div className="flex justify-between mt-1">
                <span className="font-body text-[10px] text-slate-600">{new Date(assessmentHistory[0]?.createdAt).toLocaleDateString()}</span>
                <span className="font-body text-[10px] text-slate-600">{new Date(assessmentHistory[assessmentHistory.length - 1]?.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="font-body text-xs text-slate-500 mt-2">
                {assessmentHistory.length} assessments · Latest: {assessmentHistory[assessmentHistory.length - 1]?.safetyScore}/100
              </p>
            </div>
          </Section>
        )}

        {/* ── Seasonal Guide ──────────────────────────────────────────── */}
        <Section title="Seasonal Travel Guide" icon={Calendar}>
          <div className="pt-4 grid sm:grid-cols-2 gap-3">
            {seasonalGuide.seasons.map((s) => {
              const isCurrent = s.name === seasonalGuide.current;
              const isBest = s.name === seasonalGuide.best;
              const riskCfg = RISK_COLORS[s.risk] ?? RISK_COLORS.MEDIUM;
              return (
                <div key={s.name} className={`p-4 rounded-xl border transition-all ${isCurrent ? "bg-amber-500/5 border-amber-500/25" : "bg-slate-800/40 border-slate-700/30"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-white text-sm">{s.name.split(" (")[0]}</span>
                      {isCurrent && <span className="px-1.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/25 text-amber-400 font-body text-[9px] font-bold uppercase">Now</span>}
                      {isBest && <span className="px-1.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-400/25 text-emerald-400 font-body text-[9px] font-bold uppercase">Best</span>}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full border font-body text-[10px] font-semibold ${riskCfg}`}>{s.risk}</span>
                  </div>
                  <p className="font-body text-[10px] text-slate-500 mb-1">{s.months}</p>
                  <p className="font-body text-xs text-slate-400 leading-relaxed">{s.description}</p>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Connected Routes ────────────────────────────────────────── */}
        {connectedRoutes.length > 0 && (
          <Section title={`Connected Routes (${connectedRoutes.length})`} icon={Route} defaultOpen={false}>
            <div className="pt-4 space-y-2">
              {connectedRoutes.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <Navigation size={13} className="text-amber-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-body text-sm text-white truncate">{r.name}</p>
                      <p className="font-body text-[10px] text-slate-500">{r.from.name} → {r.to.name}</p>
                    </div>
                  </div>
                  {r.distanceKm && <span className="font-body text-xs text-slate-500 shrink-0">{r.distanceKm.toFixed(0)} km</span>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Nearby Destinations ─────────────────────────────────────── */}
        {nearbyDestinations.length > 0 && (
          <Section title={`Nearby in ${loc.district}`} icon={MapPin} defaultOpen={false}>
            <div className="pt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {nearbyDestinations.map((nd) => {
                const ndCfg = LEVEL_CFG[nd.safetyLevel ?? "SAFE"] ?? LEVEL_CFG.SAFE;
                return (
                  <Link key={nd.id} href={`/destinations/${nd.id}`}
                    className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:border-amber-400/20 transition-all group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-body text-sm text-white group-hover:text-amber-400 transition-colors truncate">{nd.name}</span>
                      {nd.safetyScore != null && <span className={`font-display font-bold text-sm ${ndCfg.color}`}>{nd.safetyScore}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {nd.altitude && <span className="font-body text-[10px] text-slate-500">{nd.altitude.toLocaleString()}m</span>}
                      {nd.safetyLevel && <span className={`px-1.5 py-0.5 rounded-full border font-body text-[9px] font-semibold ${ndCfg.color} ${ndCfg.bg} ${ndCfg.border}`}>{ndCfg.label}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Section>
        )}

        <Section title="Place Details" icon={Camera} defaultOpen={false}>
          <div className="pt-4 space-y-4">
            {loadingInsights && <p className="font-body text-sm text-slate-400">Loading details from multiple sources…</p>}
            {!loadingInsights && insights?.overview && (
              <p className="font-body text-sm text-slate-300 leading-relaxed">{insights.overview}</p>
            )}
            {!loadingInsights && insights?.sources?.length ? (
              <div className="grid gap-2">
                {insights.sources.map((s, idx) => (
                  <a
                    key={`${s.name}-${idx}`}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:border-amber-400/25 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-body text-xs text-amber-300 uppercase tracking-wider">{s.name}</span>
                      <ExternalLink size={12} className="text-slate-500" />
                    </div>
                    <p className="font-body text-xs text-slate-300 leading-relaxed">{s.snippet}</p>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </Section>

        {/* ── Footer CTA ──────────────────────────────────────────────── */}
        <div className="detail-card rounded-2xl p-8 text-center anim" style={{ animationDelay: ".3s" }}>
          <h2 className="font-display text-2xl font-bold text-white mb-2">
            Plan your trip to <span className="shimmer-text">{loc.name}</span>
          </h2>
          <p className="font-body text-sm text-slate-400 mb-5">
            Get a full AI safety analysis with weather forecasts, route risk, and personalised health advisories.
          </p>
          <Link href={`/plan?destination=${loc.id}&name=${encodeURIComponent(loc.name)}`}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-base transition-all hover:shadow-[0_0_40px_rgba(245,158,11,.3)] group">
            <Compass size={16} /> Plan a Trip
            <ArrowLeft size={14} className="rotate-180 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  );
}
