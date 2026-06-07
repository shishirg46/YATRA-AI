import { NextRequest, NextResponse } from "next/server";
import { generateRouteIntelligence } from "@/lib/route-intelligence";
import { generateFallbackRoute } from "@/lib/route-intelligence";
import type { AccessibilityRequest, RouteAccessibilityResult, AccessibleSegment, AccessibilityStatus } from "@/lib/accessibility/types";
import { haversineKm } from "@/lib/routing/geo";

async function handler(req: NextRequest) {
  try {
    const body: AccessibilityRequest = await req.json();
    const {
      originLat, originLon, destinationLat, destinationLon,
      originName, destinationName, travelDate,
    } = body;

    if (!originLat || !originLon || !destinationLat || !destinationLon) {
      return NextResponse.json(
        { message: "Missing required fields: originLat, originLon, destinationLat, destinationLon" },
        { status: 400 },
      );
    }

    const departureDate = travelDate || new Date().toISOString().split("T")[0];

    let routeIntel;
    try {
      routeIntel = await generateRouteIntelligence(
        { lat: originLat, lon: originLon, name: originName || "Origin" },
        { lat: destinationLat, lon: destinationLon, name: destinationName || "Destination" },
        departureDate,
      );
    } catch {
      const fallback = generateFallbackRoute(
        { lat: originLat, lon: originLon, name: originName || "Origin" },
        { lat: destinationLat, lon: destinationLon, name: destinationName || "Destination" },
      );
      routeIntel = {
        origin: { lat: originLat, lon: originLon, name: originName || "Origin" },
        destination: { lat: destinationLat, lon: destinationLon, name: destinationName || "Destination" },
        departureDate,
        routes: [fallback],
        bestRoute: fallback,
        generatedAt: new Date().toISOString(),
      };
    }

    const route = routeIntel.bestRoute ?? routeIntel.routes[0];
    if (!route) {
      return NextResponse.json(
        { message: "Could not generate a route between these locations" },
        { status: 400 },
      );
    }

    const segments = route.segments || [];
    const totalDistance = route.distance;

    const segmentResults: AccessibleSegment[] = segments.map((seg, i) => {
      const blockedBy: string[] = [];
      if (seg.hazards && seg.hazards.length > 0) {
        for (const h of seg.hazards) {
          const hl = h.toLowerCase();
          if (hl.includes("landslide") || hl.includes("flood") || hl.includes("road closure") || hl.includes("blocked")) {
            blockedBy.push(h);
          }
        }
      }

      if (seg.hazardAssessment?.alerts) {
        for (const a of seg.hazardAssessment.alerts) {
          const al = a.toLowerCase();
          if (al.includes("landslide") || al.includes("flood") || al.includes("closure") || al.includes("blocked") || al.includes("hazard")) {
            if (!blockedBy.includes(a)) blockedBy.push(a);
          }
        }
      }

      const isExtreme = seg.riskLevel === "EXTREME";
      const isHighWithHazards = seg.riskLevel === "HIGH" && blockedBy.length > 0;

      const polyline = buildSegmentPolyline(route.waypoints, seg, i);

      return {
        index: i,
        startLat: seg.startPoint.lat,
        startLon: seg.startPoint.lon,
        endLat: seg.endPoint.lat,
        endLon: seg.endPoint.lon,
        distance: seg.distance,
        polyline,
        accessible: !isExtreme && !isHighWithHazards,
        blockedBy: isExtreme ? ["Extreme risk level"] : blockedBy,
        riskLevel: seg.riskLevel,
      };
    });

    let firstBlockedIndex = segmentResults.findIndex((s) => !s.accessible);

    let accessibleSegments: AccessibleSegment[];
    let blockedSegments: AccessibleSegment[];

    if (firstBlockedIndex === -1) {
      accessibleSegments = segmentResults;
      blockedSegments = [];
    } else {
      accessibleSegments = segmentResults
        .slice(0, firstBlockedIndex)
        .map((s) => ({ ...s, accessible: true, blockedBy: [] }));

      const allLaterBlocked = segmentResults.slice(firstBlockedIndex).map((s) => ({
        ...s,
        accessible: false,
      }));
      blockedSegments = allLaterBlocked;
    }

    const accessibleDistance = accessibleSegments.reduce((sum, s) => sum + s.distance, 0);
    const accessibilityPercentage = totalDistance > 0
      ? Math.round((accessibleDistance / totalDistance) * 100)
      : 0;

    let status: AccessibilityStatus;
    if (firstBlockedIndex === -1) {
      status = "fully_accessible";
    } else if (firstBlockedIndex === 0) {
      status = "not_accessible";
    } else {
      status = "partially_accessible";
    }

    const lastAccessible = accessibleSegments[accessibleSegments.length - 1];
    const furthestReachablePoint = lastAccessible
      ? { lat: lastAccessible.endLat, lon: lastAccessible.endLon }
      : null;

    const safetyScore = Math.round((1 - route.riskScore) * 100);

    let reason: string;
    let suggestions: string[] = [];

    if (status === "fully_accessible") {
      reason = "The entire route is accessible with no significant hazards detected.";
      suggestions.push("Check road conditions before departure.");
    } else if (status === "partially_accessible") {
      const firstBlocked = blockedSegments[0];
      const causes = firstBlocked ? firstBlocked.blockedBy.join(", ") : "Unknown hazards";
      reason = `Route is blocked at segment ${firstBlocked!.index + 1} due to: ${causes}. You can reach ${Math.round(accessibleDistance / 1000)} km from origin.`;
      suggestions = [
        `Try alternative routes to bypass blocked segments around ${firstBlocked ? `${firstBlocked.startLat.toFixed(4)}, ${firstBlocked.startLon.toFixed(4)}` : "the affected area"}.`,
        "Consider postponing travel until hazards clear.",
        "Contact local authorities for current road status.",
      ];
    } else {
      const firstBlocked = blockedSegments[0];
      const causes = firstBlocked ? firstBlocked.blockedBy.join(", ") : "Unknown hazards";
      reason = `The route to your destination is not accessible due to: ${causes}.`;
      suggestions = [
        "Choose a different destination.",
        "Check for alternative routes with lower risk.",
        "Wait for current hazard conditions to improve.",
      ];
    }

    const result: RouteAccessibilityResult = {
      origin: { lat: originLat, lon: originLon, name: originName },
      destination: { lat: destinationLat, lon: destinationLon, name: destinationName },
      status,
      accessibleSegments,
      blockedSegments,
      furthestReachablePoint,
      totalDistance: Math.round(totalDistance),
      accessibleDistance: Math.round(accessibleDistance),
      accessibilityPercentage,
      safetyScore,
      reason,
      suggestions,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/accessibility] Error:", error);
    return NextResponse.json(
      { message: "Failed to analyze route accessibility" },
      { status: 500 },
    );
  }
}

function buildSegmentPolyline(
  waypoints: Array<{ lat: number; lon: number; distanceFromStart: number }>,
  segment: { startPoint: { lat: number; lon: number }; endPoint: { lat: number; lon: number } },
  segIndex: number,
): Array<{ lat: number; lon: number }> {
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < waypoints.length; i++) {
    if (Math.abs(waypoints[i].lat - segment.startPoint.lat) < 0.001 &&
        Math.abs(waypoints[i].lon - segment.startPoint.lon) < 0.001) {
      startIdx = i;
    }
    if (Math.abs(waypoints[i].lat - segment.endPoint.lat) < 0.001 &&
        Math.abs(waypoints[i].lon - segment.endPoint.lon) < 0.001) {
      endIdx = i;
    }
  }

  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    return waypoints.slice(startIdx, endIdx + 1).map((w) => ({ lat: w.lat, lon: w.lon }));
  }

  return [
    { lat: segment.startPoint.lat, lon: segment.startPoint.lon },
    { lat: segment.endPoint.lat, lon: segment.endPoint.lon },
  ];
}

export const POST = handler;
