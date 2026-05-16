"use client";

import { useCallback, useState } from "react";

export type ResolvedOriginState = {
  lat: number;
  lon: number;
  displayLat: number;
  displayLon: number;
  name: string;
  routeNodeId?: string | null;
  routeNodeName?: string | null;
  source?: string;
  note?: string;
  rawLat?: number;
  rawLon?: number;
  accuracyMeters?: number;
};

export function useResolvedOrigin() {
  const [origin, setOrigin] = useState<ResolvedOriginState | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveFromGps = useCallback(
    async (lat: number, lon: number, accuracy?: number, name?: string) => {
      setResolving(true);
      setError(null);
      try {
        const res = await fetch("/api/routing/resolve-origin", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lon, accuracy, name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Could not resolve location");

        const resolved: ResolvedOriginState = {
          lat: data.lat,
          lon: data.lon,
          displayLat: data.displayLat ?? data.rawLat ?? data.lat,
          displayLon: data.displayLon ?? data.rawLon ?? data.lon,
          name: data.name,
          routeNodeId: data.routeNodeId,
          routeNodeName: data.routeNodeName,
          source: data.source,
          note: data.note,
          rawLat: data.rawLat,
          rawLon: data.rawLon,
          accuracyMeters: data.accuracyMeters,
        };
        setOrigin(resolved);
        return resolved;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Location resolution failed";
        setError(msg);
        return null;
      } finally {
        setResolving(false);
      }
    },
    []
  );

  const resolveFromManual = useCallback(
    async (placeName: string, lat: number, lon: number) => {
      setResolving(true);
      setError(null);
      try {
        await fetch("/api/user/location", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeName, lat, lon }),
        });

        return resolveFromGps(lat, lon, undefined, placeName);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to save location";
        setError(msg);
        return null;
      }
    },
    [resolveFromGps]
  );

  const loadSavedHome = useCallback(async () => {
    setResolving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/location", { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.saved) return null;

      const resolved: ResolvedOriginState = {
        lat: data.saved.snappedLat ?? data.saved.lat,
        lon: data.saved.snappedLon ?? data.saved.lon,
        displayLat: data.saved.lat,
        displayLon: data.saved.lon,
        name: data.saved.placeName,
        routeNodeId: data.saved.routeNodeId,
        routeNodeName: data.saved.routeNodeName,
        source: "saved-home",
      };
      setOrigin(resolved);
      return resolved;
    } catch {
      return null;
    } finally {
      setResolving(false);
    }
  }, []);

  return {
    origin,
    resolving,
    error,
    setOrigin,
    resolveFromGps,
    resolveFromManual,
    loadSavedHome,
  };
}
