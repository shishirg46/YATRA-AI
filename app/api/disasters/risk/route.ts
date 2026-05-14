export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  calculateSegmentOwnedRouteRisk,
  fetchHistoricalDisastersNearRoute,
  fetchOpenMeteoWeather,
  fetchRealtimeDisastersNearRoute,
} from "@/lib/disaster-pipeline";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sampledPoints = Array.isArray(body?.sampledPoints) ? body.sampledPoints : [];
    const segmentsInput = Array.isArray(body?.segments) ? body.segments : undefined;
    if (!sampledPoints.length) {
      return NextResponse.json({ message: "sampledPoints are required" }, { status: 400 });
    }

    const center = sampledPoints[Math.floor(sampledPoints.length / 2)];

    const [realtime, historical, weather] = await Promise.all([
      fetchRealtimeDisastersNearRoute(sampledPoints, 15, 7).catch(() => []),
      fetchHistoricalDisastersNearRoute(sampledPoints, 15).catch(() => []),
      fetchOpenMeteoWeather(center.lat, center.lon).catch(() => ({ rain_mm_per_hr: 0, wind_kph: 0 })),
    ]);

    const segmentOwned = calculateSegmentOwnedRouteRisk({
      routePoints: sampledPoints,
      realtimeDisasters: realtime,
      historicalDisasters: historical,
      weather,
      segments: segmentsInput,
    });

    // Keep legacy fields aligned to the segment-owned result so UI cannot show
    // contradictory values (e.g. routeRisk LOW while pipeline says MEDIUM).
    const legacyBreakdown = {
      weather: 0,
      realtime: 0,
      historical: 0,
      terrain: 0,
    };
    if (segmentOwned.segments.length > 0) {
      const avg = segmentOwned.routeRisk.percent / 100;
      // Preserve weighted envelope used by engine for backward-compatible UI chips.
      legacyBreakdown.weather = Math.round(avg * 40);
      legacyBreakdown.realtime = Math.round(avg * 30);
      legacyBreakdown.historical = Math.round(avg * 20);
      legacyBreakdown.terrain = Math.round(avg * 10);
    }

    return NextResponse.json({
      routeRisk: segmentOwned.routeRisk,
      clusters: segmentOwned.clusters,
      alerts: segmentOwned.alerts,
      segments: segmentOwned.segments,
      riskPercent: segmentOwned.routeRisk.percent,
      riskLevel: segmentOwned.routeRisk.level,
      breakdown: legacyBreakdown,
      note: segmentOwned.segments.length
        ? "Segment-owned geospatial risk model applied."
        : "No data available, using baseline risk.",
      evidence: {
        weather,
        realtimeCount: realtime.length,
        historicalCount: historical.length,
        clusteredRealtime: segmentOwned.segments.reduce((sum, s) => sum + (s.alerts.some((a) => a.toLowerCase().includes("seismic")) ? 1 : 0), 0),
        clusteredHistorical: segmentOwned.segments.reduce((sum, s) => sum + (s.alerts.some((a) => a.toLowerCase().includes("flood history") || a.toLowerCase().includes("landslide-prone")) ? 1 : 0), 0),
      },
    });
  } catch (error) {
    console.error("[disasters/risk] error:", error);
    return NextResponse.json({ message: "Failed to calculate route risk" }, { status: 500 });
  }
}
