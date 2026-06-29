export interface DestinationResult {
  id: string; name: string; district: string; province: string; altitude: number | null;
  latitude?: number; longitude?: number;
}

export interface MemberResult {
  id: string; name: string; username: string | null; image: string | null; status: string;
}

export interface MemberAnalysis {
  userId: string; name: string; username: string | null; isLeader: boolean;
  score: number; level: string; topRisks: string[]; healthFlags: string[];
}

export interface WeatherSnapshot {
  temperature: number;
  humidity: number;
  rainfall: number;
  windSpeed: number;
  description: string;
  source?: string;
  sourceLabel?: string;
  officialSource?: boolean;
  stationName?: string;
  stationDistanceKm?: number;
}

export interface HazardSnapshot {
  floodIndex: number;
  landslideIndex: number;
  earthquakeIndex: number;
  airQuality: number;
}

export interface RouteRisk {
  from: string;
  to: string;
  date: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
}

export interface Alternative {
  id: string; name: string; district: string; province: string;
  altitude: number | null; safetyScore: number; safetyLevel: string;
  estimatedNPR: number; budgetFeasible: boolean;
  transportCost: number; dailyCost: number; tripDays: number;
}

export interface DailyCostBreakdown {
  accommodation: number;
  meals: number;
  localTransport: number;
  misc: number;
  total: number;
}

export interface BudgetSummary {
  specified: number;
  estimatedTotal: number;
  estimatedDays: number;
  tripDays: number;
  perPerson: number;
  breakdown: { accommodation: number; food: number; transport: number; label: string };
  dailyCost: DailyCostBreakdown;
  transportCost: number;
  remainingBudget: number;
  feasible: boolean;
  shortfall: number;
}

export interface PlanReport {
  destination:    { id: string; name: string; district: string; province: string; latitude: number; longitude: number; altitude: number | null };
  travelDate:     string;
  startDate:      string;
  endDate:        string;
  tripType:       string;
  liveWeather?:   WeatherSnapshot | null;
  liveHazard?:    HazardSnapshot | null;
  routeRisk?:     RouteRisk | null;
  season:         string;
  overallScore:   number;
  overallLevel:   "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  groupAvgScore:  number;
  confidence:     number;
  conflict:       boolean;
  mostVulnerableMember: { name: string; score: number; level: string; risks: string[] } | null;
  memberAnalyses: MemberAnalysis[];
  riskFactors:    { category: string; name: string; severity: string; score: number; description: string }[];
  healthAdvisories: { condition: string; risk: string; detail: string; affectedGroups: string[] }[];
  recommendations: { type: string; text: string }[];
  notableEvents:   { date: string; type: string; description: string; severity: string }[];
  seasonalContext: string;
  weatherStats:   { avgTempMax: number; avgTempMin: number; avgRainfall: number; avgWindSpeed: number; avgSnowfall: number; heavyRainProbability: number; freezingProbability: number; snowProbability: number; maxRainfall: number; minTemp: number; maxTemp: number; yearsAnalysed: number } | null;
  budget: BudgetSummary;
  alternatives:   Alternative[];
  ai: { verdict: string; whyUnsafe: string; groupConflict: string; riskExplanation: string; healthWarning: string; budgetAdvice: string; alternativeReason: string; topTip: string };
  pillarScores?: Array<{
    id: "route_historic" | "route_realtime" | "destination_safety" | "weather_safety" | "personal_safety";
    title: string;
    maxPoints: number;
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    summary: string;
  }>;
  routePillar?: {
    highway: string;
    breakpoints: string[];
    incidentBreakdown?: Array<{ section: string; total: number; roadAccidents: number; floods: number; landslides: number }>;
    segmentFlags: Array<{ where: string; when: string; what: string; effect: string; status: "Clear" | "Advisory" | "Blocked"; sources: string[] }>;
  };
  segmentDetails?: Array<{
    index: number;
    from: string; to: string;
    fromLat: number; fromLon: number; toLat: number; toLon: number;
    distanceKm: number;
    riskLevel: string; riskScore: number;
    gradient: number | null;
    roadSurface: { highway: string; surface: string | null; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME" } | null;
    riverProximityKm: number | null;
    elevationStart: number | null; elevationEnd: number | null;
    hazards: string[];
    floodIndex: number; landslideIndex: number; earthquakeIndex: number;
    temperature: number; rainfall: number; windSpeed: number;
  }>;
  destinationPillar?: { historicProfile: string; realtimeSnapshot: string };
  weatherPillar?: {
    deltas: { temperature: number; altitude: number; humidity: number; rainfallRatio: number };
    acclimatizationDays: number;
    forecastWeek?: Array<{ date: string; weatherCode: number; tempMax: number; tempMin: number; rainProb: number; windMax: number; isTravelDate: boolean }>;
  };
  personalPillar?: {
    clearance: string;
    flags: string[];
    soloSummary: string;
    guideRequired: boolean;
    emergencyPreparedness: { hospital: string; helicopter: string; mobileCoverage: "Good" | "Partial" | "None"; pavedRoadAccessHours: number; evacuationWarning: string | null };
  };
  analyzedAt: string;
}

export type PlanReportSavePayload = {
  title: string;
  tripType: "SOLO" | "GROUP";
  startDate: string;
  endDate: string;
  budgetNPR: number;
  stops: { locationId: string; stopOrder: number; arrivalDate: string; departureDate: string }[];
  memberUsernames: string[];
  status: "ANALYZED" | "PENDING";
  groupRiskResult: {
    overallLevel: string;
    overallScore: number;
    confidence: number;
    routeRisk: RouteRisk | null | undefined;
    riskFactors: { category: string; name: string; severity: string; score: number; description: string }[];
    recommendations: { type: string; text: string }[];
    analyzedAt: string;
  };
  stopRiskSnapshot: {
    overallLevel: string;
    overallScore: number;
    routeRisk: RouteRisk | null | undefined;
    destination: { id: string; name: string; district: string; province: string; latitude: number; longitude: number; altitude: number | null };
    travelDate: string;
  };
};
