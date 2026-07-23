/**
 * FILE: page.tsx
 * LOCATION: /app/plan/page.tsx — Form‑only. Results moved to /plan/[destinationId]/analysis.
 */
"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter }  from "next/navigation";
import { AppShell } from "@/components/app-shell";
import DestSearch from "./_components/DestSearch";
import MemberSearch from "./_components/MemberSearch";
import {
  Calendar, Users, User,
  Loader2,
  CheckCircle2,
  Wallet,
  Sparkles, ArrowRight, AlertCircle, Car, Map,
} from "lucide-react";
import { getCurrentLocation, LocationError } from "@/lib/location/getCurrentLocation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DestinationResult {
  id: string; name: string; district: string; province: string; altitude: number | null;
  latitude?: number; longitude?: number;
}

interface MemberResult {
  id: string; name: string; username: string | null; image: string | null; status: string;
}

// ── Inner plan page ───────────────────────────────────────────────────────────

function PlanInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [destination, setDestination] = useState<DestinationResult | null>(null);
  const [startDate,   setStartDate]   = useState(searchParams.get("startDate") ?? "");
  const [endDate,     setEndDate]     = useState(searchParams.get("endDate") ?? "");
  const [tripType,    setTripType]    = useState<"SOLO" | "GROUP">(
    (searchParams.get("type") as "SOLO" | "GROUP") ?? "SOLO"
  );
  const [vehicle,     setVehicle]     = useState(searchParams.get("vehicle") || "car");
  const [travelStyle, setTravelStyle] = useState(searchParams.get("style") || "standard");
  const [originLat, setOriginLat] = useState<number | null>(null);
  const [originLon, setOriginLon] = useState<number | null>(null);
  const [budgetNPR,   setBudgetNPR]   = useState(searchParams.get("budget") ?? "");
  const [members,     setMembers]     = useState<MemberResult[]>([]);
  const [error,       setError]       = useState<string | null>(null);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const destId   = searchParams.get("destination");
    const destName = searchParams.get("name");
    const urlType  = searchParams.get("type") as "SOLO" | "GROUP" | null;
    const qOriginLat = searchParams.get("originLat");
    const qOriginLon = searchParams.get("originLon");

    if (destId && destName) {
      setDestination({ id: destId, name: destName, district: "", province: "", altitude: null });
    }
    if (urlType)  setTripType(urlType);
    if (qOriginLat && qOriginLon) {
      const lat = Number(qOriginLat);
      const lon = Number(qOriginLon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        setOriginLat(lat);
        setOriginLon(lon);
      }
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!destination) { setError("Please select a destination."); return; }
    if (!startDate)   { setError("Start date is required."); return; }
    if (!endDate)     { setError("End date is required."); return; }
    if (endDate < startDate) { setError("End date must be on or after start date."); return; }
    if (tripType === "GROUP" && members.length === 0) { setError("Group trips require at least one partner."); return; }

    setError(null);
    setLocationWarning(null);

    let requestOriginLat = originLat;
    let requestOriginLon = originLon;

    // Fallback: browser geolocation at submit-time if permission exists.
    if ((requestOriginLat == null || requestOriginLon == null) && typeof navigator !== "undefined" && navigator.geolocation) {
      try {
        const geo = await getCurrentLocation();
        const accuracy = geo.accuracy;
        console.log(`Geolocation received. Accuracy: ${accuracy.toFixed(1)}m`);

        if (!Number.isFinite(accuracy) || accuracy > 10000) {
          setLocationWarning(
            `Location accuracy is very low (${accuracy > 10000 ? (accuracy / 1000).toFixed(0) + "km" : Math.round(accuracy) + "m"}). ` +
            `Move to an open area or enable high-accuracy location, then try again.`
          );
        } else {
          if (accuracy > 150) {
            setLocationWarning(
              `Location accuracy is moderate (${accuracy.toFixed(0)}m). Results may be less precise. ` +
              `For better accuracy, move to an open area with clear sky view.`
            );
          }
          requestOriginLat = geo.lat;
          requestOriginLon = geo.lon;
          setOriginLat(geo.lat);
          setOriginLon(geo.lon);
          console.log(`Geolocation: lat=${geo.lat}, lon=${geo.lon}, accuracy=${accuracy.toFixed(1)}m`);

          // Attempt road snapping — raw GPS is the fallback on failure/timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          try {
            const res = await fetch("/api/routing/resolve-origin", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat: geo.lat, lon: geo.lon, accuracy }),
              signal: controller.signal,
            });
            if (res.ok) {
              const data = await res.json();
              if (data.lat != null && data.lon != null) {
                requestOriginLat = data.lat;
                requestOriginLon = data.lon;
                setOriginLat(data.lat);
                setOriginLon(data.lon);
                console.log(`Snapped to road: lat=${data.lat}, lon=${data.lon}`);
              }
            }
          } catch {
            // Use raw GPS coordinates — already set above
          } finally {
            clearTimeout(timeoutId);
          }
        }
      } catch (err) {
        const msg = err instanceof LocationError
          ? err.message
          : "Could not access device location.";
        setLocationWarning(msg);
      }
    }

    // Navigate to analysis page
    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    params.set("type", tripType);
    params.set("vehicle", vehicle);
    params.set("style", travelStyle);
    if (requestOriginLat != null) params.set("originLat", String(requestOriginLat));
    if (requestOriginLon != null) params.set("originLon", String(requestOriginLon));
    params.set("budget", budgetNPR);
    if (destination.name) params.set("name", destination.name);

    router.push(`/plan/${destination.id}/analysis?${params.toString()}`);
  }

  return (
    <div className="w-full min-h-[calc(100vh-10rem)] flex items-center justify-center pb-16">
      <div className="w-full max-w-md">
        <div className="plan-card rounded-2xl p-5 space-y-4">

          {error && (
            <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-body text-xs">{error}</div>
          )}

          {locationWarning && (
            <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 font-body text-xs flex items-start gap-2">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5"/>
              <div>{locationWarning}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                e.currentTarget.requestSubmit();
              }
            }} className="space-y-4">

            {/* Destination */}
            <div className="grid gap-1.5">
              <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                Destination <span className="text-red-400">*</span>
              </label>
              <DestSearch value={destination} onChange={setDestination}/>
              {destination && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 size={10} className="text-emerald-400"/>
                  <span className="font-body text-[11px] text-emerald-400 truncate">{destination.name}{destination.district ? `, ${destination.district}` : ""}</span>
                </div>
              )}
            </div>

            {/* Start date */}
            <div className="grid gap-1.5">
              <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                Start date <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                <input type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  required className="plan-input w-full pl-9 pr-3 py-2.5 text-sm rounded-xl" style={{ colorScheme: "dark" }}/>
              </div>
            </div>

            {/* End date */}
            <div className="grid gap-1.5">
              <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                End date <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                <input type="date" min={startDate || today} value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  required className="plan-input w-full pl-9 pr-3 py-2.5 text-sm rounded-xl" style={{ colorScheme: "dark" }}/>
              </div>
            </div>

            {/* Trip type */}
            <div className="grid gap-1.5">
              <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">Trip type</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: "SOLO",  icon: User,  label: "Solo",  desc: "Individual" },
                  { id: "GROUP", icon: Users, label: "Group", desc: "Consensus" },
                ] as const).map((t) => (
                  <button key={t.id} type="button" onClick={() => setTripType(t.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${tripType === t.id ? "bg-amber-400/10 border-amber-400/35 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}>
                    <t.icon size={15}/>
                    <div>
                      <p className="font-body text-xs font-medium">{t.label}</p>
                      <p className="font-body text-[10px] opacity-60">{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Vehicle */}
            <div className="grid gap-1.5">
              <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                Vehicle <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["car", "motorcycle", "jeep", "bus"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setVehicle(v)}
                    className={`flex items-center gap-1.5 p-2.5 rounded-xl border text-left transition-all ${vehicle === v ? "bg-amber-400/10 border-amber-400/35 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}>
                    <Car size={14}/>
                    <span className="font-body text-xs capitalize">{v}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Travel style */}
            <div className="grid gap-1.5">
              <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                Travel style <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["budget", "standard", "luxury"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setTravelStyle(s)}
                    className={`flex items-center gap-1.5 p-2.5 rounded-xl border text-left transition-all ${travelStyle === s ? "bg-amber-400/10 border-amber-400/35 text-amber-300" : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}>
                    <Map size={14}/>
                    <span className="font-body text-xs capitalize">{s}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Group members — required for GROUP */}
            {tripType === "GROUP" && (
              <div className="grid gap-1.5">
                <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                  Partners <span className="text-red-400">*</span>
                  <span className="text-slate-600 normal-case tracking-normal font-normal ml-1">— at least one</span>
                </label>
                <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                  <MemberSearch members={members} onChange={setMembers}/>
                </div>
              </div>
            )}

            {/* Budget */}
            <div className="grid gap-1.5">
              <label className="font-body text-[10px] text-slate-500 uppercase tracking-widest">
                Budget (NPR) <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Wallet size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                <input type="number" min="0" placeholder="e.g. 15000" value={budgetNPR}
                  onChange={(e) => setBudgetNPR(e.target.value)} required
                  className="plan-input w-full pl-9 pr-3 py-2.5 text-sm rounded-xl"/>
              </div>
            </div>

            <button type="submit" disabled={!destination || !startDate || !endDate || (tripType === "GROUP" && members.length === 0)}
              className="amber-btn w-full py-3 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              <><Sparkles size={14}/> Analyse Trip Safety <ArrowRight size={13}/></>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────────────────────

export default function PlanPage() {
  return (
    <AppShell active="plan" title="Plan a Trip" subpage contentClassName="pt-20 w-full px-4 md:px-6 lg:px-8 pb-20 relative z-10">
      <Suspense fallback={<div className="flex justify-center pt-20"><Loader2 size={32} className="text-amber-400 animate-spin"/></div>}>
        <PlanInner/>
      </Suspense>
    </AppShell>
  );
}
