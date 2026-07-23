/**
 * FILE: temporal-risk.ts
 * LOCATION: /lib/analysis/temporal-risk.ts
 * PURPOSE: Combines historical weather, historical hazards, health factors,
 *          and seasonal rules into a comprehensive travel safety report
 *          for a specific destination on a specific date.
 *
 * OUTPUT: A full TravelRiskReport that answers:
 *   "Is it safe to travel to X on Y date?"
 *   With: overall score, level, every risk factor explained, and recommendations.
 */

import { fetchHistoricalWeather, HistoricalWeatherStats } from "@/lib/collectors/historical-weather";
import { fetchHistoricalHazard, HistoricalHazardStats }   from "@/lib/collectors/historical-hazard";
import { fetchWeather, WeatherSnapshot }                   from "@/lib/collectors/weather";
import { TemplateCache } from "@/lib/explain/templates/cache";
import { renderTemplate } from "@/lib/explain/templates/renderer";

// ── Output types ──────────────────────────────────────────────────────────────

export type RiskLevel = "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";

export interface RiskFactor {
  category:    string;           // "Weather", "Hazard", "Health", "Seasonal"
  name:        string;           // "Heavy monsoon rainfall"
  severity:    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  score:       number;           // penalty 0–30
  description: string;           // full explanation
  source:      string;           // where data came from
}

export interface HealthAdvisory {
  condition: string;           // "Altitude sickness", "Cold exposure", etc.
  risk:      "LOW" | "MEDIUM" | "HIGH";
  detail:    string;
  affectedGroups: string[];    // ["elderly", "heart condition", "asthma"]
}

export interface Recommendation {
  type:    "GEAR" | "TIMING" | "MEDICAL" | "ROUTE" | "AVOID";
  text:    string;
}

/**
 * Look up a recommendation template from the DB-backed cache and render it.
 * Falls back to `fallback` text when the cache is unavailable or has no match.
 */
function rec(condition: string, params: Record<string, string | number>, fallback: string): string {
  try {
    const templates = TemplateCache.instance.get("recommendation", condition);
    if (templates.length > 0) {
      return renderTemplate(templates[0].template, params);
    }
  } catch {
    // Cache not initialized — use fallback
  }
  return fallback;
}

export interface TravelRiskReport {
  // Core result
  overallScore:  number;      // 0–100
  overallLevel:  RiskLevel;
  confidence:    number;      // 0–1 based on data availability
  summary:       string;      // one-sentence verdict

  // Breakdown
  riskFactors:      RiskFactor[];
  healthAdvisories: HealthAdvisory[];
  recommendations:  Recommendation[];
  notableEvents:    HistoricalHazardStats["notableEvents"];

  // Seasonal context
  season:          string;    // "Pre-monsoon", "Monsoon", "Post-monsoon", "Winter"
  seasonalContext: string;    // e.g. "July is peak monsoon in Nepal"

  // Data snapshots
  weatherStats:  HistoricalWeatherStats | null;
  hazardStats:   HistoricalHazardStats  | null;

  // Meta
  destination:   string;
  district:      string;
  province:      string;
  travelDate:    string;
  altitude:      number | null;
  analyzedAt:    string;
}

// ── User health profile for personalised analysis ─────────────────────────────

export interface UserHealthProfile {
  fitnessLevel:      "LOW" | "MODERATE" | "HIGH";
  mobilityLimited:   boolean;
  chronicConditions: string[];  // ["heart", "asthma", "diabetes", "hypertension"]
  allergies:         string[];
  homeAltitude:      number;    // metres — for altitude acclimatisation check
  homeProvince:      string;    // for climate difference check
}

// ── Main analysis function ────────────────────────────────────────────────────

