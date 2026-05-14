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
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button }          from "@/components/ui/button";
import { authClient }      from "@/lib/auth-client";
import { useRealtime }     from "@/lib/hooks/useRealtime";

import { DashboardData, Destination, UserProfile, HazardNotif } from "./_components/types";
import { NotificationPanel } from "./_components/NotificationPanel";
import { FriendsSidebar }    from "./_components/FriendsSidebar";
import { DestinationCard }   from "./_components/DestinationCard";
import { ProfileDrawer }     from "./_components/ProfileDrawer";

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
  const USER_LOCATION_CACHE_KEY = "yatraai:last-origin";

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
  const [filter, setFilter]           = useState<"ALL" | Destination["safetyLevel"]>("ALL");
  const [notifications, setNotifs]    = useState<HazardNotif[]>([]);
  const [userImage, setUserImage]     = useState<string | null>(null);
  const [userData, setUserData]       = useState<UserProfile | null>(null);
  const [page, setPage]               = useState(1);
  const [assessStatus, setAssessStatus] = useState<{ hoursAgo: number | null; isStale: boolean } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [visibleRouteCards, setVisibleRouteCards] = useState(5);

  function requestUserLocation() {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }

    const executeGeoRequest = () => {
      setLocating(true);
      setLocationError(null);
      let finished = false;
      const forceTimeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        setLocating(false);
        setLocationError("Location request timed out. Check browser location settings for this site and try again.");
      }, 10000);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (finished) return;
          finished = true;
          clearTimeout(forceTimeout);
          const nextLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setUserLocation(nextLoc);
          try {
            localStorage.setItem(USER_LOCATION_CACHE_KEY, JSON.stringify(nextLoc));
          } catch {
            // ignore storage failures
          }
          setLocating(false);
        },
        (err) => {
          if (finished) return;
          finished = true;
          clearTimeout(forceTimeout);
          setLocating(false);
          if (err.code === 1) {
            setLocationError("Location permission denied. Open browser site settings for localhost:3000, allow Location, then tap Enable again.");
            return;
          }
          if (err.code === 2) {
            setLocationError("Location unavailable right now. Please try again.");
            return;
          }
          setLocationError("Could not fetch location. Please try again.");
        },
        {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000,
        }
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

  // Reuse cached location to avoid repeated permission prompts on page reload.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(USER_LOCATION_CACHE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached) as { lat?: number; lon?: number };
      if (Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lon)) {
        setUserLocation({ lat: parsed.lat as number, lon: parsed.lon as number });
      }
    } catch {
      // ignore cache parse failures
    }
  }, []);

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

  useEffect(() => { fetchDashboard(); checkAndRefreshData(); }, []);
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
      setData(json);
      setUserImage(json.user.image);
      setUserData(json.user);
    } catch (err) {
      setError(`Failed to load: ${String(err)}`);
    } finally {
      setLoading(false);
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

  // Priority Ranking Algorithm
  function calculateScore(dest: Destination, userProf: UserProfile | null): number {
    let score = 0;
    const pref = userProf?.preference;
    if (!pref) return dest.safetyScore; // Fallback to raw safety score

    // 1. Safety Dominates
    if (pref.riskTolerance === "LOW" && (dest.safetyLevel === "HIGH_RISK" || dest.safetyLevel === "EXTREME")) {
      return -9999; // Heavily penalize to push to bottom
    }
    if (pref.riskTolerance === "MEDIUM" && dest.safetyLevel === "EXTREME") {
      return -9999;
    }
    
    // Base safety points
    if (dest.safetyLevel === "SAFE") score += 50;
    else if (dest.safetyLevel === "CAUTION") score += 20;
    else if (dest.safetyLevel === "HIGH_RISK") score -= 30;

    // 2. Distance / Proximity
    if (pref.locationLat && pref.locationLng && dest.latitude && dest.longitude) {
      const dist = getDistanceFromLatLonInKm(pref.locationLat, pref.locationLng, dest.latitude, dest.longitude);
      if (pref.maxDistanceKm && dist > pref.maxDistanceKm) {
        score -= 50; // penalty for being too far based on constraint
      } else {
        // Closer is better (max +30 points)
        score += Math.max(0, 30 - (dist / 20)); 
      }
    }

    // 3. Match Interests & Travel Style (Simulated by checking name/district/reasoning)
    const destStr = (dest.name + " " + dest.district + " " + dest.reasoning.join(" ")).toLowerCase();
    
    let interestMatches = 0;
    pref.interests?.forEach((interest: string) => {
      if (destStr.includes(interest.toLowerCase())) interestMatches++;
    });
    score += (interestMatches * 15);

    let styleMatches = 0;
    pref.travelStyle?.forEach((style: string) => {
      if (destStr.includes(style.toLowerCase())) styleMatches++;
    });
    score += (styleMatches * 10);

    // 4. Behavior Adjustments
    const behavior = userProf?.behavior?.metrics || {};
    const destClicks = behavior.destinations?.[dest.id] || 0;
    score += (destClicks * 5); // Direct destination clicks give strong boost

    if (behavior.categories) {
      Object.entries(behavior.categories).forEach(([cat, clicks]) => {
        if (destStr.includes(cat.toLowerCase())) {
          score += (Number(clicks) * 2); // Category interest boost
        }
      });
    }

    return score;
  }

  // Merge live SSE score updates into base dashboard data
  const all      = mergeLiveScores(data?.destinations ?? []) as Destination[];

  const filtered = all.filter((d) => {
    const q = search.toLowerCase();
    return (d.name.toLowerCase().includes(q) || d.district.toLowerCase().includes(q) || d.province.toLowerCase().includes(q))
      && (filter === "ALL" || d.safetyLevel === filter);
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
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1e" }}>
      <div className="text-center">
        <Mountain className="text-amber-400 mx-auto mb-4 animate-pulse" size={40} />
        <p className="font-body text-slate-400 text-sm">Loading your dashboard…</p>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1e" }}>
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

  return (
    <div className="min-h-screen" style={{ background: "#0a0f1e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}
        .font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .shimmer-text{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b,#fbbf24);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite}
        .glow-dot{position:fixed;border-radius:9999px;filter:blur(100px);pointer-events:none;z-index:0}
        .nav-blur{background:rgba(10,15,30,.92);border-bottom:1px solid rgba(255,255,255,.06);backdrop-filter:blur(20px)}
        .drawer-panel{background:rgba(10,15,30,.97);border-left:1px solid rgba(255,255,255,.08);backdrop-filter:blur(24px)}
        .friends-panel{background:rgba(10,15,30,.97);border-right:1px solid rgba(255,255,255,.08);backdrop-filter:blur(24px)}
        .notif-panel{background:rgba(10,15,30,.97);border:1px solid rgba(255,255,255,.08);border-radius:16px;backdrop-filter:blur(24px);box-shadow:0 24px 64px rgba(0,0,0,.7)}
        .dest-card{background:rgba(15,23,42,.7);border:1px solid rgba(255,255,255,.07);border-radius:16px;transition:border-color .2s,transform .2s,box-shadow .2s;backdrop-filter:blur(12px)}
        .dest-card:hover{border-color:rgba(245,158,11,.25);transform:translateY(-2px);box-shadow:0 16px 40px rgba(0,0,0,.4)}
        .stat-card{background:rgba(15,23,42,.7);border:1px solid rgba(255,255,255,.06);border-radius:14px;backdrop-filter:blur(12px)}
        .friend-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);transition:border-color .2s,background .2s}
        .friend-card:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1)}
        .filter-pill{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:9999px;cursor:pointer;transition:all .2s;font-family:'DM Sans',system-ui,sans-serif}
        .filter-pill:hover{border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.05)}
        .filter-pill.active{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.4);color:#f59e0b}
        .search-input{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:white;font-family:'DM Sans',system-ui,sans-serif;transition:border-color .2s,box-shadow .2s}
        .search-input:focus{border-color:rgba(245,158,11,.4);box-shadow:0 0 0 3px rgba(245,158,11,.08);outline:none}
        .search-input::placeholder{color:rgba(255,255,255,.25)}
        .icon-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);cursor:pointer;transition:all .2s;position:relative;flex-shrink:0}
        .icon-btn:hover{border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.06)}
        .icon-btn .badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 3px;border-radius:99px;background:#ef4444;color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',system-ui,sans-serif;border:2px solid #0a0f1e}
        .user-btn{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 6px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);cursor:pointer;transition:all .2s}
        .user-btn:hover{border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.06)}
        .drawer-input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:white;font-family:'DM Sans',system-ui,sans-serif;transition:border-color .2s,box-shadow .2s}
        .drawer-input:focus{border-color:rgba(245,158,11,.5);box-shadow:0 0 0 3px rgba(245,158,11,.08);outline:none}
        .drawer-input::placeholder{color:rgba(255,255,255,.2)}
        .drawer-input option{background:#0f1729;color:white}
        .toggle-track{position:relative;width:36px;height:20px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);border-radius:10px;transition:background .2s,border-color .2s;cursor:pointer;flex-shrink:0}
        .toggle-track.on{background:rgba(245,158,11,.25);border-color:rgba(245,158,11,.4)}
        .toggle-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,.35);transition:transform .2s,background .2s}
        .toggle-track.on .toggle-knob{transform:translateX(16px);background:#f59e0b}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s,transform .15s}
        .amber-btn:hover:not(:disabled){background:#fbbf24;box-shadow:0 0 24px rgba(245,158,11,.35);transform:translateY(-1px)}
        .mountain-wave{clip-path:polygon(0 40%,10% 25%,22% 38%,35% 10%,48% 30%,60% 5%,72% 22%,85% 12%,95% 28%,100% 18%,100% 100%,0 100%)}
      `}</style>

      <div className="glow-dot w-[500px] h-[400px] bg-amber-500/8 -top-32 -left-32" />
      <div className="glow-dot w-[400px] h-[300px] bg-sky-500/6 bottom-0 right-0" />

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

      {/* Navbar */}
      <nav className="nav-blur fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 md:px-8 h-16">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Mountain className="text-amber-400" size={22} />
          <span className="font-display font-bold text-lg text-white tracking-tight">YatraAI</span>
        </Link>
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

        {/* Plan a Trip — primary CTA */}
        <Link href="/plan"
          className="hidden md:flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm transition-all hover:shadow-lg hover:shadow-amber-500/20">
          <Mountain size={14} />
          Plan a Trip
        </Link>

        {/* Your Plans */}
        <Link href="/trips"
          className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 font-body text-sm transition-all">
          <Users size={14} />
          Your Plans
        </Link>
        <div className="flex items-center gap-2">
          <button className="icon-btn" onClick={() => setFriendsOpen(true)} title="Travel network"><Users size={16} className="text-slate-400" /></button>
          <button className="icon-btn" onClick={() => { setNotifOpen((v) => !v); setProfileOpen(false); }} title="Hazard alerts">
            <Bell size={16} className={unreadCount > 0 ? "text-amber-400" : "text-slate-400"} />
            {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </button>
          <button className="user-btn" onClick={() => { setProfileOpen(true); setNotifOpen(false); }}>
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
        </div>
      </nav>

      {/* Main content */}
      <div className="pt-16 max-w-7xl mx-auto px-4 md:px-8 py-8 relative z-10">

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
        {locationError && (
          <p className="mb-4 font-body text-xs text-amber-400/90">{locationError}</p>
        )}

        {/* Recommended — top 3 safe/caution, shown only on "All" view */}
        {filter === "ALL" && stats.total > 0 && recommended.length > 0 && (
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
                  onRequestLocation={requestUserLocation}
                  requestingLocation={locating}
                  shouldFetchRoute
                />
              ))}
            </div>
          </div>
        )}

        {/* Search + filter bar */}
        <div className="flex flex-col md:flex-row gap-3 mb-4" style={{ animation: "fadeUp .6s .2s ease both" }}>
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Search destinations, districts, provinces…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="search-input w-full pl-9 pr-9 py-2.5 text-sm rounded-xl" />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"><X size={14} /></button>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(["ALL","SAFE","CAUTION","HIGH_RISK","EXTREME"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`filter-pill px-3 py-1.5 text-xs font-medium text-slate-400 ${filter === f ? "active" : ""}`}>
                {f === "ALL" ? "All" : f === "HIGH_RISK" ? "High Risk" : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Count row */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-body text-xs text-slate-600">
            {stats.total === 0 ? "Run POST /api/assess to populate safety scores"
              : sortedAndRanked.length === 0 ? "No destinations match"
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sortedAndRanked.length)} of ${sortedAndRanked.length}`}
          </p>
          {filter !== "ALL" && (
            <button onClick={() => setFilter("ALL")} className="font-body text-xs text-amber-400 hover:text-amber-300 transition-colors">Clear filter ×</button>
          )}
        </div>

        {/* Empty states */}
        {stats.total === 0 && (
          <div className="text-center py-20 dest-card max-w-md mx-auto">
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
            {filter === "SAFE" && "✅ Safe destinations"}
            {filter === "CAUTION" && "⚠️ Caution — travel with care"}
            {filter === "HIGH_RISK" && "🚨 High risk — avoid if possible"}
            {filter === "EXTREME" && "❌ Extreme — do not travel"}
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
                  onRequestLocation={requestUserLocation}
                  requestingLocation={locating}
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

      </div>

      <div className="fixed bottom-0 inset-x-0 h-20 mountain-wave bg-gradient-to-b from-slate-800/10 to-slate-900/30 pointer-events-none z-0" />
    </div>
  );
}
