/**
 * FILE: route-safety.ts
 * LOCATION: /lib/analysis/route-safety.ts
 * PURPOSE: Analyzes safety for a route (origin → destination) using:
 *  1. Real-time disasters from BIPAD
 *  2. Historical weather data for the route
 *  3. Historical incident data along the route
 *  4. Place-by-place safety scoring
 *
 * This enables answering: "Is it safe to travel from Kathmandu to Pokhara in July?"
 */

import { fetchHistoricalWeather } from "@/lib/collectors/historical-weather";
import { fetchHistoricalHazard } from "@/lib/collectors/historical-hazard";
import { fetchHazard } from "@/lib/collectors/hazard";
import { fetchWeather } from "@/lib/collectors/weather";
import { getBaselineForPlace } from "@/lib/analysis/route-baseline";

export interface RoutePoint {
  id:          string;
  name:        string;
  district:    string;
  province:    string;
  lat:         number;
  lon:         number;
  altitude:    number | null;
  arrivalDate: string; // YYYY-MM-DD
}

export interface RouteSegment {
  from: RoutePoint;
  to:   RoutePoint;
  distanceKm: number;
  estimatedHours: number;
}

export interface PlaceSafetyScore {
  place:       RoutePoint;
  // Real-time data
  currentWeather: ReturnType<typeof fetchWeather> extends Promise<infer T> ? T : never;
  currentHazard:  ReturnType<typeof fetchHazard> extends Promise<infer T> ? T : never;
  // Historical data
  historicalWeather: ReturnType<typeof fetchHistoricalWeather> extends Promise<infer T> ? T : never;
  historicalHazard:  ReturnType<typeof fetchHistoricalHazard> extends Promise<infer T> ? T : never;
  // Computed scores
  weatherRisk:    number; // 0-1
  hazardRisk:    number; // 0-1
  seasonalRisk:  number; // 0-1
  overallScore:  number; // 0-1
  safetyLevel:   "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  riskFactors:  string[];
  recommendations: string[];
}

export interface RouteSafetyResult {
  origin:      RoutePoint;
  destination: RoutePoint;
  departureDate: string;
  // Place-by-place analysis
  places:      PlaceSafetyScore[];
  // Route summary
  overallScore: number;
  safetyLevel:  "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  // Risk breakdown
  weatherRisk:   number;
  hazardRisk:    number;
  seasonalRisk:  number;
  // Key insights
  riskFactors:    string[];
  recommendations: string[];
  bestMonths:     string[];
  alternativeRoutes?: string[];
}

/**
 * Analyze safety for a route between two places
 */
