/**
 * FILE: page.tsx
 * LOCATION: /app/admin/analytics/page.tsx
 * PURPOSE: Analytics Dashboard — systems metrics, custom charts, and security velocity
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  ChevronLeft, BarChart3, Users, Shield, MapPin, Loader2, TrendingUp, 
  CheckCircle2, AlertCircle, RefreshCw 
} from "lucide-react";
import { AppShell } from "@/components/app-shell";

interface AnalyticsData {
  destinations: {
    total: number;
    verified: number;
    unverified: number;
    categories: { category: string; count: number }[];
  };
  risk: {
    averageScore: number;
    levels: { level: string; count: number }[];
  };
  users: {
    total: number;
    active: number;
    inactive: number;
    roles: { role: string; count: number }[];
  };
  audit: {
    timeline: { date: string; count: number }[];
  };
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  async function fetchAnalytics() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/analytics", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        throw new Error("Failed to load analytics");
      }
      const analyticsData = await res.json();
      setData(analyticsData);
    } catch (err) {
      console.error("[analytics dashboard]", err);
      setError("Failed to compile system metrics database reports.");
    } finally {
      setLoading(false);
    }
  }

  // Draw SVG Area/Line Chart for Audit Timeline
  function renderTimelineChart(timeline: { date: string; count: number }[]) {
    if (timeline.length === 0) return null;
    const maxVal = Math.max(...timeline.map((t) => t.count), 5);
    const height = 150;
    const width = 500;
    const padding = 20;

    // Convert data to SVG coordinate points
    const points = timeline.map((t, index) => {
      const x = padding + (index * (width - padding * 2)) / (timeline.length - 1);
      const y = height - padding - (t.count * (height - padding * 2)) / maxVal;
      return { x, y, count: t.count, date: t.date };
    });

    const pathD = points.reduce((path, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${path} L ${p.x} ${p.y}`;
    }, "");

    const areaD = points.length > 0 
      ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
      : "";

    return (
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
            const y = padding + r * (height - padding * 2);
            return (
              <line
                key={i}
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="#1e293b"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            );
          })}

          {/* Area under the line */}
          {points.length > 0 && (
            <path d={areaD} fill="url(#chartGrad)" />
          )}

          {/* Line path */}
          {points.length > 0 && (
            <path d={pathD} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
          )}

          {/* Dots & tooltips */}
          {points.map((p, i) => (
            <g key={i} className="group/dot cursor-pointer">
              <circle cx={p.x} cy={p.y} r="3.5" fill="#f59e0b" className="transition-all group-hover/dot:r-5" />
              <circle cx={p.x} cy={p.y} r="8" fill="transparent" />
            </g>
          ))}
        </svg>

        {/* Labels */}
        <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-2 px-3">
          <span>{timeline[0]?.date.split("-")[2]} {new Date(timeline[0]?.date).toLocaleString("default", { month: "short" })}</span>
          <span>{timeline[Math.floor(timeline.length / 2)]?.date.split("-")[2]} {new Date(timeline[Math.floor(timeline.length / 2)]?.date).toLocaleString("default", { month: "short" })}</span>
          <span>{timeline[timeline.length - 1]?.date.split("-")[2]} {new Date(timeline[timeline.length - 1]?.date).toLocaleString("default", { month: "short" })}</span>
        </div>
      </div>
    );
  }

  return (
    <AppShell active="dashboard" title="Admin Analytics" subpage onBack={() => router.push("/admin")}>
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ChevronLeft size={18} className="text-slate-400" />
            <Link href="/admin" className="text-slate-400 hover:text-white font-body text-sm">
              Back to Admin
            </Link>
          </div>
          <h1 className="font-display text-3xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="text-amber-400" /> System Analytics Dashboard
          </h1>
          <p className="font-body text-slate-400 mt-1">
            Aggregated system usage, category segmentations, weather risk distributions and administrative audit metrics
          </p>
        </div>

        <button 
          onClick={fetchAnalytics}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white transition-all font-body text-xs self-start md:self-auto"
        >
          <RefreshCw size={12} /> Reload metrics
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <Loader2 className="animate-spin text-amber-400 mx-auto mb-2" size={38} />
          <p className="font-body text-slate-400">Compiling database aggregates…</p>
        </div>
      ) : error || !data ? (
        <div className="stat-card p-4 bg-red-400/10 border-red-500/30 text-red-300">{error || "No data available"}</div>
      ) : (
        <div className="space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* destinations stats card */}
            <div className="stat-card p-4 hover:border-blue-500/30 transition-all duration-300">
              <div className="flex justify-between items-start mb-3">
                <p className="font-body text-xs text-slate-500 uppercase tracking-wider">Total Destinations</p>
                <div className="p-1.5 rounded bg-blue-500/10 text-blue-400"><MapPin size={16} /></div>
              </div>
              <p className="font-display text-3xl font-bold text-white">{data.destinations.total}</p>
              <div className="flex items-center gap-2 mt-2 font-body text-[10px] text-slate-400">
                <span className="text-emerald-400 font-semibold">{data.destinations.verified} verified</span>
                <span>&bull;</span>
                <span className="text-rose-400 font-semibold">{data.destinations.unverified} pending</span>
              </div>
            </div>

            {/* active user stats card */}
            <div className="stat-card p-4 hover:border-purple-500/30 transition-all duration-300">
              <div className="flex justify-between items-start mb-3">
                <p className="font-body text-xs text-slate-500 uppercase tracking-wider">Registered Accounts</p>
                <div className="p-1.5 rounded bg-purple-500/10 text-purple-400"><Users size={16} /></div>
              </div>
              <p className="font-display text-3xl font-bold text-white">{data.users.total}</p>
              <div className="flex items-center gap-2 mt-2 font-body text-[10px] text-slate-400">
                <span className="text-emerald-400 font-semibold">{data.users.active} active profiles</span>
                <span>&bull;</span>
                <span className="text-slate-500">{data.users.inactive} soft-deleted</span>
              </div>
            </div>

            {/* weather safety stats card */}
            <div className="stat-card p-4 hover:border-emerald-500/30 transition-all duration-300">
              <div className="flex justify-between items-start mb-3">
                <p className="font-body text-xs text-slate-500 uppercase tracking-wider">Average Safety Index</p>
                <div className="p-1.5 rounded bg-emerald-500/10 text-emerald-400"><CheckCircle2 size={16} /></div>
              </div>
              <p className="font-display text-3xl font-bold text-white">{data.risk.averageScore.toFixed(1)} / 100</p>
              <div className="flex items-center gap-1.5 mt-2 font-body text-[10px] text-slate-400">
                <TrendingUp size={12} className="text-emerald-400" />
                <span>Geographic assessment safety avg</span>
              </div>
            </div>

            {/* system actions card */}
            <div className="stat-card p-4 hover:border-amber-500/30 transition-all duration-300">
              <div className="flex justify-between items-start mb-3">
                <p className="font-body text-xs text-slate-500 uppercase tracking-wider">Log Actions (14d)</p>
                <div className="p-1.5 rounded bg-amber-500/10 text-amber-400"><Shield size={16} /></div>
              </div>
              <p className="font-display text-3xl font-bold text-white">
                {data.audit.timeline.reduce((sum, t) => sum + t.count, 0)}
              </p>
              <div className="flex items-center gap-1.5 mt-2 font-body text-[10px] text-slate-400">
                <span>Security logs audit velocity</span>
              </div>
            </div>
          </div>

          {/* Custom Visualizations Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. Destination Categories Breakdown */}
            <div className="stat-card p-5">
              <h3 className="font-display text-sm font-bold text-white mb-4 flex items-center gap-1.5">
                <MapPin size={14} className="text-blue-400" /> Catalog Category Ratios
              </h3>
              <div className="space-y-3 font-body text-xs">
                {data.destinations.categories.map((c) => {
                  const percent = (c.count / data.destinations.total) * 100;
                  return (
                    <div key={c.category}>
                      <div className="flex justify-between text-slate-400 mb-1">
                        <span className="capitalize">{c.category.toLowerCase().replace(/_/g, " ")}</span>
                        <span className="font-semibold text-white">{c.count} ({Math.round(percent)}%)</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-400 rounded-full" 
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Weather Safety Risks */}
            <div className="stat-card p-5">
              <h3 className="font-display text-sm font-bold text-white mb-4 flex items-center gap-1.5">
                <AlertCircle size={14} className="text-rose-400" /> Active Weather Safety Levels
              </h3>
              
              <div className="space-y-4 font-body text-xs pt-1">
                {["SAFE", "CAUTION", "HIGH_RISK", "EXTREME"].map((level) => {
                  const record = data.risk.levels.find((r) => r.level === level) || { count: 0 };
                  const totalLevelCounts = data.risk.levels.reduce((s, r) => s + r.count, 0) || 1;
                  const ratio = (record.count / totalLevelCounts) * 100;

                  // Severity levels color matching safety.ts
                  let colorClass = "bg-emerald-500";
                  let textColorClass = "text-emerald-400";
                  if (level === "CAUTION") { colorClass = "bg-amber-400"; textColorClass = "text-amber-400"; }
                  if (level === "HIGH_RISK") { colorClass = "bg-orange-500"; textColorClass = "text-orange-500"; }
                  if (level === "EXTREME") { colorClass = "bg-red-500"; textColorClass = "text-red-500"; }

                  return (
                    <div key={level}>
                      <div className="flex justify-between items-center mb-1">
                        <span className={`font-semibold uppercase tracking-wider ${textColorClass}`}>{level.replace(/_/g, " ")}</span>
                        <span className="text-white font-mono">{record.count} regions ({Math.round(ratio)}%)</span>
                      </div>
                      <div className="h-2 bg-slate-850 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${colorClass} rounded-full`}
                          style={{ width: `${ratio}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Audit Logs Velocity */}
            <div className="stat-card p-5 lg:col-span-2">
              <h3 className="font-display text-sm font-bold text-white mb-4 flex items-center gap-1.5">
                <Shield size={14} className="text-amber-400" /> Administrative Action Velocity (Last 14 Days)
              </h3>
              {renderTimelineChart(data.audit.timeline)}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
