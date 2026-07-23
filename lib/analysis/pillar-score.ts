import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import { fetchHistoricalHazard } from "@/lib/collectors/historical-hazard";
import { fetchHistoricalWeather } from "@/lib/collectors/historical-weather";
import {
  fetchHistoricalDisastersNearRoute,
  fetchRealtimeDisastersNearRoute,
  getDisasterImpactSummary,
} from "@/lib/disaster-pipeline";
import { generateRouteIntelligence } from "@/lib/route-intelligence";
import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";
import { searchHospitalsNear } from "@/lib/routing/nominatim";
import type { PillarEvidence, ForecastDay, PlacePoint } from "@/lib/plan/pipeline-types";

type Level = "LOW" | "MEDIUM" | "HIGH";

export interface PillarScoreItem {
  id: "route_historic" | "route_realtime" | "destination_safety" | "weather_safety" | "personal_safety";
  title: string;
  maxPoints: number;
  score: number;
  level: Level;
  summary: string;
}

export interface SegmentDetail {
  index: number;
  from: string;
  to: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  distanceKm: number;
  riskLevel: string;
  riskScore: number;
  gradient: number | null;
  roadSurface: { highway: string; surface: string | null; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME" } | null;
  riverProximityKm: number | null;
  elevationStart: number | null;
  elevationEnd: number | null;
  hazards: string[];
  floodIndex: number;
  landslideIndex: number;
  earthquakeIndex: number;
  stormIndex: number;
  accidentIndex: number;
  temperature: number;
  rainfall: number;
  windSpeed: number;
}

export interface WeatherBreakdownItem {
  label: string;
  value: number;
  type: "base" | "penalty" | "result";
}

export interface PillarModelResult {
  totalScore: number;
  overallLevel: "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";
  pillars: PillarScoreItem[];
  segmentDetails: SegmentDetail[];
  route: {
    highway: string;
    breakpoints: string[];
    segmentFlags: Array<{
      where: string;
      when: string;
      what: string;
      effect: string;
      status: "Clear" | "Advisory" | "Blocked";
      sources: string[];
    }>;
    realtimeEvidenceCount: number;
    historicalEvidenceCount: number;
    incidentBreakdown: Array<{ section: string; total: number; roadAccidents: number; floods: number; landslides: number }>;
  };
  destination: {
    historicProfile: string;
    realtimeSnapshot: string;
    notableEvents: Array<{ date: string; type: string; description: string; severity: string }>;
  };
  weather: {
    home: { name: string; altitude: number; temp: number; humidity: number };
    destination: { name: string; altitude: number; temp: number; humidity: number; uvIndexEstimate: number };
    deltas: { temperature: number; altitude: number; humidity: number; rainfallRatio: number };
    acclimatizationDays: number;
    forecastWeek: Array<{
      date: string;
      weatherCode: number;
      tempMax: number;
      tempMin: number;
      rainProb: number;
      windMax: number;
      isTravelDate: boolean;
    }>;
    breakdown: WeatherBreakdownItem[];
  };
  personal: {
    clearance: string;
    flags: string[];
    soloSummary: string;
    guideRequired: boolean;
    emergencyPreparedness: {
      hospital: string;
      helicopter: string;
      mobileCoverage: "Good" | "Partial" | "None";
      pavedRoadAccessHours: number;
      evacuationWarning: string | null;
    };
  };
  baselineScore: number;
  seasonalFactors: Array<{ factor: string; points: number }>;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function toLevelByRatio(score: number, max: number): Level {
  const r = max <= 0 ? 0 : score / max;
  if (r >= 0.7) return "LOW";
  if (r >= 0.4) return "MEDIUM";
  return "HIGH";
}

function toOverallLevel(score: number): "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME" {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}

function estimateUvIndex(altitudeM: number, baseUv = 8): number {
  const multiplier = 1 + Math.max(0, altitudeM) / 1000;
  return Math.round(baseUv * multiplier);
}

function extractMonthsHint(month: number): string {
  if (month >= 6 && month <= 9) return "June-September (monsoon peak)";
  if (month >= 12 || month <= 2) return "December-February (winter)";
  return "Shoulder season pattern";
}

function inferRoadSection(routeName: string, from: string, to: string): string {
  return `${from}-${to} section of ${routeName}`;
}

async function loadPlaces(): Promise<PlacePoint[]> {
  const rows = await prisma.location.findMany({
    select: { name: true, latitude: true, longitude: true },
  });
  return rows
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({ name: r.name, lat: r.latitude, lon: r.longitude }));
}

function nearestPlaceName(lat: number, lon: number, places: PlacePoint[]): string | null {
  if (!places.length) return null;
  let best: PlacePoint | null = null;
  let minDist = Infinity;
  for (const p of places) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < minDist) {
      minDist = d;
      best = p;
    }
  }
  if (!best) return null;
  return minDist <= 12 ? best.name : null;
}

