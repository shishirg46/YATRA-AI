/**
 * FILE: route-map.tsx
 * LOCATION: /components/route-map.tsx
 * PURPOSE: Interactive map component for displaying routes with segments and hazard overlays
 *
 * Features:
 * - Display route with waypoints
 * - Show route segments with color-coded risk levels
 * - Display hazard zones and weather data
 * - Interactive popups with segment details
 * - Responsive and mobile-friendly
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import L, { LatLngBounds } from "leaflet";
import { MapContainer, TileLayer, Popup, Marker, useMap, Polyline } from "react-leaflet";
import { MapPin, Zap, Cloud } from "lucide-react";
import type { HighwaySegment, RouteProvenance } from "@/lib/routing/types";
import {
  toLatLng,
  getRiskColor,
  getRiskOpacity,
  formatDistance,
  formatDuration,
  calculateBounds,
  createSegmentPopup,
  NEPAL_BOUNDS,
  NEPAL_CENTER,
  isInNepalBounds,
  type RouteSegmentInfo,
} from "@/lib/map-utils";

// Fix Leaflet marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface Waypoint {
  lat: number;
  lon: number;
  name?: string;
  order?: number;
}

interface RouteMapProps {
  waypoints: Waypoint[];
  polyline?: Array<{ lat: number; lon: number }>;
  segments?: RouteSegmentInfo[];
  originName?: string;
  destinationName?: string;
  distance?: number;
  duration?: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  onSegmentClick?: (segment: RouteSegmentInfo) => void;
  alternatives?: Array<{
    polyline: Array<{ lat: number; lon: number }>;
    distance: number;
    duration: number;
  }>;
  selectedRouteIndex?: number;
  onRouteSelect?: (index: number) => void;
  height?: string;
  userLocation?: { lat: number; lon: number } | null;
  segmentRoutes?: Array<{
    from: { lat: number; lon: number; name?: string };
    to: { lat: number; lon: number; name?: string };
    polyline: Array<{ lat: number; lon: number }>;
    distance: number;
    duration: number;
    alternatives: Array<{
      polyline: Array<{ lat: number; lon: number }>;
      distance: number;
      duration: number;
    }>;
  }>;
  highwaySegments?: HighwaySegment[];
  provenance?: RouteProvenance | null;
}

function MapController({ bounds }: { bounds: LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
}

export default function RouteMap({
  waypoints,
  polyline,
  segments = [],
  originName = "Origin",
  destinationName = "Destination",
  distance,
  duration,
  riskLevel = "MEDIUM",
  onSegmentClick,
  alternatives = [],
  selectedRouteIndex = 0,
  onRouteSelect,
  height = "h-96",
  userLocation = null,
  segmentRoutes = [],
  highwaySegments = [],
  provenance = null,
}: RouteMapProps) {
  const pathPoints = useMemo(() => {
    const raw = polyline && polyline.length >= 2 ? polyline : waypoints;
    const filtered = raw.filter((p) => isInNepalBounds(p.lat, p.lon));
    return filtered.length >= 2 ? filtered : waypoints.filter((p) => isInNepalBounds(p.lat, p.lon));
  }, [polyline, waypoints]);
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);


  useEffect(() => {
    const forBounds = [...pathPoints];
    if (userLocation && isInNepalBounds(userLocation.lat, userLocation.lon)) {
      forBounds.push(userLocation);
    }
    if (forBounds.length >= 2) {
      const boundsArray = calculateBounds(forBounds);
      setBounds(L.latLngBounds([boundsArray[0], boundsArray[1]]));
    } else if (forBounds.length === 1) {
      const p = forBounds[0];
      setBounds(
        L.latLngBounds([
          [p.lat - 0.15, p.lon - 0.15],
          [p.lat + 0.15, p.lon + 0.15],
        ])
      );
    } else {
      setBounds(L.latLngBounds(NEPAL_BOUNDS));
    }
  }, [pathPoints, userLocation]);

  // Render highway abstraction when DOR provenance is available,
  // fall back to raw node segments for OSRM / estimated routes
  const renderSegments = () => {
    if (provenance?.engine === "dor" && highwaySegments.length > 0) {
      return highwaySegments.map((hs, i) => (
        <HighwaySegmentLabel key={`hs-${i}`} segment={hs} index={i} />
      ));
    }
    if (segments.length === 0 || pathPoints.length > 2) return null;

    return segments.map((segment, idx) => (
      <SegmentPolyline key={`segment-${idx}`} segment={segment} onClick={onSegmentClick} />
    ));
  };

  // Render waypoints
  const renderWaypoints = () => {
    return waypoints.map((wp, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === waypoints.length - 1;
      const isOrigin = isFirst;
      const isDestination = isLast;

      return (
        <Marker
          key={`waypoint-${idx}`}
          position={toLatLng(wp.lat, wp.lon)}
          icon={
            isOrigin
              ? createWaypointIcon("origin")
              : isDestination
                ? createWaypointIcon("destination")
                : createWaypointIcon("waypoint")
          }
        >
          <Popup>
            <div className="font-body text-xs">
              <div className="font-semibold">{wp.name || (isOrigin ? originName : isDestination ? destinationName : `Stop ${idx}`)}</div>
              <div className="text-slate-600 mt-1">
                {wp.lat.toFixed(4)}, {wp.lon.toFixed(4)}
              </div>
            </div>
          </Popup>
        </Marker>
      );
    });
  };

  const hasData = waypoints.length > 0;

  if (!hasData) {
    return (
      <div className={`${height} w-full bg-slate-900 rounded-lg border border-slate-700 flex items-center justify-center`}>
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <MapPin size={24} />
          <span className="text-sm">No route data available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg overflow-hidden border border-slate-700 bg-slate-900">
      {/* Header Info */}
      <div className="bg-slate-800/50 border-b border-slate-700 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          {distance && (
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <MapPin size={14} className="text-amber-400" />
              <span>{formatDistance(distance)}</span>
            </div>
          )}
          {duration && (
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Cloud size={14} className="text-blue-400" />
              <span>{formatDuration(duration)}</span>
            </div>
          )}
          <div className={`flex items-center gap-2 text-xs font-semibold ${getRiskBadgeClass(riskLevel)}`}>
            <Zap size={14} />
            <span>{riskLevel} Risk</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-500">OpenStreetMap</div>
      </div>

      {/* Map Container */}
      <MapContainer
        center={NEPAL_CENTER}
        zoom={7}
        minZoom={7}
        maxZoom={14}
        maxBounds={L.latLngBounds(NEPAL_BOUNDS)}
        maxBoundsViscosity={1}
        style={{ height: "400px", width: "100%" }}
        className="map-container"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        {/* Segments */}
        {renderSegments()}

        {/* Main route polyline */}
        {pathPoints.length > 1 && (
          <RoutePolyline
            waypoints={pathPoints}
            riskLevel={riskLevel}
            isActive={selectedRouteIndex === 0}
            onClick={() => onRouteSelect?.(0)}
          />
        )}

        {/* Alternatives */}
        {alternatives.map((alt, i) => (
          <RoutePolyline
            key={`alt-${i}`}
            waypoints={alt.polyline}
            riskLevel={riskLevel}
            isActive={selectedRouteIndex === i + 1}
            isAlternative={true}
            onClick={() => onRouteSelect?.(i + 1)}
          />
        ))}

        {/* Per-segment alternatives (thin dashed lines) */}
        {segmentRoutes.map((sr, segIdx) =>
          sr.alternatives.map((alt, altIdx) => (
            <Polyline
              key={`seg-${segIdx}-alt-${altIdx}`}
              positions={alt.polyline
                .filter((p) => isInNepalBounds(p.lat, p.lon))
                .map((p) => toLatLng(p.lat, p.lon))}
              color="#64748b"
              weight={2}
              opacity={0.35}
              dashArray="6, 4"
              smoothFactor={1}
              interactive={false}
            />
          ))
        )}

        {/* Waypoints */}
        {renderWaypoints()}

        {userLocation && isInNepalBounds(userLocation.lat, userLocation.lon) && (
          <Marker
            position={toLatLng(userLocation.lat, userLocation.lon)}
            icon={createWaypointIcon("user")}
          >
            <Popup>
              <div className="font-body text-xs">
                <div className="font-semibold">Your position</div>
                <div className="text-slate-600 mt-1">
                  {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Map controller for bounds fitting */}
        {bounds && <MapController bounds={bounds} />}
      </MapContainer>

      {/* Legend */}
      <div className="bg-slate-800/50 border-t border-slate-700 px-4 py-2 grid grid-cols-4 gap-3 text-[11px]">
        <div className="flex items-center gap-2">
          <div className="w-4 h-3" style={{ backgroundColor: "#34d399" }} />
          <span className="text-slate-400">Low</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3" style={{ backgroundColor: "#fbbf24" }} />
          <span className="text-slate-400">Medium</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3" style={{ backgroundColor: "#fb923c" }} />
          <span className="text-slate-400">High</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3" style={{ backgroundColor: "#f87171" }} />
          <span className="text-slate-400">Extreme</span>
        </div>
      </div>
    </div>
  );
}

