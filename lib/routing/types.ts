export interface GeoPoint {
  lat: number;
  lon: number;
  name?: string;
}

export interface ResolvedPlace {
  id: string | null;
  name: string;
  lat: number;
  lon: number;
  /** User-facing coordinates (marker); defaults to lat/lon */
  displayLat?: number;
  displayLon?: number;
  /** How this place was resolved */
  match: "exact" | "fuzzy" | "coordinates" | "nearest" | "user";
  distanceKm?: number;
}

export interface RouteNode {
  lat: number;
  lon: number;
  name: string;
  locationId?: string | null;
  routeNodeId?: string | null;
}

export interface BuiltRouteSegment {
  index: number;
  from: RouteNode;
  to: RouteNode;
  distance: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  riskScore?: number;
  hazards?: string[];
}

export interface RouteInstruction {
  text: string;
  distance: number;
  duration: number;
  type: string;
  lat: number;
  lon: number;
}

export interface BuiltRoute {
  origin: ResolvedPlace;
  destination: ResolvedPlace;
  nodes: RouteNode[];
  waypoints: Array<{ lat: number; lon: number; name?: string; order: number }>;
  segments: BuiltRouteSegment[];
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
  instructions?: RouteInstruction[];
  alternatives?: Array<{
    polyline: Array<{ lat: number; lon: number }>;
    distance: number;
    duration: number;
    instructions: RouteInstruction[];
  }>;
  source: string;
  resolutionNote?: string;
}

export interface BuildRouteInput {
  originLat: number;
  originLon: number;
  originDisplayLat?: number;
  originDisplayLon?: number;
  originName?: string;
  originRouteNodeId?: string | null;
  destinationLat?: number;
  destinationLon?: number;
  destinationDisplayLat?: number;
  destinationDisplayLon?: number;
  destinationName?: string;
  destinationId?: string;
  destinationRouteNodeId?: string | null;
}
