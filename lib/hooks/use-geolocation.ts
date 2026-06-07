"use client";

import { useState, useEffect, useCallback } from "react";

interface GeolocationState {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  error: string | null;
  loading: boolean;
  permissionDenied: boolean;
}

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
}

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const {
    enableHighAccuracy = true,
    maximumAge = 10000,
    timeout = 15000,
  } = options;

  const [state, setState] = useState<GeolocationState>({
    lat: null,
    lon: null,
    accuracy: null,
    error: null,
    loading: true,
    permissionDenied: false,
  });

  const updatePosition = useCallback((pos: GeolocationPosition) => {
    setState({
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      error: null,
      loading: false,
      permissionDenied: false,
    });
  }, []);

  const handleError = useCallback((err: GeolocationPositionError) => {
    setState((prev) => ({
      ...prev,
      error: err.message,
      loading: false,
      permissionDenied: err.code === err.PERMISSION_DENIED,
    }));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: "Geolocation not supported",
        loading: false,
        permissionDenied: true,
      }));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      handleError,
      { enableHighAccuracy, maximumAge, timeout },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enableHighAccuracy, maximumAge, timeout, updatePosition, handleError]);

  return state;
}