export async function analyzeRouteSafety(
  origin: RoutePoint,
  destination: RoutePoint,
  departureDate: string
): Promise<RouteSafetyResult> {

  // Get intermediate waypoints (simplified - in production, use routing API)
  const waypoints = generateWaypoints(origin, destination);
  const allPlaces = [origin, ...waypoints, destination];

  // Fetch data for all places in parallel
  const placeData = await Promise.all(
    allPlaces.map(async (place) => {
      const [currentWeatherRaw, currentHazardRaw, historicalWeatherRaw, historicalHazardRaw] = await Promise.all([
        fetchWeather(place.lat, place.lon).catch(() => null),
        fetchHazard(place.district, place.lat, place.lon).catch(() => null),
        fetchHistoricalWeather(place.lat, place.lon, departureDate, 5).catch(() => null),
        fetchHistoricalHazard(place.district, place.lat, place.lon, departureDate, 5).catch(() => null),
      ]);
      const baseline = await getBaselineForPlace(place, departureDate).catch(() => null);

      const currentWeather = currentWeatherRaw ?? baseline?.currentWeather ?? null;
      const currentHazard = currentHazardRaw ?? baseline?.currentHazard ?? null;
      const historicalWeather = historicalWeatherRaw ?? baseline?.historicalWeather ?? null;
      const historicalHazard = historicalHazardRaw ?? baseline?.historicalHazard ?? null;

      return {
        place,
        currentWeather,
        currentHazard,
        historicalWeather,
        historicalHazard,
      };
    })
  );

  // Calculate safety scores for each place
  const places: PlaceSafetyScore[] = placeData.map((data) => {
    const weatherRisk = calculateWeatherRisk(data.currentWeather, data.historicalWeather);
    const hazardRisk = calculateHazardRisk(data.currentHazard, data.historicalHazard);
    const seasonalRisk = calculateSeasonalRisk(data.historicalWeather, data.historicalHazard);
    const overallScore = (weatherRisk + hazardRisk + seasonalRisk) / 3;
    const safetyLevel = scoreToLevel(overallScore);
    const riskFactors = extractRiskFactors(data);
    const recommendations = generateRecommendations(data, safetyLevel);

    return {
      place: data.place,
      currentWeather: data.currentWeather as any,
      currentHazard: data.currentHazard as any,
      historicalWeather: data.historicalWeather as any,
      historicalHazard: data.historicalHazard as any,
      weatherRisk,
      hazardRisk,
      seasonalRisk,
      overallScore,
      safetyLevel,
      riskFactors,
      recommendations,
    };
  });

  // Calculate route-level scores
  const weatherRisk = places.reduce((sum, p) => sum + p.weatherRisk, 0) / places.length;
  const hazardRisk = places.reduce((sum, p) => sum + p.hazardRisk, 0) / places.length;
  const seasonalRisk = places.reduce((sum, p) => sum + p.seasonalRisk, 0) / places.length;
  const overallScore = (weatherRisk + hazardRisk + seasonalRisk) / 3;
  const safetyLevel = scoreToLevel(overallScore);

  // Extract route-level insights
  const riskFactors = Array.from(new Set(places.flatMap(p => p.riskFactors)));
  const recommendations = Array.from(new Set(places.flatMap(p => p.recommendations)));
  const bestMonths = calculateBestMonths(places);

  return {
    origin,
    destination,
    departureDate,
    places,
    overallScore,
    safetyLevel,
    weatherRisk,
    hazardRisk,
    seasonalRisk,
    riskFactors,
    recommendations,
    bestMonths,
  };
}

/**
 * Generate waypoints between origin and destination
 * In production, this would use a routing API like OSRM
 */
function generateWaypoints(origin: RoutePoint, destination: RoutePoint): RoutePoint[] {
  const waypoints: RoutePoint[] = [];
  
  // Simple interpolation for now
  const steps = 3;
  for (let i = 1; i < steps; i++) {
    const ratio = i / steps;
    waypoints.push({
      id: `waypoint-${i}`,
      name: `Stop ${i}`,
      district: "",
      province: "",
      lat: origin.lat + (destination.lat - origin.lat) * ratio,
      lon: origin.lon + (destination.lon - origin.lon) * ratio,
      altitude: null,
      arrivalDate: "",
    });
  }

  return waypoints;
}

/**
 * Calculate weather risk from current + historical data
 */
function calculateWeatherRisk(
  current: any,
  historical: any
): number {
  let risk = 0.2; // baseline

  // Current weather risks
  if (current) {
    if (current.rainfall > 25) risk += 0.4;
    else if (current.rainfall > 10) risk += 0.2;
    
    if (current.temperature > 40) risk += 0.3;
    else if (current.temperature < 0) risk += 0.2;
  }

  // Historical weather risks
  if (historical) {
    risk += historical.heavyRainProbability ?? 0;
    risk += historical.freezingProbability ?? 0;
    risk += (historical.highWindProbability ?? 0) * 0.5;
  }

  return Math.min(risk, 1);
}

/**
 * Calculate hazard risk from current + historical data
 */
function calculateHazardRisk(
  current: any,
  historical: any
): number {
  let risk = 0.2; // baseline

  // Current real-time hazards
  if (current) {
    risk += current.floodIndex ?? 0;
    risk += current.landslideIndex ?? 0;
    risk += current.earthquakeIndex ?? 0;
  }

  // Historical incident data
  if (historical) {
    risk += historical.historicalFloodRisk ?? 0;
    risk += historical.historicalLandslideRisk ?? 0;
    risk += historical.historicalEarthquakeRisk ?? 0;
  }

  return Math.min(risk, 1);
}

