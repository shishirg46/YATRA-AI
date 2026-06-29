"use client";

import { useEffect, useMemo, useState } from "react";
import * as L from "leaflet";
import { MapContainer, TileLayer, Marker, useMap, Polyline } from "react-leaflet";
import { calculateBounds, NEPAL_BOUNDS } from "@/lib/map-utils";
import type { EnhancedRoad } from "@/lib/routing/types";

const ROAD_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444"];

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const startIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;background:#10b981;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const endIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function FitBounds({ roads }: { roads: EnhancedRoad[] }) {
  const map = useMap();
  useEffect(() => {
    const allPoints: Array<{ lat: number; lon: number }> = [];
    for (const road of roads) {
      for (const c of road.fullCoordinates) {
        allPoints.push(c);
      }
    }
    const [sw, ne] = allPoints.length >= 2 ? calculateBounds(allPoints) : NEPAL_BOUNDS;
    map.fitBounds(L.latLngBounds(sw, ne), { padding: [40, 40] });
  }, [roads, map]);
  return null;
}

export default function RouteMapMini({ roads }: { roads: EnhancedRoad[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const allPoints = useMemo(() => {
    const pts: Array<{ lat: number; lon: number }> = [];
    for (const road of roads) {
      for (const c of road.fullCoordinates) {
        pts.push(c);
      }
    }
    return pts;
  }, [roads]);
  const center = allPoints.length > 0
    ? [allPoints[Math.floor(allPoints.length / 2)].lat, allPoints[Math.floor(allPoints.length / 2)].lon] as [number, number]
    : [28.0, 84.0] as [number, number];

  if (!mounted) return <div className="h-52 rounded-xl bg-slate-800/50 animate-pulse" />;

  return (
    <MapContainer
      center={center}
      zoom={9}
      className="h-52 w-full rounded-xl"
      style={{ background: "#020617" }}
      zoomControl={true}
      scrollWheelZoom={true}
      dragging={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds roads={roads} />
      {roads.map((road, ri) => (
        <Polyline
          key={road.id}
          positions={road.fullCoordinates.map((c) => [c.lat, c.lon] as [number, number])}
          pathOptions={{ color: ROAD_COLORS[ri % ROAD_COLORS.length], weight: 3, opacity: 0.85 }}
        />
      ))}
      {roads.length > 0 && roads[0].fullCoordinates.length > 0 && (
        <Marker position={[roads[0].fullCoordinates[0].lat, roads[0].fullCoordinates[0].lon]} icon={startIcon} />
      )}
      {(() => {
        if (roads.length === 0) return null;
        const lastRoad = roads[roads.length - 1];
        const coords = lastRoad.fullCoordinates;
        if (coords.length === 0) return null;
        return <Marker position={[coords[coords.length - 1].lat, coords[coords.length - 1].lon]} icon={endIcon} />;
      })()}
    </MapContainer>
  );
}
