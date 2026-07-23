"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ShareSession {
  shareLink: string;
  shareUrl: string;
  expiresAt: string;
  friendCount?: number;
}

interface UseLocationShareOptions {
  tripId?: string;
  intervalMs?: number;
}

const GPS_WEAK_THRESHOLD = 500; // metres — show "weak GPS" warning above this

export function useLocationShare(options: UseLocationShareOptions = {}) {
  const { tripId, intervalMs = 30_000 } = options;
  const [shareSession, setShareSession] = useState<ShareSession | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPush, setLastPush] = useState<Date | null>(null);
  const [gpsWeak, setGpsWeak] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosRef = useRef<GeolocationCoordinates | null>(null);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startSharing = useCallback(async (friendIds?: string[]) => {
    setError(null);
    try {
      const res = await fetch("/api/location/share", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, friendIds }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.message || "Failed to start sharing");
      }
      const data = await res.json();
      setShareSession(data);
      setIsSharing(true);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sharing");
      throw err;
    }
  }, [tripId]);

  const stopSharing = useCallback(async () => {
    stopWatching();
    try {
      await fetch("/api/location/share", {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      // Best-effort
    }
    setIsSharing(false);
    setShareSession(null);
    lastPosRef.current = null;
  }, [stopWatching]);

  // Start GPS watching when sharing is active
  useEffect(() => {
    if (!isSharing || !shareSession) return;

    // Watch position continuously
    // One-shot high-accuracy GPS (fast 5s timeout, best-effort)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastPosRef.current = pos.coords;
        setGpsWeak((pos.coords.accuracy ?? 9999) > GPS_WEAK_THRESHOLD);
      },
      () => {
        /* high-accuracy unavailable — low-accuracy watch below will cover */
      },
      { enableHighAccuracy: true, timeout: 5_000, maximumAge: 0 },
    );

    // Continuous low-accuracy watching (wifi/cell/IP — always returns something)
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        lastPosRef.current = pos.coords;
        setGpsWeak((pos.coords.accuracy ?? 9999) > GPS_WEAK_THRESHOLD);
      },
      (err) => {
        console.warn("[useLocationShare] GPS error:", err.message);
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 },
    );

    // Push position on interval
    const push = async () => {
      if (!lastPosRef.current) return;
      try {
        await fetch("/api/location/push", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: lastPosRef.current.latitude,
            longitude: lastPosRef.current.longitude,
            accuracy: lastPosRef.current.accuracy,
            speed: lastPosRef.current.speed,
            heading: lastPosRef.current.heading,
            altitude: lastPosRef.current.altitude,
          }),
        });
        setLastPush(new Date());
      } catch {
        // Best-effort
      }
    };

    // Push immediately, then on interval
    push();
    intervalRef.current = setInterval(push, intervalMs);

    return () => {
      stopWatching();
    };
  }, [isSharing, shareSession, intervalMs, stopWatching]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWatching();
    };
  }, [stopWatching]);

  return {
    shareSession,
    isSharing,
    error,
    lastPush,
    gpsWeak,
    startSharing,
    stopSharing,
  };
}
