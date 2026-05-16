/**
 * FILE: segment-details.tsx
 * LOCATION: /components/segment-details.tsx
 * PURPOSE: Display detailed information about a specific route segment
 */

"use client";

import { AlertCircle, Cloud, Droplets, Thermometer, Wind, TrendingUp, ExternalLink } from "lucide-react";
import { getRiskColor, formatDistance, type RouteSegmentInfo } from "@/lib/map-utils";

interface SegmentDetailsProps {
  segment: RouteSegmentInfo;
  onClose: () => void;
}

export default function SegmentDetails({ segment, onClose }: SegmentDetailsProps) {
  const riskColor = getRiskColor(segment.riskLevel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-slate-900 rounded-xl border border-slate-700 max-w-md w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-800/80 backdrop-blur border-b border-slate-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-white">Segment {segment.index + 1}</h3>
            <p className="text-xs text-slate-400 mt-1">{formatDistance(segment.distance)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Risk Level */}
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: riskColor }} />
              <span className="font-semibold text-white">{segment.riskLevel} Risk</span>
            </div>
            <p className="text-xs text-slate-400">
              This segment has{" "}
              {segment.riskLevel === "LOW"
                ? "minimal hazards and favorable conditions"
                : segment.riskLevel === "MEDIUM"
                  ? "some hazard risks that require standard precautions"
                  : segment.riskLevel === "HIGH"
                    ? "significant hazard risks and should be approached carefully"
                    : "extreme hazards and should be avoided or traversed with extreme caution"}
            </p>
          </div>

          {/* Location */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">From</div>
              <div className="text-xs text-slate-300">
                {segment.startLat.toFixed(4)}°N
                <br />
                {segment.startLon.toFixed(4)}°E
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">To</div>
              <div className="text-xs text-slate-300">
                {segment.endLat.toFixed(4)}°N
                <br />
                {segment.endLon.toFixed(4)}°E
              </div>
            </div>
          </div>

          {/* Street View Button */}
          <div className="flex justify-center">
            <a
              href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${segment.startLat},${segment.startLon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-500 transition-colors w-full justify-center"
            >
              <ExternalLink size={14} />
              Open Street View
            </a>
          </div>

          {/* Weather Conditions */}
          {(segment.temperature !== undefined || segment.rainfall !== undefined) && (
            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="flex items-center gap-2 mb-3">
                <Cloud size={14} className="text-sky-400" />
                <span className="font-semibold text-white text-sm">Weather Conditions</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {segment.temperature !== undefined && (
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <Thermometer size={12} className="text-orange-400" />
                    <span>{segment.temperature}°C</span>
                  </div>
                )}
                {segment.rainfall !== undefined && (
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <Droplets size={12} className="text-blue-400" />
                    <span>{segment.rainfall}mm</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hazards */}
          {segment.hazards.length > 0 && (
            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={14} className="text-amber-400" />
                <span className="font-semibold text-white text-sm">Hazards ({segment.hazards.length})</span>
              </div>
              <div className="space-y-2">
                {segment.hazards.map((hazard, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <span className="text-amber-400 mt-1">•</span>
                    <span className="text-slate-300">{hazard}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-emerald-400" />
              <span className="font-semibold text-emerald-400 text-sm">Recommendation</span>
            </div>
            <p className="text-xs text-emerald-300/80">
              {getRecommendation(segment.riskLevel, segment.hazards)}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-800/80 backdrop-blur border-t border-slate-700 px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-amber-500 text-slate-900 font-semibold text-sm hover:bg-amber-400 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function getRecommendation(riskLevel: string, hazards: string[]): string {
  if (riskLevel === "EXTREME") {
    return "Avoid this segment or consult with local guides. Extreme hazards present.";
  }
  if (riskLevel === "HIGH") {
    return "Proceed with caution. Recommended to travel during daylight hours and with experienced guides.";
  }
  if (riskLevel === "MEDIUM") {
    return "Standard precautions apply. Check weather before departure and have emergency contacts ready.";
  }
  return "This segment is relatively safe. Maintain standard travel precautions and stay aware of conditions.";
}
