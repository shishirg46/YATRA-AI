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
  displayLat?: number;
  displayLon?: number;
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

export type VehicleProfile = "car" | "motorcycle" | "jeep";

export interface RouteRequest {
  start: GeoPoint;
  end: GeoPoint;
  vehicle?: VehicleProfile;
  waypoints?: GeoPoint[];
  alternatives?: boolean;
}

export interface RouteCoordinate {
  lat: number;
  lon: number;
}

export interface RouteInstruction {
  text: string;
  distance: number;
  duration: number;
  type: string;
  lat: number;
  lon: number;
  sign?: string;
  streetName?: string;
}

export interface RouteLeg {
  distance: number;
  duration: number;
  steps: RouteInstruction[];
  summary: string;
}

export interface RoadRoute {
  coordinates: RouteCoordinate[];
  distance: number;
  duration: number;
  encodedPolyline: string;
  legs: RouteLeg[];
  elevation?: number[];
}

export interface RouteResult {
  id: string;
  provider: "openrouteservice" | "osrm";
  vehicle: VehicleProfile;
  routes: RoadRoute[];
  source: string;
}

export interface DetourInfo {
  placeId: string;
  placeName: string;
  lat: number;
  lon: number;
  category: string;
  routeDeviationKm: number;
  detourDistanceKm: number;
  detourDurationSeconds: number;
  detourMinutes: number;
  detourPercentage: number;
  distanceFromRouteKm: number;
  accessibilityScore: number;
  popularityScore: number;
  score: number;
}

export interface RouteStop {
  name: string;
  score: number;
  detourTime: number;
  category: string;
  lat: number;
  lon: number;
  detourDistanceKm: number;
  popularityScore: number;
  accessibilityScore: number;
}

export interface RouteBufferZone {
  strict: number;
  normal: number;
  exploration: number;
}

export interface RouteIntelligence {
  route: RoadRoute;
  buffer: RouteBufferZone;
  placesAlongRoute: DetourInfo[];
  rankedStops: RouteStop[];
  bestStop: RouteStop | null;
  vehicleProfile: VehicleProfile;
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

export interface PerSegmentRoute {
  from: RouteNode;
  to: RouteNode;
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
  instructions?: RouteInstruction[];
  alternatives: Array<{
    polyline: Array<{ lat: number; lon: number }>;
    distance: number;
    duration: number;
    instructions: RouteInstruction[];
  }>;
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
  segmentRoutes?: PerSegmentRoute[];
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
  waypoints?: RouteNode[];
  perSegmentRouting?: boolean;
  dynamicOsmRouting?: boolean;
  vehicle?: VehicleProfile;
}