function RoutePolyline({
  waypoints,
  riskLevel,
  isActive = true,
  isAlternative = false,
  onClick,
}: {
  waypoints: Waypoint[];
  riskLevel: string;
  isActive?: boolean;
  isAlternative?: boolean;
  onClick?: () => void;
}) {
  const positions = waypoints.map((wp) => toLatLng(wp.lat, wp.lon));

  return (
    <Polyline
      positions={positions}
      color={isAlternative && !isActive ? "#64748b" : getRiskColor(riskLevel)}
      weight={isActive ? 6 : 4}
      opacity={isActive ? 0.9 : 0.4}
      smoothFactor={1}
      interactive={true}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e);
          onClick?.();
        },
      }}
    />
  );
}

function SegmentPolyline({
  segment,
  onClick,
}: {
  segment: RouteSegmentInfo;
  onClick?: (segment: RouteSegmentInfo) => void;
}) {
  const positions = [
    toLatLng(segment.startLat, segment.startLon),
    toLatLng(segment.endLat, segment.endLon),
  ];

  const color = getRiskColor(segment.riskLevel);
  const opacity = getRiskOpacity(segment.riskLevel);

  const handleClick = () => {
    onClick?.(segment);
  };

  return (
    <Polyline
      positions={positions}
      color={color}
      weight={6}
      opacity={opacity}
      interactive={true}
      eventHandlers={{
        click: handleClick,
      }}
    >
      <Popup>
        <div
          className="font-body text-xs"
          dangerouslySetInnerHTML={{
            __html: createSegmentPopup(segment),
          }}
        />
      </Popup>
    </Polyline>
  );
}

