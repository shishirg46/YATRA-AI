/**
 * FILE: route-directions.tsx
 * LOCATION: /components/route-directions.tsx
 * PURPOSE: Display turn-by-turn navigation instructions for a route
 */

"use client";

import { MapPin, Navigation, ArrowRight, ChevronRight, CornerDownRight, CornerUpRight, MoveUp } from "lucide-react";
import { formatDistance, formatDuration } from "@/lib/map-utils";
import type { RouteInstruction } from "@/lib/routing/types";

interface RouteDirectionsProps {
  instructions: RouteInstruction[];
  distance?: number;
  duration?: number;
  originName?: string;
  destinationName?: string;
}

export default function RouteDirections({
  instructions,
  distance,
  duration,
  originName = "Origin",
  destinationName = "Destination",
}: RouteDirectionsProps) {
  if (!instructions || instructions.length === 0) return null;

  return (
    <div className="w-full bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-800/80 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-lg">
            <Navigation size={18} className="text-amber-500" />
          </div>
          <div>
            <h3 className="font-display font-bold text-white text-sm">Street Directions</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Turn-by-turn guidance</p>
          </div>
        </div>
        {(distance !== undefined || duration !== undefined) && (
          <div className="flex items-center gap-4 text-xs font-body">
            {distance !== undefined && (
              <div className="flex flex-col items-end">
                <span className="text-slate-500 text-[10px]">Distance</span>
                <span className="text-slate-200 font-semibold">{formatDistance(distance)}</span>
              </div>
            )}
            {duration !== undefined && (
              <div className="flex flex-col items-end">
                <span className="text-slate-500 text-[10px]">Time</span>
                <span className="text-slate-200 font-semibold">{formatDuration(duration)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Instructions List */}
      <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
        {/* Start Point */}
        <div className="px-6 py-4 flex items-start gap-4 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group">
          <div className="mt-1 p-1.5 bg-emerald-500/20 rounded-full group-hover:scale-110 transition-transform">
            <MapPin size={14} className="text-emerald-500" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-white">Start at {originName}</p>
            <p className="text-[11px] text-slate-500 mt-1">Begin your journey towards Nepal's corridor</p>
          </div>
        </div>

        {/* Steps */}
        {instructions.map((step, idx) => (
          <div 
            key={idx} 
            className="px-6 py-4 flex items-start gap-4 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group"
          >
            <div className="mt-1 p-1.5 bg-slate-700/50 rounded-lg text-slate-400 group-hover:bg-amber-500/10 group-hover:text-amber-500 transition-colors">
              {getDirectionIcon(step.type)}
            </div>
            <div className="flex-1">
              <p className="text-xs text-slate-200 leading-relaxed">{step.text}</p>
              <div className="flex items-center gap-3 mt-2">
                {step.distance > 0 && (
                  <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    {formatDistance(step.distance)}
                  </span>
                )}

              </div>
            </div>
          </div>
        ))}

        {/* End Point */}
        <div className="px-6 py-5 flex items-start gap-4 bg-amber-500/5 group">
          <div className="mt-1 p-1.5 bg-red-500/20 rounded-full group-hover:scale-110 transition-transform">
            <MapPin size={14} className="text-red-500" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-white">Arrive at {destinationName}</p>
            <p className="text-[11px] text-slate-500 mt-1">Destination reached safely</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function getDirectionIcon(type: string) {
  switch (type) {
    case "turn":
    case "on ramp":
      return <CornerDownRight size={14} />;
    case "merge":
    case "fork":
      return <CornerUpRight size={14} />;
    case "roundabout":
    case "rotary":
      return <Navigation size={14} className="rotate-90" />;
    case "depart":
    case "arrive":
      return <MoveUp size={14} />;
    default:
      return <ArrowRight size={14} />;
  }
}