/**
 * Calculate seasonal risk based on historical patterns
 */
function calculateSeasonalRisk(
  historicalWeather: any,
  historicalHazard: any
): number {
  let risk = 0.2;

  if (historicalWeather) {
    // Monsoon season (June-September) has higher risks
    const month = new Date().getMonth();
    if (month >= 5 && month <= 8) {
      risk += 0.3;
      risk += (historicalWeather.heavyRainProbability ?? 0) * 0.3;
    }
    // Winter (December-February) in high altitude
    if (month === 0 || month === 1 || month === 11) {
      risk += (historicalWeather.snowProbability ?? 0) * 0.3;
    }
  }

  if (historicalHazard) {
    risk += (historicalHazard.historicalFloodRisk ?? 0) * 0.2;
    risk += (historicalHazard.historicalLandslideRisk ?? 0) * 0.2;
  }

  return Math.min(risk, 1);
}

/**
 * Convert score to safety level
 */
function scoreToLevel(score: number): "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME" {
  if (score < 0.3) return "SAFE";
  if (score < 0.5) return "CAUTION";
  if (score < 0.7) return "HIGH_RISK";
  return "EXTREME";
}

/**
 * Extract risk factors from place data
 */
function extractRiskFactors(data: {
  place: RoutePoint;
  currentWeather: any;
  currentHazard: any;
  historicalWeather: any;
  historicalHazard: any;
}): string[] {
  const factors: string[] = [];

  if (data.currentWeather) {
    if (data.currentWeather.rainfall > 10) factors.push("Heavy rainfall");
    if (data.currentWeather.temperature > 35) factors.push("Extreme heat");
    if (data.currentWeather.temperature < 0) factors.push("Freezing conditions");
  }

  if (data.currentHazard) {
    if (data.currentHazard.floodIndex > 0.5) factors.push("Flood warning");
    if (data.currentHazard.landslideIndex > 0.5) factors.push("Landslide warning");
    if (data.currentHazard.earthquakeIndex > 0.3) factors.push("Earthquake activity");
  }

  if (data.historicalHazard) {
    if (data.historicalHazard.historicalFloodRisk > 0.5) factors.push("Flood-prone area");
    if (data.historicalHazard.historicalLandslideRisk > 0.5) factors.push("Landslide-prone area");
  }

  return factors;
}

/**
 * Generate recommendations based on place data
 */
function generateRecommendations(
  data: {
    place: RoutePoint;
    currentWeather: any;
    currentHazard: any;
    historicalWeather: any;
    historicalHazard: any;
  },
  safetyLevel: "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME"
): string[] {
  const recommendations: string[] = [];

  if (safetyLevel === "EXTREME" || safetyLevel === "HIGH_RISK") {
    recommendations.push("Consider postponing travel");
    recommendations.push("Check for road closures");
  }

  if (data.currentWeather?.rainfall > 10) {
    recommendations.push("Avoid travel during heavy rain");
  }

  if (data.historicalHazard?.historicalLandslideRisk > 0.5) {
    recommendations.push("Travel during dry season");
  }

  if (recommendations.length === 0) {
    recommendations.push("Standard travel precautions apply");
  }

  return recommendations;
}

/**
 * Calculate best months for travel based on historical data
 */
function calculateBestMonths(places: PlaceSafetyScore[]): string[] {
  const monthScores: Record<number, number> = {};
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Simple scoring based on place data
  places.forEach((place) => {
    const hw = place.historicalWeather as { heavyRainProbability?: number; snowProbability?: number } | null;
    if (hw) {
      // Score each month based on weather patterns
      for (let m = 0; m < 12; m++) {
        monthScores[m] = (monthScores[m] ?? 0) + 
          (1 - (hw.heavyRainProbability ?? 0.2)) * 0.5 +
          (1 - (hw.snowProbability ?? 0.1)) * 0.3;
      }
    }
  });

  // Return top 3 months
  const sorted = Object.entries(monthScores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([month]) => months[parseInt(month)]);

  return sorted.length > 0 ? sorted : ["October", "November", "March"];
}
