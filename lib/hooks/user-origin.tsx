"use client";

import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";

export type UserOrigin = {
  lat: number;
  lon: number;
  name: string;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
};

const STORAGE_KEY = "yatra_user_origin";

function loadCached(): { lat: number; lon: number; name: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(lat: number, lon: number, name: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lat, lon, name }));
  } catch { /* ignore */ }
}

const UserOriginContext = createContext<UserOrigin>({
  lat: 0,
  lon: 0,
  name: "",
  loading: true,
  error: null,
  permissionDenied: false,
});

export function useUserOrigin() {
  return useContext(UserOriginContext);
}

export function UserOriginProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState<UserOrigin>(() => {
    const cached = loadCached();
    return cached
      ? { ...cached, loading: true, error: null, permissionDenied: false }
      : { lat: 0, lon: 0, name: "", loading: true, error: null, permissionDenied: false };
  });
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;

    if (!navigator.geolocation) {
      setOrigin((prev) => ({ ...prev, loading: false, error: "Geolocation not supported", permissionDenied: true }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res = await fetch("/api/routing/resolve-origin", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: latitude, lon: longitude }),
          });
          if (res.ok) {
            const data = await res.json();
            const name = data.name || "Your Location";
            saveCache(latitude, longitude, name);
            setOrigin({ lat: latitude, lon: longitude, name, loading: false, error: null, permissionDenied: false });
          } else {
            setOrigin({ lat: latitude, lon: longitude, name: "Your Location", loading: false, error: null, permissionDenied: false });
          }
        } catch {
          setOrigin({ lat: latitude, lon: longitude, name: "Your Location", loading: false, error: null, permissionDenied: false });
        }
      },
      (err) => {
        const cached = loadCached();
        if (cached) {
          setOrigin({ ...cached, loading: false, error: "Using cached location", permissionDenied: false });
        } else {
          setOrigin((prev) => ({
            ...prev,
            loading: false,
            error: err.message,
            permissionDenied: err.code === err.PERMISSION_DENIED,
          }));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  return <UserOriginContext.Provider value={origin}>{children}</UserOriginContext.Provider>;
}
