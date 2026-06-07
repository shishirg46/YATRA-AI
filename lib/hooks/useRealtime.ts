/**
 * FILE: useRealtime.ts
 * LOCATION: /lib/hooks/useRealtime.ts
 * PURPOSE: React hook that opens SSE connection to /api/realtime
 *          and returns live score/weather/alert updates
 *
 * USAGE:
 *   const { updates, connected, lastUpdate } = useRealtime();
 *   // updates is a map of locationId → latest score/weather
 *   // Merge with base dashboard data to get live scores
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface LiveScoreUpdate {
  locationId:  string;
  name:        string;
  district:    string;
  province:    string;
  altitude:    number | null;
  safetyScore: number;
  safetyLevel: "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  confidence:  number;
  reasoning:   string[];
  weather: {
    temperature: number;
    rainfall:    number;
    windSpeed:   number;
  };
  hazard?: {
    floodIndex:     number;
    landslideIndex: number;
    earthquakeIndex: number;
    airQuality:     number;
  };
}

export interface LiveWeatherUpdate {
  locationId:  string;
  name:        string;
  temperature: number;
  rainfall:    number;
  windSpeed:   number;
  humidity:    number;
  description: string;
  source:      string;
  sourceLabel?: string;
  officialSource?: boolean;
  stationName?: string;
  stationDistanceKm?: number;
}

export interface LiveAlert {
  locationId:  string;
  name:        string;
  safetyLevel: string;
  safetyScore: number;
  reason:      string;
}

interface RealtimeState {
  // Map of locationId → latest score update
  scoreUpdates:   Map<string, LiveScoreUpdate>;
  // Map of locationId → latest weather update
  weatherUpdates: Map<string, LiveWeatherUpdate>;
  // Most recent alerts
  alerts:         LiveAlert[];
  connected:      boolean;
  lastUpdate:     Date | null;
  status:         "connecting" | "connected" | "disconnected" | "error";
}

export function useRealtime() {
  const [state, setState] = useState<RealtimeState>({
    scoreUpdates:   new Map(),
    weatherUpdates: new Map(),
    alerts:         [],
    connected:      false,
    lastUpdate:     null,
    status:         "connecting",
  });

  const esRef        = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef  = useRef(0);

  const connect = useCallback(() => {
    // Close existing connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setState((prev) => ({ ...prev, status: "connecting" }));

    const es = new EventSource("/api/realtime", { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      attemptsRef.current = 0;
      setState((prev) => ({ ...prev, connected: true, status: "connected" }));
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          data: unknown;
          time: string;
        };

        setState((prev) => {
          const now = new Date(msg.time);

          if (msg.type === "scores") {
            const updates = msg.data as LiveScoreUpdate[];
            const newMap  = new Map(prev.scoreUpdates);
            updates.forEach((u) => newMap.set(u.locationId, u));
            return { ...prev, scoreUpdates: newMap, lastUpdate: now };
          }

          if (msg.type === "weather") {
            const updates = msg.data as LiveWeatherUpdate[];
            const newMap  = new Map(prev.weatherUpdates);
            updates.forEach((u) => newMap.set(u.locationId, u));
            return { ...prev, weatherUpdates: newMap, lastUpdate: now };
          }

          if (msg.type === "alert") {
            const newAlerts = msg.data as LiveAlert[];
            return {
              ...prev,
              alerts:     [...newAlerts, ...prev.alerts].slice(0, 20),
              lastUpdate: now,
            };
          }

          if (msg.type === "heartbeat") {
            return { ...prev, connected: true, status: "connected", lastUpdate: now };
          }

          return prev;
        });
      } catch { /* ignore malformed events */ }
    };

    es.onerror = () => {
      setState((prev) => ({ ...prev, connected: false, status: "error" }));
      es.close();
      esRef.current = null;

      // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
      attemptsRef.current++;
      const delay = Math.min(5000 * Math.pow(2, attemptsRef.current - 1), 60_000);
      reconnectRef.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current)        esRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return {
    ...state,
    // Convenience: merge base destinations with live updates
    mergeLiveScores: (destinations: { id: string; safetyScore: number; safetyLevel: string; reasoning: string[]; weather: { temperature: number; rainfall: number; windSpeed: number; description?: string; source?: string; sourceLabel?: string; officialSource?: boolean; stationName?: string; stationDistanceKm?: number } | null; hazard?: { floodIndex: number; landslideIndex: number; earthquakeIndex: number; airQuality: number } | null; assessedAt: string }[]) => {
      return destinations.map((dest) => {
        const live        = state.scoreUpdates.get(dest.id);
        const liveWeather = state.weatherUpdates.get(dest.id);

        if (!live && !liveWeather) return dest;

        return {
          ...dest,
          // Preserve per-user safetyScore/safetyLevel from server (SSE scores are global, not user-personalized)
          safetyScore: dest.safetyScore,
          safetyLevel: dest.safetyLevel,
          reasoning:   live?.reasoning    ?? dest.reasoning,
          weather:     liveWeather
            ? {
                temperature: liveWeather.temperature,
                rainfall: liveWeather.rainfall,
                windSpeed: liveWeather.windSpeed,
                description: liveWeather.description,
                source: liveWeather.source,
                sourceLabel: liveWeather.sourceLabel,
                officialSource: liveWeather.officialSource,
                stationName: liveWeather.stationName,
                stationDistanceKm: liveWeather.stationDistanceKm,
              }
            : live?.weather ?? dest.weather,
          hazard:      live?.hazard  ?? dest.hazard,
          assessedAt:  live ? new Date().toISOString() : dest.assessedAt,
          isLive:      true,
        };
      });
    },
  };
}
