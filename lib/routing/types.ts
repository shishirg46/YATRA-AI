import type { RouteExplanation } from "@/lib/routing/route-explanation";

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
  roadCode?: string;
  junction?: string;
}

export interface CorridorLabel {
  displayName: string;
  startIdx: number;
  endIdx: number;
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

export interface HazardProfile {
  landslideExposure: number;   // 0-100, independent per segment
  floodExposure: number;       // 0-100
  weatherRisk: number;         // 0-100
  roadConditionRisk: number;   // 0-100
  seismicRisk: number;         // 0-100
  composite: number;           // 0-100 weighted blend
}

export interface BuiltRouteSegment {
  index: number;
  from: RouteNode;
  to: RouteNode;
  distance: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  riskScore?: number;
  hazards?: string[];
  hazardProfile?: HazardProfile;
  roadCode?: string;
}

export interface TripIntelligence {
  optimalDepartureTime: string | null;
  monsoonWarning: string | null;
  driverAdvisories: string[];
  segmentHazards: Record<number, HazardProfile>;
  seasonalNote: string | null;
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
  provenance: RouteProvenance;
  resolutionNote?: string;
  tripIntelligence?: TripIntelligence;
  dorMetrics?: {
    deviationScore: number;
    roadChangeRatePer100km: number;
    continuityScore: number;
    weightEfficiency: number;
  };
  abstraction?: RouteAbstraction;
  routeAlternatives?: RouteAlternative[];
  explanation?: RouteExplanation;
  namedRoute?: NamedRoute;
}

export type DorRoutingMode = "strict-road" | "balanced" | "fastest" | "highway-preferred";

// ─── Route Abstraction Layer (Stage 7) ────────────────────────────

export type RouteIntent = "fastest" | "scenic" | "highway" | "balanced";

export interface HighwaySegment {
  roadCode: string;
  fromPlace: string;
  toPlace: string;
  fromPlaceSource: "raw" | "sanitized" | "gazetteer";
  toPlaceSource: "raw" | "sanitized" | "gazetteer";
  distanceKm: number;
  nodeCount: number;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
}

export interface RouteAbstraction {
  origin: string;
  destination: string;
  totalDistanceKm: number;
  totalWeight: number;
  highwaySegments: HighwaySegment[];
  roadChain: string[];
  roadChanges: number;
  metrics?: {
    deviationScore: number;
    roadChangeRatePer100km: number;
    continuityScore: number;
    weightEfficiency: number;
  };
  intent?: RouteIntent;
}

export interface RouteAlternativeSegment {
  roadCode: string;
  roadName: string;
  fromPlace: string;
  toPlace: string;
  distanceKm: number;
}

export interface RouteAlternative {
  label: string;
  intent: RouteIntent;
  abstraction: RouteAbstraction;
  description?: string;
  displaySegments?: RouteAlternativeSegment[];
}

// ─── Route Provenance Contract Layer (Stage 8.5) ───────────────────

export interface RouteProvenance {
  engine: "dor" | "osrm" | "estimated" | "legacy-graph" | "template";
  mode?: DorRoutingMode;
  validationStatus: "passed" | "fallback" | "empty";
  fallbackReason?: string;
  isTraceValid: boolean;
  isMetricComplete: boolean;
}

// ─── Route Explanation types live in route-explanation.ts ─────────
// Re-exported via lib/routing/index.ts

export type PlaceType = "city" | "town" | "village" | "municipality" | "hamlet" | "suburb";

export interface NamedPlace {
  name: string;
  lat: number;
  lon: number;
  type: PlaceType;
}

export interface NamedRoute {
  coordinates: Array<{ lat: number; lon: number }>;
  namedPlaces: string[];
  distance: number;
  duration: number;
  roads?: RoadGenerationResult["roads"];
}

export interface GeneratedRoad {
  id: number;
  sequence: string[];
  segments: string[];
  coordinates: Array<{ lat: number; lon: number }>;
  distance: number;
  duration: number;
}

export interface RoadGenerationResult {
  roads: GeneratedRoad[];
}

// ─── Enhanced Road Types with Named Sub-Coordinates ───────────────

export interface NamedCoordinate {
  coord: { lat: number; lon: number };
  placeName: string | null;
  placeType: string | null;
}

export interface EnhancedRoadSegment {
  index: number;
  fromName: string;
  toName: string;
  fromCoord: { lat: number; lon: number };
  toCoord: { lat: number; lon: number };
  subCoords: NamedCoordinate[];
  direction: string;
  distance: number;
  duration: number;
}

export interface EnhancedRoad {
  id: number;
  name: string;
  direction: string;
  distance: number;
  duration: number;
  fullCoordinates: Array<{ lat: number; lon: number }>;
  segments: EnhancedRoadSegment[];
}

export interface EnhancedRoadResult {
  roads: EnhancedRoad[];
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
  dorRoutingMode?: DorRoutingMode;
  dorPreferRoad?: string;
  includeNamedPlaces?: boolean;
}
