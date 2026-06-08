/**
 * FILE: page.tsx
 * LOCATION: /app/dashboard/page.tsx
 * PURPOSE: Main dashboard page — all heavy components imported from _components/
 *
 * STRUCTURE:
 *   _components/types.ts              shared types + config constants
 *   _components/ui.tsx                SafetyBadge, ScoreRing, Avatar, TimeAgo, PhotoUpload
 *   _components/NotificationPanel.tsx hazard alert dropdown
 *   _components/FriendsSidebar.tsx    left slide-in friends panel
 *   _components/DestinationCard.tsx   destination card + PlanTripModal
 *   _components/ProfileDrawer.tsx     right slide-in profile + inline editing
 *
 * PAGINATION: PAGE_SIZE = 12, numeric bar: 1 2 … n  Prev / Next
 */
"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef }  from "react";
import { useRouter }            from "next/navigation";
import Link                     from "next/link";
import Image                    from "next/image";
import {
  Mountain, XCircle, RefreshCw,
  Search, X, User, Bell, Users, MapPin,
  ChevronLeft, ChevronRight, Navigation, Loader2, Download,
  Map, LayoutGrid, ArrowRight, Menu, NotebookPen, Settings,
} from "lucide-react";
import { Button }          from "@/components/ui/button";
import { authClient }      from "@/lib/auth-client";
import { useRealtime }     from "@/lib/hooks/useRealtime";

import { DashboardData, Destination, DestinationSummary, UserProfile, HazardNotif } from "./_components/types";
import { NotificationPanel } from "./_components/NotificationPanel";
import { FriendsSidebar }    from "./_components/FriendsSidebar";
import { DestinationCard }   from "./_components/DestinationCard";

import { LocationPicker }    from "./_components/LocationPicker";
import { ReportHazardButton }     from "./_components/ReportHazardButton";
import { TripActionModal }        from "./_components/TripActionModal";
import { RecommendationsCarousel } from "./_components/RecommendationsCarousel";
import { SafetyMap } from "./_components/SafetyMap";
import { FirstRunCoachmarks } from "./_components/FirstRunCoachmarks";
import { AppShell }            from "@/components/app-shell";
import { LocationShareButton } from "@/components/location-share-button";
import { useResolvedOrigin } from "@/lib/hooks/use-resolved-origin";
import {
  rankRecommendedDestinations,
  recommendationSortScore,
} from "@/lib/recommendations/destination-recommendations";

const PAGE_SIZE          = 12;
const DASHBOARD_CARD_LIMIT = 6;

