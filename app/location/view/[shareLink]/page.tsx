"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { MapPin, Navigation, Clock, Crosshair, WifiOff } from "lucide-react";

const LocationMap = dynamic(() => import("./_components/LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-slate-900">
      <Navigation size={32} className="text-amber-400 animate-pulse" />
    </div>
  ),
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

interface SessionInfo {
  userName: string;
  tripTitle: string | null;
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
}

type Status = "connecting" | "waiting" | "live" | "offline";

export default function LocationViewPage() {
  const params = useParams();
  const shareLink = params?.shareLink as string;

  const [session_, setSession_] = useState<SessionInfo | null>(null);
  const [location, setLocation] = useState<LocationPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>("connecting");
  const hasDataRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!shareLink) return;

    // Fetch session info
    fetch(`/api/location/view/${shareLink}`)
      .then(async (res) => {
        if (!res.ok) {
          const msg = res.status === 410 ? "Share link expired" : "Share link not found";
          throw new Error(msg);
        }
        const data = await res.json();
        setSession_(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    // SSE connection (auto-reconnects on drop)
    const es = new EventSource(`/api/location/view/${shareLink}/stream`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as LocationPoint;
        hasDataRef.current = true;
        setLocation(data);
        setStatus(Date.now() - data.updatedAt < 120_000 ? "live" : "offline");
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects — just reflect connection state
    };

    es.onopen = () => {
      setStatus(hasDataRef.current ? "live" : "waiting");
    };

    // Fallback polling — runs in parallel as safety net
    const fetchLocation = async () => {
      try {
        const res = await fetch(`/api/location/view/${shareLink}/data`);
        if (res.ok) {
          const data = await res.json();
          hasDataRef.current = true;
          setLocation(data);
          setStatus(Date.now() - data.updatedAt < 120_000 ? "live" : "offline");
        }
      } catch {
        // Server might be down
      }
    };

    intervalRef.current = setInterval(fetchLocation, 15_000);
    // Fetch once immediately
    fetchLocation();

    return () => {
      es.close();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [shareLink]);

  const center: [number, number] = location
    ? [location.latitude, location.longitude]
    : [27.7172, 85.3240]; // Default to Kathmandu

  const lastUpdate = location ? new Date(location.updatedAt).toLocaleTimeString() : null;
  const speedKmh = location?.speed != null ? Math.round(location.speed * 3.6) : null;
  const altitudeM = location?.altitude != null ? Math.round(location.altitude) : null;

  const statusColor = status === "live" ? "bg-green-500" : status === "offline" ? "bg-slate-600" : "bg-amber-500";
  const statusText = status === "connecting" ? "Connecting…" : status === "waiting" ? "Waiting for GPS" : status === "live" ? "Live" : "Offline";

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Navigation size={32} className="text-amber-400 animate-pulse mx-auto mb-3" />
          <p className="font-body text-slate-400 text-sm">Loading live location…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <WifiOff size={40} className="text-slate-600 mx-auto mb-3" />
          <h1 className="font-display text-xl font-bold text-white mb-2">Location Unavailable</h1>
          <p className="font-body text-slate-400 text-sm mb-6">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-muted border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-amber-400" />
            <span className="font-display text-sm font-bold text-white">YatraAI</span>
            <span className="text-slate-700">·</span>
            <span className="font-body text-xs text-slate-400">
              {session_?.userName || "Someone"}&apos;s live location
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
            <span className="font-body text-xs text-slate-500">{statusText}</span>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <LocationMap
          center={center}
          userName={session_?.userName}
          location={location ?? undefined}
          speedKmh={speedKmh}
          altitudeM={altitudeM}
          lastUpdate={lastUpdate}
        />
      </div>

      {/* Bottom info bar */}
      <div className="bg-muted border-t border-slate-800 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            {lastUpdate && (
              <div className="flex items-center gap-1.5">
                <Clock size={13} className="text-slate-500" />
                <span className="font-body text-xs text-slate-400">Updated {lastUpdate}</span>
              </div>
            )}
            {speedKmh !== null && (
              <div className="flex items-center gap-1.5">
                <Navigation size={13} className="text-slate-500" />
                <span className="font-body text-xs text-slate-400">{speedKmh} km/h</span>
              </div>
            )}
            {altitudeM !== null && (
              <div className="flex items-center gap-1.5">
                <Crosshair size={13} className="text-slate-500" />
                <span className="font-body text-xs text-slate-400">{altitudeM}m</span>
              </div>
            )}
            {location?.accuracy && (
              <div className="flex items-center gap-1.5">
                <Crosshair size={13} className="text-slate-500" />
                <span className="font-body text-xs text-slate-400">±{Math.round(location.accuracy)}m</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${status === "live" ? "bg-green-500" : status === "waiting" ? "bg-amber-500 animate-pulse" : "bg-slate-600"}`} />
            <span className={`font-body text-xs ${status === "live" ? "text-green-400" : status === "waiting" ? "text-amber-400" : "text-slate-500"}`}>
              {status === "live" ? "Tracking live" : status === "waiting" ? "Acquiring GPS…" : "No signal"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
