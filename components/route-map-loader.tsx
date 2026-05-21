"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import SegmentDetails from "@/components/segment-details";
import RouteDirections from "@/components/route-directions";
import { isInNepalBounds, NEPAL_CENTER, type RouteSegmentInfo } from "@/lib/map-utils";
import type { RouteInstruction, PerSegmentRoute } from "@/lib/routing/types";

const RouteMap = dynamic(() => import("@/components/route-map"), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full bg-slate-900 rounded-lg border border-slate-700 flex items-center justify-center">
      <Loader2 size={24} className="text-amber-400 animate-spin" />
    </div>
  ),
});

interface RouteMapLoaderProps {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  displayStartLat?: number;
  displayStartLon?: number;
  destinationId?: string;
  destinationName?: string;
  originName?: string;
  gpsAccuracy?: number;
  originRouteNodeId?: string | null;
  originAlreadyResolved?: boolean;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  height?: string;
  perSegmentRouting?: boolean;
  dynamicOsmRouting?: boolean;
}

export default function RouteMapLoader({
  startLat,
  startLon,
  endLat,
  endLon,
  displayStartLat,
  displayStartLon,
  destinationId,
  destinationName,
  originName = "Your location",
  gpsAccuracy,
  originRouteNodeId,
  originAlreadyResolved = false,
  riskLevel = "MEDIUM",
  height,
  perSegmentRouting = true,
  dynamicOsmRouting = true,
}: RouteMapLoaderProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<Array<{ lat: number; lon: number; name?: string }>>([]);
  const [polyline, setPolyline] = useState<Array<{ lat: number; lon: number }>>([]);
  const [segments, setSegments] = useState<RouteSegmentInfo[]>([]);
  const [distance, setDistance] = useState<number>();
  const [duration, setDuration] = useState<number>();
  const [resolutionNote, setResolutionNote] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<RouteSegmentInfo | null>(null);
  const [instructions, setInstructions] = useState<RouteInstruction[]>([]);
  const [userMarker, setUserMarker] = useState<{ lat: number; lon: number } | null>(null);
  const [segmentRoutes, setSegmentRoutes] = useState<PerSegmentRoute[]>([]);

  useEffect(() => {
    const fetchRoute = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/routes/geometry", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startLat,
            startLon,
            endLat,
            endLon,
            destinationId,
            destinationName,
            originName,
            accuracy: gpsAccuracy,
            originRouteNodeId,
            originAlreadyResolved,
            displayStartLat,
            displayStartLon,
            perSegmentRouting,
            dynamicOsmRouting,
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.message || "Failed to fetch route geometry");
        }

        const data = await response.json();

        const nodeWaypoints = Array.isArray(data.waypoints)
          ? data.waypoints.map((w: { lat: number; lon: number; name?: string }) => ({
              lat: w.lat,
              lon: w.lon,
              name: w.name,
            }))
          : [];

        const roadPolyline = Array.isArray(data.polyline)
          ? data.polyline.filter((p: { lat: number; lon: number }) =>
              isInNepalBounds(p.lat, p.lon)
            )
          : [];

        const safePolyline =
          roadPolyline.length >= 2
            ? roadPolyline
            : nodeWaypoints.filter((p: { lat: number; lon: number }) => isInNepalBounds(p.lat, p.lon));

        if (nodeWaypoints.length > 0 && displayStartLat != null && displayStartLon != null) {
          nodeWaypoints[0] = {
            ...nodeWaypoints[0],
            lat: displayStartLat,
            lon: displayStartLon,
            name: originName,
          };
        }

        setWaypoints(nodeWaypoints);
        setPolyline(safePolyline.length >= 2 ? safePolyline : nodeWaypoints);
        setSegments(data.segments || []);
        setDistance(data.distance);
        setDuration(data.duration);
        setInstructions(data.instructions || []);
        setSegmentRoutes(data.segmentRoutes || []);
        setResolutionNote(data.resolutionNote ?? data.originNote ?? null);
        setError(null);

        const showUserPin =
          displayStartLat != null &&
          displayStartLon != null &&
          isInNepalBounds(displayStartLat, displayStartLon) &&
          (Math.abs(displayStartLat - startLat) > 0.002 ||
            Math.abs(displayStartLon - startLon) > 0.002);
        setUserMarker(showUserPin ? { lat: displayStartLat, lon: displayStartLon } : null);
      } catch (err) {
        console.error("Route loading error:", err);
        setError(
          err instanceof Error ? err.message : "Could not load route. Showing corridor waypoints."
        );

        const oLat = displayStartLat ?? startLat;
        const oLon = displayStartLon ?? startLon;
        const center = NEPAL_CENTER as [number, number];
        const fallback =
          isInNepalBounds(oLat, oLon) && isInNepalBounds(endLat, endLon)
            ? [
                { lat: oLat, lon: oLon, name: originName },
                { lat: endLat, lon: endLon, name: destinationName ?? "Destination" },
              ]
            : [{ lat: center[0], lon: center[1], name: "Nepal" }];

        setWaypoints(fallback);
        setPolyline(fallback);
        setUserMarker(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRoute();
  }, [
    startLat,
    startLon,
    endLat,
    endLon,
    destinationId,
    destinationName,
    originName,
    gpsAccuracy,
    originRouteNodeId,
    originAlreadyResolved,
    displayStartLat,
    displayStartLon,
  ]);

  if (loading) {
    return (
      <div
        className={`${height || "h-96"} w-full bg-slate-900 rounded-lg border border-slate-700 flex items-center justify-center`}
      >
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={24} className="text-amber-400 animate-spin" />
          <span className="text-sm text-slate-400">Loading corridor route…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {resolutionNote && (
        <div className="mb-3 p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs font-body">
          {resolutionNote}
        </div>
      )}
      {error && (
        <div className="mb-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-body">
          {error}
        </div>
      )}

      <RouteMap
        waypoints={waypoints}
        polyline={polyline}
        segments={segments}
        originName={originName}
        destinationName={destinationName ?? "Destination"}
        distance={distance}
        duration={duration}
        riskLevel={riskLevel}
        height={height}
        userLocation={userMarker}
        segmentRoutes={segmentRoutes}
        onSegmentClick={(segment) => setSelectedSegment(segment)}
      />

      {selectedSegment && (
        <SegmentDetails segment={selectedSegment} onClose={() => setSelectedSegment(null)} />
      )}

      {instructions.length > 0 && (
        <div className="mt-6">
          <RouteDirections
            instructions={instructions}
            distance={distance}
            duration={duration}
            originName={originName}
            destinationName={destinationName}
          />
        </div>
      )}
    </>
  );
}
