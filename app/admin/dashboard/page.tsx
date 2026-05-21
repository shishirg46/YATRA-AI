"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Users,
  MapPin,
  AlertTriangle,
  Activity,
  Plus,
  ArrowRight,
  TrendingUp,
  History,
  CheckCircle,
  FileText
} from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";

interface DashboardStats {
  totalDestinations: number;
  verifiedDestinations: number;
  unverifiedDestinations: number;
  routeAccessibleDestinations: number;
  totalUsers: number;
  activeUsers: number;
  totalHazards: number;
  averageDataQualityScore: number;
  latestDestinations: Array<{
    id: string;
    name: string;
    category: string;
    district: string;
    province: string;
    dataQualityScore: number | null;
    verified: boolean;
    createdAt: string;
  }>;
  latestHazards: Array<{
    id: string;
    floodIndex: number | null;
    landslideIndex: number | null;
    heatIndex: number | null;
    airQuality: number | null;
    recordedAt: string;
    location: {
      id: string;
      latitude: number;
      longitude: number;
      district: {
        name: string;
        province: {
          name: string;
        };
      };
    };
  }>;
  recentActivities: Array<{
    id: string;
    action: string;
    entity: string;
    createdAt: string;
    user: {
      email: string;
      name: string;
    } | null;
  }>;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  async function fetchDashboardStats() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/stats", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        throw new Error(`Failed to load stats: ${res.status}`);
      }
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("[admin stats dashboard]", err);
      setError("Failed to fetch admin stats.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminShell active="dashboard" title="Admin Overview">
      {/* Welcome banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-slate-900/90 to-slate-950/40 border border-slate-800/80">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            System Intelligence Control
          </h1>
          <p className="font-body text-sm text-slate-400 mt-1">
            Real-time telemetry, geographic data curation, and risk assessment controls for Nepal.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => router.push("/admin/destinations")}
            className="bg-amber-500 text-slate-950 font-semibold text-xs py-2 px-4 flex items-center gap-1.5"
          >
            <Plus size={14} /> Add Destination
          </Button>
          <Button
            onClick={() => router.push("/admin/hazards")}
            variant="outline"
            className="border-slate-800 bg-slate-900/60 text-slate-350 hover:text-white text-xs py-2 px-4 flex items-center gap-1.5"
          >
            Report Hazard
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-900/40 border border-slate-850 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 font-body text-sm">
          {error}
        </div>
      ) : stats ? (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Users */}
            <div className="stat-card p-5 relative overflow-hidden group hover:border-purple-500/20 transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="font-body text-xs text-slate-500 uppercase tracking-widest font-semibold">
                  Platform Users
                </span>
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <Users size={16} />
                </div>
              </div>
              <p className="font-display text-3xl font-extrabold text-white">
                {stats.totalUsers.toLocaleString()}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-450">
                <span className="text-emerald-400 font-semibold">{stats.activeUsers.toLocaleString()}</span>
                <span>active accounts</span>
              </div>
            </div>

            {/* Destinations */}
            <div className="stat-card p-5 relative overflow-hidden group hover:border-sky-500/20 transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="font-body text-xs text-slate-500 uppercase tracking-widest font-semibold">
                  Destinations
                </span>
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                  <MapPin size={16} />
                </div>
              </div>
              <p className="font-display text-3xl font-extrabold text-white">
                {stats.totalDestinations.toLocaleString()}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-450">
                <span className="text-emerald-400 font-semibold">{stats.verifiedDestinations.toLocaleString()}</span>
                <span>verified records</span>
              </div>
            </div>

            {/* Hazards */}
            <div className="stat-card p-5 relative overflow-hidden group hover:border-red-500/20 transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="font-body text-xs text-slate-500 uppercase tracking-widest font-semibold">
                  Hazards Tracked
                </span>
                <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                  <AlertTriangle size={16} />
                </div>
              </div>
              <p className="font-display text-3xl font-extrabold text-white">
                {stats.totalHazards.toLocaleString()}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-450">
                <span>Real-time safety sensors active</span>
              </div>
            </div>

            {/* Quality Score */}
            <div className="stat-card p-5 relative overflow-hidden group hover:border-amber-500/20 transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="font-body text-xs text-slate-500 uppercase tracking-widest font-semibold">
                  Data Quality
                </span>
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <TrendingUp size={16} />
                </div>
              </div>
              <p className="font-display text-3xl font-extrabold text-white">
                {stats.averageDataQualityScore.toFixed(1)}/100
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-450">
                <span>Geo-coordinate match accuracy</span>
              </div>
            </div>
          </div>

          {/* Core Tables Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Latest Destinations */}
            <div className="stat-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-base text-white flex items-center gap-2">
                  <MapPin size={17} className="text-sky-400" /> Latest Destinations
                </h3>
                <Link
                  href="/admin/destinations"
                  className="font-body text-xs text-amber-400 hover:text-amber-500 flex items-center gap-1 transition-colors"
                >
                  Manage all <ArrowRight size={12} />
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-550 uppercase tracking-wider font-body">
                      <th className="py-2.5 px-3">Name</th>
                      <th className="py-2.5 px-3">Region</th>
                      <th className="py-2.5 px-3 text-center">Score</th>
                      <th className="py-2.5 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 font-body text-xs">
                    {stats.latestDestinations.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-600">
                          No destinations found.
                        </td>
                      </tr>
                    ) : (
                      stats.latestDestinations.map((dest) => (
                        <tr key={dest.id} className="hover:bg-slate-900/20 transition-colors">
                          <td className="py-3 px-3 font-semibold text-slate-200">{dest.name}</td>
                          <td className="py-3 px-3 text-slate-450">
                            {dest.district}, {dest.province}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 font-semibold border border-slate-850">
                              {dest.dataQualityScore ? Math.round(dest.dataQualityScore) : "N/A"}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            {dest.verified ? (
                              <span className="text-[10px] font-bold text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                                Verified
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Latest Hazards */}
            <div className="stat-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-base text-white flex items-center gap-2">
                  <AlertTriangle size={17} className="text-red-400" /> Latest Hazards
                </h3>
                <Link
                  href="/admin/hazards"
                  className="font-body text-xs text-amber-400 hover:text-amber-500 flex items-center gap-1 transition-colors"
                >
                  Manage all <ArrowRight size={12} />
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-550 uppercase tracking-wider font-body">
                      <th className="py-2.5 px-3">Location</th>
                      <th className="py-2.5 px-3 text-center">Indices</th>
                      <th className="py-2.5 px-3 text-right">Logged At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 font-body text-xs">
                    {stats.latestHazards.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-slate-600">
                          No hazard records found.
                        </td>
                      </tr>
                    ) : (
                      stats.latestHazards.map((haz) => {
                        const indices = [];
                        if (haz.floodIndex !== null) indices.push(`FL: ${(haz.floodIndex * 100).toFixed(0)}%`);
                        if (haz.landslideIndex !== null) indices.push(`LS: ${(haz.landslideIndex * 100).toFixed(0)}%`);
                        if (haz.heatIndex !== null) indices.push(`HI: ${haz.heatIndex.toFixed(0)}`);
                        if (haz.airQuality !== null) indices.push(`AQI: ${haz.airQuality.toFixed(0)}`);

                        return (
                          <tr key={haz.id} className="hover:bg-slate-900/20 transition-colors">
                            <td className="py-3 px-3">
                              <span className="font-semibold text-slate-200">
                                {haz.location.district.name}, {haz.location.district.province.name}
                              </span>
                              <span className="block text-[10px] text-slate-500">
                                {haz.location.latitude.toFixed(3)}, {haz.location.longitude.toFixed(3)}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <div className="flex flex-wrap justify-center gap-1">
                                {indices.map((ind, i) => (
                                  <span
                                    key={i}
                                    className="px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-semibold"
                                  >
                                    {ind}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right text-slate-450">
                              {new Date(haz.recordedAt).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Audit Logs */}
          <div className="stat-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-white flex items-center gap-2">
                <History size={17} className="text-purple-400" /> Recent Administrative Activity
              </h3>
              <Link
                href="/admin/audit-logs"
                className="font-body text-xs text-amber-400 hover:text-amber-500 flex items-center gap-1 transition-colors"
              >
                View full logs <ArrowRight size={12} />
              </Link>
            </div>

            <div className="space-y-3 font-body text-xs">
              {stats.recentActivities.length === 0 ? (
                <div className="py-8 text-center text-slate-600">No recent activity.</div>
              ) : (
                stats.recentActivities.map((act) => (
                  <div
                    key={act.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-slate-900/30 border border-slate-850 hover:bg-slate-900/60 transition-all gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 rounded bg-slate-900 text-slate-400 border border-slate-850 shrink-0">
                        <Activity size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-200">
                          {act.action} <span className="text-slate-450 font-normal">on</span> {act.entity}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate">
                          Executed by: {act.user?.name ?? "System"} ({act.user?.email ?? "cron/trigger"})
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0 sm:text-right font-medium">
                      {new Date(act.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}
