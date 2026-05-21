"use client";

import { MapContainer, TileLayer, Marker, Polyline, Circle, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface DestItem {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  verified: boolean;
  category: string;
  district: string;
}

interface HazardItem {
  id: string;
  latitude: number;
  longitude: number;
  locationName: string;
  severity: "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  floodIndex: number;
  landslideIndex: number;
}

interface NodeItem {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isHub: boolean;
}

interface EdgeItem {
  id: string;
  fromNode: { name: string; latitude: number; longitude: number };
  toNode: { name: string; latitude: number; longitude: number };
  roadName: string | null;
  distanceKm: number;
}

interface AdminInteractiveMapProps {
  destinations: DestItem[];
  hazards: HazardItem[];
  nodes: NodeItem[];
  edges: EdgeItem[];
  showDestinations: boolean;
  showHazards: boolean;
  showRoutes: boolean;
}

export default function AdminInteractiveMap({
  destinations,
  hazards,
  nodes,
  edges,
  showDestinations,
  showHazards,
  showRoutes,
}: AdminInteractiveMapProps) {

  // Custom marker configuration with Tailwind classes
  const verifiedIcon = typeof window !== "undefined" ? L.divIcon({
    html: `<div class="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-md"></div>`,
    className: "bg-transparent",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  }) : null;

  const unverifiedIcon = typeof window !== "undefined" ? L.divIcon({
    html: `<div class="w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-white shadow-md animate-pulse"></div>`,
    className: "bg-transparent",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  }) : null;

  const hubIcon = typeof window !== "undefined" ? L.divIcon({
    html: `<div class="w-3 h-3 rounded-full bg-amber-400 border border-slate-900"></div>`,
    className: "bg-transparent",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }) : null;

  const normalNodeIcon = typeof window !== "undefined" ? L.divIcon({
    html: `<div class="w-2 h-2 rounded-full bg-slate-400 border border-slate-900"></div>`,
    className: "bg-transparent",
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  }) : null;

  function getHazardColor(severity: string) {
    switch (severity) {
      case "SAFE": return "#10b981";
      case "CAUTION": return "#f59e0b";
      case "HIGH_RISK": return "#f97316";
      default: return "#ef4444";
    }
  }

  return (
    <div className="h-full w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
      <MapContainer
        center={[28.3949, 84.1240]} // Center of Nepal
        zoom={7}
        className="h-full w-full"
        style={{ background: "#020617" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* 1. Destinations Layer */}
        {showDestinations && destinations.map((dest) => {
          const icon = dest.verified ? verifiedIcon : unverifiedIcon;
          if (!icon) return null;
          return (
            <Marker key={dest.id} position={[dest.latitude, dest.longitude]} icon={icon}>
              <Tooltip>
                <div className="font-body text-xs">
                  <p className="font-bold text-white">{dest.name}</p>
                  <p className="text-slate-400 text-[10px]">{dest.category} &bull; {dest.district}</p>
                  <p className={`text-[9px] font-bold mt-1 ${dest.verified ? "text-emerald-400" : "text-rose-455"}`}>
                    {dest.verified ? "Verified" : "Pending Verification"}
                  </p>
                </div>
              </Tooltip>
            </Marker>
          );
        })}

        {/* 2. Hazards Layer */}
        {showHazards && hazards.map((haz) => {
          const color = getHazardColor(haz.severity);
          return (
            <Circle
              key={haz.id}
              center={[haz.latitude, haz.longitude]}
              radius={8000} // 8km radius hazard zones
              pathOptions={{
                color: color,
                fillColor: color,
                fillOpacity: 0.25,
                weight: 1.5,
              }}
            >
              <Tooltip>
                <div className="font-body text-xs">
                  <p className="font-bold text-white">Hazard Alert: {haz.locationName}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Flood: {haz.floodIndex.toFixed(2)} &bull; Landslide: {haz.landslideIndex.toFixed(2)}
                  </p>
                  <p className="text-[10px] font-bold mt-1 uppercase" style={{ color }}>
                    Severity: {haz.severity.replace(/_/g, " ")}
                  </p>
                </div>
              </Tooltip>
            </Circle>
          );
        })}

        {/* 3. Routes Layer */}
        {showRoutes && (
          <>
            {/* Polylines */}
            {edges.map((edge) => {
              if (!edge.fromNode || !edge.toNode) return null;
              const positions: [number, number][] = [
                [edge.fromNode.latitude, edge.fromNode.longitude],
                [edge.toNode.latitude, edge.toNode.longitude],
              ];
              return (
                <Polyline
                  key={edge.id}
                  positions={positions}
                  pathOptions={{ color: "#38bdf8", weight: 2, opacity: 0.6 }}
                />
              );
            })}
            
            {/* Markers */}
            {nodes.map((node) => {
              const icon = node.isHub ? hubIcon : normalNodeIcon;
              if (!icon) return null;
              return (
                <Marker key={node.id} position={[node.latitude, node.longitude]} icon={icon}>
                  <Tooltip>
                    <div className="font-body text-[10px] font-semibold text-slate-200">
                      {node.name} ({node.isHub ? "Transit Hub" : "Waypoint"})
                    </div>
                  </Tooltip>
                </Marker>
              );
            })}
          </>
        )}
      </MapContainer>
    </div>
  );
}
