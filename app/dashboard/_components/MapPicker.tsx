"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Loader2, Crosshair } from "lucide-react";

const NOMINATIM_BASE = process.env.NEXT_PUBLIC_NOMINATIM_URL || "https://nominatim.openstreetmap.org";

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
    setReverseName("Selected location");
    setResolving(true);
    resolvingRef.current = true;

    async function reverseAt(aLat: number, aLon: number) {
      try {
        const r = await fetch(
          `${NOMINATIM_BASE}/reverse?lat=${aLat}&lon=${aLon}&format=json&zoom=18&addressdetails=1`,
          { headers: { Accept: "application/json", "Accept-Language": "en" } }
        );
        if (!r.ok) return null;
        const d = await r.json();
        return d;
      } catch {
        return null;
      }
    }

    try {
      // Primary reverse
      const primary = await reverseAt(lat, lng);
      if (resolvingRef.current && primary) {
        const addr = primary.address || {};
        // Accept a broader set of place-name fields (priority order)
        const primaryName =
          addr.village ||
          addr.town ||
          addr.city ||
          addr.municipality ||
          addr.city_district ||
          addr.hamlet ||
          addr.suburb ||
          addr.county ||
          null;
        if (primaryName) {
          setReverseName(primaryName);
          return;
        }
        // Fallback to the display_name first segment if available
        if (primary.display_name) {
          const first = String(primary.display_name).split(",")[0];
          if (first) {
            setReverseName(first);
            return;
          }
        }
      }

      // Failure handling: radius-based nearby search (meters)
      const radii = [100, 250, 500, 1000];
      const toLatDelta = (m: number) => m / 111111; // approx meters -> degrees lat
      const toLonDelta = (m: number, atLat: number) => m / (111111 * Math.cos((atLat * Math.PI) / 180));

      let foundName: string | null = null;
      outer: for (const rMeters of radii) {
        const dLat = toLatDelta(rMeters);
        const dLon = toLonDelta(rMeters, lat);
        const samples = [
          { lat: lat + dLat, lon: lng }, // north
          { lat: lat - dLat, lon: lng }, // south
          { lat: lat, lon: lng + dLon }, // east
          { lat: lat, lon: lng - dLon }, // west
        ];

        for (const s of samples) {
          if (!resolvingRef.current) break outer;
          const hit = await reverseAt(s.lat, s.lon);
          if (!hit) continue;
          const a = hit.address || {};
          const name =
            a.village ||
            a.town ||
            a.city ||
            a.municipality ||
            a.city_district ||
            a.hamlet ||
            a.suburb ||
            a.county ||
            null;
          const finalName = name || (hit.display_name ? String(hit.display_name).split(",")[0] : null);
          if (name) {
            foundName = finalName;
            break outer;
          }
        }
      }

      if (resolvingRef.current) {
        setReverseName(foundName || "Selected location");
      }
    } finally {
      if (resolvingRef.current) {
        setResolving(false);
      }
    }
  }, []);

  const confirmLocation = useCallback(() => {
    if (!marker) return;
    onSelect(marker.lat, marker.lng, reverseName || "Selected location");
  }, [marker, reverseName, onSelect]);

  useEffect(() => {
    return () => {
      resolvingRef.current = false;
    };
  }, []);

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
              <div className="text-xs text-slate-400 font-body">
                {resolving ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" />
                    Resolving place name…
                  </span>
                ) : (
                  <div>
                    <div className="text-white font-semibold truncate">{reverseName || "Unknown"}</div>
                    <div className="text-slate-500">{marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}</div>
                  </div>
                )}
              </div>
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
          disabled={!marker || !reverseName}
          onClick={confirmLocation}
          className="shrink-0 px-4 py-2 rounded-lg text-xs font-body font-semibold transition-all bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Use This Location
        </button>
      </div>
    </div>
  );
}
