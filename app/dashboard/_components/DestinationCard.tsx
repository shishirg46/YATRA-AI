"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  AlertTriangle, Compass, Droplet, Eye, MapPin, Navigation, Route,
  Thermometer, Wind, X, Mountain, TreePine, Landmark, Tent, Waves,
  Binoculars, Building2,
} from "lucide-react";
import { Destination } from "./types";
import { SafetyBadge, ScoreRing } from "./ui";
import { OverlayPortal } from "@/components/overlay-portal";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";

type RouteSummary = { count: number };
type RouteSegment = {
  from: { lat: number; lon: number; name?: string | null };
  to: { lat: number; lon: number; name?: string | null };
  riskLevel: string;
  riskScore?: number;
  hazards: string[];
  realtime?: {
    floodIndex: number;
    landslideIndex: number;
    earthquakeIndex: number;
    airQuality: number;
    rainfall: number;
    windSpeed: number;
    temperature: number;
  };
  historical?: {
    floodRisk: number;
    landslideRisk: number;
  };
  contributions?: {
    realtime: number;
    historical: number;
    regionalPrior: number;
  };
  evidence?: {
    realtime?: {
      hazardSource?: string;
      weatherSource?: string;
      weatherTimestamp?: string;
    };
    historical?: {
      source?: string;
      yearsAnalysed?: number;
      notableEvents?: { date: string; type: string; description: string; severity: "LOW" | "MEDIUM" | "HIGH" }[];
    };
    regionalPrior?: {
      reasons: string[];
    };
  };
};
type RouteDetail = {
  id?: string;
  name: string;
  distance: number;
  duration: number;
  riskScore: number;
  riskLevel: string;
  breakpoints?: { lat: number; lon: number }[];
  breakpointNames?: string[];
  segments: RouteSegment[];
};

type PipelineRisk = {
  riskPercent: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  breakdown: { weather: number; realtime: number; historical: number; terrain: number };
  alerts: string[];
  note?: string;
  evidence?: { weather?: { rain_mm_per_hr?: number; wind_kph?: number }; realtimeCount?: number; historicalCount?: number };
};

type LiveWeather = {
  temperature: number;
  humidity: number;
  rainfall: number;
  windSpeed: number;
  description?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  officialSource?: boolean;
  stationName?: string;
  stationDistanceKm?: number;
};

const summaryCache = new Map<string, RouteSummary>();
const detailCache = new Map<string, RouteDetail[]>();

const RouteMapLoader = dynamic(() => import("@/components/route-map-loader"), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full bg-slate-900 rounded-lg border border-slate-700 flex items-center justify-center">
      <span className="text-sm text-slate-400">Loading map…</span>
    </div>
  ),
});

function keyFor(userLat: number, userLon: number, destLat: number, destLon: number) {
  return `${userLat.toFixed(4)},${userLon.toFixed(4)}:${destLat.toFixed(4)},${destLon.toFixed(4)}`;
}

function compactBreakpointNames(route: RouteDetail): string[] {
  const names = Array.isArray(route.breakpointNames) ? route.breakpointNames.filter(Boolean) : [];
  if (names.length > 0) {
    if (names.length <= 6) return names;
    return [names[0], names[1], names[2], names[names.length - 2], names[names.length - 1]];
  }

  const segmentNames = (route.segments || [])
    .flatMap((s) => [s.from.name, s.to.name])
    .filter((v): v is string => !!v);

  // Deduplicate consecutive names
  const deduped = segmentNames.filter((name, index, arr) => index === 0 || name !== arr[index - 1]);

  if (deduped.length <= 6) return deduped;
  return [deduped[0], deduped[1], deduped[2], deduped[deduped.length - 2], deduped[deduped.length - 1]];
}

