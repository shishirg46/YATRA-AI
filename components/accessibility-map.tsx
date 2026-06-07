"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, useMap, Popup } from "react-leaflet";
import { NEPAL_BOUNDS, NEPAL_CENTER, formatDistance } from "@/lib/map-utils";
import type { RouteAccessibilityResult } from "@/lib/accessibility/types";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const userIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:20px;height:20px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const destIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:24px;height:24px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:14px;">D</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const reachableIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:18px;height:18px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

interface AccessibilityMapProps {
  result: RouteAccessibilityResult | null;
  userLocation: { lat: number; lon: number } | null;
  destinationLocation: { lat: number; lon: number } | null;
  onMapClick?: (lat: number, lon: number) => void;
  height?: string;
}

function MapBoundsUpdater({ result, userLocation }: { result: RouteAccessibilityResult | null; userLocation: { lat: number; lon: number } | null }) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];
    if (userLocation) points.push([userLocation.lat, userLocation.lon]);
    if (result) {
      for (const seg of [...result.accessibleSegments, ...result.blockedSegments]) {
        for (const p of seg.polyline) {
          points.push([p.lat, p.lon]);
        }
      }
    }

    if (points.length > 1) {
      const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (userLocation) {
      map.setView([userLocation.lat, userLocation.lon], 10);
    }
  }, [result, userLocation, map]);

  return null;
}

export default function AccessibilityMap({
  result,
  userLocation,
  destinationLocation,
  onMapClick,
  height = "500px",
}: AccessibilityMapProps) {
  const accessiblePolylines = useMemo(() => {
    if (!result) return [];
    return result.accessibleSegments.map((seg) => ({
      positions: seg.polyline.map((p) => [p.lat, p.lon] as [number, number]),
      distance: seg.distance,
      index: seg.index,
    }));
  }, [result]);

  const blockedPolylines = useMemo(() => {
    if (!result) return [];
    return result.blockedSegments.map((seg) => ({
      positions: seg.polyline.map((p) => [p.lat, p.lon] as [number, number]),
      distance: seg.distance,
      index: seg.index,
      blockedBy: seg.blockedBy,
    }));
  }, [result]);

  const center = userLocation
    ? [userLocation.lat, userLocation.lon] as [number, number]
    : NEPAL_CENTER;

  return (
    <MapContainer
      center={center}
      zoom={8}
      style={{ width: "100%", height, borderRadius: "12px", zIndex: 0 }}
      maxBounds={NEPAL_BOUNDS}
      maxBoundsViscosity={1}
      minZoom={7}
      scrollWheelZoom={true}
      doubleClickZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapBoundsUpdater result={result} userLocation={userLocation} />

      {accessiblePolylines.map((poly) => (
        <Polyline
          key={`accessible-${poly.index}`}
          positions={poly.positions}
          color="#22c55e"
          weight={5}
          opacity={0.8}
        >
          <Popup>
            <div className="text-sm">
              <strong>Segment {poly.index + 1}</strong>
              <br />
              Distance: {formatDistance(poly.distance)}
              <br />
              <span style={{ color: "#22c55e" }}>Accessible</span>
            </div>
          </Popup>
        </Polyline>
      ))}

      {blockedPolylines.map((poly) => (
        <Polyline
          key={`blocked-${poly.index}`}
          positions={poly.positions}
          color="#ef4444"
          weight={5}
          opacity={0.8}
          dashArray="10, 6"
        >
          <Popup>
            <div className="text-sm">
              <strong>Segment {poly.index + 1}</strong>
              <br />
              Distance: {formatDistance(poly.distance)}
              <br />
              <span style={{ color: "#ef4444" }}>Blocked</span>
              {poly.blockedBy.length > 0 && (
                <>
                  <br />
                  Cause: {poly.blockedBy[0]}
                </>
              )}
            </div>
          </Popup>
        </Polyline>
      ))}

      {userLocation && (
        <Marker position={[userLocation.lat, userLocation.lon]} icon={userIcon}>
          <Popup>Your location</Popup>
        </Marker>
      )}

      {destinationLocation && (
        <Marker position={[destinationLocation.lat, destinationLocation.lon]} icon={destIcon}>
          <Popup>{destinationLocation.lat.toFixed(4)}, {destinationLocation.lon.toFixed(4)}</Popup>
        </Marker>
      )}

      {result?.furthestReachablePoint && result.status !== "fully_accessible" && (
        <Marker
          position={[result.furthestReachablePoint.lat, result.furthestReachablePoint.lon]}
          icon={reachableIcon}
        >
          <Popup>
            <strong>Furthest reachable point</strong>
          </Popup>
        </Marker>
      )}

      {onMapClick && (
        <MapClickHandler onMapClick={onMapClick} />
      )}
    </MapContainer>
  );
}

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [map, onMapClick]);

  return null;
}
