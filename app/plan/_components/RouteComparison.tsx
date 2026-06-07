"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, MapPin, Clock, Zap, Shield, Route,
  ArrowLeft, ArrowRight, Check, Navigation,
} from "lucide-react";

export interface RouteAlt {
  index: number;
  label: string;
  distance: number;
  duration: number;
  distanceKm: number;
  durationMin: number;
  riskScore: number;
  riskLevel: string;
  summary: string;
  polyline: Array<{ lat: number; lon: number }>;
}

interface RouteComparisonProps {
  originLat: number;
  originLon: number;
  destLat: number;
  destLon: number;
  onSelectRoute: (alt: RouteAlt) => void;
  selectedIndex: number;
}

const LEVEL_COLORS: Record<string, string> = {
  SAFE: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  CAUTION: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  HIGH_RISK: "text-orange-400 border-orange-400/30 bg-orange-400/10",
  EXTREME: "text-red-400 border-red-400/30 bg-red-400/10",
};

const LABEL_ICONS: Record<string, typeof Zap> = {
  Recommended: Shield,
  Fastest: Zap,
  Shortest: Route,
  Scenic: Navigation,
};

function formatDistance(meters: number): string {
  const km = meters / 1000;
  return km >= 100 ? `${(km / 1000).toFixed(1)}k km` : `${km.toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${mins} min`;
  return `${hours}h ${mins}m`;
}

export function RouteComparison({
  originLat, originLon, destLat, destLon,
  onSelectRoute, selectedIndex,
}: RouteComparisonProps) {
  const [routes, setRoutes] = useState<RouteAlt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlternatives = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/routes/alternatives?originLat=${originLat}&originLon=${originLon}&destLat=${destLat}&destLon=${destLon}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch routes");
      const data = await res.json();
      setRoutes(data.alternatives || []);
      if (data.alternatives?.length > 0 && onSelectRoute) {
        onSelectRoute(data.alternatives[0]);
      }
    } catch {
      setError("Could not load alternative routes.");
    } finally {
      setLoading(false);
    }
  }, [originLat, originLon, destLat, destLon, onSelectRoute]);

  useEffect(() => { fetchAlternatives(); }, [fetchAlternatives]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={18} className="animate-spin text-amber-400 mr-2" />
        <span className="font-body text-xs text-slate-400">Finding route options…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4 text-center">
        <p className="font-body text-xs text-slate-500">{error}</p>
      </div>
    );
  }

  if (routes.length < 2) {
    return (
      <div className="py-4 text-center">
        <p className="font-body text-xs text-slate-500">Only one route available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-body text-xs text-slate-500 mb-2">{routes.length} route options found</p>
      {routes.map((route) => {
        const Icon = LABEL_ICONS[route.label] || Route;
        const isSelected = route.index === selectedIndex;
        return (
          <button
            key={route.index}
            onClick={() => onSelectRoute(route)}
            className={`w-full text-left rounded-xl border p-3 transition-all ${
              isSelected
                ? "border-amber-400/40 bg-amber-400/8"
                : "border-slate-700/50 bg-slate-800/60 hover:border-slate-500"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isSelected ? "bg-amber-400/15" : "bg-slate-700/60"
              }`}>
                <Icon size={15} className={isSelected ? "text-amber-400" : "text-slate-400"} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-body font-semibold text-white text-sm">{route.label}</span>
                  {isSelected && <Check size={12} className="text-amber-400" />}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 font-body">
                  <span className="flex items-center gap-1"><MapPin size={10} />{formatDistance(route.distance)}</span>
                  <span className="flex items-center gap-1"><Clock size={10} />{formatDuration(route.duration)}</span>
                </div>
              </div>
              <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                LEVEL_COLORS[route.riskLevel] || "text-slate-400 border-slate-600"
              }`}>
                {route.riskScore}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