function normalizeSectionKey(from: string, to: string): string {
  const a = from.trim().toLowerCase();
  const b = to.trim().toLowerCase();
  return `${a}->${b}`;
}

async function fetchForecastWindow(lat: number, lon: number, startDate: string, endDate: string) {
  try {
    const url = `https://dhm.gov.np/mfd/api/forecast?lat=${lat}&lng=${lon}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json() as any;
    const daily = data?.daily_forecast;
    if (!Array.isArray(daily) || daily.length === 0) return [];

    const startTs = Date.parse(`${startDate}T00:00:00Z`);
    const endTs = Date.parse(`${endDate}T23:59:59Z`);

    const all: ForecastDay[] = daily.map((d: any) => {
      const dt = d.datetime;
      const ts = Date.parse(`${dt}T00:00:00Z`);
      return {
        date: dt,
        weatherCode: 0,
        tempMax: Number(d.max_temperature ?? 0),
        tempMin: Number(d.min_temperature ?? 0),
        rainProb: Number(d.precipitation_probability ?? 0),
        windMax: Number(d.wind_speed ?? 0),
        isTravelDate: ts >= startTs && ts <= endTs,
      };
    });

    // Prefer days within the trip window; fall back to nearest forecast days
    const inTrip = all.filter((d) => d.isTravelDate);
    if (inTrip.length >= 1) return inTrip;

    const midTs = (startTs + endTs) / 2;
    const sorted = [...all].sort((a, b) => {
      const aTs = Date.parse(`${a.date}T00:00:00Z`);
      const bTs = Date.parse(`${b.date}T00:00:00Z`);
      return Math.abs(aTs - midTs) - Math.abs(bTs - midTs);
    });
    return sorted.slice(0, 7);
  } catch {
    console.warn("[forecast] DHM API failed for weather forecast");
    return [];
  }
}

export async function computePillarModel(
  input: {
    routeIntelligence?: Awaited<ReturnType<typeof generateRouteIntelligence>> | null;
    destination: {
      id?: string;
      name: string;
      district: string;
      province: string;
      lat: number;
      lon: number;
      altitude: number | null;
    };
    home: {
      name: string;
      district: string;
      province: string;
      lat: number;
      lon: number;
      altitude: number | null;
    };
    travelDate: string;
    endDate?: string;
    tripType: "SOLO" | "GROUP";
    userHealth: {
      fitnessLevel: "LOW" | "MODERATE" | "HIGH";
      mobilityLimited: boolean;
      chronicConditions: string[];
    } | null;
  },
  evidence?: PillarEvidence,
): Promise<PillarModelResult> {
  const travelMonth = new Date(input.travelDate).getMonth() + 1;

  const routeIntel = input.routeIntelligence ?? await generateRouteIntelligence(
    { lat: input.home.lat, lon: input.home.lon, name: input.home.name },
    { lat: input.destination.lat, lon: input.destination.lon, name: input.destination.name },
    input.travelDate,
    { destinationId: input.destination.id }
  );
  const bestRoute = routeIntel.bestRoute ?? routeIntel.routes[0] ?? null;
  const destinationNameLc = input.destination.name.toLowerCase();
  const forcedPalpaRoute = destinationNameLc.includes("palpa") || destinationNameLc.includes("tansen");
  const routePoints = (bestRoute?.waypoints ?? []).map((w) => ({ lat: w.lat, lon: w.lon }));
  const routeName = forcedPalpaRoute
    ? "Siddhartha Highway (Kathmandu -> Mugling -> Narayanghat -> Butwal -> Tansen/Palpa)"
    : (bestRoute?.name ?? "Primary route");

  let routeHistorical: any[];
  let routeRealtime: any[];
  let impactSummary: { dead: number; injured: number; missing: number; affected: number; displaced: number };
  let destinationHistorical: any;
  let destinationWeather: any;
  let homeWeather: any;
  let destinationLiveHazard: any;
  let destinationLiveWeather: any;
  let forecastWeek: ForecastDay[];
  let places: PlacePoint[];

  if (evidence) {
    routeHistorical = evidence.routeHistorical as any[];
    routeRealtime = evidence.routeRealtime as any[];
    impactSummary = evidence.impactSummary;
    destinationHistorical = evidence.destinationHistorical;
    destinationWeather = evidence.destinationWeather;
    homeWeather = evidence.homeWeather;
    destinationLiveHazard = evidence.destinationLiveHazard;
    destinationLiveWeather = evidence.destinationLiveWeather;
    forecastWeek = evidence.forecastWeek;
    places = evidence.places;
  } else {
    [routeHistorical, routeRealtime, impactSummary, destinationHistorical, destinationWeather, homeWeather, destinationLiveHazard, destinationLiveWeather, forecastWeek, places] =
      await Promise.all([
        routePoints.length ? fetchHistoricalDisastersNearRoute(routePoints, 8).catch(() => []) : Promise.resolve([]),
        routePoints.length ? fetchRealtimeDisastersNearRoute(routePoints, 8, 7).catch(() => []) : Promise.resolve([]),
        routePoints.length ? getDisasterImpactSummary(routePoints, 12).catch(() => ({ dead: 0, injured: 0, missing: 0, affected: 0, displaced: 0 })) : Promise.resolve({ dead: 0, injured: 0, missing: 0, affected: 0, displaced: 0 }),
        fetchHistoricalHazard(input.destination.district, input.destination.lat, input.destination.lon, input.travelDate, 5, 75, undefined, routePoints.length ? routePoints : undefined).catch(() => null),
        fetchHistoricalWeather(input.destination.lat, input.destination.lon, input.travelDate, 5).catch(() => null),
        fetchWeather(input.home.lat, input.home.lon).catch(() => null),
        fetchHazard(input.destination.lat, input.destination.lon, prisma).catch(() => null),
        fetchWeather(input.destination.lat, input.destination.lon).catch(() => null),
        fetchForecastWindow(input.destination.lat, input.destination.lon, input.travelDate, input.endDate ?? input.travelDate).catch(() => []),
        loadPlaces().catch(() => [] as PlacePoint[]),
      ]);
  }

  // Look up real hospitals via Nominatim
  const nearbyHospitals = await searchHospitalsNear(
    input.destination.lat,
    input.destination.lon,
    3,
  );

  // i) Route historic (25)
  let routeHistoricPenalty = 0;
  const segFlags: PillarModelResult["route"]["segmentFlags"] = [];
  const incidentBreakdown: PillarModelResult["route"]["incidentBreakdown"] = [];
  const seenFlagSections = new Set<string>();
  const incidentBySection = new Map<string, { section: string; total: number; roadAccidents: number; floods: number; landslides: number }>();
  const segmentNames = (bestRoute?.segments ?? []).slice(0, 8);
  for (const seg of segmentNames) {
    const flood = seg.historical?.floodRisk ?? 0;
    const land = seg.historical?.landslideRisk ?? 0;
    const eqEvents = seg.evidence?.historical?.notableEvents ?? [];
    const recencyWeightedEq = eqEvents.reduce((sum, ev) => {
      const y = Number(String(ev.date).slice(0, 4));
      const recentBoost = y >= new Date().getFullYear() - 2 ? 2 : 1;
      const sevWeight = ev.severity === "HIGH" ? 3 : ev.severity === "MEDIUM" ? 1.5 : 1;
      return sum + recentBoost * sevWeight;
    }, 0);
    const segPenalty = (flood * 1) + (land * 1.5) + Math.min(3, recencyWeightedEq / 6);
    routeHistoricPenalty += segPenalty;

    const districtFrom = seg.startPoint.name ?? nearestPlaceName(seg.startPoint.lat, seg.startPoint.lon, places) ?? "Unknown";
    const districtTo = seg.endPoint.name ?? nearestPlaceName(seg.endPoint.lat, seg.endPoint.lon, places) ?? "Unknown";
    const floodCount = Math.round(flood * 12);
    const landslideCount = Math.round(land * 12);
    const estimatedRoadRiskEvents = Math.max(0, Math.round(segPenalty * 4) - floodCount - landslideCount);
    const section = inferRoadSection(routeName, districtFrom, districtTo);
    const sectionKey = normalizeSectionKey(districtFrom, districtTo);
    const existing = incidentBySection.get(sectionKey);
    if (existing) {
      existing.total += estimatedRoadRiskEvents + floodCount + landslideCount;
      existing.roadAccidents += estimatedRoadRiskEvents;
      existing.floods += floodCount;
      existing.landslides += landslideCount;
    } else if (districtFrom !== districtTo) {
      incidentBySection.set(sectionKey, {
        section,
        total: estimatedRoadRiskEvents + floodCount + landslideCount,
        roadAccidents: estimatedRoadRiskEvents,
        floods: floodCount,
        landslides: landslideCount,
      });
    }
    const extraDetails: string[] = [];
    if (seg.gradient !== undefined && seg.gradient !== null && Math.abs(seg.gradient) > 8) {
      extraDetails.push(`Grade ${seg.gradient >= 0 ? "+" : ""}${seg.gradient}%`);
    }
    if (seg.roadSurface) {
      const surf = seg.roadSurface.surface ? `/${seg.roadSurface.surface}` : "";
      extraDetails.push(`${seg.roadSurface.highway}${surf}`);
    }
    if (seg.riverProximityKm !== undefined && seg.riverProximityKm !== null && seg.riverProximityKm < 1) {
      extraDetails.push(`River ${Math.round(seg.riverProximityKm * 1000)}m`);
    }
    const extraStr = extraDetails.length > 0 ? ` — ${extraDetails.join(", ")}` : "";

    if ((segPenalty >= 1.25 || (seg.hazards ?? []).length > 0) && districtFrom !== districtTo && !seenFlagSections.has(sectionKey)) {
      seenFlagSections.add(sectionKey);
      segFlags.push({
        where: `${districtFrom} / ${districtTo} — ${section}`,
        when: extractMonthsHint(travelMonth),
        what: `${Math.round(flood * 100)}% flood risk, ${Math.round(land * 100)}% landslide risk, ${eqEvents.length} notable seismic events${extraStr}`,
        effect: segPenalty > 2 ? "Possible delays or partial road blockage. Keep 1 extra buffer day." : "Monitor advisories before departure.",
        status: segPenalty > 2.8 ? "Blocked" : segPenalty > 1.4 ? "Advisory" : "Clear",
        sources: [
          seg.evidence?.historical?.sources?.join("+") ?? "bipad+usgs",
          "OpenStreetMap route geometry",
          ...(seg.roadSurface ? ["OSM road surface tags"] : []),
        ],
      });
    }
  }
  incidentBreakdown.push(...incidentBySection.values());
  // Road accident / bridge washout proxy from disaster impact counts
  routeHistoricPenalty += clamp((impactSummary.dead * 3 + impactSummary.injured * 1.5 + impactSummary.affected / 1000) / 20, 0, 5);
  // Known risky corridors prior
  if (/prithvi|narayanghat|butwal|araniko/i.test(routeName)) routeHistoricPenalty += 3;
  const routeHistoricScore = Math.round(clamp(25 - routeHistoricPenalty, 0, 25));

  // ii) Route realtime (15)
  let routeRealtimePenalty = 0;
  routeRealtimePenalty += Math.min(8, routeRealtime.length * 0.9);
  const blockedSegments = segFlags.filter((s) => s.status === "Blocked").length;
  if (blockedSegments > 0) routeRealtimePenalty += 6;
  const hasActiveHigh = (bestRoute?.segments ?? []).some((s) => (s.realtime?.floodIndex ?? 0) > 0.7 || (s.realtime?.landslideIndex ?? 0) > 0.7 || ((s.realtime as any)?.stormIndex ?? 0) > 0.7 || ((s.realtime as any)?.accidentIndex ?? 0) > 0.8);
  if (hasActiveHigh) routeRealtimePenalty += 6;
  const routeRealtimeScore = Math.round(clamp(15 - routeRealtimePenalty, 0, 15));

  // iii) Destination safety (20)
  let destinationPenalty = 0;
  const histFlood = destinationHistorical?.historicalFloodRisk ?? 0;
  const histLand = destinationHistorical?.historicalLandslideRisk ?? 0;
  const histEq = destinationHistorical?.historicalEarthquakeRisk ?? 0;
  const histStorm = destinationHistorical?.historicalStormRisk ?? 0;
  const histAccident = destinationHistorical?.historicalAccidentRisk ?? 0;
  const liveFlood = destinationLiveHazard?.floodIndex ?? 0;
  const liveLand = destinationLiveHazard?.landslideIndex ?? 0;
  const liveEq = destinationLiveHazard?.earthquakeIndex ?? 0;
  const liveStorm = destinationLiveHazard?.stormIndex ?? 0;
  const liveAccident = destinationLiveHazard?.accidentIndex ?? 0;
  const destinationHumidity = destinationLiveWeather?.humidity ?? 45;
  const destinationRain = destinationLiveWeather?.rainfall ?? (destinationWeather?.avgRainfall ?? 2);

  destinationPenalty += histFlood * 0.8 + histLand * 0.8 + histEq * 0.4 + histStorm * 0.5 + histAccident * 0.3;
  destinationPenalty += (liveFlood + liveLand + liveEq) * 1.2 + liveStorm * 0.8 + liveAccident * 0.4;
  destinationPenalty += Math.max(0, destinationRain / 20) * 0.8;
  destinationPenalty += Math.max(0, (destinationHumidity - 70) / 20) * 0.7;
  if ((destinationLiveHazard?.airQuality ?? 0) > 0.7) destinationPenalty += 2;
  const destinationScore = Math.round(clamp(20 - destinationPenalty, 0, 20));

  // iv) Weather safety home vs destination (20)
  const homeTemp = homeWeather?.temperature ?? 24;
  const homeHumidity = homeWeather?.humidity ?? 60;
  const destTemp = destinationLiveWeather?.temperature ?? (destinationWeather?.avgTempMax ?? 18);
  const destHumidity = destinationLiveWeather?.humidity ?? 45;
  const tempDelta = destTemp - homeTemp;
  const altitudeDelta = (input.destination.altitude ?? 0) - (input.home.altitude ?? 1400);
  const humidityDelta = destHumidity - homeHumidity;
  const homeRain = Math.max(0.1, homeWeather?.rainfall ?? 1);
  const destRain = destinationLiveWeather?.rainfall ?? (destinationWeather?.avgRainfall ?? 2);
  const rainfallRatio = destRain / homeRain;
  const uv = estimateUvIndex(input.destination.altitude ?? 0);
  const wb: WeatherBreakdownItem[] = [{ label: "Starting score", value: 20, type: "base" }];
  let weatherPenalty = 0;
  const absTempDelta = Math.abs(tempDelta);
  if (absTempDelta > 20) { weatherPenalty += 4; wb.push({ label: "Temperature difference >20°C", value: -4, type: "penalty" }); }
  if (absTempDelta > 30) { weatherPenalty += 4; wb.push({ label: "Temperature difference >30°C", value: -4, type: "penalty" }); }
  if (altitudeDelta > 2500) { weatherPenalty += 6; wb.push({ label: "Altitude difference >2500m", value: -6, type: "penalty" }); }
  if (altitudeDelta > 3500) { weatherPenalty += 4; wb.push({ label: "Altitude difference >3500m", value: -4, type: "penalty" }); }
  if (travelMonth >= 6 && travelMonth <= 9) {
    const monsoonScore = Math.min((destinationLiveWeather?.rainfall ?? 0) / 10, 6);
    weatherPenalty += monsoonScore;
    wb.push({ label: `Monsoon season — ${destinationLiveWeather?.rainfall ?? 0}mm now`, value: -monsoonScore, type: "penalty" });
  }
  if ((destinationLiveWeather?.rainfall ?? 0) > 10) { weatherPenalty += 2; wb.push({ label: "Active heavy rainfall", value: -2, type: "penalty" }); }
  if (humidityDelta > 20) { weatherPenalty += 2; wb.push({ label: "Destination humidity significantly higher", value: -2, type: "penalty" }); }
  const effectiveWindChill = destTemp - ((destinationLiveWeather?.windSpeed ?? 0) * 1.5);
  if (effectiveWindChill < -15) { weatherPenalty += 4; wb.push({ label: "Wind chill below -15°C", value: -4, type: "penalty" }); }
  if (uv > 11) { weatherPenalty += 2; wb.push({ label: "Extreme UV index", value: -2, type: "penalty" }); }
  if (homeHumidity - destHumidity > 40) { weatherPenalty += 2; wb.push({ label: "Humidity difference >40%", value: -2, type: "penalty" }); }
  const weatherScore = Math.round(clamp(20 - weatherPenalty, 0, 20));
  wb.push({ label: "Final score", value: weatherScore, type: "result" });

  // v) Personal safety (20)
  let personalPenalty = 0;
  const flags: string[] = [];
  const fitness = input.userHealth?.fitnessLevel ?? "MODERATE";
  const mobility = input.userHealth?.mobilityLimited ?? false;
  const chronic = input.userHealth?.chronicConditions ?? [];
  const terrainDifficulty: "Easy" | "Moderate" | "Hard" | "Expert" =
    (input.destination.altitude ?? 0) > 4500 ? "Expert" : (input.destination.altitude ?? 0) > 3000 ? "Hard" : (input.destination.altitude ?? 0) > 1800 ? "Moderate" : "Easy";
  const routeSegmentRisk = (bestRoute?.segments ?? []).reduce((sum, seg) => sum + ((seg.riskLevel === "HIGH" || seg.riskLevel === "EXTREME") ? 2 : seg.riskLevel === "MEDIUM" ? 1 : 0), 0);
  if (fitness === "LOW" && (terrainDifficulty === "Hard" || terrainDifficulty === "Expert")) {
    personalPenalty += 5;
    flags.push("Low fitness vs hard terrain");
  }
  if (fitness === "MODERATE" && terrainDifficulty === "Expert") {
    personalPenalty += 3;
    flags.push("Moderate fitness vs expert terrain");
  }
  if (chronic.includes("heart") && (input.destination.altitude ?? 0) > 3000) {
    personalPenalty += 5;
    flags.push("Heart condition at high altitude");
  }
  if (chronic.includes("asthma") && (input.destination.altitude ?? 0) > 3000) {
    personalPenalty += 3;
    flags.push("Asthma trigger risk in cold/dry altitude");
  }
  if (chronic.includes("diabetes") && (input.destination.altitude ?? 0) > 3000) {
    personalPenalty += 3;
    flags.push("Diabetes management risk in remote altitude");
  }
  if (mobility && (terrainDifficulty === "Hard" || terrainDifficulty === "Expert")) {
    personalPenalty += 5;
    flags.push("Mobility limitation on difficult terrain");
  }
  const guideRequired = (input.destination.altitude ?? 0) > 4000 || terrainDifficulty === "Expert" || routeRealtimeScore < 8;
  if (input.tripType === "SOLO" && guideRequired) {
    personalPenalty += 4;
    flags.push("Solo risk elevated without guide");
  }
  if (routeSegmentRisk > 0) {
    personalPenalty += Math.min(3, Math.floor(routeSegmentRisk / 3));
    flags.push("Route segments include sustained hazard exposure");
  }
  const personalScore = Math.round(clamp(20 - personalPenalty, 0, 20));

  const acclimatizationDays = altitudeDelta > 3000 ? Math.ceil((altitudeDelta - 2500) / 500) : altitudeDelta > 1500 ? 1 : 0;

  const pillars: PillarScoreItem[] = [
    {
      id: "route_historic",
      title: "Route Safety - Historic",
      maxPoints: 25,
      score: routeHistoricScore,
      level: toLevelByRatio(routeHistoricScore, 25),
      summary: `${segFlags.length} flagged route sections, weighted by recency, severity, and frequency.`,
    },
    {
      id: "route_realtime",
      title: "Route Safety - Recent Incidents",
      maxPoints: 15,
      score: routeRealtimeScore,
      level: toLevelByRatio(routeRealtimeScore, 15),
      summary: `${routeRealtime.length} recent BIPAD records within ${8}km of corridor — filtered by severity.`,
    },
    {
      id: "destination_safety",
      title: "Destination Safety",
      maxPoints: 20,
      score: destinationScore,
      level: toLevelByRatio(destinationScore, 20),
      summary: "Combined historical district hazard profile and live local incident/weather condition signals.",
    },
    {
      id: "weather_safety",
      title: "Weather Safety - Home vs Destination",
      maxPoints: 20,
      score: weatherScore,
      level: toLevelByRatio(weatherScore, 20),
      summary: `Altitude delta ${Math.round(altitudeDelta)}m, temp delta ${Math.round(tempDelta)}°C, humidity delta ${Math.round(humidityDelta)}%.`,
    },
    {
      id: "personal_safety",
      title: "Personal Safety",
      maxPoints: 20,
      score: personalScore,
      level: toLevelByRatio(personalScore, 20),
      summary: guideRequired ? "Personal profile indicates guide support is recommended." : "Profile and terrain are broadly compatible with precautions.",
    },
  ];

  const totalScore = pillars.reduce((s, p) => s + p.score, 0);

  const clearance =
    personalScore >= 15
      ? "Suitable with standard precautions."
      : personalScore >= 10
      ? "Requires precautions before travel."
      : "Not recommended without medical and safety clearance.";
  const soloSummary =
    input.tripType === "SOLO"
      ? guideRequired
        ? "Solo emergency response may be delayed. Guide or satellite communicator strongly recommended."
        : "Solo travel possible, but share itinerary and register your trip."
      : "Group travel reduces solo-response risk, but keep emergency communication redundancy.";

  const emergencyHours = (input.destination.altitude ?? 0) > 3500 ? 7 : (input.destination.altitude ?? 0) > 2200 ? 4 : 2;
  const emergencyWarning = emergencyHours > 6 ? "Evacuation may take over 6 hours in bad weather." : null;

  const baselineScore = routeHistoricScore + destinationScore + weatherScore + personalScore;
  const seasonalFactors = [
    { factor: "route_historic", points: routeHistoricScore },
    { factor: "route_realtime", points: routeRealtimeScore },
    { factor: "destination_safety", points: destinationScore },
    { factor: "weather_safety", points: weatherScore },
    { factor: "personal_safety", points: personalScore },
  ];

  const segmentDetails: SegmentDetail[] = (bestRoute?.segments ?? []).map((seg) => ({
    index: seg.index,
    from: seg.startPoint.name ?? nearestPlaceName(seg.startPoint.lat, seg.startPoint.lon, places) ?? `(${seg.startPoint.lat.toFixed(3)}, ${seg.startPoint.lon.toFixed(3)})`,
    to: seg.endPoint.name ?? nearestPlaceName(seg.endPoint.lat, seg.endPoint.lon, places) ?? `(${seg.endPoint.lat.toFixed(3)}, ${seg.endPoint.lon.toFixed(3)})`,
    fromLat: seg.startPoint.lat,
    fromLon: seg.startPoint.lon,
    toLat: seg.endPoint.lat,
    toLon: seg.endPoint.lon,
    distanceKm: Math.round((seg.distance / 1000) * 10) / 10,
    riskLevel: seg.riskLevel,
    riskScore: Math.round(seg.riskScore * 100),
    gradient: seg.gradient ?? null,
    roadSurface: seg.roadSurface ?? null,
    riverProximityKm: seg.riverProximityKm ?? null,
    elevationStart: seg.elevationStart ?? null,
    elevationEnd: seg.elevationEnd ?? null,
    hazards: seg.hazards,
    floodIndex: seg.realtime?.floodIndex ?? 0,
    landslideIndex: seg.realtime?.landslideIndex ?? 0,
    earthquakeIndex: seg.realtime?.earthquakeIndex ?? 0,
    stormIndex: (seg.realtime as any)?.stormIndex ?? 0,
    accidentIndex: (seg.realtime as any)?.accidentIndex ?? 0,
    temperature: seg.realtime?.temperature ?? 0,
    rainfall: seg.realtime?.rainfall ?? 0,
    windSpeed: seg.realtime?.windSpeed ?? 0,
  }));

  return {
    totalScore,
    overallLevel: toOverallLevel(totalScore),
    pillars,
    segmentDetails,
    route: {
      highway: routeName,
      breakpoints: (bestRoute?.waypoints ?? [])
        .filter((w, i) => i % Math.max(1, Math.floor((bestRoute?.waypoints.length ?? 1) / 6)) === 0)
        .map((w) => nearestPlaceName(w.lat, w.lon, places) || w.name || `${w.lat.toFixed(3)},${w.lon.toFixed(3)}`)
        .slice(0, 8),
      segmentFlags: segFlags,
      realtimeEvidenceCount: routeRealtime.length,
      historicalEvidenceCount: routeHistorical.length,
      incidentBreakdown,
    },
    destination: {
      historicProfile: `In ${extractMonthsHint(travelMonth)}, ${input.destination.district} has averaged ${destinationHistorical?.floodIncidents ?? 0} flood, ${destinationHistorical?.landslideIncidents ?? 0} landslide, ${destinationHistorical?.stormIncidents ?? 0} storm, and ${destinationHistorical?.accidentIncidents ?? 0} accident incidents over ${destinationHistorical?.yearsAnalysed ?? 5} years.`,
      realtimeSnapshot: `BIPAD hazard indices - Flood ${Math.round(liveFlood * 100)}%, Landslide ${Math.round(liveLand * 100)}%, Quake ${Math.round(liveEq * 100)}%, Storm ${Math.round((destinationLiveHazard?.stormIndex ?? 0) * 100)}%, Accident ${Math.round((destinationLiveHazard?.accidentIndex ?? 0) * 100)}%.`,
      notableEvents: destinationHistorical?.notableEvents ?? [],
    },
    weather: {
      home: { name: input.home.name, altitude: input.home.altitude ?? 1400, temp: homeTemp, humidity: homeHumidity },
      destination: { name: input.destination.name, altitude: input.destination.altitude ?? 0, temp: destTemp, humidity: destHumidity, uvIndexEstimate: uv },
      deltas: { temperature: tempDelta, altitude: altitudeDelta, humidity: humidityDelta, rainfallRatio },
      acclimatizationDays,
      forecastWeek,
      breakdown: wb,
    },
    personal: {
      clearance,
      flags,
      soloSummary,
      guideRequired,
      emergencyPreparedness: {
        hospital: nearbyHospitals.length > 0
          ? nearbyHospitals.map((h) => `${h.name} (${Math.round(h.distanceKm * 10) / 10}km)`).join("; ")
          : `Nearest estimated facility: ${input.destination.district} District Hospital`,
        helicopter: `Nearest helicopter-capable zone: ${input.destination.name} helipad/municipal ground (verify locally)`,
        mobileCoverage: (input.destination.altitude ?? 0) > 4200 ? "Partial" : "Good",
        pavedRoadAccessHours: emergencyHours,
        evacuationWarning: emergencyWarning,
      },
    },
    baselineScore,
    seasonalFactors,
  };
}
