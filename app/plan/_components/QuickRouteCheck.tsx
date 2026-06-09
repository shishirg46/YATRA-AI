"use client";

import { useState, useEffect } from "react";
import { Loader2, Calendar, AlertTriangle, Zap, Shield } from "lucide-react";

interface DestinationResult {
  id: string; name: string; district: string; province: string; altitude: number | null;
  latitude?: number; longitude?: number;
}

export default function QuickRouteCheck({ destination, travelDate, originLat, originLon }: {
  destination: DestinationResult;
  travelDate: string;
  originLat: number | null;
  originLon: number | null;
}) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{
    season: string;
    route?: { risk: string; reason: string; seasonalContext: string; floodRisk: number; landslideRisk: number };
    seasonalRisks: { name: string; severity: string; description: string }[];
    recommendations: string[];
  } | null>(null);

  useEffect(() => {
    if (!destination || !travelDate) return;

    async function checkRoute() {
      setLoading(true);
      try {
        const res = await fetch("/api/routes/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: originLat && originLon ? { lat: originLat, lon: originLon } : null,
            destination: {
              id: destination.id,
              lat: destination.latitude || 0,
              lon: destination.longitude || 0,
              name: destination.name,
              district: destination.district,
              province: destination.province,
            },
            travelDate,
          }),
        });
        if (res.ok) {
          setResult(await res.json());
        }
      } catch (err) {
        console.error("Route check failed:", err);
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(checkRoute, 500);
    return () => clearTimeout(timer);
  }, [destination, travelDate, originLat, originLon]);

  if (loading) {
    return (
      <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-amber-400 animate-spin" />
          <span className="font-body text-xs text-slate-400">Checking route safety for {new Date(travelDate).toLocaleDateString("en-NP", { month: "long", day: "numeric" })}...</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const riskColor = result.route?.risk === "HIGH" ? "text-orange-400 bg-orange-400/10 border-orange-400/20"
    : result.route?.risk === "MEDIUM" ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
    : "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";

  const riskIcon = result.route?.risk === "HIGH" ? Zap
    : result.route?.risk === "MEDIUM" ? AlertTriangle
    : Shield;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/50">
        <Calendar size={12} className="text-amber-400" />
        <span className="font-body text-xs text-slate-300">
          {result.season} · {new Date(travelDate).toLocaleDateString("en-NP", { month: "long", day: "numeric", year: "numeric" })}
        </span>
      </div>

      {result.route && (
        <div className={`p-3 rounded-xl border ${riskColor}`}>
          <div className="flex items-center gap-2 mb-1">
            {(() => { const Icon = riskIcon; return <Icon size={14} />; })()}
            <span className="font-body text-sm font-semibold uppercase">{result.route.risk} Risk</span>
          </div>
          <p className="font-body text-xs text-slate-300 leading-relaxed">{result.route.reason}</p>
        </div>
      )}

      {result.seasonalRisks.length > 0 && (
        <div className="space-y-2">
          {result.seasonalRisks.slice(0, 2).map((risk, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
              <AlertTriangle size={12} className={risk.severity === "HIGH" ? "text-orange-400" : "text-amber-400"} />
              <div>
                <p className="font-body text-xs text-white">{risk.name}</p>
                <p className="font-body text-[10px] text-slate-500">{risk.description.slice(0, 80)}...</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.recommendations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {result.recommendations.slice(0, 2).map((rec, i) => (
            <span key={i} className="px-2 py-1 rounded-lg bg-slate-800/40 border border-slate-700/50 font-body text-[10px] text-slate-400">
              {rec}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
