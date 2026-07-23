"use client";

import { useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { X, Route, Loader2 } from "lucide-react";
import { OverlayPortal } from "@/components/overlay-portal";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import type { EnhancedRoad } from "@/lib/routing/types";

const RouteMapMini = dynamic(() => import("@/components/route-map-mini"), {
  ssr: false,
  loading: () => (
    <div className="h-52 rounded-xl bg-slate-800/50 animate-pulse flex items-center justify-center">
      <Loader2 size={18} className="animate-spin text-slate-500" />
    </div>
  ),
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

function stripWardSuffix(name: string): string {
  return name.replace(/[-–—]\s*\d+\s*$/, "").trim();
}

function buildPlaceChain(road: EnhancedRoad, originName?: string, destinationName?: string): string[] {
  const cleanOrigin = originName?.replace(/,+\s*$/, "").trim();
  const places: string[] = [];
  const seen = new Set<string>();
  for (const seg of road.segments) {
    const from = places.length === 0 && cleanOrigin ? cleanOrigin : seg.fromName;
    const fromNorm = stripWardSuffix(from).toLowerCase();
    if (places.length === 0 || !seen.has(fromNorm)) {
      places.push(from);
      seen.add(fromNorm);
    }
    const toNorm = stripWardSuffix(seg.toName).toLowerCase();
    if (!seen.has(toNorm)) {
      places.push(seg.toName);
      seen.add(toNorm);
    }
  }
  if (destinationName && places.length > 0) {
    const destNorm = stripWardSuffix(destinationName).toLowerCase();
    const filtered = places.filter((p, i) =>
      i === places.length - 1 ||
      (!stripWardSuffix(p).toLowerCase().includes(destNorm) &&
        !destNorm.includes(stripWardSuffix(p).toLowerCase()))
    );
    filtered[filtered.length - 1] = destinationName;
    return filtered;
  }
  return places;
}

// ── Road strip component ──────────────────────────────────────────────────────
function RoadStrip({ chain }: { chain: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const vehicleRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const onScroll = useCallback(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    const vehicle = vehicleRef.current;
    const fill = fillRef.current;
    if (!scroller || !inner || !vehicle || !fill) return;

    const maxScroll = inner.scrollWidth - scroller.clientWidth;
    const progress = maxScroll > 0 ? scroller.scrollLeft / maxScroll : 0;
    const totalWidth = inner.scrollWidth;
    const vehicleX = progress * (totalWidth - 24) + 4;

    vehicle.style.left = `${vehicleX}px`;
    fill.style.width = `${vehicleX}px`;

    const innerRect = inner.getBoundingClientRect();
    dotRefs.current.forEach((dot, i) => {
      if (!dot) return;
      const rect = dot.getBoundingClientRect();
      const stopCenter = rect.left - innerRect.left + scroller.scrollLeft + rect.width / 2;
      const passed = stopCenter <= vehicleX + 12;
      const label = labelRefs.current[i];

      if (passed) {
        dot.style.background = "#fbbf24";
        dot.style.borderColor = "#fbbf24";
        dot.style.boxShadow = "0 0 6px rgba(251,191,36,0.6)";
        if (label) label.style.color = "#f1f5f9";
      } else {
        dot.style.background = "#1e293b";
        dot.style.borderColor = "#475569";
        dot.style.boxShadow = "none";
        if (label) label.style.color = "#475569";
      }
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const isFirst = (i: number) => i === 0;
  const isLast = (i: number) => i === chain.length - 1;
  const isEndpoint = (i: number) => isFirst(i) || isLast(i);

  return (
    <div>
      {/* Hidden-scrollbar road container */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style>{`.road-strip-inner::-webkit-scrollbar{display:none}`}</style>
        <div
          ref={innerRef}
          className="road-strip-inner relative flex items-center min-w-max px-1 pb-3"
        >
          {/* Asphalt surface */}
          <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-5.5 bg-slate-800 border-t border-b border-slate-700 z-0" style={{marginBottom:"12px"}} />
          {/* Center dashes */}
          <div
            className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-[3px] z-[1] opacity-40"
            style={{
              background: "repeating-linear-gradient(90deg,#fbbf24 0px,#fbbf24 10px,transparent 10px,transparent 22px)",
              marginBottom: "12px",
            }}
          />
          {/* Amber fill (road traveled) */}
          <div
            ref={fillRef}
            className="absolute top-1/2 left-0 -translate-y-1/2 h-5.5 z-[1] pointer-events-none"
            style={{ width: 0, background: "rgba(251,191,36,0.12)", marginBottom: "12px", transition: "width 0.1s linear" }}
          />
          {/* Vehicle */}
          <div
            ref={vehicleRef}
            className="absolute top-1/2 z-[3]"
            style={{
              left: 4,
              transform: "translateY(-50%)",
              width: 18,
              height: 10,
              background: "#fbbf24",
              borderRadius: 3,
              boxShadow: "0 0 8px rgba(251,191,36,0.8), 12px 0 6px rgba(251,191,36,0.15)",
              transition: "left 0.12s linear",
            }}
          >
            {/* Arrow tip */}
            <div style={{
              position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)",
              borderLeft: "6px solid #fbbf24",
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
            }} />
          </div>

          {/* Stops */}
          {chain.map((place, i) => (
            <div
              key={`${place}-${i}`}
              className="relative z-2 flex flex-col items-center shrink-0"
              style={{ width: isEndpoint(i) ? 80 : 72 }}
            >
              {/* Label above */}
              <p
                ref={el => { labelRefs.current[i] = el; }}
                className="font-body text-center mb-1.5 leading-tight"
                style={{
                  fontSize: 11,
                  margin: "0 0 6px",
                  color: isFirst(i) ? "#f1f5f9" : "#475569",
                  fontWeight: isEndpoint(i) ? 600 : 400,
                  transition: "color 0.3s ease",
                }}
              >
                {place}
              </p>
              {/* Dot on road */}
              <div
                ref={el => { dotRefs.current[i] = el; }}
                style={{
                  width: isEndpoint(i) ? 14 : 9,
                  height: isEndpoint(i) ? 14 : 9,
                  borderRadius: "50%",
                  background: isFirst(i) ? "#fbbf24" : "#1e293b",
                  border: `${isEndpoint(i) ? 3 : 2}px solid ${isFirst(i) ? "#fbbf24" : "#475569"}`,
                  boxShadow: isFirst(i) ? "0 0 6px rgba(251,191,36,0.6)" : "none",
                  transition: "background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
                  flexShrink: 0,
                }}
              />
              {/* Sub-label below endpoint */}
              {isEndpoint(i) && (
                <p style={{ margin: "5px 0 0", fontSize: 9, color: isFirst(i) ? "#fbbf24" : "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", transition: "color 0.3s ease" }}>
                  {isFirst(i) ? "Start" : "Destination"}
                </p>
              )}
              {!isEndpoint(i) && <div style={{ height: 17 }} />}
            </div>
          ))}
        </div>
      </div>
      <p className="font-body text-center text-slate-600 mt-1" style={{ fontSize: 10 }}>← scroll to travel →</p>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
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
        className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Route roads"
        className="fixed inset-4 z-110 flex items-center justify-center pointer-events-none"
      >
        <div
          className="pointer-events-auto w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
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
                <span className="font-body text-[11px] text-slate-500">
                  {roads.length} route{roads.length > 1 ? "s" : ""}
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 overflow-y-auto max-h-[75vh] space-y-4">
            {roads.length > 0 && <RouteMapMini roads={roads} />}

            {roads.map((road) => {
              const chain = buildPlaceChain(road, originName, destinationName);
              return (
                <div key={road.id} className="rounded-xl border border-slate-700/70 bg-slate-800/50 overflow-hidden">
                  {/* Route header */}
                  <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
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

                  {/* Road strip */}
                  {chain.length > 1 && (
                    <div className="px-4 pt-4 pb-3">
                      <p className="font-body text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold flex items-center gap-1.5">
                        Route path
                        <span className="normal-case tracking-normal font-normal text-slate-600">· {chain.length} stops</span>
                      </p>
                      <RoadStrip chain={chain} />
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