export async function analyzeTemporalRisk(params: {
  destinationName: string;
  district:        string;
  province:        string;
  lat:             number;
  lon:             number;
  altitude:        number | null;
  travelDate:      string;          // YYYY-MM-DD
  userHealth:      UserHealthProfile | null;
  tripType:        "SOLO" | "GROUP";
  precomputedSeasonalContext?: string; // skip AI call if provided
  routePoints?:    { lat: number; lon: number }[]; // corridor-filter historical hazard
}): Promise<TravelRiskReport> {

  const { destinationName, district, province, lat, lon, altitude, travelDate, userHealth, tripType, precomputedSeasonalContext } = params;

  // Declare month + season before Promise.all since generateSeasonalContext needs them
  const travelDateObj = new Date(travelDate);
  const month         = travelDateObj.getMonth() + 1; // 1–12
  const season        = getSeason(month);

  // ── Fetch all data in parallel (weather + hazard + AI seasonal context) ──────
  const monthName = travelDateObj.toLocaleString("en-US", { month: "long" });
  const seasonalContextTask = Promise.resolve(
    precomputedSeasonalContext ?? fallbackSeasonalContext(destinationName, district, altitude ?? 0, monthName, season)
  );
  const [weatherStats, hazardStats, currentWeather, seasonalCtx] = await Promise.all([
    fetchHistoricalWeather(lat, lon, travelDate, 5),
    fetchHistoricalHazard(district, lat, lon, travelDate, 5, 150, undefined, params.routePoints),
    fetchWeather(lat, lon),
    seasonalContextTask,
  ]);

  const riskFactors:      RiskFactor[]      = [];
  const healthAdvisories: HealthAdvisory[]  = [];
  const recommendations:  Recommendation[]  = [];
  let totalPenalty = 0;
  let confidence   = 0.5; // base confidence

  if (weatherStats)    confidence += 0.2;
  if (hazardStats)     confidence += 0.15;
  if (currentWeather)  confidence += 0.1;

  // ── 1. Weather risk factors ──────────────────────────────────────────────────

  if (weatherStats) {
    // Heavy rain
    if (weatherStats.avgRainfall > 30 || weatherStats.heavyRainProbability > 0.4) {
      const penalty = Math.min(weatherStats.avgRainfall / 3, 12);
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Weather",
        name:        "Heavy rainfall",
        severity:    weatherStats.avgRainfall > 50 ? "CRITICAL" : weatherStats.avgRainfall > 25 ? "HIGH" : "MEDIUM",
        score:       round(penalty),
        description: `${destinationName} in ${district} receives ${weatherStats.avgRainfall}mm of rain in ${season.toLowerCase()} — ${Math.round(weatherStats.heavyRainProbability * 100)}% of days see heavy falls (>20mm). Highest single-day record: ${weatherStats.maxRainfall}mm.${currentWeather?.stationName ? ` DHM station "${currentWeather.stationName}"${currentWeather.stationDistanceKm ? ` (${currentWeather.stationDistanceKm}km)` : ""} reports ${currentWeather.rainfall}mm now.` : ""}`,
        source:      "Nepal DHM · OpenMeteo 5-year historical",
      });
      if (weatherStats.avgRainfall > 20) {
        recommendations.push({ type: "GEAR", text: `Pack waterproof jacket and gear for ${destinationName}. Roads in ${district} may be muddy or flooded during wet periods.` });
      }
    }

    // Freezing temperatures
    if (weatherStats.freezingProbability > 0.1 || weatherStats.avgTempMin < 5) {
      const penalty = Math.min((0 - weatherStats.avgTempMin) * 1.5, 8);
      if (penalty > 0) totalPenalty += penalty;
      riskFactors.push({
        category:    "Weather",
        name:        "Cold / freezing temperatures",
        severity:    weatherStats.avgTempMin < -5 ? "CRITICAL" : weatherStats.avgTempMin < 0 ? "HIGH" : "MEDIUM",
        score:       Math.max(0, round(penalty)),
        description: `${weatherStats.avgTempMin}°C is the average minimum in ${season.toLowerCase()} at ${destinationName}. ${Math.round(weatherStats.freezingProbability * 100)}% of days dip below freezing. Extreme low recorded: ${weatherStats.minTemp}°C.${currentWeather?.stationName ? ` DHM station "${currentWeather.stationName}" reads ${currentWeather.temperature}°C currently.` : ""}`,
        source:      "Nepal DHM · OpenMeteo 5-year historical",
      });
      recommendations.push({ type: "GEAR", text: `Pack thermal layers. Minimum temperatures can reach ${weatherStats.minTemp}°C.` });
    }

    // High winds
    if (weatherStats.highWindProbability > 0.2 || weatherStats.avgWindSpeed > 8) {
      const penalty = Math.min(weatherStats.avgWindSpeed * 0.8, 6);
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Weather",
        name:        "High wind speeds",
        severity:    weatherStats.avgWindSpeed > 15 ? "HIGH" : "MEDIUM",
        score:       round(penalty),
        description: `Peak winds at ${destinationName} average ${weatherStats.avgWindSpeed}m/s in ${season.toLowerCase()}. ${Math.round(weatherStats.highWindProbability * 100)}% of days exceed 10m/s. Maximum gust recorded: ${weatherStats.maxWindSpeed}m/s.${currentWeather?.stationName ? ` DHM station "${currentWeather.stationName}" records ${currentWeather.windSpeed}m/s now.` : ""}`,
        source:      "Nepal DHM · OpenMeteo 5-year historical",
      });
    }

    // Snow — gate by season and elevation
    const isSnowMonsoon = month >= 6 && month <= 9;
    const isSnowWinter = month === 12 || month === 1 || month === 2;
    const destinationAlt = altitude ?? 0;
    const isHighEnoughForSummerSnow = destinationAlt > 4500;
    const shouldShowSnowfall = (isSnowMonsoon && isHighEnoughForSummerSnow) || !isSnowMonsoon;
    if (shouldShowSnowfall && (weatherStats.snowProbability > 0.15 || weatherStats.avgSnowfall > 2)) {
      const penalty = Math.min(weatherStats.avgSnowfall * 1.5, 8);
      totalPenalty += penalty;
      const snowSeverity = isSnowWinter && weatherStats.avgSnowfall > 10 ? "HIGH"
        : isSnowWinter ? "MEDIUM"
        : weatherStats.avgSnowfall > 10 ? "MEDIUM"
        : "LOW";
      riskFactors.push({
        category:    "Weather",
        name:        "Snowfall",
        severity:    snowSeverity,
        score:       round(penalty),
        description: `${Math.round(weatherStats.snowProbability * 100)}% of days see snowfall in ${district} during this period, averaging ${weatherStats.avgSnowfall}cm. At ${altitude}m, trails and passes may close temporarily.${currentWeather?.stationName ? ` DHM station "${currentWeather.stationName}" reports ${currentWeather.temperature}°C currently.` : ""}`,
        source:      "Nepal DHM · OpenMeteo 5-year historical",
      });
      recommendations.push({ type: "GEAR", text: `Carry microspikes or crampons for ${destinationName}. Check trail conditions before departure.` });
      recommendations.push({ type: "ROUTE", text: `Confirm passes near ${destinationName} are open. Some high-altitude routes in ${district} close due to snow.` });
    }
  }

  // ── 2. Historical hazard factors ────────────────────────────────────────────

  if (hazardStats) {
    // Historical floods
    if (hazardStats.historicalFloodRisk > 0.1) {
      const penalty = Math.min(hazardStats.historicalFloodRisk * 3, 3);
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Hazard",
        name:        "Flood history",
        severity:    hazardStats.floodIncidents > 5 ? "HIGH" : hazardStats.floodIncidents > 2 ? "MEDIUM" : "LOW",
        score:       round(penalty),
        description: `${hazardStats.floodIncidents} flood events recorded in ${district} during ${season.toLowerCase()} over ${hazardStats.yearsAnalysed} years. This includes riverine floods affecting Terai road sections and flash floods in foothill areas.${currentWeather?.stationName ? ` DHM station "${currentWeather.stationName}" reports ${currentWeather.rainfall}mm now.` : ""}`,
        source:      "BIPAD · Nepal DHM",
      });
    }

    // Historical landslides
    if (hazardStats.historicalLandslideRisk > 0.1) {
      const penalty = Math.min(hazardStats.historicalLandslideRisk * 3, 3);
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Hazard",
        name:        "Landslide history",
        severity:    hazardStats.landslideIncidents > 5 ? "HIGH" : hazardStats.landslideIncidents > 2 ? "MEDIUM" : "LOW",
        score:       round(penalty),
        description: `${hazardStats.landslideIncidents} landslides recorded in ${district} during ${season.toLowerCase()} over ${hazardStats.yearsAnalysed} years. Hilly road sections above the Terai belt carry the highest exposure, especially during or after heavy rain.${currentWeather?.stationName ? ` DHM station "${currentWeather.stationName}" reports ${currentWeather.rainfall}mm — wet soil increases slide risk.` : ""}`,
        source:      "BIPAD · Nepal DHM",
      });
      recommendations.push({ type: "ROUTE", text: rec("recommendation_road_closure_alerts", { destination: destinationName, district }, `Check for road blockages en route to ${destinationName}. Carry emergency contacts for DoR (Department of Roads) for ${district}.`) });
    }

    // Earthquake history
    if (hazardStats.historicalEarthquakeRisk > 0.1) {
      const penalty = Math.min(hazardStats.historicalEarthquakeRisk * 2, 2);
      totalPenalty += penalty;
      const eqSeverity = hazardStats.earthquakeCount > 5 && hazardStats.maxEarthquakeMag >= 6
        ? "HIGH" : hazardStats.earthquakeCount > 2 ? "MEDIUM" : "LOW";
      riskFactors.push({
        category:    "Hazard",
        name:        "Seismic activity",
        severity:    eqSeverity,
        score:       round(penalty),
        description: `${hazardStats.earthquakeCount} earthquakes (M3.5+) recorded within 150km of ${destinationName} in ${season.toLowerCase()} over ${hazardStats.yearsAnalysed} years (max ${hazardStats.maxEarthquakeMag}M). Seismic risk exists across all Nepal but is not elevated for this specific corridor relative to baseline.`,
        source:      "USGS Earthquake Catalog",
      });
    }
  }

  // ── 3. Seasonal risk factors ─────────────────────────────────────────────────

  const seasonalFactors = getSeasonalRiskFactors(month, province, altitude ?? 0, destinationName, district, hazardStats, currentWeather);
  for (const sf of seasonalFactors) {
    totalPenalty += sf.score;
    riskFactors.push(sf);
  }

  // ── 4. Health advisories ─────────────────────────────────────────────────────

  const alt = altitude ?? 0;

  // Altitude sickness — universal risk above 2500m
  if (alt > 2500) {
    const altRisk = alt > 4000 ? "HIGH" : alt > 3000 ? "MEDIUM" : "LOW";
    const altPenalty = alt > 4500 ? 20 : alt > 3500 ? 12 : alt > 2500 ? 6 : 0;
    totalPenalty += altPenalty;

    healthAdvisories.push({
      condition:      "Altitude sickness (AMS)",
      risk:           altRisk,
      detail:         `At ${alt}m in ${district}, Acute Mountain Sickness is a risk. Symptoms: headache, nausea, dizziness. Ascend no more than 300–500m/day above 3000m. Carry Diamox if your doctor advises it.`,
      affectedGroups: ["all travelers", "especially those from low-altitude areas"],
    });

    recommendations.push({ type: "MEDICAL",  text: rec("recommendation_high_altitude_diamox", { destination: destinationName, altitude: alt }, `Consult a doctor about Diamox (acetazolamide) before travelling to ${destinationName} at ${alt}m.`) });
    recommendations.push({ type: "TIMING",   text: `Allow 1–2 rest days at intermediate altitude in ${district} before ascending further to ${destinationName}.` });

    if (userHealth?.homeAltitude !== undefined && userHealth.homeAltitude < 500 && alt > 3000) {
      const altDiff = alt - userHealth.homeAltitude;
      healthAdvisories.push({
        condition:      "Altitude acclimatisation — elevated risk",
        risk:           "HIGH",
        detail:         `You are travelling from ${userHealth.homeAltitude}m (home) to ${alt}m (${district}) — a ${altDiff}m gain. This significant increase requires extra acclimatisation time. AMS risk is higher for lowland residents.`,
        affectedGroups: ["lowland residents"],
      });
      totalPenalty += 10;
    }
  }

  // Cold exposure risk
  if (weatherStats && weatherStats.avgTempMin < 5) {
    healthAdvisories.push({
      condition:      "Cold exposure / hypothermia risk",
      risk:           weatherStats.avgTempMin < 0 ? "HIGH" : "MEDIUM",
      detail:         `Temperature at ${destinationName} drops to ${weatherStats.avgTempMin}°C in ${season.toLowerCase()}. Hypothermia risk if unprepared. Layer: base → insulation → waterproof outer.${currentWeather?.stationName ? ` DHM station "${currentWeather.stationName}" reads ${currentWeather.temperature}°C currently.` : ""}`,
      affectedGroups: ["elderly", "children", "those with heart conditions"],
    });
  }

  // Health condition specific advisories
  if (userHealth) {
    if (userHealth.chronicConditions.includes("heart") && alt > 2000) {
      const penalty = alt > 3500 ? 15 : 8;
      totalPenalty += penalty;
      healthAdvisories.push({
        condition:      "Heart condition at altitude",
        risk:           "HIGH",
        detail:         `At ${alt}m (${district}), reduced oxygen increases cardiac workload. Heart conditions carry higher cardiac event risk at this altitude. Medical clearance is strongly advised before this trip.`,
        affectedGroups: ["heart condition"],
      });
      recommendations.push({ type: "MEDICAL", text: `Mandatory cardiology clearance before travelling to ${destinationName} at ${alt}m with a heart condition.` });
    }

    if (userHealth.chronicConditions.includes("asthma") && weatherStats && weatherStats.avgRainfall > 15) {
      totalPenalty += 5;
      healthAdvisories.push({
        condition:      "Asthma — cold + damp conditions",
        risk:           "MEDIUM",
        detail:         `${season} conditions at ${destinationName} — cold and damp — can trigger asthma attacks. Carry salbutamol inhaler. Avoid early mornings when temperatures are lowest.`,
        affectedGroups: ["asthma"],
      });
    }

    if (userHealth.chronicConditions.includes("diabetes") && (alt > 3000 || (weatherStats && weatherStats.avgTempMin < 5))) {
      healthAdvisories.push({
        condition:      "Diabetes management at altitude/cold",
        risk:           "MEDIUM",
        detail:         `Altitude (${alt}m) and cold in ${district} affect insulin absorption and blood sugar. Monitor more frequently. Keep insulin close to your body to prevent freezing. Carry extra snacks for hypoglycaemia.`,
        affectedGroups: ["diabetes"],
      });
    }

    if (userHealth.mobilityLimited && (hazardStats?.historicalLandslideRisk ?? 0) > 0.2) {
      totalPenalty += 8;
      healthAdvisories.push({
        condition:      "Mobility — difficult terrain risk",
        risk:           "HIGH",
        detail:         `${district} has a history of landslides in ${season.toLowerCase()}. Debris-covered or washed-out roads in the corridor increase difficulty for those with mobility limitations.`,
        affectedGroups: ["mobility limited"],
      });
    }

    if (userHealth.fitnessLevel === "LOW" && alt > 2500) {
      totalPenalty += 6;
      healthAdvisories.push({
        condition:      "Low fitness — high altitude exertion",
        risk:           "MEDIUM",
        detail:         `At ${alt}m in ${district}, moderate walking is strenuous due to lower oxygen. Low fitness raises exhaustion risk. Plan shorter daily distances and include rest days.`,
        affectedGroups: ["low fitness"],
      });
    }

    // Solo trip penalty
    if (tripType === "SOLO") {
      totalPenalty += 5;
      riskFactors.push({
        category:    "Safety",
        name:        "Solo travel",
        severity:    "LOW",
        score:       5,
        description: `Travelling solo in ${district} — no backup if an incident occurs along the corridor. Register your itinerary with Nepal Tourism Board and share live location with a contact.`,
        source:      "Safety guidelines",
      });
      recommendations.push({ type: "MEDICAL", text: rec("recommendation_solo_trek_registration", { destination: destinationName }, `Register your trek to ${destinationName} with Nepal Tourism Board. Share your itinerary with an emergency contact.`) });
    }
  }

  // ── 5. Disease / health seasonal risks ──────────────────────────────────────

  const diseaseRisks = getDiseaseSeasonal(month, province, alt, destinationName, district);
  healthAdvisories.push(...diseaseRisks.advisories);
  totalPenalty += diseaseRisks.penalty;
  recommendations.push(...diseaseRisks.recommendations);

  // ── 6. Final score ────────────────────────────────────────────────────────────

  const overallScore = Math.max(0, Math.round(100 - totalPenalty));
  const overallLevel = scoreToLevel(overallScore);

  // Summary sentence
  const summary = buildSummary(overallLevel, destinationName, season, riskFactors);

  // Deduplicate recommendations
  const uniqueRecs = recommendations.filter((r, i, arr) =>
    arr.findIndex((x) => x.text === r.text) === i
  );

  return {
    overallScore,
    overallLevel,
    confidence:   round(Math.min(confidence, 1.0)),
    summary,
    riskFactors:      riskFactors.sort((a, b) => b.score - a.score),
    healthAdvisories,
    recommendations:  uniqueRecs,
    notableEvents:    hazardStats?.notableEvents ?? [],
    season,
    seasonalContext:  seasonalCtx,
    weatherStats,
    hazardStats,
    destination:  destinationName,
    district,
    province,
    travelDate,
    altitude:     alt || null,
    analyzedAt:   new Date().toISOString(),
  };
}

