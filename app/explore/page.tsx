"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mountain, Search, X, MapPin, Navigation, Loader2,
  Map, LayoutGrid, ChevronLeft, ChevronRight, ArrowLeft,
  Download, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { AppShell } from "@/components/app-shell";
import { DestinationCard } from "@/app/dashboard/_components/DestinationCard";
import { SafetyMap } from "@/app/dashboard/_components/SafetyMap";
import { LocationPicker } from "@/app/dashboard/_components/LocationPicker";
import type { DashboardData, Destination, UserProfile } from "@/app/dashboard/_components/types";
import { useResolvedOrigin } from "@/lib/hooks/use-resolved-origin";

const PAGE_SIZE = 12;

function Pagination({ current, total, onChange }: {
  current: number; total: number; onChange: (p: number) => void;
}) {
  if (total <= 1) return null;

  const pages: (number | "…")[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    if (current > 3) pages.push("…");
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
    if (current < total - 2) pages.push("…");
    pages.push(total);
  }

  return (
    <div className="flex items-center justify-center gap-1.5 mt-6">
      <button disabled={current === 1} onClick={() => onChange(current - 1)}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-all bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
        <ChevronLeft size={13} /> Prev
      </button>
      {pages.map((p, i) =>
        p === "…"
          ? <span key={`e${i}`} className="px-1.5 text-slate-600 text-xs">…</span>
          : <button key={p} onClick={() => onChange(p)}
              className={`w-8 h-8 rounded-lg text-xs font-body font-medium transition-all ${
                p === current
                  ? "bg-amber-500/15 border border-amber-500/30 text-amber-400"
                  : "bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white"
              }`}>{p}</button>
      )}
      <button disabled={current === total} onClick={() => onChange(current + 1)}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-all bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
        Next <ChevronRight size={13} />
      </button>
    </div>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [visibleRouteCards, setVisibleRouteCards] = useState(5);
  const watchIdRef = useRef<number | null>(null);
  const {
    origin: resolvedOrigin,
    resolving: resolvingOrigin,
    error: originResolveError,
    resolveFromGps,
    resolveFromManual,
    loadSavedHome,
  } = useResolvedOrigin();

  const userLocation = resolvedOrigin
    ? { lat: resolvedOrigin.lat, lon: resolvedOrigin.lon }
    : null;
  const manualLocationName = resolvedOrigin?.name ?? null;

  const FILTER_OPTIONS = [
    { value: "ALL", label: "All Destinations" },
    { value: "RECOMMENDED", label: "Recommended for You" },
    { value: "SAFE", label: "Safe" },
    { value: "CAUTION", label: "Caution" },
    { value: "HIGH_RISK", label: "High Risk & Extreme" },
    { value: "SAVED", label: "Saved" },
    { value: "NEARBY", label: "Nearby" },
  ];

  useEffect(() => {
    fetchDashboard();
    void loadSavedHome();
  }, []);

  useEffect(() => {
    const key = resolvedOrigin ? `${resolvedOrigin.lat.toFixed(4)}_${resolvedOrigin.lon.toFixed(4)}` : "";
    if (!key) return;
    const timer = setTimeout(() => { fetchDashboard(); }, 800);
    return () => clearTimeout(timer);
  }, [resolvedOrigin]);

  useEffect(() => { setPage(1); }, [filter, search]);
  useEffect(() => { setVisibleRouteCards(5); }, [page, filter, search]);
  useEffect(() => {
    const iv = setInterval(() => {
      setVisibleRouteCards((prev) => Math.min(prev + 3, PAGE_SIZE));
    }, 1200);
    return () => clearInterval(iv);
  }, [page, filter, search]);

  async function fetchDashboard() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (resolvedOrigin) {
        params.set("originLat", String(resolvedOrigin.lat));
        params.set("originLon", String(resolvedOrigin.lon));
      }
      const qs = params.toString();
      const res = await fetch(`/api/dashboard${qs ? `?${qs}` : ""}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) { router.push("/sign-in"); return; }
        if (res.status === 403 && json.needsOnboarding) { router.push("/onboarding"); return; }
        setError(`Error ${res.status}: ${json.message ?? "Unknown error"}`);
        return;
      }
      setData(json);
    } catch (err) {
      setError(`Failed to load: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function requestUserLocation() {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void resolveFromGps(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      (err) => {
        setLocating(false);
        if (err.code === 1) setLocationError("Permission denied.");
        else setLocationError("Location unavailable.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // ── Derived data ────────────────────────────────────────────────────────

  const destinations = (data?.destinations ?? []) as Destination[];
  const savedIds = data?.user?.savedDestinationIds ?? [];
  const userData = data?.user ?? null;

  const filtered = destinations.filter((d) => {
    const q = search.toLowerCase();
    if (!d.name.toLowerCase().includes(q) && !d.district.toLowerCase().includes(q) && !d.province.toLowerCase().includes(q)) return false;
    if (filter === "ALL" || filter === "RECOMMENDED") return true;
    if (filter === "SAFE") return d.safetyLevel === "SAFE";
    if (filter === "CAUTION") return d.safetyLevel === "CAUTION";
    if (filter === "HIGH_RISK") return d.safetyLevel === "HIGH_RISK" || d.safetyLevel === "EXTREME";
    if (filter === "SAVED") return savedIds.includes(d.id);
    if (filter === "NEARBY") {
      if (!userData?.homeLocation?.province) return false;
      return d.province === userData.homeLocation.province;
    }
    return true;
  });

  const sortedAndRanked = [...filtered].sort((a, b) => (b.safetyScore ?? 0) - (a.safetyScore ?? 0));

  const totalPages = Math.ceil(sortedAndRanked.length / PAGE_SIZE);
  const paginated = sortedAndRanked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = {
    total: destinations.length,
    safe: destinations.filter((d) => d.safetyLevel === "SAFE").length,
    caution: destinations.filter((d) => d.safetyLevel === "CAUTION").length,
    highRisk: destinations.filter((d) => d.safetyLevel === "HIGH_RISK").length,
    extreme: destinations.filter((d) => d.safetyLevel === "EXTREME").length,
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) return (
    <AppShell active="accessibility" title="Explore">
      <div className="p-6 md:p-10">
        <div className="mb-8 animate-pulse">
          <div className="h-8 w-32 bg-slate-800 rounded mb-4" />
          <div className="h-10 bg-slate-800/60 rounded-xl mb-4" />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-slate-800/40 rounded-2xl border border-slate-700/30" />
          ))}
        </div>
      </div>
    </AppShell>
  );

  if (error) return (
    <AppShell active="accessibility" title="Explore">
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm px-4">
          <Mountain className="text-red-400 mx-auto mb-4" size={40} />
          <p className="font-body text-slate-300 mb-2 text-sm">{error}</p>
          <Button onClick={fetchDashboard} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold font-body">
            <RefreshCw size={14} className="mr-2" /> Try Again
          </Button>
        </div>
      </div>
    </AppShell>
  );

  return (
    <AppShell active="accessibility" title="Explore">
      <div className="px-6 pt-6 pb-20 md:px-10 md:pt-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-white">Explore Destinations</h1>
            <p className="font-body text-sm text-slate-500 mt-1">{stats.total} destinations with safety data</p>
          </div>
        </div>

        {/* Location bar */}
        <div className="mb-6">
          {pickingLocation && (
            <LocationPicker
              onClose={() => setPickingLocation(false)}
              onSelect={(loc) => {
                setPickingLocation(false);
                setLocationError(null);
                void resolveFromManual(`${loc.name}, ${loc.district}`, loc.latitude, loc.longitude);
              }}
            />
          )}
          <div className="stat-card location-card">
            <div className="location-card__main">
              <div className={`location-card__icon transition-colors ${userLocation ? "" : "opacity-70 grayscale"}`}>
                <Navigation size={18} className={userLocation ? "text-amber-400" : "text-slate-500"} />
              </div>
              <div className="location-card__content">
                <p className="location-card__eyebrow">Current Origin</p>
                <div className="location-card__title-row">
                  <p className="location-card__title">
                    {manualLocationName || (userLocation ? "Detected Location" : "Not Set")}
                  </p>
                  {(resolvingOrigin || locating) && (
                    <span className="location-card__badge text-accent">Resolving…</span>
                  )}
                  {userLocation && !resolvingOrigin && (
                    <span className="location-card__badge">
                      {resolvedOrigin?.routeNodeName ? `Hub: ${resolvedOrigin.routeNodeName}` : "Snapped"}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="location-card__actions md:grid-cols-1 md:min-w-[17rem]">
              <div className="location-card__secondary-actions">
                <button onClick={requestUserLocation} disabled={locating}
                  className="location-card__button">
                  {locating ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                  {locating ? "Locating..." : "Auto-Detect"}
                </button>
                <button onClick={() => setPickingLocation(true)}
                  className="location-card__button">
                  <Search size={12} /> Set Manually
                </button>
              </div>
            </div>
          </div>
          {(locationError || originResolveError) && (
            <p className="mt-2 font-body text-xs text-amber-400/90">{locationError || originResolveError}</p>
          )}
        </div>

        {/* Search + filter + map toggle */}
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Search destinations, districts, provinces…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="search-input w-full pl-9 pr-9 py-2.5 text-sm rounded-xl" />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"><X size={14} /></button>}
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2.5 text-sm rounded-xl bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/10 transition-all">
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-slate-800 text-white">{opt.label}</option>
            ))}
          </select>
          <button onClick={() => setShowMap(!showMap)}
            className={`flex items-center gap-2 px-3 py-2.5 text-sm rounded-xl border font-body transition-all ${
              showMap
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-slate-800/80 border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-500"
            }`}
            title={showMap ? "Grid view" : "Map view"}>
            {showMap ? <LayoutGrid size={15} /> : <Map size={15} />}
            {showMap ? "Grid" : "Map"}
          </button>
        </div>

        {/* Count */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-body text-xs text-slate-600">
            {stats.total === 0 ? "No safety data yet"
              : sortedAndRanked.length === 0 ? "No destinations match"
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sortedAndRanked.length)} of ${sortedAndRanked.length}`}
          </p>
          {filter !== "ALL" && (
            <button onClick={() => setFilter("ALL")} className="font-body text-xs text-amber-400 hover:text-amber-300 transition-colors">Clear filter ×</button>
          )}
        </div>

        {/* Empty states */}
        {stats.total === 0 && (
          <div className="text-center py-20 destination-card max-w-md mx-auto">
            <Mountain size={40} className="text-slate-700 mx-auto mb-4" />
            <h3 className="font-display text-xl text-slate-400 mb-2">No safety data yet</h3>
            <p className="font-body text-slate-500 text-sm">Destinations are being scored. Check back soon.</p>
          </div>
        )}
        {stats.total > 0 && sortedAndRanked.length === 0 && (
          <div className="text-center py-16">
            <Search size={32} className="text-slate-700 mx-auto mb-3" />
            <p className="font-body text-slate-500">No destinations match your search.</p>
          </div>
        )}

        {/* Filter heading */}
        {filter !== "ALL" && paginated.length > 0 && (
          <h2 className="font-display text-base font-bold text-white mb-4">
            {filter === "RECOMMENDED" && "✨ Recommended for you"}
            {filter === "SAFE" && "✅ Safe destinations"}
            {filter === "CAUTION" && "⚠️ Caution — travel with care"}
            {filter === "HIGH_RISK" && "🚨 High risk — avoid if possible"}
            {filter === "EXTREME" && "❌ Extreme — do not travel"}
            {filter === "NEARBY" && "📍 Nearby destinations"}
            {filter === "SAVED" && "♥ Saved destinations"}
          </h2>
        )}

        {/* Map view */}
        {showMap && stats.total > 0 && (
          <SafetyMap destinations={sortedAndRanked} />
        )}

        {/* Grid */}
        {!showMap && paginated.length > 0 && (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginated.map((dest, i) => (
                <DestinationCard
                  key={dest.id}
                  dest={dest}
                  index={i}
                  homeProvince={userData?.homeLocation?.province ?? null}
                  highlighted={false}
                  userLat={userLocation?.lat}
                  userLon={userLocation?.lon}
                  displayUserLat={resolvedOrigin?.displayLat}
                  displayUserLon={resolvedOrigin?.displayLon}
                  originName={manualLocationName || undefined}
                  originRouteNodeId={resolvedOrigin?.routeNodeId ?? undefined}
                  gpsAccuracyMeters={resolvedOrigin?.accuracyMeters}
                  originAlreadyResolved={!!resolvedOrigin}
                  onRequestLocation={requestUserLocation}
                  requestingLocation={locating}
                  onOpenManualLocation={() => setPickingLocation(true)}
                  shouldFetchRoute={i < visibleRouteCards}
                  savedDestinationIds={savedIds}
                />
              ))}
            </div>
            <Pagination current={page} total={totalPages} onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          </>
        )}
      </div>
    </AppShell>
  );
}
