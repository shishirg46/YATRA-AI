"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapNode {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isHub: boolean;
}

interface MapEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distanceKm: number;
  roadName: string | null;
  fromNode: { name: string; latitude: number; longitude: number };
  toNode: { name: string; latitude: number; longitude: number };
}

interface RouteGraphMapProps {
  nodes: MapNode[];
  edges: MapEdge[];
  onNodeClick?: (node: MapNode) => void;
  selectedNodeId?: string | null;
}

// Map Updater to auto-fit bounds
function FitBounds({ nodes }: { nodes: MapNode[] }) {
  const map = useMap();
  useEffect(() => {
    if (nodes.length > 0) {
      const bounds = L.latLngBounds(nodes.map((n) => [n.latitude, n.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [nodes, map]);
  return null;
}

export default function RouteGraphMap({ nodes, edges, onNodeClick, selectedNodeId }: RouteGraphMapProps) {
  const hubIcon = typeof window !== "undefined" ? L.divIcon({
    html: `<div class="w-4 h-4 rounded-full bg-amber-400 border-2 border-slate-900 shadow-[0_0_8px_rgba(251,191,36,0.8)] flex items-center justify-center"><div class="w-1.5 h-1.5 bg-slate-950 rounded-full animate-ping"></div></div>`,
    className: "bg-transparent",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  }) : null;

  const normalIcon = typeof window !== "undefined" ? L.divIcon({
    html: `<div class="w-3 h-3 rounded-full bg-sky-400 border-2 border-slate-900 shadow-md"></div>`,
    className: "bg-transparent",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }) : null;

  const selectedIcon = typeof window !== "undefined" ? L.divIcon({
    html: `<div class="w-5 h-5 rounded-full bg-rose-500 border-2 border-white shadow-[0_0_12px_rgba(244,63,94,1)] flex items-center justify-center"><div class="w-2 h-2 bg-white rounded-full"></div></div>`,
    className: "bg-transparent",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  }) : null;

  return (
    <div className="h-full w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950 relative">
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

        <FitBounds nodes={nodes} />

        {/* Render Edges as Polylines */}
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
              pathOptions={{
                color: "#64748b",
                weight: 2.5,
                opacity: 0.7,
                dashArray: "4, 6",
              }}
              eventHandlers={{
                mouseover: (e) => {
                  e.target.setStyle({ color: "#fbbf24", weight: 4.5, opacity: 1.0 });
                },
                mouseout: (e) => {
                  e.target.setStyle({ color: "#64748b", weight: 2.5, opacity: 0.7 });
                },
              }}
            >
              <Tooltip sticky>
                <div className="font-body text-xs text-slate-200">
                  <p className="font-bold">{edge.roadName || "Unnamed Segment Road"}</p>
                  <p className="text-slate-400 mt-0.5">{edge.distanceKm.toFixed(2)} Km</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {edge.fromNode.name} &harr; {edge.toNode.name}
                  </p>
                </div>
              </Tooltip>
            </Polyline>
          );
        })}

        {/* Render Nodes as Markers */}
        {nodes.map((node) => {
          const isSelected = selectedNodeId === node.id;
          const currentIcon = isSelected 
            ? selectedIcon 
            : (node.isHub ? hubIcon : normalIcon);

          if (!currentIcon) return null;

          return (
            <Marker
              key={node.id}
              position={[node.latitude, node.longitude]}
              icon={currentIcon}
              eventHandlers={{
                click: () => {
                  if (onNodeClick) onNodeClick(node);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -5]}>
                <div className="font-body text-xs font-semibold">
                  <p className="text-slate-100">{node.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {node.isHub ? "Transit Hub" : "Route Node"}
                  </p>
                </div>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