// ── Seasonal helpers ──────────────────────────────────────────────────────────

function getSeason(month: number): string {
  if (month >= 6  && month <= 9)  return "Monsoon";
  if (month >= 12 || month <= 2)  return "Winter";
  if (month >= 3  && month <= 5)  return "Pre-monsoon (Spring)";
  return "Post-monsoon (Autumn)";
}

// ── Seasonal context generator ────────────────────────────────────────────────
function fallbackSeasonalContext(
  name:      string,
  district:  string,
  altitude:  number,
  monthName: string,
  season:    string,
): string {
  const isVHigh = altitude > 4000;
  const isHigh  = altitude > 2500;

  if (season === "Monsoon") {
    return `${monthName} brings heavy monsoon rainfall to ${name} in ${district}. Landslide and river-flooding risk is elevated along the corridor. ${isHigh ? "High trails become slick and hazardous." : "Low-lying roads may be cut off during heavy downpours."}`;
  }
  if (season === "Winter" && isVHigh) {
    return `${name} at ${altitude.toLocaleString()}m is extremely cold in ${monthName}. Temperatures drop below freezing at night. Snow may block trails and passes. Full winter gear is essential.`;
  }
  if (season === "Pre-monsoon (Spring)" && isHigh) {
    return `${monthName} is a popular trekking month for ${name} (${altitude.toLocaleString()}m). Mornings are clear with afternoon thunderstorm risk. Rhododendrons bloom at lower elevations nearby.`;
  }
  if (season === "Post-monsoon (Autumn)") {
    return `${monthName} offers clear skies and stable weather at ${name} — one of the best times to visit ${district}. ${isHigh ? "Mountain views are outstanding and trails are dry." : "Comfortable temperatures and minimal rain."}`;
  }
  return `${name} in ${district} in ${monthName} (${season}). Check local conditions before travel.`;
}

