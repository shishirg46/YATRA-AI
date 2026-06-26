"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Search, Navigation, MapPin, Crosshair } from "lucide-react";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import type { RouteAccessibilityResult, AccessibilitySearchResult } from "@/lib/accessibility/types";

const NOMINATIM_BASE = process.env.NEXT_PUBLIC_NOMINATIM_URL || "https://nominatim.openstreetmap.org";

const AccessibilityMap = dynamic(
  () => import("@/components/accessibility-map").then((m) => m.default),
  { ssr: false, loading: () => <div className="h-[500px] bg-gray-100 rounded-xl animate-pulse" /> },
);

const AccessibilityPanel = dynamic(
  () => import("@/components/accessibility-panel").then((m) => m.default),
  { ssr: false },
);

export default function AccessibilityPage() {
  const geo = useGeolocation();
  const [destination, setDestination] = useState<{ lat: number; lon: number; name?: string } | null>(null);
  const [result, setResult] = useState<RouteAccessibilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AccessibilitySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (q.length < 3) {
      setSearchResults([]);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `${NOMINATIM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=np`,
          { headers: { "Accept-Language": "en" } },
        );
        const data = await res.json();
        setSearchResults(
          data.map((d: any) => ({
            displayName: d.display_name,
            lat: parseFloat(d.lat),
            lon: parseFloat(d.lon),
          })),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const selectDestination = useCallback((r: AccessibilitySearchResult) => {
    setDestination({ lat: r.lat, lon: r.lon, name: r.displayName.split(",")[0] });
    setSearchQuery(r.displayName.split(",")[0]);
    setSearchResults([]);
    setShowSearch(false);
    setResult(null);
    setError(null);
  }, []);

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setDestination({ lat, lon });
    setResult(null);
    setError(null);
    fetch(
      `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "Accept-Language": "en" } },
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.display_name) {
          setDestination((prev) => prev ? { ...prev, name: d.display_name.split(",")[0] } : prev);
        }
      })
      .catch(() => {});
  }, []);

  const centerOnUser = useCallback(() => {
    if (geo.lat && geo.lon) {
      setDestination(null);
      setResult(null);
      setError(null);
    }
  }, [geo.lat, geo.lon]);

  const analyzeRoute = useCallback(async () => {
    if (!geo.lat || !geo.lon || !destination) {
      setError("Both your location and a destination are required.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/accessibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originLat: geo.lat,
          originLon: geo.lon,
          destinationLat: destination.lat,
          destinationLon: destination.lon,
          originName: "Your location",
          destinationName: destination.name,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(err.message || "Failed to analyze route");
      }

      const data: RouteAccessibilityResult = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [geo.lat, geo.lon, destination]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-semibold text-lg flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-600" />
            Route Accessibility
          </h1>
          <div className="flex items-center gap-2">
            {!geo.lat && geo.loading && (
              <span className="text-xs text-gray-400">Detecting location...</span>
            )}
            {geo.permissionDenied && (
              <span className="text-xs text-red-500">Location denied</span>
            )}
            <button
              onClick={centerOnUser}
              disabled={!geo.lat}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 flex items-center gap-1"
            >
              <Crosshair className="w-3.5 h-3.5" />
              My Location
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Controls */}
          <div className="lg:col-span-1 space-y-3">
            {/* Current location card */}
            <div className="bg-white rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <MapPin className="w-4 h-4 text-blue-500" />
                Current Location
              </div>
              {geo.lat && geo.lon ? (
                <p className="text-sm font-mono text-gray-700">
                  {geo.lat.toFixed(4)}, {geo.lon.toFixed(4)}
                  {geo.accuracy && <span className="text-gray-400"> ±{Math.round(geo.accuracy)}m</span>}
                </p>
              ) : geo.loading ? (
                <p className="text-sm text-gray-400">Detecting...</p>
              ) : (
                <p className="text-sm text-red-500">{geo.error || "Location unavailable"}</p>
              )}
            </div>

            {/* Destination search */}
            <div className="bg-white rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                <MapPin className="w-4 h-4 text-red-500" />
                Destination
              </div>

              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      onFocus={() => setShowSearch(true)}
                      placeholder="Search for a destination..."
                      className="w-full h-9 pl-8 pr-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  </div>
                </div>

                {showSearch && searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => selectDestination(r)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b last:border-0"
                      >
                        <span className="block truncate font-medium">{r.displayName.split(",")[0]}</span>
                        <span className="block truncate text-gray-400 text-[10px]">{r.displayName}</span>
                      </button>
                    ))}
                  </div>
                )}

                {showSearch && searching && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg p-3 text-center text-xs text-gray-400">
                    Searching...
                  </div>
                )}

                {destination && !searchResults.length && (
                  <p className="text-xs text-gray-500 mt-1.5">
                    {destination.name || `${destination.lat.toFixed(4)}, ${destination.lon.toFixed(4)}`}
                    <span className="text-gray-300"> — Click map or search to change</span>
                  </p>
                )}
              </div>
            </div>

            {/* Analyze button */}
            <button
              onClick={analyzeRoute}
              disabled={!geo.lat || !destination || loading}
              className="w-full h-10 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {loading ? "Analyzing Route..." : "Check Route Accessibility"}
            </button>

            {/* Results panel */}
            <AccessibilityPanel result={result} loading={loading} error={error} />
          </div>

          {/* Right: Map */}
          <div className="lg:col-span-2">
            <AccessibilityMap
              result={result}
              userLocation={geo.lat && geo.lon ? { lat: geo.lat, lon: geo.lon } : null}
              destinationLocation={destination ? { lat: destination.lat, lon: destination.lon } : null}
              onMapClick={handleMapClick}
              height="600px"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