// ── Pagination bar ────────────────────────────────────────────────────────────

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
    <div className="flex items-center justify-center gap-1 mt-8 flex-wrap">
      <button onClick={() => onChange(current - 1)} disabled={current === 1}
        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed font-body text-sm transition-all">
        <ChevronLeft size={14} /> Prev
      </button>

      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-2 text-slate-600 font-body text-sm">…</span>
        ) : (
          <button key={p} onClick={() => onChange(p as number)}
            className={`w-9 h-9 rounded-xl border font-body text-sm transition-all ${p === current ? "bg-amber-500 border-amber-500 text-slate-900 font-semibold" : "border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600"}`}>
            {p}
          </button>
        )
      )}

      <button onClick={() => onChange(current + 1)} disabled={current === total}
        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed font-body text-sm transition-all">
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData]               = useState<DashboardData | null>(null);

  // Real-time SSE updates
  const { mergeLiveScores, connected, lastUpdate, alerts: liveAlerts, status: realtimeStatus } = useRealtime();
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [loggingOut, setLoggingOut]   = useState(false);
  const [notifOpen, setNotifOpen]     = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [actionNotif, setActionNotif] = useState<HazardNotif | null>(null);
  const [search, setSearch]           = useState("");
  const [filter, setFilter]           = useState<string>("ALL");
  const [notifications, setNotifs]    = useState<HazardNotif[]>([]);
  const [userImage, setUserImage]     = useState<string | null>(null);
  const [userData, setUserData]       = useState<UserProfile | null>(null);
  const [page, setPage]               = useState(1);
  const [assessStatus, setAssessStatus] = useState<{ hoursAgo: number | null; isStale: boolean } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [destinationSummary, setDestinationSummary] = useState<DestinationSummary | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [visibleRouteCards, setVisibleRouteCards] = useState(5);
  const FILTER_OPTIONS = [
    { value: "ALL", label: "All Destinations" },
    { value: "RECOMMENDED", label: "Recommended for You" },
    { value: "SAFE", label: "Safe" },
    { value: "CAUTION", label: "Caution" },
    { value: "HIGH_RISK", label: "High Risk & Extreme" },
    { value: "SAVED", label: "Saved" },
    { value: "NEARBY", label: "Nearby" },
  ];
  const [fetchingOsm, setFetchingOsm] = useState(false);
  const [osmFetchResult, setOsmFetchResult] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickingLocation, setPickingLocation] = useState(false);
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

  function requestUserLocation() {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }

    const executeGeoRequest = () => {
      setLocating(true);
      setLocationError(null);

      let bestPos: GeolocationPosition | null = null;

      const stopWatching = () => {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        setLocating(false);
      };

      const resolveLocation = async (latitude: number, longitude: number, accuracy: number) => {
        const resolved = await resolveFromGps(latitude, longitude, accuracy);
        if (!resolved) {
          setLocationError("Could not resolve your location.");
        }
      };

      const timeoutId = setTimeout(() => {
        stopWatching();
        if (bestPos) {
          void resolveLocation(bestPos.coords.latitude, bestPos.coords.longitude, bestPos.coords.accuracy);
        } else {
          setLocationError("Location request timed out. Please ensure GPS is enabled and try again.");
        }
      }, 12000);

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
            bestPos = pos;
          }
          if (pos.coords.accuracy < 80) {
            clearTimeout(timeoutId);
            stopWatching();
            void resolveLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          }
        },
        (err) => {
          if (!bestPos) {
            clearTimeout(timeoutId);
            stopWatching();
            if (err.code === 1) setLocationError("Permission denied.");
            else setLocationError("Location unavailable.");
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    };

    if (typeof navigator !== "undefined" && "permissions" in navigator) {
      navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
        if (status.state === "denied") {
          setLocating(false);
          setLocationError("Location is blocked by browser for localhost:3000. Change it to Allow in site settings, then tap Enable.");
          return;
        }
        executeGeoRequest();
      }).catch(() => {
        executeGeoRequest();
      });
      return;
    }

    executeGeoRequest();
  }

  // Do not auto-request on mount; request only from explicit user action.

  // Watch permission changes; auto-detect once location access becomes granted.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    let mounted = true;
    let permissionStatus: PermissionStatus | null = null;

    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
      permissionStatus = status;
      status.onchange = () => {
        if (!mounted) return;
        if (status.state === "granted") {
          requestUserLocation();
        }
      };
    }).catch(() => {});

    return () => {
      mounted = false;
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, []);

  // Surface denied state immediately so the user doesn't wait for a prompt that won't come.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
      if (status.state === "denied") {
        setLocating(false);
        setLocationError("Browser has blocked location for localhost:3000. Please allow Location in site settings, then tap Enable.");
      }
    }).catch(() => {});
  }, []);

  // Clean up watchPosition on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => { fetchDashboard(); checkAndRefreshData(); fetchDestinationSummary(); }, []);

  // Auto re-fetch dashboard when origin changes (GPS resolve, manual pick, cached load)
  const originKeyRef = useRef("");
  useEffect(() => {
    const key = resolvedOrigin ? `${resolvedOrigin.lat.toFixed(4)}_${resolvedOrigin.lon.toFixed(4)}` : "";
    if (!key) return;
    if (key === originKeyRef.current) return;
    originKeyRef.current = key;
    const timer = setTimeout(() => { fetchDashboard(); }, 800);
    return () => clearTimeout(timer);
  }, [resolvedOrigin]);

  useEffect(() => {
    void loadSavedHome().then((home) => {
      if (!home && navigator.geolocation) {
        requestUserLocation();
      }
    });
  }, [loadSavedHome]);
  useEffect(() => {
    fetchNotifications();
    // Check for trip lifecycle triggers
    fetch("/api/user/trips/check-status", { method: "POST", credentials: "include" }).catch(() => {});
    const iv = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Reset page when filter or search changes
  useEffect(() => { setPage(1); }, [filter, search]);
  useEffect(() => { setVisibleRouteCards(5); }, [page, filter, search]);
  useEffect(() => {
    const iv = setInterval(() => {
      setVisibleRouteCards((prev) => Math.min(prev + 3, PAGE_SIZE));
    }, 1200);
    return () => clearInterval(iv);
  }, [page, filter, search]);

  // Check if safety data is stale — trigger background reassessment if so
  async function checkAndRefreshData() {
    try {
      const res = await fetch("/api/assess/status", { credentials: "include" });
      if (!res.ok) return;
      const status = await res.json();
      setAssessStatus({ hoursAgo: status.hoursAgo, isStale: status.isStale });
      if (status.isStale) {
        fetch("/api/assess/status", { method: "POST", credentials: "include" })
          .then(async (r) => {
            const d = await r.json();
            if (d.triggered) setTimeout(fetchDashboard, 45_000);
          })
          .catch(() => {});
      }
    } catch { /* silent */ }
  }

  async function fetchDashboard() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (resolvedOrigin) {
        params.set("originLat", String(resolvedOrigin.lat));
        params.set("originLon", String(resolvedOrigin.lon));
      }
      const qs = params.toString();
      const res  = await fetch(`/api/dashboard${qs ? `?${qs}` : ""}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) { router.push("/sign-in"); return; }
        if (res.status === 403 && json.needsOnboarding) { router.push("/onboarding"); return; }
        setError(`Error ${res.status}: ${json.message ?? "Unknown error"}`);
        return;
      }
      if (json.user?.role === "ADMIN") {
        router.replace("/admin/dashboard");
        return;
      }
      if (json.user?.role === "ANALYST") {
        router.replace("/admin/analytics");
        return;
      }
      setData(json);
      setUserImage(json.user.image);
      setUserData(json.user);
    } catch (err) {
      setError(`Failed to load: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchFromOsm() {
    setFetchingOsm(true);
    setOsmFetchResult(null);
    try {
      const res = await fetch("/api/destinations/fetch-from-osm", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (res.ok) {
        setOsmFetchResult(json.message);
        setTimeout(fetchDashboard, 2000);
      } else {
        setOsmFetchResult(json.message || "Failed to fetch from OSM");
      }
    } catch (err) {
      setOsmFetchResult(`Error: ${String(err)}`);
    } finally {
      setFetchingOsm(false);
    }
  }

  // Only show important hazard notifications
  function filterHazardNotifs(notifs: HazardNotif[]): HazardNotif[] {
    return notifs.filter(n =>
      n.type === "FLOOD" || n.type === "LANDSLIDE" || n.type === "EARTHQUAKE"
    );
  }

  async function fetchNotifications() {
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      const json = await res.json();
      if (Array.isArray(json)) {
        setNotifs(filterHazardNotifs(json));
      }
    } catch {}
  }

  async function fetchDestinationSummary() {
    try {
      const res = await fetch("/api/destinations/summary", { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      setDestinationSummary(json);
    } catch {}
  }

  function markRead(id: string) {
    setNotifs((p) => p.map((n) => n.id === id ? { ...n, read: true } : n));
    fetch(`/api/notifications/${id}/read`, { method: "POST", credentials: "include" }).catch(() => {});
  }
  function markAllRead() {
    setNotifs((p) => p.map((n) => ({ ...n, read: true })));
    fetch("/api/notifications/read-all", { method: "POST", credentials: "include" }).catch(() => {});
  }
  async function handleTripAction(notif: HazardNotif, action: string, newDate?: string) {
    if (!notif.planId) return;
    const res = await fetch(`/api/trips/${notif.planId}/action`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, newDate }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Action failed");
    }
    // Mark the notif as read & dismiss modal
    markRead(notif.id);
    setActionNotif(null);
    // Refetch notifications to pull updated state
    fetchNotifications();
  }

  async function handleLogout() {
    setLoggingOut(true);
    await authClient.signOut();
    router.push("/sign-in");
  }

  // ── Filter + paginate + rank ────────────────────────────────────────────────────────

  // Merge live SSE score updates into base dashboard data
  const all      = mergeLiveScores(data?.destinations ?? []) as Destination[];

  const savedIds = data?.user?.savedDestinationIds ?? [];
  const filtered = all.filter((d) => {
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

  const rankedRecommendations = rankRecommendedDestinations(filtered, userData);
  const sortedAndRanked = filter === "RECOMMENDED"
    ? rankedRecommendations.map((item) => item.destination)
    : [...filtered].sort((a, b) => recommendationSortScore(b, userData) - recommendationSortScore(a, userData));

  const totalPages      = Math.ceil(sortedAndRanked.length / PAGE_SIZE);
  const paginated       = sortedAndRanked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const dashboardCards  = sortedAndRanked.slice(0, DASHBOARD_CARD_LIMIT);
  const totalCardsShown = sortedAndRanked.length > DASHBOARD_CARD_LIMIT ? DASHBOARD_CARD_LIMIT : sortedAndRanked.length;
  // Recompute stats from live-merged data
  const stats      = {
    total:    all.length,
    safe:     all.filter((d) => d.safetyLevel === "SAFE").length,
    caution:  all.filter((d) => d.safetyLevel === "CAUTION").length,
    highRisk: all.filter((d) => d.safetyLevel === "HIGH_RISK").length,
    extreme:  all.filter((d) => d.safetyLevel === "EXTREME").length,
  };
  
  const recommended = rankRecommendedDestinations(all, userData)
    .slice(0, 3)
    .map((item) => item.destination);

  // ── Loading / Error ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="yatra-page min-h-screen p-6 md:p-10">
      {/* skeleton header */}
      <div className="mb-8 animate-pulse">
        <div className="h-3 w-24 bg-slate-800 rounded mb-2" />
        <div className="h-8 w-48 bg-slate-800 rounded" />
      </div>
      {/* skeleton stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 animate-pulse">
        {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-slate-800/60 rounded-2xl" />)}
      </div>
      {/* skeleton grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-48 bg-slate-800/40 rounded-2xl border border-slate-700/30" />
        ))}
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="yatra-page flex items-center justify-center min-h-screen">
      <div className="text-center max-w-sm px-4">
        <XCircle className="text-red-400 mx-auto mb-4" size={40} />
        <p className="font-body text-slate-300 mb-2 text-sm">{error}</p>
        <Button onClick={fetchDashboard} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold font-body">
          <RefreshCw size={14} className="mr-2" />Try Again
        </Button>
      </div>
    </div>
  );

  const { user: rawUser } = data;
  const user = { ...rawUser, ...userData, image: userImage };

  const centerContent = (
    <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border ${connected ? "bg-emerald-400/10 border-emerald-400/20" : "bg-slate-700/30 border-slate-600/30"}`}>
      <span className="relative flex h-2 w-2">
        {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? "bg-emerald-400" : "bg-slate-500"}`} />
      </span>
      <span className={`text-xs font-body ${connected ? "text-emerald-400" : "text-slate-500"}`}>
        {connected ? "Live" : realtimeStatus === "connecting" ? "Connecting…" : "Reconnecting…"}
      </span>
      {lastUpdate && connected && (
        <span className="text-xs font-body text-slate-600 hidden lg:block">
          · updated {new Date(lastUpdate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );

  const navActions = (
    <>
      {user.role === "ADMIN" && (
        <Link href="/admin" className="hidden md:inline-flex yatra-cta-ghost">
          Admin Panel
        </Link>
      )}
      <div className="relative hidden md:block">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setMenuOpen((v) => !v)}
          title="Menu"
        >
          <Menu size={16} className="text-slate-400" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-2 w-auto whitespace-nowrap z-50 rounded-xl border border-slate-700/50 bg-background backdrop-blur-xl shadow-2xl overflow-hidden">
              <div className="p-1.5 space-y-0.5">
                <Link href="/profile" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all font-body">
                  {userImage ? (
                    <Image src={userImage} alt="" width={20} height={20}
                      className="w-5 h-5 rounded-full object-cover border border-slate-600" unoptimized={userImage.startsWith("data:")} />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-amber-400/20 border border-amber-400/30 flex items-center justify-center">
                      <span className="text-amber-400 text-[10px] font-bold">{user.name?.[0]?.toUpperCase()}</span>
                    </div>
                  )}
                  Profile
                </Link>
                <Link href="/plan" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all font-body"
                >
                  <Mountain size={15} /> Plan a Trip
                </Link>
                <Link href="/trips" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all font-body"
                >
                  <NotebookPen size={15} /> Your Plans
                </Link>
                <Link href="/settings" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all font-body"
                >
                  <Settings size={15} /> Settings
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
      <button type="button" className="icon-btn" onClick={() => setFriendsOpen(true)} title="Travel network">
        <Users size={16} className="text-slate-400" />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setNotifOpen((v) => !v)}
        title="Hazard alerts"
      >
        <Bell size={16} className={unreadCount > 0 ? "text-amber-400" : "text-slate-400"} />
        {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

    </>
  );

  return (
    <AppShell active="dashboard" actions={navActions} center={centerContent}>
      {/* Overlays */}
      <FriendsSidebar open={friendsOpen} onClose={() => setFriendsOpen(false)} />
      <FirstRunCoachmarks />
      <NotificationPanel
        open={notifOpen} onClose={() => setNotifOpen(false)}
        notifications={notifications} onMarkRead={markRead} onMarkAllRead={markAllRead}
        onNotificationClick={(n) => { setNotifOpen(false); setActionNotif(n); }}
      />
      {actionNotif && (
        <TripActionModal
          notif={actionNotif}
          onClose={() => setActionNotif(null)}
          onAction={(a, d) => handleTripAction(actionNotif, a, d)}
        />
      )}

        {/* Welcome */}
        <div className="mb-8" style={{ animation: "fadeUp .6s ease both" }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-body text-muted-foreground text-sm">Welcome back,</span>
            <span className="text-border text-xs">·</span>
            <span className="font-body text-muted-foreground/60 text-xs">नमस्ते</span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground">
            <Link href="/profile" className="hover:opacity-80 transition-opacity">
              <em className="shimmer-text not-italic">{user.name?.split(" ")[0]}</em>
            </Link>
          </h1>
          {user.homeLocation && (
            <div className="flex items-center gap-1.5 mt-2">
              <MapPin size={13} className="text-accent" />
              <span className="font-body text-sm text-muted-foreground">{user.homeLocation.district}, {user.homeLocation.province}</span>
            </div>
          )}
        </div>

        {/* Location Status / Picker */}
        <div className="mb-6 relative" style={{ animation: "fadeUp .6s .05s ease both" }}>
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
                <Navigation size={18} className={userLocation ? "text-primary" : "text-muted-foreground"} />
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

            <div className="location-card__actions">
              <div className="location-card__secondary-actions">
                <button
                  onClick={requestUserLocation}
                  disabled={locating}
                  className="location-card__button"
                >
                  {locating ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                  {locating ? "Locating..." : "Auto-Detect"}
                </button>
                <button
                  onClick={() => setPickingLocation(true)}
                  className="location-card__button"
                >
                  <Search size={12} />
                  Set Manually
                </button>
              </div>
              <LocationShareButton className="location-card__share" />
            </div>
          </div>
        </div>

        {/* Stats — each card filters on click */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-2" style={{ animation: "fadeUp .6s .1s ease both" }}>
          {[
            { label: "Total",     value: stats.total,    color: "text-foreground",    dot: "bg-muted-foreground", f: "ALL"       },
            { label: "Safe",      value: stats.safe,     color: "text-emerald-500",   dot: "bg-emerald-500",     f: "SAFE"      },
            { label: "Caution",   value: stats.caution,  color: "text-accent",        dot: "bg-saffron",          f: "CAUTION"   },
            { label: "High Risk", value: stats.highRisk, color: "text-orange-500",    dot: "bg-orange-500",       f: "HIGH_RISK" },
            { label: "Extreme",   value: stats.extreme,  color: "text-destructive",   dot: "bg-destructive",      f: "EXTREME"   },
          ].map((s) => (
            <button key={s.label} onClick={() => setFilter(s.f as typeof filter)}
              className={`stat-card px-4 py-4 text-left transition-all hover:border-accent/20 ${filter === s.f ? "border-accent/40 bg-accent/5" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                <span className="font-body text-xs text-muted-foreground uppercase tracking-widest">{s.label}</span>
              </div>
              <div className={`font-display text-2xl font-bold ${s.color}`}>{s.value}</div>
            </button>
          ))}
        </div>
        {destinationSummary && (
          <>
            {destinationSummary.topUnverified.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm text-accent">⚠️</span>
                  <h3 className="font-display text-base font-semibold text-foreground">Unverified destinations</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {destinationSummary.topUnverified.map((dest) => (
                    <div key={dest.id} className="stat-card p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <p className="font-semibold text-foreground truncate">{dest.name}</p>
                          <p className="font-body text-xs text-muted-foreground">{dest.district}, {dest.province}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">{dest.category}</span>
                      </div>
                      <p className="font-body text-xs text-muted-foreground">Quality: {dest.dataQualityScore != null ? `${Math.round(dest.dataQualityScore)} / 100` : "Unknown"}</p>
                      <p className="font-body text-xs text-muted-foreground mt-1">Route accessible: {dest.routeAccessible ? "Yes" : "No"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Last updated indicator */}
        <div className="flex items-center justify-between mb-6">
          <p className="font-body text-xs text-slate-700">
            {assessStatus?.hoursAgo != null
              ? assessStatus.isStale
                ? `⟳ Refreshing safety data… (last updated ${Math.round(assessStatus.hoursAgo)}h ago)`
                : `Safety data updated ${assessStatus.hoursAgo < 1 ? "< 1h" : `${Math.round(assessStatus.hoursAgo)}h`} ago`
              : ""}
          </p>
          {assessStatus?.isStale && (
            <span className="font-body text-xs text-amber-400/60 animate-pulse">Updating in background…</span>
          )}
        </div>
        {(locationError || originResolveError) && (
          <p className="mb-4 font-body text-xs text-amber-400/90">{locationError || originResolveError}</p>
        )}
        {resolvedOrigin?.note && (
          <p className="mb-4 font-body text-xs text-sky-300/90">{resolvedOrigin.note}</p>
        )}

        {/* AI-powered recommendations carousel */}
        {(filter === "ALL" || filter === "RECOMMENDED") && stats.total > 0 && data?.recommendations && (
          <RecommendationsCarousel
            recommendations={data.recommendations.recommendations}
            summary={data.recommendations.summary}
            aiUsed={data.recommendations.aiUsed}
            savedIds={savedIds}
          />
        )}

        {/* Algorithmic recommendations fallback — top 3 personalized picks */}
        {(filter === "ALL" || filter === "RECOMMENDED") && stats.total > 0 && !data?.recommendations && recommended.length > 0 && (
          <div className="mb-8" style={{ animation: "fadeUp .6s .15s ease both" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏔️</span>
                <h2 className="font-display text-lg font-bold text-foreground">Recommended for you</h2>
              </div>
              <div className="flex-1 h-px bg-border" />
              <span className="font-body text-xs text-muted-foreground">Based on your profile + current conditions</span>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {recommended.map((dest, i) => (
                <DestinationCard
                  key={dest.id}
                  dest={dest}
                  index={i}
                  homeProvince={user.homeLocation?.province ?? null}
                  highlighted
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
                  shouldFetchRoute
                  savedDestinationIds={savedIds}
                />
              ))}
            </div>
          </div>
        )}

        {/* Search + unified filter dropdown */}
        <div className="flex flex-col md:flex-row gap-3 mb-4" style={{ animation: "fadeUp .6s .2s ease both" }}>
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Search destinations, districts, provinces…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="search-input w-full pl-9 pr-9 py-2.5 text-sm rounded-xl" />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"><X size={14} /></button>}
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2.5 text-sm rounded-xl bg-muted border border-border text-foreground font-body focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-all"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-foreground">
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowMap(!showMap)}
            className={`flex items-center gap-2 px-3 py-2.5 text-sm rounded-xl border font-body transition-all ${
              showMap
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-muted border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
            title={showMap ? "Grid view" : "Map view"}
          >
            {showMap ? <LayoutGrid size={15} /> : <Map size={15} />}
            {showMap ? "Grid" : "Map"}
          </button>
        </div>

        {/* Count row + OSM fetch */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-body text-xs text-muted-foreground">
            {stats.total === 0 ? "No safety data yet — check back soon"
              : sortedAndRanked.length === 0 ? "No destinations match"
              : `Showing ${totalCardsShown} of ${sortedAndRanked.length} destinations`}
          </p>
          <div className="flex items-center gap-3">
            {data?.user?.role === "ADMIN" && (
              <>
                {osmFetchResult && (
                  <span className="font-body text-xs text-accent">{osmFetchResult}</span>
                )}
                <button
                  onClick={handleFetchFromOsm}
                  disabled={fetchingOsm}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-all bg-muted hover:bg-muted/80 text-muted-foreground border border-border disabled:opacity-50"
                >
                  {fetchingOsm ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  {fetchingOsm ? "Fetching..." : "Fetch from OSM"}
                </button>
              </>
            )}
            {filter !== "ALL" && (
              <button onClick={() => setFilter("ALL")} className="font-body text-xs text-accent hover:text-accent/80 transition-colors">Clear filter ×</button>
            )}
          </div>
        </div>

        {/* Empty states */}
        {stats.total === 0 && (
          <div className="text-center py-20 destination-card max-w-md mx-auto">
            <Mountain size={40} className="text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="font-display text-xl text-muted-foreground mb-2">No safety data yet</h3>
            <p className="font-body text-muted-foreground text-sm mb-5 px-4">Destinations are being scored. Check back soon or trigger a refresh from the admin panel.</p>
          </div>
        )}
        {stats.total > 0 && sortedAndRanked.length === 0 && (
          <div className="text-center py-16">
            <Search size={32} className="text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-body text-muted-foreground">No destinations match your search.</p>
          </div>
        )}

        {/* Filter heading */}
          {filter !== "ALL" && dashboardCards.length > 0 && (
          <h2 className="font-display text-base font-bold text-foreground mb-4">
            {filter === "RECOMMENDED" && "🏔️ Recommended for you"}
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

        {/* Destinations grid (limited to 6 on dashboard) */}
        {!showMap && dashboardCards.length > 0 && (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dashboardCards.map((dest, i) => (
                <DestinationCard
                  key={dest.id}
                  dest={dest}
                  index={i}
                  homeProvince={user.homeLocation?.province ?? null}
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
            {sortedAndRanked.length > DASHBOARD_CARD_LIMIT && (
              <div className="flex justify-center mt-6">
                <Link
                  href="/explore"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-muted/60 text-sm text-muted-foreground hover:text-foreground hover:border-accent/30 hover:bg-accent/5 transition-all font-body font-medium"
                >
                  Show all {sortedAndRanked.length} destinations <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </>
        )}

      <div className="fixed bottom-24 right-6 z-50">
        <ReportHazardButton fab />
      </div>
      <div className="absolute bottom-0 inset-x-0 h-20 mountain-divider opacity-5 pointer-events-none z-0" />
    </AppShell>
  );
}
