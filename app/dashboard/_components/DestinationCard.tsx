"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle, Compass, Droplet, Eye, Heart, MapPin, Navigation, Route,
  Thermometer, Wind, Mountain, TreePine, Landmark, Tent, Waves,
  Binoculars, Building2,
} from "lucide-react";
import { Destination } from "./types";
import { SafetyBadge, ScoreRing } from "./ui";
import { RouteModal } from "@/components/route-modal";
import type { EnhancedRoad } from "@/lib/routing/types";

type RouteSummary = { count: number; sequence?: string[]; segments?: string[] };

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

function keyFor(userLat: number, userLon: number, destLat: number, destLon: number) {
  return `${userLat.toFixed(4)},${userLon.toFixed(4)}:${destLat.toFixed(4)},${destLon.toFixed(4)}`;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
  savedDestinationIds,
  onToggleSave,
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
  savedDestinationIds?: string[];
  onToggleSave?: (destinationId: string, saved: boolean) => void;
}) {
  const router = useRouter();
  const isNearby = homeProvince && dest.province === homeProvince;
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [openRoutes, setOpenRoutes] = useState(false);
  const [roadsData, setRoadsData] = useState<EnhancedRoad[] | null>(null);
  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [loadingLiveWeather, setLoadingLiveWeather] = useState(false);
  const [isSaved, setIsSaved] = useState(
    savedDestinationIds ? savedDestinationIds.includes(dest.id) : false
  );
  const hasOriginCoordinates = isFiniteCoordinate(userLat) && isFiniteCoordinate(userLon);
  const hasDestinationCoordinates = isFiniteCoordinate(dest.latitude) && isFiniteCoordinate(dest.longitude);

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
    const canFetchRoute =
      shouldFetchRoute &&
      isFiniteCoordinate(userLat) &&
      isFiniteCoordinate(userLon) &&
      isFiniteCoordinate(dest.latitude) &&
      isFiniteCoordinate(dest.longitude);

    if (!canFetchRoute) {
      setRouteSummary(null);
      setLoadingSummary(false);
      return;
    }

    const routeUserLat = userLat;
    const routeUserLon = userLon;
    const routeDestLat = dest.latitude!;
    const routeDestLon = dest.longitude!;
    const cacheKey = keyFor(routeUserLat, routeUserLon, routeDestLat, routeDestLon);
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
            startLat: routeUserLat,
            startLon: routeUserLon,
            endLat: routeDestLat,
            endLon: routeDestLon,
            destinationId: dest.id,
            destinationName: dest.name,
          }),
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const roads = Array.isArray(data.roads) ? data.roads : [];
        const firstRoad = roads[0] ?? null;
        const placeNames: string[] = [];
        if (firstRoad?.segments) {
          for (const seg of firstRoad.segments) {
            for (const sc of seg.subCoords ?? []) {
              if (sc.placeName && !placeNames.includes(sc.placeName)) {
                placeNames.push(sc.placeName);
              }
            }
          }
        }
        const summary = {
          count: roads.length,
          sequence: placeNames.length > 0 ? placeNames : undefined,
          segments: Array.isArray(firstRoad?.segments) ? firstRoad.segments : undefined,
        };
        summaryCache.set(cacheKey, summary);
        setRouteSummary(summary);
        setRoadsData(roads);
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

  function openRouteDetails() {
    if (!roadsData || roadsData.length === 0) return;
    setOpenRoutes(true);
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
    MUNICIPALITY:        { icon: <Building2 size={14} />, color: "text-rose-400",    label: "Municipality" },
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

  const borderAccent: Record<string, string> = {
    SAFE: "border-l-emerald-400/40",
    CAUTION: "border-l-amber-400/40",
    HIGH_RISK: "border-l-orange-400/40",
    EXTREME: "border-l-red-400/40",
  };

  return (
    <>
      <div
        className={`destination-card p-5 flex flex-col gap-3 border-l-4 ${borderAccent[dest.safetyLevel] ?? "border-l-slate-600"} ${highlighted ? "border-amber-400/20" : ""}`}
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
                href={`/destinations/${dest.name.replace(/ /g, '_')}`}
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const next = !isSaved;
                setIsSaved(next);
                onToggleSave?.(dest.id, next);
                fetch("/api/user/saved-destinations", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ destinationId: dest.id }),
                }).catch(() => setIsSaved(!next));
              }}
              className={`p-1.5 rounded-lg transition-all hover:scale-110 ${
                isSaved ? "text-rose-400" : "text-slate-600 hover:text-rose-400/70"
              }`}
              title={isSaved ? "Remove from saved" : "Save destination"}
            >
              <Heart size={16} fill={isSaved ? "currentColor" : "none"} />
            </button>
            <ScoreRing score={dest.safetyScore} />
          </div>
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
        ) : shouldFetchRoute && !hasOriginCoordinates ? (
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
        ) : shouldFetchRoute && hasOriginCoordinates && hasDestinationCoordinates ? (
          <div className="rounded-xl bg-slate-800/50 px-4 py-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Navigation size={12} />
              Routes are unavailable right now
            </span>
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
              href={`/destinations/${dest.name.replace(/ /g, '_')}`}
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

      {openRoutes && roadsData && (
        <RouteModal
          roads={roadsData}
          destinationName={`${dest.name}${dest.district ? ` · ${dest.district}` : ""}`}
          originName={originName || "Your Location"}
          onClose={() => setOpenRoutes(false)}
        />
      )}
    </>
  );
}


