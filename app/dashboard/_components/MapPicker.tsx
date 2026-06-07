"use client";

import { useState, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Loader2, Crosshair } from "lucide-react";

interface MapPickerProps {
  onSelect: (lat: number, lng: number, name: string) => void;
}

const NEPAL_CENTER: [number, number] = [28.2, 84.0];
const DEFAULT_ZOOM = 7;

// Fix Leaflet default icon path issue
const icon = L.divIcon({
  className: "custom-marker",
  html: `<div style="background:#f59e0b;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapPicker({ onSelect }: MapPickerProps) {
  const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(null);
  const [reverseName, setReverseName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    setMarker({ lat, lng });
    setReverseName(null);
    setResolving(true);
    resolvingRef.current = true;

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14&addressdetails=1`,
        { headers: { "User-Agent": "YatraAI/1.0" } }
      );
      if (!res.ok || !resolvingRef.current) return;
      const data = await res.json();
      if (!resolvingRef.current) return;

      const displayName = data.display_name || "";
      const addr = data.address || {};
      const shortName =
        addr.village || addr.town || addr.suburb || addr.city || addr.county || displayName.split(",")[0] || "Selected location";

      setReverseName(shortName);
    } catch {
      if (resolvingRef.current) {
        setReverseName("Selected location");
      }
    } finally {
      if (resolvingRef.current) {
        setResolving(false);
      }
    }
  }, []);

  const confirmLocation = useCallback(() => {
    if (!marker || !reverseName) return;
    onSelect(marker.lat, marker.lng, reverseName);
  }, [marker, reverseName, onSelect]);

  // Cleanup ref on unmount
  const cleanupRef = useRef(() => { resolvingRef.current = false; });
  cleanupRef.current = () => { resolvingRef.current = false; };

  return (
    <div>
      <div className="h-64 w-full rounded-lg overflow-hidden border border-slate-700/50 z-0">
        <MapContainer
          center={NEPAL_CENTER}
          zoom={DEFAULT_ZOOM}
          className="h-full w-full"
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onMapClick={handleMapClick} />
          {marker && (
            <Marker position={[marker.lat, marker.lng]} icon={icon} />
          )}
        </MapContainer>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {marker ? (
            <div>
              <p className="text-xs text-slate-400 font-body">
                {resolving ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" />
                    Resolving place name…
                  </span>
                ) : (
                  <>
                    <span className="text-white font-semibold">{reverseName || "Unknown"}</span>
                    <br />
                    <span className="text-slate-500">
                      {marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}
                    </span>
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 font-body flex items-center gap-1.5">
              <Crosshair size={12} />
              Click on the map to set your location
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={!marker || !reverseName || resolving}
          onClick={confirmLocation}
          className="shrink-0 px-4 py-2 rounded-lg text-xs font-body font-semibold transition-all bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Use This Location
        </button>
      </div>
    </div>
  );
}
