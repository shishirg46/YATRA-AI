/**
 * FILE: page.tsx
 * LOCATION: /app/trips/new/page.tsx
 * PURPOSE: Multi-stop trip creation form
 *
 * FLOW:
 *  1. Set trip title, type (Solo/Group), total date range, budget
 *  2. Add stops (destination search + arrival/departure dates per stop)
 *  3. If GROUP — search and add members by username
 *  4. Submit → POST /api/trips → redirect to /trips/[id]
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter }                   from "next/navigation";
import Link                            from "next/link";
import {
  Mountain, ArrowLeft, Plus, X, Search, MapPin,
  Calendar, Users, User, Wallet, Loader2,
  ArrowRight, GripVertical, UserPlus, Check,
  ChevronDown, ChevronUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocationResult {
  id:       string;
  name:     string;
  district: string;
  province: string;
  altitude: number | null;
}

interface StopDraft {
  id:            string; // local only
  location:      LocationResult | null;
  arrivalDate:   string;
  departureDate: string;
}

interface MemberDraft {
  userId:   string;
  name:     string;
  username: string;
  image:    string | null;
}

interface UserSearchResult {
  id:       string;
  name:     string;
  email:    string;
  image:    string | null;
  username: string | null;
  status:   string;
}

// ── Location search input ─────────────────────────────────────────────────────

function LocationSearch({ value, onChange, placeholder }: {
  value:       LocationResult | null;
  onChange:    (l: LocationResult | null) => void;
  placeholder?: string;
}) {
  const [query,   setQuery]   = useState(value?.name ?? "");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const timer                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref                   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!query.trim() || query === value?.name) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/destinations/search?q=${encodeURIComponent(query)}`, { credentials: "include" });
        if (res.ok) { setResults(await res.json()); setOpen(true); }
      } catch { /* silent */ } finally { setLoading(false); }
    }, 300);
  }, [query]);

  function select(l: LocationResult) {
    onChange(l); setQuery(l.name); setOpen(false); setResults([]);
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder={placeholder ?? "Search destination…"}
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (value) onChange(null); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="trip-input w-full pl-9 pr-8 py-2.5 text-sm rounded-xl"
        />
        {loading
          ? <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />
          : query
          ? <button onClick={() => { onChange(null); setQuery(""); setResults([]); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X size={13} />
            </button>
          : null}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
          style={{ background: "rgba(10,15,30,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {results.map((l) => (
            <button key={l.id} onClick={() => select(l)}
              className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors text-left border-b border-slate-800/60 last:border-0">
              <MapPin size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-body text-sm text-white">{l.name}</p>
                <p className="font-body text-xs text-slate-500">{l.district}, {l.province}{l.altitude ? ` · ${l.altitude.toLocaleString()}m` : ""}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stop row ─────────────────────────────────────────────────────────────────

function StopRow({ stop, index, total, onChange, onRemove }: {
  stop:     StopDraft;
  index:    number;
  total:    number;
  onChange: (patch: Partial<StopDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="trip-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-amber-400/15 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
            <span className="font-display font-bold text-amber-400 text-xs">{index + 1}</span>
          </div>
          <span className="font-body text-sm text-slate-400">Stop {index + 1}</span>
          {index < total - 1 && <ArrowRight size={12} className="text-slate-600" />}
        </div>
        {total > 1 && (
          <button onClick={onRemove} className="p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all">
            <X size={14} />
          </button>
        )}
      </div>

      <LocationSearch
        value={stop.location}
        onChange={(l) => onChange({ location: l })}
        placeholder="Search destination…"
      />

      {stop.location && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <Check size={11} className="text-emerald-400" />
          <span className="font-body text-xs text-emerald-400">{stop.location.name}, {stop.location.district}</span>
          {stop.location.altitude && <span className="font-body text-xs text-emerald-400/60 ml-auto">{stop.location.altitude.toLocaleString()}m</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="font-body text-xs text-slate-500 mb-1 block">Arrival</label>
          <input type="date" value={stop.arrivalDate} onChange={(e) => onChange({ arrivalDate: e.target.value })}
            className="trip-input w-full px-3 py-2 text-sm rounded-xl" style={{ colorScheme: "dark" }} />
        </div>
        <div>
          <label className="font-body text-xs text-slate-500 mb-1 block">Departure</label>
          <input type="date" value={stop.departureDate} min={stop.arrivalDate}
            onChange={(e) => onChange({ departureDate: e.target.value })}
            className="trip-input w-full px-3 py-2 text-sm rounded-xl" style={{ colorScheme: "dark" }} />
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewTripPage() {
  const router = useRouter();

  const [title,      setTitle]      = useState("");
  const [tripType,   setTripType]   = useState<"SOLO" | "GROUP">("SOLO");
  const [budgetNPR,  setBudgetNPR]  = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Stops
  const [stops, setStops] = useState<StopDraft[]>([
    { id: crypto.randomUUID(), location: null, arrivalDate: "", departureDate: "" },
  ]);

  // Members
  const [members,      setMembers]      = useState<MemberDraft[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching,    setSearching]    = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived dates
  const startDate = stops[0]?.arrivalDate   ?? "";
  const endDate   = stops[stops.length - 1]?.departureDate ?? "";

  // Member search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!memberSearch.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(memberSearch)}`, { credentials: "include" });
        if (res.ok) setSearchResults(await res.json());
      } catch { /* silent */ } finally { setSearching(false); }
    }, 300);
  }, [memberSearch]);

  function addStop() {
    setStops((prev) => [...prev, { id: crypto.randomUUID(), location: null, arrivalDate: "", departureDate: "" }]);
  }

  function updateStop(id: string, patch: Partial<StopDraft>) {
    setStops((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }

  function removeStop(id: string) {
    setStops((prev) => prev.filter((s) => s.id !== id));
  }

  function addMember(u: UserSearchResult) {
    if (!u.username) return;
    if (members.some((m) => m.userId === u.id)) return;
    setMembers((prev) => [...prev, { userId: u.id, name: u.name, username: u.username!, image: u.image }]);
    setMemberSearch(""); setSearchResults([]);
  }

  function removeMember(userId: string) {
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!title.trim()) { setError("Trip title is required."); return; }
    if (!startDate)    { setError("First stop arrival date is required."); return; }
    if (!endDate)      { setError("Last stop departure date is required."); return; }

    const invalidStop = stops.find((s) => !s.location || !s.arrivalDate || !s.departureDate);
    if (invalidStop)   { setError("All stops need a destination and dates."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/trips", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:     title.trim(),
          tripType,
          startDate,
          endDate,
          budgetNPR: budgetNPR ? parseInt(budgetNPR, 10) : null,
          stops: stops.map((s, i) => ({
            locationId:    s.location!.id,
            stopOrder:     i + 1,
            arrivalDate:   s.arrivalDate,
            departureDate: s.departureDate,
          })),
          memberUsernames: members.map((m) => m.username),
        }),
      });

      const data = await res.json();
      if (!res.ok) { setError(data.message ?? "Failed to create trip."); return; }
      router.push(`/trips/${data.id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a0f1e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500&display=swap');
        .font-display{font-family:'Playfair Display',Georgia,serif}
        .font-body{font-family:'DM Sans',system-ui,sans-serif}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        .shimmer-text{background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b,#fbbf24);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite}
        .nav-blur{background:rgba(10,15,30,.92);border-bottom:1px solid rgba(255,255,255,.06);backdrop-filter:blur(20px)}
        .trip-card{background:rgba(15,23,42,.8);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px)}
        .trip-input{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:white;font-family:'DM Sans',system-ui,sans-serif;transition:border-color .2s,box-shadow .2s}
        .trip-input:focus{border-color:rgba(245,158,11,.5);box-shadow:0 0 0 3px rgba(245,158,11,.08);outline:none}
        .trip-input::placeholder{color:rgba(255,255,255,.25)}
        .trip-input::-webkit-calendar-picker-indicator{filter:invert(1) opacity(.4)}
        .amber-btn{background:#f59e0b;color:#0a0f1e;font-family:'DM Sans',system-ui,sans-serif;font-weight:600;border-radius:10px;transition:background .2s,box-shadow .2s}
        .amber-btn:hover:not(:disabled){background:#fbbf24;box-shadow:0 0 24px rgba(245,158,11,.3)}
        .glow-dot{position:fixed;border-radius:9999px;filter:blur(100px);pointer-events:none;z-index:0}
      `}</style>

      <div className="glow-dot w-[400px] h-[300px] bg-amber-500/7 -top-20 -right-20" />

      {/* Navbar */}
      <nav className="nav-blur fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 md:px-8 h-16">
        <div className="flex items-center gap-3">
          <Link href="/trips" className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-body text-sm">
            <ArrowLeft size={15} /> Your Plans
          </Link>
          <span className="text-slate-700">·</span>
          <div className="flex items-center gap-2">
            <Mountain className="text-amber-400" size={18} />
            <span className="font-display font-bold text-white">YatraAI</span>
          </div>
        </div>
        <span className="font-body text-sm text-slate-400 hidden sm:block">New Trip</span>
      </nav>

      <div className="pt-24 max-w-2xl mx-auto px-4 md:px-8 pb-16 relative z-10">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold text-white mb-1">
            Plan a <em className="shimmer-text not-italic">route</em>
          </h1>
          <p className="font-body text-sm text-slate-400">Add multiple stops, invite travellers, and get a group safety analysis.</p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-body text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Basic details ─────────────────────────────────────────────── */}
          <div className="trip-card rounded-2xl p-5 space-y-4">
            <h2 className="font-display font-bold text-white text-base">Trip details</h2>

            <div>
              <label className="font-body text-xs text-slate-400 uppercase tracking-widest mb-1.5 block">
                Trip title <span className="text-red-400">*</span>
              </label>
              <input type="text" placeholder="e.g. Annapurna Circuit, Langtang Valley Trek"
                value={title} onChange={(e) => setTitle(e.target.value)} required
                className="trip-input w-full px-3 py-2.5 text-sm rounded-xl" />
            </div>

            {/* Trip type */}
            <div>
              <label className="font-body text-xs text-slate-400 uppercase tracking-widest mb-1.5 block">Trip type</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: "SOLO",  icon: User,  label: "Solo",  desc: "Individual safety profile" },
                  { id: "GROUP", icon: Users, label: "Group", desc: "Consensus safety for all" },
                ] as const).map((t) => (
                  <button key={t.id} type="button" onClick={() => setTripType(t.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${tripType === t.id ? "bg-amber-400/10 border-amber-400/35 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}>
                    <t.icon size={18} className="flex-shrink-0" />
                    <div>
                      <p className="font-body text-sm font-medium">{t.label}</p>
                      <p className="font-body text-xs opacity-60">{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Budget */}
            <div>
              <label className="font-body text-xs text-slate-400 uppercase tracking-widest mb-1.5 block">
                Total budget (NPR) <span className="text-slate-600 normal-case tracking-normal">— optional</span>
              </label>
              <div className="relative">
                <Wallet size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="number" min="0" placeholder="e.g. 25000"
                  value={budgetNPR} onChange={(e) => setBudgetNPR(e.target.value)}
                  className="trip-input w-full pl-9 pr-3 py-2.5 text-sm rounded-xl" />
              </div>
              {budgetNPR && tripType === "GROUP" && members.length > 0 && (
                <p className="font-body text-xs text-slate-500 mt-1">
                  ≈ NPR {Math.round(parseInt(budgetNPR) / (members.length + 1)).toLocaleString()} per person
                </p>
              )}
            </div>
          </div>

          {/* ── Route stops ──────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-white text-base">Route stops</h2>
              <span className="font-body text-xs text-slate-500">{stops.length} stop{stops.length !== 1 ? "s" : ""}</span>
            </div>

            {stops.map((stop, i) => (
              <StopRow
                key={stop.id}
                stop={stop}
                index={i}
                total={stops.length}
                onChange={(patch) => updateStop(stop.id, patch)}
                onRemove={() => removeStop(stop.id)}
              />
            ))}

            <button type="button" onClick={addStop}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-700 text-slate-500 hover:border-amber-400/40 hover:text-amber-400 hover:bg-amber-400/5 font-body text-sm transition-all">
              <Plus size={15} /> Add another stop
            </button>

            {/* Route summary */}
            {stops.filter((s) => s.location).length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap px-2 py-2">
                {stops.filter((s) => s.location).map((s, i, arr) => (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <span className="font-body text-xs text-slate-400">{s.location!.name}</span>
                    {i < arr.length - 1 && <ArrowRight size={11} className="text-slate-600" />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Group members (GROUP only) ───────────────────────────────── */}
          {tripType === "GROUP" && (
            <div className="trip-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-white text-base">Group members</h2>
                <span className="font-body text-xs text-slate-500">{members.length} invited</span>
              </div>
              <p className="font-body text-xs text-slate-500">
                Search by name to add travellers. Their health profiles will be used in the group safety analysis.
              </p>

              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="text" placeholder="Search by name…" value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="trip-input w-full pl-9 pr-9 py-2.5 text-sm rounded-xl" />
                {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />}
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="space-y-1">
                  {searchResults.map((u) => {
                    const alreadyAdded = members.some((m) => m.userId === u.id);
                    return (
                      <div key={u.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
                        <Link href={`/profile/${u.id}`} className="flex-1 min-w-0">
                          <p className="font-body text-sm text-white">{u.name}</p>
                          {u.username && <p className="font-body text-xs text-slate-500">@{u.username}</p>}
                        </Link>
                        <button type="button" onClick={() => addMember(u)} disabled={alreadyAdded || !u.username}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-body font-medium transition-all ${alreadyAdded ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 cursor-default" : "border-amber-500/25 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>
                          {alreadyAdded ? <><Check size={11} /> Added</> : <><UserPlus size={11} /> Add</>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Added members */}
              {members.length > 0 && (
                <div className="space-y-2">
                  <p className="font-body text-xs text-slate-500 uppercase tracking-widest">Invited</p>
                  {members.map((m) => (
                    <div key={m.userId} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/40 border border-slate-700/40">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-amber-400/15 border border-amber-400/25 flex items-center justify-center flex-shrink-0">
                          <span className="font-display font-bold text-amber-400 text-xs">{m.name[0]?.toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-body text-sm text-white">{m.name}</p>
                          <p className="font-body text-xs text-slate-500">@{m.username}</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeMember(m.userId)}
                        className="p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {members.length === 0 && !memberSearch && (
                <div className="py-6 text-center">
                  <Users size={28} className="text-slate-700 mx-auto mb-2" />
                  <p className="font-body text-sm text-slate-600">Search for travellers to add to this trip</p>
                </div>
              )}
            </div>
          )}

          {/* ── Trip summary ──────────────────────────────────────────────── */}
          {stops.filter((s) => s.location && s.arrivalDate).length > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <Calendar size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="font-body text-xs text-slate-400 space-y-0.5">
                <p>{stops.filter((s) => s.location).length} stop{stops.filter((s) => s.location).length !== 1 ? "s" : ""} · {tripType.toLowerCase()} trip</p>
                {startDate && endDate && <p>{new Date(startDate).toLocaleDateString()} → {new Date(endDate).toLocaleDateString()}</p>}
                {tripType === "GROUP" && <p>{members.length + 1} traveller{members.length !== 0 ? "s" : ""} (you{members.length > 0 ? ` + ${members.length} invited` : ""})</p>}
                {budgetNPR && <p>Budget: NPR {parseInt(budgetNPR).toLocaleString()}</p>}
              </div>
            </div>
          )}

          <button type="submit" disabled={submitting || !title || stops.some((s) => !s.location || !s.arrivalDate || !s.departureDate)}
            className="amber-btn w-full py-3.5 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Creating trip…</>
              : <><Mountain size={16} /> Create Trip & Run Safety Analysis</>}
          </button>
        </form>
      </div>
    </div>
  );
}
