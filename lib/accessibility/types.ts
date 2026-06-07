export type AccessibilityStatus = "fully_accessible" | "partially_accessible" | "not_accessible";

export interface AccessibleSegment {
  index: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distance: number;
  polyline: Array<{ lat: number; lon: number }>;
  accessible: boolean;
  blockedBy: string[];
  riskLevel: string;
}

export interface RouteAccessibilityResult {
  origin: { lat: number; lon: number; name?: string };
  destination: { lat: number; lon: number; name?: string };
  status: AccessibilityStatus;
  accessibleSegments: AccessibleSegment[];
  blockedSegments: AccessibleSegment[];
  furthestReachablePoint: { lat: number; lon: number } | null;
  totalDistance: number;
  accessibleDistance: number;
  accessibilityPercentage: number;
  safetyScore: number;
  reason: string;
  suggestions: string[];
}

export interface AccessibilitySearchResult {
  displayName: string;
  lat: number;
  lon: number;
}

export interface AccessibilityRequest {
  originLat: number;
  originLon: number;
  destinationLat: number;
  destinationLon: number;
  originName?: string;
  destinationName?: string;
  travelDate?: string;
}
