/**
 * FILE: page.tsx
 * LOCATION: /app/trips/page.tsx
 * PURPOSE: "Your Plans" — shows all trips user leads or is invited to
 */
"use client";

import { useState, useEffect } from "react";
import Link                    from "next/link";
import { useRouter }           from "next/navigation";
import { toast } from "sonner";
import {
  Mountain, MapPin, Calendar, Users, User, Plus,
  CheckCircle2, X, Clock, AlertTriangle, Shield,
  Zap, XCircle, ArrowRight, Loader2, RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stop {
  stopOrder:     number;
  arrivalDate:   string;
  departureDate: string;
  location: { name: string; district: { name: string; province: { name: string } } };
}

interface Member {
  id:     string;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  user:   { id: string; name: string; username: string | null; image: string | null };
}

interface Plan {
  id:        string;
  title:     string;
  tripType:  "SOLO" | "GROUP";
  status:    string;
  startDate: string;
  endDate:   string;
  budgetNPR: number | null;
  leader:    { id: string; name: string; username: string | null; image: string | null };
  stops:     Stop[];
  members:   Member[];
  groupRiskResult: { overallGroupLevel?: string; overallGroupScore?: number } | null;
}

interface PlansData {
  led:     Plan[];
  joined:  Plan[];
  pending: Plan[];
}

// ── Config ────────────────────────────────────────────────────────────────────

const LEVEL_CONFIG = {
  SAFE:      { color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25", icon: Shield },
  CAUTION:   { color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/25",   icon: AlertTriangle },
  HIGH_RISK: { color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/25",  icon: Zap },
  EXTREME:   { color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/25",     icon: XCircle },
} as const;

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, isLeader, isPending, onRespond }: {
  plan:       Plan;
  isLeader:   boolean;
  isPending:  boolean;
  onRespond?: (planId: string, action: "accept" | "decline") => void;
}) {
  const risk   = plan.groupRiskResult;
  const level  = (risk?.overallGroupLevel ?? null) as keyof typeof LEVEL_CONFIG | null;
  const cfg    = level ? LEVEL_CONFIG[level] : null;
  const LIcon  = cfg?.icon;

  return (
    <div className="trip-card rounded-2xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-display font-bold text-white text-base truncate">{plan.title}</h3>
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-body font-semibold uppercase ${
              plan.tripType === "GROUP"
                ? "bg-sky-400/10 border-sky-400/20 text-sky-400"
                : "bg-slate-700/50 border-slate-600/40 text-slate-400"
            }`}>{plan.tripType}</span>
            {isLeader && <span className="px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-400 font-body text-[10px] font-semibold">Leader</span>}
            {isPending && <span className="px-2 py-0.5 rounded-full bg-purple-400/10 border border-purple-400/20 text-purple-400 font-body text-[10px] font-semibold animate-pulse">Invited</span>}
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <Calendar size={11} /><span className="font-body text-xs">{new Date(plan.startDate).toLocaleDateString()} → {new Date(plan.endDate).toLocaleDateString()}</span>
          </div>
        </div>
        {cfg && LIcon && (
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border font-body text-xs font-semibold shrink-0 ${cfg.color} ${cfg.bg} ${cfg.border}`}>
            <LIcon size={11} />{risk?.overallGroupScore}/100
          </span>
        )}
      </div>

      {/* Route stops */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {plan.stops.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <MapPin size={10} className="text-amber-400" />
              <span className="font-body text-xs text-slate-300">{s.location.name}</span>
            </div>
            {i < plan.stops.length - 1 && <ArrowRight size={11} className="text-slate-600 shrink-0" />}
          </div>
        ))}
      </div>

      {/* Members + budget */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Users size={12} className="text-slate-500" />
            <span className="font-body text-xs text-slate-500">{plan.members.filter((m) => m.status === "ACCEPTED").length + 1} members</span>
          </div>
          {plan.budgetNPR && (
            <span className="font-body text-xs text-slate-600">· NPR {plan.budgetNPR.toLocaleString()}</span>
          )}
        </div>
        <div className="flex gap-2">
          {isPending && onRespond && (
            <>
              <button onClick={() => onRespond(plan.id, "decline")}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20 font-body text-xs font-medium transition-all">
                <X size={11} /> Decline
              </button>
              <button onClick={() => onRespond(plan.id, "accept")}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 font-body text-xs font-medium transition-all">
                <CheckCircle2 size={11} /> Accept
              </button>
            </>
          )}
          {!isPending && (
            <Link href={`/trips/${plan.id}`}>
              <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-body text-xs font-semibold transition-all">
                View <ArrowRight size={11} />
              </button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TripsPage() {
  const router = useRouter();
  const [data,     setData]     = useState<PlansData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);
  const [tab, setTab] = useState<"led" | "joined" | "pending" | "past">("led");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/trips", { credentials: "include" });
      if (!res.ok) { setError("Failed to load plans."); return; }
      setData(await res.json());
    } catch { setError("Network error."); } finally { setLoading(false); }
  }

  async function respond(planId: string, action: "accept" | "decline") {
    setResponding(planId);
    try {
      const res = await fetch(`/api/trips/${planId}/respond`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) { await load(); toast.success(action === "accept" ? "Invitation accepted!" : "Invitation declined."); }
      else toast.error("Failed to respond to invitation.");
    } catch { toast.error("Failed to respond to invitation."); } finally { setResponding(null); }
  }

  const pastTrips = (data?.led ?? []).concat(data?.joined ?? []).filter((p) => p.status === "COMPLETED");
  const tabs = [
    { id: "led",     label: "My Trips",    count: data?.led.length ?? 0 },
    { id: "joined",  label: "Joined",      count: data?.joined.length ?? 0 },
    { id: "pending", label: "Invitations", count: data?.pending.length ?? 0 },
    { id: "past",    label: "Past Trips",  count: pastTrips.length },
  ] as const;

  const currentPlans = tab === "past"
    ? pastTrips
    : tab === "led" ? (data?.led ?? [])
    : tab === "joined" ? (data?.joined ?? [])
    : (data?.pending ?? []);

  return (
    <AppShell
      active="trips"
      title="Your Plans"
      contentClassName="pt-20 max-w-3xl mx-auto px-4 md:px-8 pb-20 relative z-10"
      actions={
        <Link href="/trips/new" className="yatra-cta">
          <Plus size={15} /> New Trip
        </Link>
      }
    >

        {/* Header */}
        <div className="mb-6 anim">
          <h1 className="font-display text-3xl font-bold text-white mb-1">Your Plans</h1>
          <p className="font-body text-sm text-slate-400">Trips you&apos;re leading, joined, or invited to</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 mb-6 anim">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative px-4 py-3 font-body text-sm font-medium transition-colors ${tab === t.id ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              {t.label}
              {t.count > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === t.id ? "bg-amber-400/20 text-amber-400" : "bg-slate-700 text-slate-400"}`}>{t.count}</span>
              )}
              {t.id === "pending" && t.count > 0 && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 size={32} className="text-amber-400 animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="text-center py-16">
            <p className="font-body text-slate-400 mb-4">{error}</p>
            <button onClick={load} className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white font-body text-sm transition-all">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && currentPlans.length === 0 && (
          <div className="text-center py-20 trip-card rounded-2xl">
            {tab === "led" ? (
              <>
                <Mountain size={40} className="text-slate-700 mx-auto mb-4" />
                <h3 className="font-display text-xl text-slate-400 mb-2">No trips yet</h3>
                <p className="font-body text-sm text-slate-500 mb-6">Create your first multi-stop trip plan</p>
                <Link href="/trips/new">
                  <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-body font-semibold text-sm transition-all">
                    <Plus size={15} /> Plan a Trip
                  </button>
                </Link>
              </>
            ) : tab === "joined" ? (
              <>
                <Users size={36} className="text-slate-700 mx-auto mb-3" />
                <p className="font-body text-slate-500">You haven&apos;t joined any group trips yet</p>
              </>
            ) : tab === "past" ? (
              <>
                <Clock size={36} className="text-slate-700 mx-auto mb-3" />
                <p className="font-body text-slate-500">No completed trips yet</p>
              </>
            ) : (
              <>
                <Clock size={36} className="text-slate-700 mx-auto mb-3" />
                <p className="font-body text-slate-500">No pending invitations</p>
              </>
            )}
          </div>
        )}

        {/* Plan cards */}
        <div className="space-y-4">
          {currentPlans.map((plan, i) => (
            <div key={plan.id} className="anim" style={{ animationDelay: `${i * 0.05}s` }}>
              {responding === plan.id ? (
                <div className="trip-card rounded-2xl p-5 flex items-center justify-center gap-2">
                  <Loader2 size={18} className="text-amber-400 animate-spin" />
                  <span className="font-body text-sm text-slate-400">Responding…</span>
                </div>
              ) : (
                <PlanCard
                  plan={plan}
                  isLeader={tab === "led"}
                  isPending={tab === "pending"}
                  onRespond={tab === "pending" ? respond : undefined}
                />
              )}
            </div>
          ))}
        </div>

    </AppShell>
  );
}