function getSeasonalRiskFactors(
  month: number, province: string, altitude: number,
  destinationName: string, district: string,
  hazardStats?: HistoricalHazardStats | null,
  currentWeather?: WeatherSnapshot | null,
): RiskFactor[] {
  const factors: RiskFactor[] = [];

  // Monsoon — only show if BIPAD has recorded actual flood/landslide incidents in this district
  if (month >= 6 && month <= 9 && hazardStats && (hazardStats.floodIncidents > 0 || hazardStats.landslideIncidents > 0)) {
    const notable = hazardStats.notableEvents?.find((e) => e.severity === "HIGH" || e.severity === "MEDIUM");
    const dhmInfo = currentWeather?.stationName
      ? ` DHM station "${currentWeather.stationName}"${currentWeather.stationDistanceKm ? ` (${currentWeather.stationDistanceKm}km)` : ""} reports ${currentWeather.rainfall}mm, ${currentWeather.temperature}°C.`
      : "";
    const bipadInfo = `${hazardStats.floodIncidents} flood events, ${hazardStats.landslideIncidents} landslides in ${district} during monsoon over ${hazardStats.yearsAnalysed} years (BIPAD).`;
    const notableInfo = notable ? ` Notable past event: ${notable.description}.` : "";
    const monsoonScore = Math.min(
      (currentWeather?.rainfall ?? 0) / 10 +
        hazardStats.floodIncidents * 0.3 +
        hazardStats.landslideIncidents * 0.3,
      8,
    );
    factors.push({
      category:    "Seasonal",
      name:        "Active monsoon season",
      severity:    monsoonScore > 5 ? "HIGH" : monsoonScore > 2 ? "MEDIUM" : "LOW",
      score:       round(monsoonScore),
      description: `${destinationName} in ${district} is in monsoon season (June–September).${dhmInfo} ${bipadInfo}${notableInfo} ${(altitude ?? 0) > 1000 ? "Higher trails become slick and hazardous." : "Low-lying routes face waterlogging and river flooding."}`,
      source:      "Nepal DHM · BIPAD Nepal disaster database",
    });
  }

  // Pre-monsoon thunderstorms at altitude
  if ((month === 4 || month === 5) && altitude > 3500) {
    const dhmPre = currentWeather?.stationName
      ? ` DHM station "${currentWeather.stationName}"${currentWeather.stationDistanceKm ? ` (${currentWeather.stationDistanceKm}km)` : ""}: ${currentWeather.rainfall}mm rain, ${currentWeather.windSpeed}m/s wind, ${currentWeather.temperature}°C.`
      : "";
    const hazardPre = hazardStats
      ? ` ${hazardStats.floodIncidents} flood events, ${hazardStats.landslideIncidents} landslides in ${district} during pre-monsoon over ${hazardStats.yearsAnalysed} years (BIPAD).`
      : "";
    const preScore = Math.min(
      (currentWeather?.rainfall ?? 0) / 10 + (currentWeather?.windSpeed ?? 0) / 3,
      4,
    );
    factors.push({
      category:    "Seasonal",
      name:        "Pre-monsoon afternoon thunderstorms",
      severity:    preScore > 3 ? "HIGH" : preScore > 1 ? "MEDIUM" : "LOW",
      score:       round(preScore),
      description: `${destinationName} (${altitude}m) sees frequent afternoon thunderstorms April–May.${dhmPre}${hazardPre} Start treks early and reach camp before 1pm. Lightning risk on exposed ridges.`,
      source:      "Nepal DHM · BIPAD · trekking guidelines",
    });
  }

  // Winter snow at altitude
  if ((month === 12 || month <= 2) && altitude > 3500) {
    const dhmWinter = currentWeather?.stationName
      ? ` DHM station "${currentWeather.stationName}"${currentWeather.stationDistanceKm ? ` (${currentWeather.stationDistanceKm}km)` : ""}: ${currentWeather.temperature}°C, ${currentWeather.rainfall}mm precipitation.`
      : "";
    const hazardWinter = hazardStats
      ? ` ${hazardStats.landslideIncidents} landslides recorded in ${district} over ${hazardStats.yearsAnalysed} years — frozen ground can trigger slides during thaws (BIPAD).`
      : "";
    const winterScore = Math.min(
      (currentWeather?.temperature !== undefined && currentWeather.temperature < 0
        ? (0 - currentWeather.temperature) * 0.5
        : 0) + (altitude > 4500 ? 1.5 : 0),
      4,
    );
    factors.push({
      category:    "Seasonal",
      name:        "Winter snow — pass closures",
      severity:    winterScore > 3 ? "HIGH" : winterScore > 1 ? "MEDIUM" : "LOW",
      score:       round(winterScore),
        description: `Winter snowfall at ${destinationName} (${altitude}m) can close passes in ${district} for days or weeks.${dhmWinter}${hazardWinter} Several high routes in this region are officially closed December–March. Check pass conditions with TAAN before departure.`,
      source:      "Nepal DHM · BIPAD · TAAN",
    });
  }

  return factors;
}