export function DestinationCard({
  dest,
  index,
  homeProvince,
  highlighted,
  userLat,
  userLon,
  displayUserLat,
  displayUserLon,
  originName,
  originRouteNodeId,
  gpsAccuracyMeters,
  originAlreadyResolved = false,
  onRequestLocation,
  requestingLocation,
  onOpenManualLocation,
  shouldFetchRoute = true,
}: {
  dest: Destination;
  index: number;
  homeProvince: string | null;
  highlighted: boolean;
  userLat?: number;
  userLon?: number;
  displayUserLat?: number;
  displayUserLon?: number;
  originName?: string;
  originRouteNodeId?: string;
  gpsAccuracyMeters?: number;
  originAlreadyResolved?: boolean;
  onRequestLocation?: () => void;
  requestingLocation?: boolean;
  onOpenManualLocation?: () => void;
  shouldFetchRoute?: boolean;
}) {
  const router = useRouter();
  const isNearby = homeProvince && dest.province === homeProvince;
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [openRoutes, setOpenRoutes] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [routeDetails, setRouteDetails] = useState<RouteDetail[]>([]);
  const [routeDetailsError, setRouteDetailsError] = useState<string | null>(null);
  const [pipelineRiskByRoute, setPipelineRiskByRoute] = useState<Record<number, PipelineRisk | null>>({});
  const [loadingPipelineRisk, setLoadingPipelineRisk] = useState(false);
  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [loadingLiveWeather, setLoadingLiveWeather] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadLiveWeather() {
      setLoadingLiveWeather(true);
      try {
        const res = await fetch(`/api/destinations/${dest.id}/live`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok || cancelled) {
          if (!cancelled) setLiveWeather(null);
          return;
        }
        const data = await res.json();
        if (!cancelled && data?.weather) {
          setLiveWeather(data.weather as LiveWeather);
        } else if (!cancelled) {
          setLiveWeather(null);
        }
      } catch {
        if (!cancelled) setLiveWeather(null);
      } finally {
        if (!cancelled) setLoadingLiveWeather(false);
      }
    }

    loadLiveWeather();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dest.id]);

  useEffect(() => {
    if (!shouldFetchRoute || !userLat || !userLon || !dest.latitude || !dest.longitude) {
      setRouteSummary(null);
      setLoadingSummary(false);
      return;
    }

    const cacheKey = keyFor(userLat, userLon, dest.latitude, dest.longitude);
    const cached = summaryCache.get(cacheKey);
    if (cached) {
      setRouteSummary(cached);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoadingSummary(true);

    const run = async () => {
      try {
        const res = await fetch("/api/routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startLat: userLat,
            startLon: userLon,
            endLat: dest.latitude,
            endLon: dest.longitude,
            destinationId: dest.id,
            destinationName: dest.name,
          }),
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const summary = { count: Array.isArray(data.routes) ? data.routes.length : 0 };
        summaryCache.set(cacheKey, summary);
        setRouteSummary(summary);
      } catch {
        if (!cancelled) setRouteSummary(null);
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    };

    const t = setTimeout(run, Math.min(index * 120, 600));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(t);
    };
  }, [shouldFetchRoute, userLat, userLon, dest.latitude, dest.longitude, index]);

  async function openRouteDetails() {
    if (!userLat || !userLon || !dest.latitude || !dest.longitude) return;
    const cacheKey = keyFor(userLat, userLon, dest.latitude, dest.longitude);
    const cached = detailCache.get(cacheKey);
    setOpenRoutes(true);
    setRouteDetailsError(null);
    if (cached) {
      setRouteDetails(cached);
      return;
    }

    setLoadingDetails(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch("/api/route-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { lat: userLat, lon: userLon, name: originName || "Your location" },
          destination: { lat: dest.latitude, lon: dest.longitude, name: dest.name, id: dest.id },
          destinationId: dest.id,
          departureDate: new Date().toISOString().split("T")[0],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRouteDetailsError(data.message || "Failed to load route details.");
        return;
      }
      const data = await res.json();
      const routes = Array.isArray(data.routes) ? data.routes : [];
      detailCache.set(cacheKey, routes);
      setRouteDetails(routes);
      if (routes.length === 0) {
        setRouteDetailsError("No route analysis data returned for this destination.");
      }

      if (routes.length > 0) {
        setLoadingPipelineRisk(true);
        const riskResults = await Promise.all(
          routes.map(async (route: RouteDetail, idx: number) => {
            const sampledPoints = Array.isArray(route.breakpoints) && route.breakpoints.length > 0
              ? route.breakpoints
              : route.segments.flatMap((s) => [{ lat: s.from.lat, lon: s.from.lon }, { lat: s.to.lat, lon: s.to.lon }]);
            if (!sampledPoints.length) return { idx, risk: null };

            const riskRes = await fetch("/api/disasters/risk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sampledPoints }),
            });
            if (!riskRes.ok) return { idx, risk: null };
            const risk = await riskRes.json() as PipelineRisk;
            return { idx, risk };
          })
        );
        const map: Record<number, PipelineRisk | null> = {};
        for (const r of riskResults) map[r.idx] = r.risk;
        setPipelineRiskByRoute(map);
        setLoadingPipelineRisk(false);
      }
    } catch {
      setRouteDetails([]);
      setRouteDetailsError("Route analysis request failed or timed out. Please try again.");
      setLoadingPipelineRisk(false);
    } finally {
      setLoadingDetails(false);
    }
  }

  function trackBehavior(action: string) {
    fetch("/api/user/behavior", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, destinationId: dest.id }),
    }).catch(() => {});
  }

  function handlePlanTrip() {
    trackBehavior("plan_trip");
    const params = new URLSearchParams({
      destination: dest.id,
      name: dest.name,
    });
    if (typeof userLat === "number" && typeof userLon === "number") {
      params.set("originLat", String(userLat));
      params.set("originLon", String(userLon));
    }
    router.push(`/plan?${params.toString()}`);
  }

  const activeWeather = liveWeather ?? dest.weather;

  const CATEGORY_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    TEMPLE:              { icon: <Landmark size={14} />,  color: "text-orange-400",  label: "Temple" },
    TOURIST_ATTRACTION:  { icon: <Building2 size={14} />, color: "text-rose-400",    label: "Attraction" },
    VIEWPOINT:           { icon: <Binoculars size={14} />,color: "text-violet-400",  label: "Viewpoint" },
    LAKE:                { icon: <Waves size={14} />,     color: "text-sky-400",     label: "Lake" },
    MOUNTAIN:            { icon: <Mountain size={14} />,  color: "text-slate-300",   label: "Mountain" },
    FOREST:              { icon: <TreePine size={14} />,  color: "text-emerald-400", label: "Forest" },
    CAMP:                { icon: <Tent size={14} />,      color: "text-amber-400",   label: "Camp" },
    HILL:                { icon: <Mountain size={14} />,  color: "text-stone-400",   label: "Hill" },
    TREKKING_VILLAGE:    { icon: <Tent size={14} />,      color: "text-lime-400",   label: "Trek Village" },
    RIVERSIDE:           { icon: <Waves size={14} />,     color: "text-cyan-400",   label: "Riverside" },
    WATERFALL:           { icon: <Droplet size={14} />,   color: "text-blue-400",   label: "Waterfall" },
  };
  const catMeta = CATEGORY_META[dest.category] ?? null;

  return (
    <>
      <div
        className={`destination-card p-5 flex flex-col gap-3 ${highlighted ? "border-amber-400/20" : ""}`}
        style={{ animation: `fadeUp .4s ease ${index * 0.03}s both` }}
      >
        {/* ── Header: name + badges + score ring ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {catMeta && (
                <span className={`shrink-0 ${catMeta.color}`}>{catMeta.icon}</span>
              )}
              <Link
                onClick={() => trackBehavior("view_details")}
                href={`/destinations/${encodeURIComponent(dest.name)}`}
                className="hover:text-amber-400 transition-colors"
              >
                <h3 className="font-display font-bold text-white text-base leading-tight truncate">
                  {dest.name}
                </h3>
              </Link>
              {isNearby && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-sky-400/10 border border-sky-400/20 text-sky-400 font-body text-[10px] font-semibold uppercase tracking-wider">Nearby</span>
              )}
              {dest.verified === true && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 font-body text-[10px] font-semibold uppercase tracking-wider">Verified</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin size={11} className="text-slate-500 flex-shrink-0" />
              <span className="font-body text-xs text-slate-500 truncate">
                {dest.district}, {dest.province}
                {dest.altitude != null && dest.altitude > 0 && (
                  <span className="text-slate-600 ml-1">· {dest.altitude.toLocaleString()}m</span>
                )}
              </span>
            </div>
          </div>
          <ScoreRing score={dest.safetyScore} />
        </div>

        {/* ── Risk alert ── */}
        {(dest.safetyLevel === "HIGH_RISK" || dest.safetyLevel === "EXTREME") && (
          <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-body ${
            dest.safetyLevel === "EXTREME"
              ? "bg-red-500/10 border border-red-500/20 text-red-400"
              : "bg-orange-500/10 border border-orange-500/20 text-orange-400"
          }`}>
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>
              {dest.safetyLevel === "EXTREME"
                ? "Do not travel — extreme hazard conditions"
                : "Travel not recommended — consider alternatives"}
            </span>
          </div>
        )}

        {/* ── Safety + Category row ── */}
        <div className="flex items-center justify-between">
          <SafetyBadge level={dest.safetyLevel} />
          {catMeta && (
            <span className={`inline-flex items-center gap-1 font-body text-xs ${catMeta.color}`}>
              {catMeta.icon}{catMeta.label}
            </span>
          )}
        </div>

        {/* ── Live weather ── */}
        {loadingLiveWeather && !activeWeather ? (
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/70 p-3 text-xs text-slate-400 animate-pulse">
            Loading weather…
          </div>
        ) : activeWeather ? (
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/70 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-[10px] uppercase tracking-wider text-sky-300">
              <span>Weather</span>
              {activeWeather.description && (
                <span className="normal-case tracking-normal text-slate-400">{activeWeather.description}</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-950/80 px-2.5 py-1.5 text-[11px] text-slate-200">
                <Thermometer size={13} className="text-amber-300" />
                {activeWeather.temperature.toFixed(1)}°C
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-950/80 px-2.5 py-1.5 text-[11px] text-slate-200">
                <Droplet size={13} className="text-sky-300" />
                {activeWeather.rainfall.toFixed(1)}mm
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-950/80 px-2.5 py-1.5 text-[11px] text-slate-200">
                <Wind size={13} className="text-cyan-300" />
                {activeWeather.windSpeed.toFixed(1)}m/s
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Route info ── */}
        {loadingSummary ? (
          <div className="rounded-xl bg-slate-800/50 animate-pulse h-12" />
        ) : routeSummary ? (
          <div className="rounded-xl bg-slate-800/50 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2">
                <Route size={14} className="text-amber-400" />
                <span className="font-body text-sm text-white">
                  {routeSummary.count} route{routeSummary.count === 1 ? "" : "s"} available
                </span>
              </div>
              <button
                type="button"
                onClick={openRouteDetails}
                className="px-3 py-1 rounded-md border border-slate-600 text-slate-200 hover:text-white hover:border-slate-500 transition-colors text-xs"
              >
                View
              </button>
            </div>
          </div>
        ) : shouldFetchRoute ? (
          <div className="rounded-xl bg-slate-800/50 px-4 py-3 text-xs text-slate-500">
            <div className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-1.5">
                <Navigation size={12} />
                Set your location to see routes
              </span>
              <div className="flex items-center gap-2">
                {onRequestLocation && (
                  <button
                    type="button"
                    onClick={onRequestLocation}
                    disabled={requestingLocation}
                    className="flex-1 px-3 py-1.5 rounded-md border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                  >
                    {requestingLocation ? "Requesting…" : "Enable GPS"}
                  </button>
                )}
                {onOpenManualLocation && (
                  <button
                    type="button"
                    onClick={onOpenManualLocation}
                    className="flex-1 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white transition-colors border border-white/5"
                  >
                    Set Manually
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Bottom bar ── */}
        <div className="mt-auto pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {dest.verified === true ? (
              <span className="font-body text-xs text-emerald-500">Verified</span>
            ) : dest.confidence != null ? (
              <span className="font-body text-xs text-slate-500">
                {(dest.confidence * 100).toFixed(0)}% match
              </span>
            ) : null}
            <Link
              onClick={() => trackBehavior("view_details")}
              href={`/destinations/${encodeURIComponent(dest.name)}`}
              className="flex items-center gap-1 font-body text-xs text-slate-500 hover:text-amber-400 transition-colors"
            >
              <Eye size={11} /> Details
            </Link>
          </div>
          <button
            onClick={handlePlanTrip}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-body font-semibold transition-all bg-amber-500 hover:bg-amber-400 text-slate-900 shadow-sm shadow-amber-500/20"
          >
            <Compass size={13} /> Plan Trip
          </button>
        </div>
      </div>

      {openRoutes && (
        <RouteModal
          dest={dest}
          userLat={userLat}
          userLon={userLon}
          displayUserLat={displayUserLat}
          displayUserLon={displayUserLon}
          originName={originName}
          originRouteNodeId={originRouteNodeId}
          gpsAccuracyMeters={gpsAccuracyMeters}
          originAlreadyResolved={originAlreadyResolved}
          routeDetails={routeDetails}
          loadingDetails={loadingDetails}
          routeDetailsError={routeDetailsError}
          loadingPipelineRisk={loadingPipelineRisk}
          pipelineRiskByRoute={pipelineRiskByRoute}
          onClose={() => setOpenRoutes(false)}
        />
      )}
    </>
  );
}

function RouteCard({
  route,
  pipelineRisk,
  loadingPipelineRisk,
}: {
  route: RouteDetail;
  pipelineRisk: PipelineRisk | null | undefined;
  loadingPipelineRisk: boolean;
}) {
  const { riskLevel, riskScore } = route;
  const riskPct = Math.round((riskScore ?? 0) * 100);

  const riskColor: Record<string, { text: string; bg: string; border: string; bar: string }> = {
    LOW:     { text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25", bar: "bg-emerald-400" },
    MEDIUM:  { text: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/25",   bar: "bg-amber-400" },
    HIGH:    { text: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/25",  bar: "bg-orange-400" },
    EXTREME: { text: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/25",     bar: "bg-red-400" },
  };
  const rc = riskColor[riskLevel] ?? riskColor.MEDIUM;

  const segmentRiskColor = (level: string) => {
    if (level === "LOW")    return { dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-400/8", border: "border-emerald-400/20" };
    if (level === "MEDIUM") return { dot: "bg-amber-400",   text: "text-amber-400",   bg: "bg-amber-400/8",   border: "border-amber-400/20" };
    if (level === "HIGH")   return { dot: "bg-orange-400",  text: "text-orange-400",  bg: "bg-orange-400/8",  border: "border-orange-400/20" };
    return { dot: "bg-red-400",      text: "text-red-400",     bg: "bg-red-400/8",     border: "border-red-400/20" };
  };

  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 overflow-hidden">
      {/* Route header */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg ${rc.bg} border ${rc.border} flex items-center justify-center`}>
            <Route size={15} className={rc.text} />
          </div>
          <div>
            <p className="font-display text-sm font-semibold text-white">{route.name}</p>
            <p className="font-body text-[11px] text-slate-500">
              {route.distance.toFixed(1)} km · {Math.round(route.duration / 60)} min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-body text-xs font-semibold ${rc.text}`}>{riskLevel}</span>
          <div className="relative w-20 h-2 rounded-full bg-slate-700 overflow-hidden">
            <div className={`absolute inset-y-0 left-0 rounded-full ${rc.bar} transition-all`} style={{ width: `${riskPct}%` }} />
          </div>
        </div>
      </div>

      {/* Route segments */}
      {route.segments.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-700/50">
          <p className="font-body text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Segments</p>
          <div className="space-y-1.5">
            {route.segments.map((seg, si) => {
              const sc = segmentRiskColor(seg.riskLevel);
              return (
                <div key={si} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${sc.border} ${sc.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs text-slate-200 truncate">
                      {seg.from.name ?? "Start"} → {seg.to.name ?? "End"}
                    </p>
                    {seg.hazards.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {seg.hazards.map((h, hi) => (
                          <span key={hi} className="px-1.5 py-0.5 rounded text-[9px] font-body bg-slate-700/60 text-slate-400">{h}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className={`font-body text-[11px] font-medium ${sc.text} shrink-0`}>{seg.riskLevel}</span>
                </div>
              );
            })}
          </div>

          {/* Breakpoints as a visual path */}
          {Array.isArray(route.breakpoints) && route.breakpoints.length > 0 && (
            <div className="mt-3">
              <p className="font-body text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 font-semibold">Route Path</p>
              <div className="px-3 py-2 rounded-lg border border-slate-700/70 bg-slate-950/40">
                <div className="h-0.5 w-full bg-gradient-to-r from-amber-500/80 via-sky-400/70 to-emerald-400/70 rounded-full mb-2.5" />
                <div className="flex flex-wrap items-center gap-1.5">
                  {compactBreakpointNames(route).map((name, nidx, arr) => (
                    <span key={`${name}-${nidx}`} className="inline-flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/70 text-[11px] font-body text-slate-300 leading-tight">{name}</span>
                      {nidx < arr.length - 1 && <span className="text-slate-600 text-[10px]">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pipeline risk breakdown */}
      {loadingPipelineRisk && (
        <div className="px-4 py-3 animate-pulse">
          <div className="h-3 w-32 bg-slate-700 rounded mb-2" />
          <div className="h-2 w-full bg-slate-700 rounded" />
        </div>
      )}
      {!loadingPipelineRisk && pipelineRisk && (
        <div className="px-4 py-3 border-b border-slate-700/50 last:border-0">
          <div className="flex items-center justify-between mb-2">
            <p className="font-body text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Pipeline Risk</p>
            <span className={`font-body text-xs font-semibold ${pipelineRisk.riskLevel === "LOW" ? "text-emerald-400" : pipelineRisk.riskLevel === "MEDIUM" ? "text-amber-400" : "text-orange-400"}`}>
              {pipelineRisk.riskLevel} ({pipelineRisk.riskPercent}%)
            </span>
          </div>

          {/* Stacked bar */}
          <div className="h-3 w-full rounded-full bg-slate-700 flex overflow-hidden mb-2">
            {[
              { label: "Weather",  pct: pipelineRisk.breakdown.weather,  color: "bg-sky-400" },
              { label: "Realtime", pct: pipelineRisk.breakdown.realtime, color: "bg-amber-400" },
              { label: "History",  pct: pipelineRisk.breakdown.historical, color: "bg-violet-400" },
              { label: "Terrain",  pct: pipelineRisk.breakdown.terrain, color: "bg-emerald-400" },
            ].map((b) => (
              <div key={b.label} className={`${b.color} h-full`} style={{ width: `${b.pct}%` }} title={`${b.label}: ${b.pct}%`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-body text-slate-500">
            {[
              { label: "Weather",  pct: pipelineRisk.breakdown.weather,  color: "bg-sky-400" },
              { label: "Realtime", pct: pipelineRisk.breakdown.realtime, color: "bg-amber-400" },
              { label: "History",  pct: pipelineRisk.breakdown.historical, color: "bg-violet-400" },
              { label: "Terrain",  pct: pipelineRisk.breakdown.terrain, color: "bg-emerald-400" },
            ].map((b) => (
              <span key={b.label} className="inline-flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${b.color}`} />
                {b.label} {b.pct}%
              </span>
            ))}
          </div>

          {pipelineRisk.evidence && (
            <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-body text-slate-500">
              {pipelineRisk.evidence.realtimeCount != null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700/50">
                  Realtime: {pipelineRisk.evidence.realtimeCount} events
                </span>
              )}
              {pipelineRisk.evidence.historicalCount != null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700/50">
                  Historical: {pipelineRisk.evidence.historicalCount} points
                </span>
              )}
              {pipelineRisk.evidence.weather?.rain_mm_per_hr != null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700/50">
                  Rain: {pipelineRisk.evidence.weather.rain_mm_per_hr} mm/h
                </span>
              )}
            </div>
          )}

          {pipelineRisk.alerts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {pipelineRisk.alerts.map((a, ai) => (
                <span key={ai} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-body bg-amber-400/10 text-amber-300 border border-amber-400/20">
                  ⚠ {a}
                </span>
              ))}
            </div>
          )}

          {pipelineRisk.note && (
            <p className="font-body text-[11px] text-slate-400 mt-2 italic">{pipelineRisk.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

function RouteModal({
  dest,
  userLat,
  userLon,
  displayUserLat,
  displayUserLon,
  originName,
  originRouteNodeId,
  gpsAccuracyMeters,
  originAlreadyResolved,
  routeDetails,
  loadingDetails,
  routeDetailsError,
  loadingPipelineRisk,
  pipelineRiskByRoute,
  onClose,
}: {
  dest: Destination;
  userLat?: number;
  userLon?: number;
  displayUserLat?: number;
  displayUserLon?: number;
  originName?: string;
  originRouteNodeId?: string;
  gpsAccuracyMeters?: number;
  originAlreadyResolved?: boolean;
  routeDetails: RouteDetail[];
  loadingDetails: boolean;
  routeDetailsError: string | null;
  loadingPipelineRisk: boolean;
  pipelineRiskByRoute: Record<number, PipelineRisk | null | undefined>;
  onClose: () => void;
}) {
  useBodyScrollLock(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <OverlayPortal>
      <div
        className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Route analysis"
        className="fixed inset-4 z-[110] flex items-center justify-center pointer-events-none"
      >
        <div
          className="pointer-events-auto w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/25 flex items-center justify-center">
                <Route size={15} className="text-amber-400" />
              </div>
              <div>
                <p className="font-display text-white text-base font-semibold">Route Analysis</p>
                <p className="font-body text-xs text-slate-400">{dest.name}{dest.district ? ` · ${dest.district}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {routeDetails.length > 0 && (
                <span className="font-body text-[11px] text-slate-500">{routeDetails.length} route{routeDetails.length > 1 ? "s" : ""}</span>
              )}
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="p-4 overflow-y-auto max-h-[75vh] space-y-4">
            {/* Map */}
            {userLat && userLon && dest.latitude && dest.longitude && (
              <RouteMapLoader
                startLat={userLat}
                startLon={userLon}
                displayStartLat={displayUserLat ?? userLat}
                displayStartLon={displayUserLon ?? userLon}
                endLat={dest.latitude}
                endLon={dest.longitude}
                destinationId={dest.id}
                destinationName={dest.name}
                originName={originName || "Your location"}
                originRouteNodeId={originRouteNodeId}
                gpsAccuracy={gpsAccuracyMeters}
                originAlreadyResolved={originAlreadyResolved}
                riskLevel={
                  (routeDetails[0]?.riskLevel as "LOW" | "MEDIUM" | "HIGH" | "EXTREME") ?? "MEDIUM"
                }
                height="h-56"
              />
            )}

            {/* Loading */}
            {loadingDetails && (
              <div className="space-y-3 animate-pulse">
                {[1, 2].map((i) => (
                  <div key={i} className="rounded-xl border border-slate-700/70 bg-slate-800/50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-700" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-40 bg-slate-700 rounded" />
                        <div className="h-2 w-24 bg-slate-700 rounded" />
                      </div>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      <div className="h-2 w-full bg-slate-700 rounded" />
                      <div className="h-2 w-3/4 bg-slate-700 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {!loadingDetails && routeDetailsError && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="font-body text-sm text-amber-300">{routeDetailsError}</p>
              </div>
            )}

            {/* Empty */}
            {!loadingDetails && !routeDetailsError && routeDetails.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Route size={32} className="text-slate-700 mb-3" />
                <p className="font-body text-sm text-slate-500">No route details available for this destination.</p>
              </div>
            )}

            {/* Route cards */}
            {!loadingDetails && routeDetails.map((r, idx) => (
              <RouteCard
                key={r.id ?? `route-${idx}`}
                route={r}
                pipelineRisk={pipelineRiskByRoute[idx]}
                loadingPipelineRisk={loadingPipelineRisk}
              />
            ))}

            {/* Footer */}
            {!loadingDetails && routeDetails.length > 0 && (
              <div className="flex items-center justify-center pt-2">
                <p className="font-body text-[11px] text-slate-600">
                  For detailed segment-by-segment analysis with recommendations, click <span className="text-amber-400">Plan Trip</span> and run Analyse.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

export function PlanTripModal({ onClose }: { destination?: unknown; onClose: () => void }) {
  return null;
}
