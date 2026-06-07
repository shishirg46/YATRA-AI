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

const STORAGE_KEY = "yatra_resolved_origin";

function saveToStorage(origin: ResolvedOriginState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(origin));
  } catch { /* ignore */ }
}

function loadFromStorage(): ResolvedOriginState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ResolvedOriginState;
  } catch {
    return null;
  }
}

function clearStorage() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

export function useResolvedOrigin() {
  const [origin, setOrigin] = useState<ResolvedOriginState | null>(() => loadFromStorage());
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveOrigin = useCallback((resolved: ResolvedOriginState) => {
    setOrigin(resolved);
    saveToStorage(resolved);
  }, []);

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

        saveOrigin(resolved);

        // Persist to DB (fire-and-forget)
        fetch("/api/user/location", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeName: resolved.name, lat, lon, accuracy }),
        }).catch(() => {});

        return resolved;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Location resolution failed";
        setError(msg);
        return null;
      } finally {
        setResolving(false);
      }
    },
    [saveOrigin]
  );

  const resolveFromManual = useCallback(
    async (placeName: string, lat: number, lon: number) => {
      // resolveFromGps handles both resolution and persistence
      return resolveFromGps(lat, lon, undefined, placeName);
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
      if (!data.saved) {
        clearStorage();
        setOrigin(null);
        return null;
      }

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
      saveOrigin(resolved);
      return resolved;
    } catch (err) {
      console.warn("[origin] loadSavedHome failed:", err);
      return null;
    } finally {
      setResolving(false);
    }
  }, [saveOrigin]);

  return {
    origin,
    resolving,
    error,
    setOrigin: saveOrigin,
    resolveFromGps,
    resolveFromManual,
    loadSavedHome,
  };
}