function getDiseaseSeasonal(
  month: number, province: string, altitude: number,
  destinationName: string, district: string,
): {
  advisories:      HealthAdvisory[];
  penalty:         number;
  recommendations: Recommendation[];
} {
  const advisories:      HealthAdvisory[]  = [];
  const recommendations: Recommendation[] = [];
  let penalty = 0;

  // Malaria / dengue — Terai + lowlands during monsoon
  const isTerai = province === "Madhesh" || province === "Lumbini" || province === "Sudurpashchim";
  if (isTerai && altitude < 1500 && month >= 6 && month <= 10) {
    penalty += 5;
    advisories.push({
      condition:      "Mosquito-borne diseases (Malaria, Dengue)",
      risk:           "MEDIUM",
      detail:         `Lowland ${district} near ${destinationName} has elevated mosquito activity during monsoon and post-monsoon. Risk of malaria and dengue. Use DEET repellent, sleep under nets, cover skin at dusk.`,
      affectedGroups: ["all travelers to lowland areas"],
    });
    recommendations.push({ type: "MEDICAL", text: rec("recommendation_malaria_prevention", { district }, "Consider antimalarials for Terai travel. Use DEET repellent. Cover skin at dusk.") });
  }

  // Waterborne diseases — monsoon everywhere
  if (month >= 6 && month <= 9) {
    advisories.push({
      condition:      "Waterborne diseases (Typhoid, Cholera, Giardia)",
      risk:           "MEDIUM",
      detail:         `Monsoon rains in ${district} contaminate water sources. Drink only bottled or purified water at ${destinationName}. Avoid salads, raw vegetables, and street food. Ensure typhoid and hepatitis A vaccinations are current.`,
      affectedGroups: ["all travelers"],
    });
    recommendations.push({ type: "MEDICAL", text: rec("recommendation_water_safety", { destination: destinationName }, "Carry water purification tablets or filter. Avoid tap water and uncooked foods.") });
    recommendations.push({ type: "MEDICAL", text: rec("recommendation_vaccinations", { destination: destinationName }, "Ensure Typhoid, Hepatitis A vaccinations are current before travel.") });
  }

  // Respiratory in Kathmandu Valley
  if ((province === "Bagmati") && (month >= 11 || month <= 3)) {
    advisories.push({
      condition:      "Air pollution — Kathmandu Valley",
      risk:           "MEDIUM",
      detail:         `Winter temperature inversions in the Kathmandu Valley (${district}) trap particulate matter. PM2.5 near ${destinationName} regularly exceeds WHO safe limits. Wear N95 mask in urban areas.`,
      affectedGroups: ["asthma", "elderly", "children", "heart condition"],
    });
    recommendations.push({ type: "GEAR", text: rec("recommendation_air_quality", { destination: destinationName }, "Carry N95 masks for Kathmandu Valley. Check real-time AQI at aqi.in before outdoor activity.") });
  }

  return { advisories, penalty, recommendations };
}

function buildSummary(level: RiskLevel, destination: string, season: string, factors: RiskFactor[]): string {
  const topFactor = factors[0];
  const summaries: Record<RiskLevel, string> = {
    SAFE:      `${destination} appears safe for travel during this period (${season}). Conditions are generally favourable.`,
    CAUTION:   `Travel to ${destination} during ${season} requires caution. ${topFactor ? `Primary concern: ${topFactor.name.toLowerCase()}.` : "Monitor conditions before departure."}`,
    HIGH_RISK: `${destination} presents significant risks during ${season}. ${topFactor ? `Main hazard: ${topFactor.name}.` : "Travel is not recommended without careful preparation."} Consider postponing or choosing an alternative destination.`,
    EXTREME:   `Travel to ${destination} is strongly discouraged during ${season}. ${topFactor ? `Critical hazard: ${topFactor.name}.` : "Conditions are dangerous."} Seek alternatives.`,
  };
  return summaries[level];
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
