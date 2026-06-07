"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  batteryLevel: number | null;
  updatedAt: number;
}

function AutoCenterMap({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(point, map.getZoom(), { animate: true });
  }, [point, map]);
  return null;
}

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 100);
  }, [map]);
  return null;
}

export default function LocationMap({
  center,
  userName,
  location,
  speedKmh,
  altitudeM,
  lastUpdate,
}: {
  center: [number, number];
  userName?: string;
  location?: LocationPoint;
  speedKmh: number | null;
  altitudeM: number | null;
  lastUpdate: string | null;
}) {
  return (
    <MapContainer
      center={center}
      zoom={14}
      className="w-full h-full"
      zoomControl={true}
      style={{ minHeight: "300px" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap"
      />
      <MapResizer />
      <AutoCenterMap point={center} />
      {location && (
        <Marker
          position={[location.latitude, location.longitude]}
          icon={L.divIcon({
            className: "",
            html: `<div style="position:relative;">
              <div style="width:24px;height:24px;background:#f59e0b;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 3px rgba(245,158,11,0.4),0 2px 8px rgba(0,0,0,0.3);"></div>
              <div style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;background:#22c55e;border-radius:50%;animation:pulse 2s infinite;"></div>
            </div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          })}
        >
          <Popup>
            <div className="font-body text-sm">
              <p className="font-semibold">{userName}</p>
              {speedKmh !== null && <p>Speed: {speedKmh} km/h</p>}
              {altitudeM !== null && <p>Altitude: {altitudeM}m</p>}
              {location.accuracy && <p>Accuracy: ±{Math.round(location.accuracy)}m</p>}
              {lastUpdate && <p className="text-xs text-slate-500">Updated: {lastUpdate}</p>}
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
