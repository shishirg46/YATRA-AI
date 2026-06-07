"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Layers } from "lucide-react";
import type { Destination } from "./types";

const SAFETY_COLORS: Record<string, string> = {
  SAFE: "#34d399",
  CAUTION: "#f59e0b",
  HIGH_RISK: "#fb923c",
  EXTREME: "#ef4444",
};

const SAFETY_LABELS: Record<string, string> = {
  SAFE: "Safe",
  CAUTION: "Caution",
  HIGH_RISK: "High Risk",
  EXTREME: "Extreme",
};

const LEVELS = [
  { key: "SAFE", label: "Safe", color: SAFETY_COLORS.SAFE },
  { key: "CAUTION", label: "Caution", color: SAFETY_COLORS.CAUTION },
  { key: "HIGH_RISK", label: "High Risk", color: SAFETY_COLORS.HIGH_RISK },
  { key: "EXTREME", label: "Extreme", color: SAFETY_COLORS.EXTREME },
];

const NEPAL_BOUNDS = {
  minLat: 26.3,
  maxLat: 30.5,
  minLng: 80.0,
  maxLng: 88.2,
};

function inNepal(lat: number, lng: number) {
  return (
    lat >= NEPAL_BOUNDS.minLat && lat <= NEPAL_BOUNDS.maxLat &&
    lng >= NEPAL_BOUNDS.minLng && lng <= NEPAL_BOUNDS.maxLng
  );
}

interface SafetyMapProps {
  destinations: Destination[];
}

export function SafetyMap({ destinations }: SafetyMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const leafletRef = useRef<any>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const nepalDestinations = destinations.filter(
    (d) => d.latitude && d.longitude && inNepal(d.latitude, d.longitude)
  );
  const skippedCount = destinations.length - nepalDestinations.length;

  useEffect(() => {
    const container = mapRef.current;
    if (!container) return;

    // Leaflet sets _leaflet_id synchronously on the container DOM element.
    // This check survives StrictMode unmount/remount cycles.
    if ((container as any)._leaflet_id) return;

    let cancelled = false;

    const initMap = async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;

      const map = L.map(container, {
        center: [28.3949, 84.124],
        zoom: 7,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);

      leafletRef.current = L;
      mapInstanceRef.current = map;
      renderMarkers(map, L, nepalDestinations, activeFilter, markersRef);
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current && mapInstanceRef.current.remove) {
        mapInstanceRef.current.remove();
      }
      mapInstanceRef.current = null;
      markersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    renderMarkers(map, L, nepalDestinations, activeFilter, markersRef);
  }, [nepalDestinations, activeFilter]);

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-700/50 bg-slate-900/60">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <MapPin size={15} className="text-amber-400" />
          <span className="font-display font-bold text-white text-sm">Safety Overview</span>
          <span className="font-body text-xs text-slate-500">{nepalDestinations.length} of {destinations.length} shown{skippedCount > 0 ? ` (${skippedCount} outside Nepal)` : ""}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50">
            <Layers size={11} className="text-slate-500" />
            {LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setActiveFilter(activeFilter === l.key ? null : l.key)}
                className={`w-2.5 h-2.5 rounded-full transition-transform hover:scale-125 ${activeFilter === l.key ? "ring-1 ring-white/40 scale-125" : ""}`}
                style={{ background: l.color }}
                title={`${l.label}${activeFilter === l.key ? " (active)" : ""}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div ref={mapRef} className="w-full h-[400px] md:h-[500px]" />
    </div>
  );
}

function renderMarkers(
  map: any,
  L: any,
  destinations: Destination[],
  activeFilter: string | null,
  markersRef: React.MutableRefObject<any[]>,
) {
  markersRef.current.forEach((m) => { try { map.removeLayer(m); } catch {} });
  markersRef.current = [];

  const filtered = activeFilter
    ? destinations.filter((d) => d.safetyLevel === activeFilter)
    : destinations;

  filtered.forEach((dest) => {
    if (!dest.latitude || !dest.longitude) return;
    if (!inNepal(dest.latitude, dest.longitude)) return;

    const color = SAFETY_COLORS[dest.safetyLevel] || "#64748b";
    const label = SAFETY_LABELS[dest.safetyLevel] || "Unknown";

    const marker = L.circleMarker([dest.latitude, dest.longitude], {
      radius: 8,
      fillColor: color,
      color: "rgba(255,255,255,0.3)",
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.7,
    }).addTo(map);

    marker.bindPopup(`
      <div style="min-width:160px;padding:4px;">
        <p style="font-weight:700;font-size:13px;margin:0 0 2px;color:#e2e8f0;font-family:'DM Sans',sans-serif;">${dest.name}</p>
        <p style="font-size:11px;color:#94a3b8;margin:0 0 6px;font-family:'DM Sans',sans-serif;">${dest.district}, ${dest.province}</p>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>
          <span style="font-size:11px;font-weight:600;color:${color};font-family:'DM Sans',sans-serif;">${label}</span>
          <span style="font-size:11px;color:#94a3b8;font-family:'DM Sans',sans-serif;">· ${dest.safetyScore}</span>
        </div>
        <a href="/destinations/${dest.id}" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#f59e0b;text-decoration:none;font-family:'DM Sans',sans-serif;">
          View details →
        </a>
      </div>
    `);

    marker.on("mouseover", () => { marker.setRadius(11); });
    marker.on("mouseout", () => { marker.setRadius(8); });

    markersRef.current.push(marker);
  });

  if (filtered.length > 0 && L.featureGroup) {
    const group = L.featureGroup(markersRef.current);
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }
  }
}
