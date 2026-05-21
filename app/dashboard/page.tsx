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

import { useState, useEffect }  from "react";
import { useRouter }            from "next/navigation";
import Link                     from "next/link";
import Image                    from "next/image";
import {
  Mountain, XCircle, RefreshCw,
  Search, X, User, Bell, Users, MapPin,
  ChevronLeft, ChevronRight, Navigation, Loader2, Download
} from "lucide-react";
import { Button }          from "@/components/ui/button";
import { authClient }      from "@/lib/auth-client";
import { useRealtime }     from "@/lib/hooks/useRealtime";

import { DashboardData, Destination, DestinationSummary, UserProfile, HazardNotif } from "./_components/types";
import { NotificationPanel } from "./_components/NotificationPanel";
import { FriendsSidebar }    from "./_components/FriendsSidebar";
import { DestinationCard }   from "./_components/DestinationCard";
import { ProfileDrawer }     from "./_components/ProfileDrawer";
import { LocationPicker }    from "./_components/LocationPicker";
import { AppShell }            from "@/components/app-shell";
import { useResolvedOrigin } from "@/lib/hooks/use-resolved-origin";

const PAGE_SIZE = 12;

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen]     = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
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
  const [visibleRouteCards, setVisibleRouteCards] = useState(5);
  const FILTER_OPTIONS = [
    { value: "ALL", label: "All Destinations" },
    { value: "RECOMMENDED", label: "Recommended for You" },
    { value: "SAFE", label: "Safe" },
    { value: "CAUTION", label: "Caution" },
    { value: "HIGH_RISK", label: "High Risk & Extreme" },
    { value: "NEARBY", label: "Nearby" },
  ];
  const [fetchingOsm, setFetchingOsm] = useState(false);
  const [osmFetchResult, setOsmFetchResult] = useState<string | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
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
      let watchId: number | null = null;

      const stopWatching = () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        setLocating(false);
      };

      const resolveAndSave = async (latitude: number, longitude: number, accuracy: number) => {
        const resolved = await resolveFromGps(latitude, longitude, accuracy);
        if (resolved) {
          fetch("/api/user/location", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ placeName: resolved.name, lat: latitude, lon: longitude, accuracy }),
          }).catch(() => {});
        }
      };

      const timeoutId = setTimeout(() => {
        stopWatching();
        if (bestPos) {
          const { latitude, longitude, accuracy } = bestPos.coords;
          if (accuracy > 300) {
             setLocationError(`Could not get accurate location (best: ${Math.round(accuracy)}m). Using approximate coordinates.`);
          }
          void resolveAndSave(latitude, longitude, accuracy);
        } else {
          setLocationError("Location request timed out. Please ensure GPS is enabled and try again.");
        }
      }, 12000);

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
            bestPos = pos;
          }
          // If accuracy is good enough (< 40m), stop early
          if (pos.coords.accuracy < 40) {
            clearTimeout(timeoutId);
            stopWatching();
            void resolveAndSave(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          }
        },
        (err) => {
          // If we already have a best position, we ignore errors and wait for timeout
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

  // Watch permission changes; auto-refresh once location access becomes granted.
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
          window.location.reload();
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

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => { fetchDashboard(); checkAndRefreshData(); fetchDestinationSummary(); }, []);
  useEffect(() => {
    void loadSavedHome();
  }, [loadSavedHome]);
  useEffect(() => {
    fetchNotifications();
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
      const res  = await fetch("/api/dashboard", { credentials: "include" });
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
      n.type === "FLOOD" ||
      n.type === "LANDSLIDE" ||
      n.type === "EARTHQUAKE" ||
      n.type === "STORM" ||
      (n.severity === "CRITICAL" && n.type !== "FIRE")
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
  async function handleLogout() {
    setLoggingOut(true);
    await authClient.signOut();
    router.push("/sign-in");
  }

  // ── Filter + paginate + rank ────────────────────────────────────────────────────────

  // Distance helper
  function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Priority Ranking Algorithm — safe > nearby > personalized
  function calculateScore(dest: Destination, userProf: UserProfile | null): number {
    let score = 0;
    const pref = userProf?.preference;
    const health = userProf?.health;
    if (!pref) return dest.safetyScore;

    // 1. SAFETY DOMINATES — safe destinations always recommended first
    if (dest.safetyLevel === "SAFE") score += 150;
    else if (dest.safetyLevel === "CAUTION") score += 80;
    else if (dest.safetyLevel === "HIGH_RISK") score -= 100;
    else score -= 500;

    // Risk tolerance check
    if (pref.riskTolerance === "LOW" && (dest.safetyLevel === "HIGH_RISK" || dest.safetyLevel === "EXTREME")) return -9999;
    if (pref.riskTolerance === "MEDIUM" && dest.safetyLevel === "EXTREME") return -9999;

    // 2. PROXIMITY — nearby destinations get major boost
    if (pref.locationLat && pref.locationLng && dest.latitude && dest.longitude) {
      const dist = getDistanceFromLatLonInKm(pref.locationLat, pref.locationLng, dest.latitude, dest.longitude);
      if (pref.maxDistanceKm && dist > pref.maxDistanceKm) {
        score -= 150;
      } else {
        score += Math.max(0, 80 - dist);
      }
    }

    // Same province = nearby boost
    if (userProf?.homeLocation?.province && dest.province === userProf.homeLocation.province) {
      score += 50;
    }

    // 3. PERSONALIZATION — interests, travel style, behavior
    const destStr = (dest.name + " " + dest.district + " " + dest.province + " " + dest.reasoning.join(" ")).toLowerCase();
    
    let interestMatches = 0;
    pref.interests?.forEach((interest: string) => {
      if (destStr.includes(interest.toLowerCase())) interestMatches++;
    });
    score += (interestMatches * 20);

    let styleMatches = 0;
    pref.travelStyle?.forEach((style: string) => {
      if (destStr.includes(style.toLowerCase())) styleMatches++;
    });
    score += (styleMatches * 15);

    // 4. HEALTH-BASED ADJUSTMENTS
    if (health) {
      if (health.chronicConditions?.includes("asthma")) {
        if (dest.altitude && dest.altitude > 2500) score -= 60;
      }
      if (health.chronicConditions?.includes("heart") || health.chronicConditions?.includes("hypertension")) {
        if (dest.altitude && dest.altitude > 2000) score -= 50;
      }
      if (health.fitnessLevel === "LOW") {
        if (dest.altitude && dest.altitude > 1500) score -= 40;
        if (dest.safetyLevel === "EXTREME") score -= 200;
      }
      if (health.mobilityLimited) {
        if (dest.altitude && dest.altitude > 1000) score -= 60;
        if (!dest.routeAccessible) score -= 80;
      }
      if (health.chronicConditions?.includes("diabetes")) {
        if (dest.altitude && dest.altitude > 3000) score -= 40;
      }
    }

    // 5. Behavior Adjustments
    const behavior = userProf?.behavior?.metrics || {};
    const destClicks = behavior.destinations?.[dest.id] || 0;
    score += (destClicks * 5);

    if (behavior.categories) {
      Object.entries(behavior.categories).forEach(([cat, clicks]) => {
        if (destStr.includes(cat.toLowerCase())) {
          score += (Number(clicks) * 2);
        }
      });
    }

    return score;
  }

  // Merge live SSE score updates into base dashboard data
  const all      = mergeLiveScores(data?.destinations ?? []) as Destination[];

  const filtered = all.filter((d) => {
    const q = search.toLowerCase();
    if (!d.name.toLowerCase().includes(q) && !d.district.toLowerCase().includes(q) && !d.province.toLowerCase().includes(q)) return false;
    if (filter === "ALL" || filter === "RECOMMENDED") return true;
    if (filter === "SAFE") return d.safetyLevel === "SAFE";
    if (filter === "CAUTION") return d.safetyLevel === "CAUTION";
    if (filter === "HIGH_RISK") return d.safetyLevel === "HIGH_RISK" || d.safetyLevel === "EXTREME";
    if (filter === "NEARBY") {
      if (!userData?.homeLocation?.province) return false;
      return d.province === userData.homeLocation.province;
    }
    return true;
  });

  // Sort by personalized priority score instead of just safety
  const sortedAndRanked = [...filtered].sort((a, b) => calculateScore(b, userData) - calculateScore(a, userData));

  const totalPages = Math.ceil(sortedAndRanked.length / PAGE_SIZE);
  const paginated  = sortedAndRanked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Recompute stats from live-merged data
  const stats      = {
    total:    all.length,
    safe:     all.filter((d) => d.safetyLevel === "SAFE").length,
    caution:  all.filter((d) => d.safetyLevel === "CAUTION").length,
    highRisk: all.filter((d) => d.safetyLevel === "HIGH_RISK").length,
    extreme:  all.filter((d) => d.safetyLevel === "EXTREME").length,
  };
  
  // Recommendations are the top 3 ranked from the algorithm (already sorted)
  const recommended = sortedAndRanked.slice(0, 3);

  // ── Loading / Error ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="yatra-page flex items-center justify-center min-h-screen">
      <div className="text-center">
        <Mountain className="text-amber-400 mx-auto mb-4 animate-pulse" size={40} />
        <p className="font-body text-slate-400 text-sm">Loading your dashboard…</p>
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

  const navActions = (
    <>
      <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border shrink-0 ${connected ? "bg-emerald-400/10 border-emerald-400/20" : "bg-slate-700/30 border-slate-600/30"}`}>
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
      <Link href="/plan" className="hidden md:inline-flex yatra-cta">
        <Mountain size={14} />
        Plan a Trip
      </Link>
      {user.role === "ADMIN" && (
        <Link href="/admin" className="hidden md:inline-flex yatra-cta-ghost">
          Admin Panel
        </Link>
      )}
      <Link href="/trips" className="hidden md:inline-flex yatra-cta-ghost">
        <Users size={14} />
        Your Plans
      </Link>
      <button type="button" className="icon-btn" onClick={() => setFriendsOpen(true)} title="Travel network">
        <Users size={16} className="text-slate-400" />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => { setNotifOpen((v) => !v); setProfileOpen(false); }}
        title="Hazard alerts"
      >
        <Bell size={16} className={unreadCount > 0 ? "text-amber-400" : "text-slate-400"} />
        {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      <button type="button" className="user-btn" onClick={() => { setProfileOpen(true); setNotifOpen(false); }}>
        {userImage ? (
          <Image src={userImage} alt={user.name} width={28} height={28} className="w-7 h-7 rounded-full object-cover border border-slate-600" unoptimized={userImage.startsWith("data:")} />
        ) : (
          <div className="w-7 h-7 rounded-full bg-amber-400/20 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
            <span className="text-amber-400 text-xs font-bold font-display">{user.name?.[0]?.toUpperCase()}</span>
          </div>
        )}
        <span className="font-body text-sm text-slate-300 max-w-[100px] truncate hidden sm:block">{user.name}</span>
        <User size={13} className="text-slate-500 hidden sm:block" />
      </button>
    </>
  );

  return (
    <AppShell active="dashboard" actions={navActions}>
      {/* Overlays */}
      <FriendsSidebar open={friendsOpen} onClose={() => setFriendsOpen(false)} />
      <ProfileDrawer
        user={user}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onLogout={handleLogout}
        loggingOut={loggingOut}
        onAvatarUploaded={(url) => setUserImage(url)}
        onProfileUpdated={(patch) => setUserData((prev) => ({ ...(prev ?? rawUser), ...patch }))}
      />
      <NotificationPanel
        open={notifOpen} onClose={() => setNotifOpen(false)}
        notifications={notifications} onMarkRead={markRead} onMarkAllRead={markAllRead}
      />

        {/* Welcome */}
        <div className="mb-8" style={{ animation: "fadeUp .6s ease both" }}>
          <p className="font-body text-slate-500 text-sm mb-1">Welcome back,</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white">
            <button onClick={() => setProfileOpen(true)} className="hover:opacity-80 transition-opacity">
              <em className="shimmer-text not-italic">{user.name?.split(" ")[0]}</em>
            </button>
          </h1>
          {user.homeLocation && (
            <div className="flex items-center gap-1.5 mt-2">
              <MapPin size={13} className="text-amber-400" />
              <span className="font-body text-sm text-slate-400">{user.homeLocation.district}, {user.homeLocation.province} Province</span>
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

          <div className="stat-card p-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${userLocation ? "bg-amber-500/10" : "bg-slate-800"}`}>
                <Navigation size={18} className={userLocation ? "text-amber-400" : "text-slate-500"} />
              </div>
              <div>
                <p className="font-body text-[10px] text-slate-500 uppercase tracking-widest font-bold">Current Origin</p>
                <div className="flex items-center gap-2">
                  <p className="font-display font-bold text-white">
                    {manualLocationName || (userLocation ? "Detected Location" : "Not Set")}
                  </p>
                  {(resolvingOrigin || locating) && (
                    <span className="text-[10px] bg-slate-800 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20">Resolving…</span>
                  )}
                  {userLocation && !resolvingOrigin && (
                    <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-white/5">
                      {resolvedOrigin?.routeNodeName ? `Hub: ${resolvedOrigin.routeNodeName}` : "Snapped"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={requestUserLocation}
                disabled={locating}
                className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-all text-xs font-body font-medium flex items-center gap-1.5"
              >
                {locating ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                {locating ? "Locating..." : "Auto-Detect"}
              </button>
              <button
                onClick={() => setPickingLocation(true)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-all text-xs font-body font-medium flex items-center gap-1.5 border border-white/5"
              >
                <Search size={12} />
                Set Manually
              </button>
            </div>
          </div>
        </div>

        {/* Stats — each card filters on click */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-2" style={{ animation: "fadeUp .6s .1s ease both" }}>
          {[
            { label: "Total",     value: stats.total,    color: "text-slate-300",   dot: "bg-slate-500",   f: "ALL"       },
            { label: "Safe",      value: stats.safe,     color: "text-emerald-400", dot: "bg-emerald-400", f: "SAFE"      },
            { label: "Caution",   value: stats.caution,  color: "text-amber-400",   dot: "bg-amber-400",   f: "CAUTION"   },
            { label: "High Risk", value: stats.highRisk, color: "text-orange-400",  dot: "bg-orange-400",  f: "HIGH_RISK" },
            { label: "Extreme",   value: stats.extreme,  color: "text-red-400",     dot: "bg-red-400",     f: "EXTREME"   },
          ].map((s) => (
            <button key={s.label} onClick={() => setFilter(s.f as typeof filter)}
              className={`stat-card px-4 py-4 text-left transition-all hover:border-amber-400/20 ${filter === s.f ? "border-amber-400/40 bg-amber-400/5" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                <span className="font-body text-xs text-slate-500 uppercase tracking-widest">{s.label}</span>
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
                  <span className="text-sm text-amber-300">⚠️</span>
                  <h3 className="font-display text-base font-semibold text-white">Unverified destinations</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {destinationSummary.topUnverified.map((dest) => (
                    <div key={dest.id} className="stat-card p-4 border border-slate-700/50 bg-slate-900/70">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <p className="font-semibold text-white truncate">{dest.name}</p>
                          <p className="font-body text-xs text-slate-500">{dest.district}, {dest.province}</p>
                        </div>
                        <span className="text-xs text-slate-400">{dest.category}</span>
                      </div>
                      <p className="font-body text-xs text-slate-400">Quality: {dest.dataQualityScore != null ? `${Math.round(dest.dataQualityScore)} / 100` : "Unknown"}</p>
                      <p className="font-body text-xs text-slate-400 mt-1">Route accessible: {dest.routeAccessible ? "Yes" : "No"}</p>
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

        {/* Recommended — top 3 personalized picks, shown on All & Recommended views */}
        {(filter === "ALL" || filter === "RECOMMENDED") && stats.total > 0 && recommended.length > 0 && (
          <div className="mb-8" style={{ animation: "fadeUp .6s .15s ease both" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">✨</span>
                <h2 className="font-display text-lg font-bold text-white">Recommended for you</h2>
              </div>
              <div className="flex-1 h-px bg-slate-800" />
              <span className="font-body text-xs text-slate-500">Based on your profile + current conditions</span>
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
            className="px-3 py-2.5 text-sm rounded-xl bg-slate-800/80 border border-slate-700/50 text-white font-body focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/10 transition-all"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-slate-800 text-white">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Count row + OSM fetch */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-body text-xs text-slate-600">
            {stats.total === 0 ? "Run POST /api/assess to populate safety scores"
              : sortedAndRanked.length === 0 ? "No destinations match"
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sortedAndRanked.length)} of ${sortedAndRanked.length}`}
          </p>
          <div className="flex items-center gap-3">
            {osmFetchResult && (
              <span className="font-body text-xs text-sky-300">{osmFetchResult}</span>
            )}
            <button
              onClick={handleFetchFromOsm}
              disabled={fetchingOsm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-all bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-50"
            >
              {fetchingOsm ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {fetchingOsm ? "Fetching..." : "Fetch from OSM"}
            </button>
            {filter !== "ALL" && (
              <button onClick={() => setFilter("ALL")} className="font-body text-xs text-amber-400 hover:text-amber-300 transition-colors">Clear filter ×</button>
            )}
          </div>
        </div>

        {/* Empty states */}
        {stats.total === 0 && (
          <div className="text-center py-20 destination-card max-w-md mx-auto">
            <Mountain size={40} className="text-slate-700 mx-auto mb-4" />
            <h3 className="font-display text-xl text-slate-400 mb-2">No safety data yet</h3>
            <p className="font-body text-slate-500 text-sm mb-5 px-4">Run the assess job to score all 261 destinations.</p>
            <code className="block font-mono text-xs bg-slate-800 text-amber-400 px-3 py-2 rounded-lg mx-6">POST /api/assess</code>
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
          </h2>
        )}

        {/* Destinations grid (paginated) */}
        {paginated.length > 0 && (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginated.map((dest, i) => (
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
                />
              ))}
            </div>
            <Pagination
              current={page}
              total={totalPages}
              onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            />
          </>
        )}

      <div className="absolute bottom-0 inset-x-0 h-20 mountain-wave bg-gradient-to-b from-slate-800/10 to-slate-900/30 pointer-events-none z-0" />
    </AppShell>
  );
}