function HighwaySegmentLabel({ segment, index }: { segment: HighwaySegment; index: number }) {
  return (
    <Polyline
      positions={[
        toLatLng(segment.fromLat, segment.fromLon),
        toLatLng(segment.toLat, segment.toLon),
      ]}
      color="#fbbf24"
      weight={4}
      opacity={0.6}
    >
      <Popup>
        <div className="font-body text-xs space-y-1">
          <div className="font-semibold text-amber-400">{segment.roadCode}</div>
          <div>{segment.fromPlace} → {segment.toPlace}</div>
          <div className="text-slate-500">{segment.distanceKm.toFixed(1)} km ({segment.nodeCount} nodes)</div>
        </div>
      </Popup>
    </Polyline>
  );
}

function createWaypointIcon(type: "origin" | "destination" | "waypoint" | "user"): L.DivIcon {
  const fill =
    type === "origin"
      ? "#10b981"
      : type === "destination"
        ? "#f87171"
        : type === "user"
          ? "#38bdf8"
          : "#fbbf24";
  const label =
    type === "origin" ? "S" : type === "destination" ? "E" : type === "user" ? "U" : "·";
  const html = `
    <div style="display: flex; align-items: center; justify-content: center;">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="14" fill="${fill}" stroke="white" stroke-width="2"/>
        <text x="16" y="20" text-anchor="middle" fill="white" font-size="12" font-weight="bold">
          ${label}
        </text>
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
    className: "waypoint-icon",
  });
}

function getRiskBadgeClass(risk: string): string {
  switch (risk) {
    case "LOW":
      return "text-emerald-400";
    case "MEDIUM":
      return "text-amber-400";
    case "HIGH":
      return "text-orange-400";
    case "EXTREME":
      return "text-red-400";
    default:
      return "text-slate-400";
  }
}
