"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { X, Route, Loader2 } from "lucide-react";
import { OverlayPortal } from "@/components/overlay-portal";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import type { EnhancedRoad } from "@/lib/routing/types";

const RouteMapMini = dynamic(() => import("@/components/route-map-mini"), {
  ssr: false,
  loading: () => <div className="h-52 rounded-xl bg-slate-800/50 animate-pulse flex items-center justify-center"><Loader2 size={18} className="animate-spin text-slate-500" /></div>,
});

interface RouteModalProps {
  roads: EnhancedRoad[];
  destinationName: string;
  originName?: string;
  onClose: () => void;
}

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

function buildPlaceChain(road: EnhancedRoad, originName?: string): string[] {
  const cleanOrigin = originName?.replace(/,+\s*$/, "");
  const places: string[] = [];
  for (const seg of road.segments) {
    const from = places.length === 0 && cleanOrigin ? cleanOrigin : seg.fromName;
    if (places.length === 0 || places[places.length - 1] !== from) {
      places.push(from);
    }
    if (places[places.length - 1] !== seg.toName) {
      places.push(seg.toName);
    }
  }
  return places;
}

export function RouteModal({ roads, destinationName, originName, onClose }: RouteModalProps) {
  useBodyScrollLock(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <OverlayPortal>
      <div
        className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Route roads"
        className="fixed inset-4 z-[110] flex items-center justify-center pointer-events-none"
      >
        <div
          className="pointer-events-auto w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/25 flex items-center justify-center">
                <Route size={15} className="text-amber-400" />
              </div>
              <div>
                <p className="font-display text-white text-base font-semibold">Route Segments</p>
                <p className="font-body text-xs text-slate-400">{destinationName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {roads.length > 0 && (
                <span className="font-body text-[11px] text-slate-500">{roads.length} route{roads.length > 1 ? "s" : ""}</span>
              )}
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="p-4 overflow-y-auto max-h-[75vh] space-y-4">
            {roads.length > 0 && <RouteMapMini roads={roads} />}

            {roads.map((road) => {
              const chain = buildPlaceChain(road, originName);
              return (
                <div key={road.id} className="rounded-xl border border-slate-700/70 bg-slate-800/50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-700/10 border border-slate-700/25 flex items-center justify-center">
                        <Route size={15} className="text-slate-400" />
                      </div>
                      <div>
                        <p className="font-display text-sm font-semibold text-white">{road.name}</p>
                        <p className="font-body text-[11px] text-slate-500">
                          {formatDistance(road.distance)} · {formatDuration(road.duration)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {chain.length > 1 && (
                    <div className="px-4 pt-3">
                      <p className="font-body text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Route path</p>
                      <div className="rounded-2xl border border-slate-700/30 bg-slate-950/80 px-3 py-3">
                        <p className="font-body text-xs text-slate-200 leading-snug">
                          {chain.map((place, idx) => (
                            <span key={`${place}-${idx}`} className="inline-flex items-center gap-1">
                              {idx > 0 && <span className="text-slate-500">→</span>}
                              <span className="font-medium text-slate-100">{place}</span>
                            </span>
                          ))}
                        </p>
                      </div>
                    </div>
                  )}


                </div>
              );
            })}

            {roads.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Route size={32} className="text-slate-700 mb-3" />
                <p className="font-body text-sm text-slate-500">No route data available for this destination.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
