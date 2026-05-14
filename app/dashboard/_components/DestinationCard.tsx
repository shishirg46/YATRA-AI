"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Compass, Eye, MapPin, Navigation, Route, X } from "lucide-react";
import { Destination } from "./types";
import { SafetyBadge, ScoreRing } from "./ui";

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

const summaryCache = new Map<string, RouteSummary>();
const detailCache = new Map<string, RouteDetail[]>();

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
  onRequestLocation,
  requestingLocation,
  shouldFetchRoute = true,
}: {
  dest: Destination;
  index: number;
  homeProvince: string | null;
  highlighted: boolean;
  userLat?: number;
  userLon?: number;
  onRequestLocation?: () => void;
  requestingLocation?: boolean;
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
          origin: { lat: userLat, lon: userLon },
          destination: { lat: dest.latitude, lon: dest.longitude, name: dest.name },
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

  const weatherSourceText = dest.weather?.sourceLabel || dest.weather?.source || null;

  return (
    <>
      <div
        className={`dest-card p-5 flex flex-col ${highlighted ? "border-amber-400/20" : ""}`}
        style={{ animation: `fadeUp .4s ease ${index * 0.03}s both` }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Link onClick={() => trackBehavior("view_details")} href={`/destinations/${dest.id}`} className="hover:text-amber-400 transition-colors"><h3 className="font-display font-bold text-white text-base leading-tight truncate group-hover:text-amber-400">{dest.name}</h3></Link>
              {isNearby && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-sky-400/10 border border-sky-400/20 text-sky-400 font-body text-[10px] font-semibold uppercase tracking-wider">Nearby</span>
              )}
              {highlighted && dest.safetyLevel === "SAFE" && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 font-body text-[10px] font-semibold uppercase tracking-wider">✦ Recommended</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin size={11} className="text-slate-500 flex-shrink-0" />
              <span className="font-body text-xs text-slate-500 truncate">{dest.district}, {dest.province}</span>
            </div>
          </div>
          <ScoreRing score={dest.safetyScore} />
        </div>

        <div className="flex items-center justify-between mb-3">
          <SafetyBadge level={dest.safetyLevel} />
          {dest.altitude != null && dest.altitude > 0 && (
            <span className="font-body text-xs text-slate-600">{dest.altitude.toLocaleString()}m</span>
          )}
        </div>

        {(dest.safetyLevel === "HIGH_RISK" || dest.safetyLevel === "EXTREME") && (
          <div className={`flex items-start gap-2 px-3 py-2 rounded-lg mb-3 text-xs font-body ${
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

        {loadingSummary ? (
          <div className="mb-3 p-3 rounded-xl bg-slate-800/50 animate-pulse h-14" />
        ) : routeSummary ? (
          <div className="mb-3 p-3 rounded-xl bg-slate-800/50">
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
                className="px-2 py-1 rounded-md border border-slate-600 text-slate-200 hover:text-white hover:border-slate-500 transition-colors text-xs"
              >
                View
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-3 p-3 rounded-xl bg-slate-800/50 text-xs text-slate-500">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center">
                <Navigation size={12} className="inline mr-1" />
                Set your location to see routes
              </span>
              {onRequestLocation && (
                <button
                  type="button"
                  onClick={onRequestLocation}
                  disabled={requestingLocation}
                  className="px-2 py-1 rounded-md border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                >
                  {requestingLocation ? "Requesting…" : "Enable"}
                </button>
              )}
            </div>
          </div>
        )}

        {dest.weather?.description && (
          <div className="mb-3 space-y-1">
            {weatherSourceText && (
              <p className="font-body text-[11px] text-sky-300">
                {weatherSourceText}
                {dest.weather.stationName ? ` · ${dest.weather.officialSource ? "Station" : "Nearest DHM"}: ${dest.weather.stationName}` : ""}
                {typeof dest.weather.stationDistanceKm === "number" ? ` (${dest.weather.stationDistanceKm.toFixed(1)} km)` : ""}
              </p>
            )}
            <p className="font-body text-xs text-slate-400">{dest.weather.description}</p>
          </div>
        )}

        {dest.reasoning?.[0] && (
          <p className="font-body text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">
            {dest.reasoning[0]}
          </p>
        )}

        <div className="mt-auto pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="font-body text-xs text-slate-600">
              {dest.confidence != null ? `${(dest.confidence * 100).toFixed(0)}% confidence` : "—"}
            </span>
            <Link onClick={() => trackBehavior("view_details")} href={`/destinations/${dest.id}`} className="flex items-center gap-1 font-body text-xs text-slate-500 hover:text-amber-400 transition-colors">
              <Eye size={11} /> Details
            </Link>
          </div>
          <button
            onClick={handlePlanTrip}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-body font-semibold transition-all bg-amber-500 hover:bg-amber-400 text-slate-900"
          >
            <Compass size={12} /> Plan Trip
          </button>
        </div>
      </div>

      {openRoutes && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <div>
                <p className="font-display text-white text-base font-semibold">Route Analysis</p>
                <p className="font-body text-xs text-slate-400">{dest.name}</p>
              </div>
              <button type="button" onClick={() => setOpenRoutes(false)} className="p-1 rounded text-slate-300 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[75vh] space-y-3">
              {loadingDetails && <p className="font-body text-sm text-slate-400">Loading route hazards and disaster data…</p>}
              {!loadingDetails && routeDetailsError && (
                <p className="font-body text-sm text-amber-300">{routeDetailsError}</p>
              )}
              {!loadingDetails && !routeDetailsError && routeDetails.length === 0 && (
                <p className="font-body text-sm text-slate-400">No route details available.</p>
              )}
              {!loadingDetails && routeDetails.map((r, idx) => (
                <div key={r.id ?? `route-${idx}`} className="rounded-lg border p-3 border-slate-700 bg-slate-800/40">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-body text-sm text-white font-semibold text-left">{r.name}</p>
                    <span className="font-body text-xs text-slate-300">
                      Risk: {r.riskLevel} ({Math.round((r.riskScore ?? 0) * 100)}%)
                    </span>
                  </div>
                  {Array.isArray(r.breakpoints) && r.breakpoints.length > 0 && (
                    <div className="mb-2 space-y-1">
                      <p className="font-body text-xs text-slate-400">
                        Breakpoints: {r.breakpoints.length}
                      </p>
                      <div className="rounded-lg border border-slate-700/70 bg-slate-950/40 px-3 py-2">
                        <div className="h-0.5 w-full bg-gradient-to-r from-amber-500/80 via-sky-400/70 to-emerald-400/70 rounded-full mb-2" />
                        <div className="flex flex-wrap items-center gap-1.5">
                          {compactBreakpointNames(r).map((name, nidx, arr) => (
                            <span key={`${name}-${nidx}`} className="inline-flex items-center gap-1 text-[11px] font-body text-slate-200">
                              <span className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700">{name}</span>
                              {nidx < arr.length - 1 && <span className="text-slate-500">→</span>}
                            </span>
                          ))}
                        </div>
                        <p className="font-body text-[10px] text-slate-500 mt-2">Highway preview: key breakpoints only</p>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {loadingPipelineRisk && (
                      <p className="font-body text-[11px] text-slate-400">Loading pipeline risk…</p>
                    )}
                    {!loadingPipelineRisk && pipelineRiskByRoute[idx] && (
                      <div className="rounded border border-sky-500/30 bg-sky-500/5 p-2">
                        <p className="font-body text-xs text-sky-200">
                          Pipeline Risk: {pipelineRiskByRoute[idx]?.riskLevel} ({pipelineRiskByRoute[idx]?.riskPercent}%)
                        </p>
                        <p className="font-body text-[11px] text-slate-300">
                          Breakdown — weather {pipelineRiskByRoute[idx]?.breakdown.weather}% · realtime {pipelineRiskByRoute[idx]?.breakdown.realtime}% · historical {pipelineRiskByRoute[idx]?.breakdown.historical}% · terrain {pipelineRiskByRoute[idx]?.breakdown.terrain}%
                        </p>
                        <p className="font-body text-[11px] text-slate-400">
                          Evidence — realtime events: {pipelineRiskByRoute[idx]?.evidence?.realtimeCount ?? 0}, historical points: {pipelineRiskByRoute[idx]?.evidence?.historicalCount ?? 0}, rain: {pipelineRiskByRoute[idx]?.evidence?.weather?.rain_mm_per_hr ?? 0} mm/h
                        </p>
                        {(pipelineRiskByRoute[idx]?.alerts?.length ?? 0) > 0 && (
                          <p className="font-body text-[11px] text-amber-300">
                            Alerts: {pipelineRiskByRoute[idx]?.alerts.join(", ")}
                          </p>
                        )}
                        {pipelineRiskByRoute[idx]?.note && (
                          <p className="font-body text-[11px] text-slate-500">{pipelineRiskByRoute[idx]?.note}</p>
                        )}
                      </div>
                    )}
                    <p className="font-body text-[11px] text-slate-500">
                      Detailed segment-by-segment analysis is shown after you click Plan Trip and run Analyse.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function PlanTripModal({ onClose }: { destination?: unknown; onClose: () => void }) {
  return null;
}
