/**
 * FILE: map-utils.ts
 * LOCATION: /lib/map-utils.ts
 * PURPOSE: Utilities for map rendering and route visualization
 */

import type { LatLngExpression } from "leaflet";

/** Nepal bounding box for map constraints */
export const NEPAL_BOUNDS: [[number, number], [number, number]] = [
  [26.3, 80.0],
  [30.5, 88.2],
];

export const NEPAL_CENTER: LatLngExpression = [28.3949, 84.124];

export function isInNepalBounds(lat: number, lon: number): boolean {
  return lat >= 26.3 && lat <= 30.5 && lon >= 80 && lon <= 88.2;
}

export interface RouteSegmentInfo {
  index: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distance: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  hazards: string[];
  temperature?: number;
  rainfall?: number;
}

/**
 * Convert a coordinate pair to Leaflet LatLngExpression
 */
export function toLatLng(lat: number, lon: number): LatLngExpression {
  return [lat, lon] as LatLngExpression;
}

/**
 * Get color based on risk level
 */
export function getRiskColor(riskLevel: string): string {
  switch (riskLevel) {
    case "LOW":
      return "#34d399"; // emerald
    case "MEDIUM":
      return "#fbbf24"; // amber
    case "HIGH":
      return "#fb923c"; // orange
    case "EXTREME":
      return "#f87171"; // red
    default:
      return "#94a3b8"; // slate
  }
}

/**
 * Get opacity based on risk level
 */
export function getRiskOpacity(riskLevel: string): number {
  switch (riskLevel) {
    case "LOW":
      return 0.5;
    case "MEDIUM":
      return 0.7;
    case "HIGH":
      return 0.85;
    case "EXTREME":
      return 1;
    default:
      return 0.6;
  }
}

/**
 * Format distance in km or meters
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Format duration
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Encode polyline (simplified for display)
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let lat = 0;
  let lon = 0;
  let i = 0;

  while (i < encoded.length) {
    let latDiff = 0;
    let shift = 0;
    let result = 0;

    do {
      const byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (result & 0x20);

    latDiff = result & 1 ? ~(result >> 1) : result >> 1;
    lat += latDiff;

    shift = 0;
    result = 0;

    do {
      const byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (result & 0x20);

    const lonDiff = result & 1 ? ~(result >> 1) : result >> 1;
    lon += lonDiff;

    points.push([lat / 1e5, lon / 1e5]);
  }

  return points;
}

/**
 * Create popup HTML for a segment
 */
export function createSegmentPopup(segment: RouteSegmentInfo): string {
  return `
    <div style="font-family: 'DM Sans', sans-serif; padding: 8px; max-width: 200px;">
      <div style="font-weight: bold; margin-bottom: 4px;">Segment ${segment.index + 1}</div>
      <div style="font-size: 12px; color: #666; margin-bottom: 6px;">
        <div>Distance: ${formatDistance(segment.distance)}</div>
        ${segment.temperature !== undefined ? `<div>Temp: ${segment.temperature}°C</div>` : ""}
        ${segment.rainfall !== undefined ? `<div>Rainfall: ${segment.rainfall}mm</div>` : ""}
      </div>

      <div style="padding-top: 6px; border-top: 1px solid #eee;">
        <div style="font-size: 11px; color: #666; margin-bottom: 3px;">
          <strong>Risk:</strong>
          <span style="color: ${getRiskColor(segment.riskLevel)};">●</span>
          ${segment.riskLevel}
        </div>
        ${segment.hazards.length > 0
          ? `<div style="font-size: 11px; color: #666;">
              <strong>Hazards:</strong> ${segment.hazards.slice(0, 2).join(", ")}
            </div>`
          : ""
        }
      </div>
    </div>
  `;
}

/**
 * Bounds for focusing on routes
 */
export function calculateBounds(
  points: Array<{ lat: number; lon: number }>
): [[number, number], [number, number]] {
  if (points.length === 0) {
    return NEPAL_BOUNDS;
  }

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLon = points[0].lon;
  let maxLon = points[0].lon;

  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }

  // Add padding
  const latPadding = (maxLat - minLat) * 0.1 || 0.5;
  const lonPadding = (maxLon - minLon) * 0.1 || 0.5;

  return [
    [minLat - latPadding, minLon - lonPadding],
    [maxLat + latPadding, maxLon + lonPadding],
  ];
}
