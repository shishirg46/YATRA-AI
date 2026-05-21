/**
 * FILE: page.tsx
 * LOCATION: /app/admin/verification/page.tsx
 * PURPOSE: Verification queue — review and approve unverified destinations
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, AlertCircle, CheckCircle2, MapPin } from "lucide-react";
import { AppShell } from "@/components/app-shell";

interface UnverifiedDestination {
  id: string;
  name: string;
  district: string;
  province: string;
  category: string;
  latitude: number;
  longitude: number;
  dataQualityScore: number | null;
  source: string;
  createdAt: string;
}

export default function VerificationQueuePage() {
  const router = useRouter();
  const [destinations, setDestinations] = useState<UnverifiedDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<string | null>(null);

  useEffect(() => {
    fetchUnverified();
  }, []);

  async function fetchUnverified() {
    try {
      const res = await fetch("/api/admin/destinations/unverified", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      setDestinations(data.destinations || []);
    } catch (err) {
      console.error("[unverified]", err);
    } finally {
      setLoading(false);
    }
  }

  async function verify(destId: string) {
    try {
      setVerifying(destId);
      const res = await fetch(`/api/admin/destinations/${destId}/verify`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setDestinations((prev) => prev.filter((d) => d.id !== destId));
    } catch (err) {
      console.error("[verify]", err);
    } finally {
      setVerifying(null);
    }
  }

  return (
    <AppShell active="dashboard" title="Verification Queue" subpage onBack={() => router.push("/admin")}>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ChevronLeft size={18} className="text-slate-400" />
          <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
            Back to Admin
          </Link>
        </div>
        <h1 className="font-display text-3xl font-bold text-white">Verification Queue</h1>
        <p className="font-body text-slate-400 mt-1">Review and approve {destinations.length} unverified destinations</p>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={32} />
          <p className="font-body text-slate-400">Loading unverified destinations…</p>
        </div>
      ) : destinations.length === 0 ? (
        <div className="stat-card p-8 text-center">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3" />
          <h3 className="font-display text-lg font-semibold text-white mb-2">All destinations verified!</h3>
          <p className="font-body text-slate-400">No pending destinations to review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {destinations.map((dest) => (
            <div key={dest.id} className="stat-card p-6 border border-orange-500/20 hover:border-orange-500/40 transition-all">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="font-body text-xs text-slate-500 uppercase tracking-widest mb-1">Destination</p>
                  <p className="font-display text-lg font-semibold text-white">{dest.name}</p>
                </div>
                <div>
                  <p className="font-body text-xs text-slate-500 uppercase tracking-widest mb-1">Location</p>
                  <p className="font-body text-sm text-slate-300">{dest.district}, {dest.province}</p>
                </div>
                <div>
                  <p className="font-body text-xs text-slate-500 uppercase tracking-widest mb-1">Quality Score</p>
                  <p className="font-display font-semibold text-amber-400">
                    {dest.dataQualityScore != null ? `${Math.round(dest.dataQualityScore)}/100` : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="font-body text-xs text-slate-500 uppercase tracking-widest mb-1">Source</p>
                  <p className="font-body text-sm text-slate-300">{dest.source}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="font-body text-xs text-slate-500">
                  Coordinates: {dest.latitude.toFixed(4)}, {dest.longitude.toFixed(4)}
                </p>
                <button
                  onClick={() => verify(dest.id)}
                  disabled={verifying === dest.id}
                  className="px-4 py-2 rounded-lg bg-emerald-400/20 border border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/30 disabled:opacity-50 font-body text-sm font-semibold transition-all"
                >
                  {verifying === dest.id ? "Verifying…" : "Verify"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
