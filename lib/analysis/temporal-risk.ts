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

import { callAI } from "@/lib/ai/client";

import { fetchHistoricalWeather, HistoricalWeatherStats } from "@/lib/collectors/historical-weather";
import { fetchHistoricalHazard, HistoricalHazardStats }   from "@/lib/collectors/historical-hazard";

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
}): Promise<TravelRiskReport> {

  const { destinationName, district, province, lat, lon, altitude, travelDate, userHealth, tripType, precomputedSeasonalContext } = params;

  // Declare month + season before Promise.all since generateSeasonalContext needs them
  const travelDateObj = new Date(travelDate);
  const month         = travelDateObj.getMonth() + 1; // 1–12
  const season        = getSeason(month);

  // ── Fetch all data in parallel (weather + hazard + AI seasonal context) ──────
  const seasonalContextTask = precomputedSeasonalContext
    ? Promise.resolve(precomputedSeasonalContext)
    : generateSeasonalContext({ destinationName, district, province, altitude: altitude ?? 0, month, season });
  const [weatherStats, hazardStats, seasonalCtx] = await Promise.all([
    fetchHistoricalWeather(lat, lon, travelDate, 5),
    fetchHistoricalHazard(district, lat, lon, travelDate, 5),
    seasonalContextTask,
  ]);

  const riskFactors:      RiskFactor[]      = [];
  const healthAdvisories: HealthAdvisory[]  = [];
  const recommendations:  Recommendation[]  = [];
  let totalPenalty = 0;
  let confidence   = 0.5; // base confidence

  if (weatherStats) confidence += 0.2;
  if (hazardStats)  confidence += 0.15;

  // ── 1. Weather risk factors ──────────────────────────────────────────────────

  if (weatherStats) {
    // Heavy rain
    if (weatherStats.avgRainfall > 30 || weatherStats.heavyRainProbability > 0.4) {
      const penalty = Math.min(weatherStats.avgRainfall / 3, 25);
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Weather",
        name:        "Heavy rainfall",
        severity:    weatherStats.avgRainfall > 50 ? "CRITICAL" : weatherStats.avgRainfall > 25 ? "HIGH" : "MEDIUM",
        score:       round(penalty),
        description: `Historically, this destination receives an average of ${weatherStats.avgRainfall}mm of rain during this period. ${Math.round(weatherStats.heavyRainProbability * 100)}% of days historically have heavy rain (>20mm). Maximum recorded: ${weatherStats.maxRainfall}mm.`,
        source:      "OpenMeteo 5-year historical",
      });
      if (weatherStats.avgRainfall > 20) {
        recommendations.push({ type: "GEAR", text: "Pack waterproof jacket and gear. Roads may be muddy or flooded." });
      }
    }

    // Freezing temperatures
    if (weatherStats.freezingProbability > 0.1 || weatherStats.avgTempMin < 5) {
      const penalty = Math.min((0 - weatherStats.avgTempMin) * 1.5, 15);
      if (penalty > 0) totalPenalty += penalty;
      riskFactors.push({
        category:    "Weather",
        name:        "Cold / freezing temperatures",
        severity:    weatherStats.avgTempMin < -5 ? "CRITICAL" : weatherStats.avgTempMin < 0 ? "HIGH" : "MEDIUM",
        score:       Math.max(0, round(penalty)),
        description: `Average minimum temperature historically: ${weatherStats.avgTempMin}°C. ${Math.round(weatherStats.freezingProbability * 100)}% of days historically drop below freezing. Lowest recorded: ${weatherStats.minTemp}°C.`,
        source:      "OpenMeteo 5-year historical",
      });
      recommendations.push({ type: "GEAR", text: `Pack thermal layers. Minimum temperatures can reach ${weatherStats.minTemp}°C.` });
    }

    // High winds
    if (weatherStats.highWindProbability > 0.2 || weatherStats.avgWindSpeed > 8) {
      const penalty = Math.min(weatherStats.avgWindSpeed * 0.8, 10);
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Weather",
        name:        "High wind speeds",
        severity:    weatherStats.avgWindSpeed > 15 ? "HIGH" : "MEDIUM",
        score:       round(penalty),
        description: `Average max wind speed: ${weatherStats.avgWindSpeed}m/s. ${Math.round(weatherStats.highWindProbability * 100)}% of days historically have winds above 10m/s. Maximum recorded: ${weatherStats.maxWindSpeed}m/s.`,
        source:      "OpenMeteo 5-year historical",
      });
    }

    // Snow
    if (weatherStats.snowProbability > 0.15 || weatherStats.avgSnowfall > 2) {
      const penalty = Math.min(weatherStats.avgSnowfall * 1.5, 15);
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Weather",
        name:        "Snowfall",
        severity:    weatherStats.avgSnowfall > 10 ? "HIGH" : "MEDIUM",
        score:       round(penalty),
        description: `${Math.round(weatherStats.snowProbability * 100)}% of days historically have snowfall. Average: ${weatherStats.avgSnowfall}cm. Trail access may be blocked.`,
        source:      "OpenMeteo 5-year historical",
      });
      recommendations.push({ type: "GEAR",  text: "Carry microspikes or crampons. Check trail conditions before departure." });
      recommendations.push({ type: "ROUTE", text: "Confirm passes are open. Some high-altitude routes close due to snow." });
    }
  }

  // ── 2. Historical hazard factors ────────────────────────────────────────────

  if (hazardStats) {
    // Historical floods
    if (hazardStats.historicalFloodRisk > 0.1) {
      const penalty = hazardStats.historicalFloodRisk * 25;
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Hazard",
        name:        "Flood history",
        severity:    hazardStats.floodIncidents > 5 ? "HIGH" : hazardStats.floodIncidents > 2 ? "MEDIUM" : "LOW",
        score:       round(penalty),
        description: `${hazardStats.floodIncidents} flood incidents recorded in ${district} during this season over the past ${hazardStats.yearsAnalysed} years.`,
        source:      "BIPAD Nepal disaster database",
      });
    }

    // Historical landslides
    if (hazardStats.historicalLandslideRisk > 0.1) {
      const penalty = hazardStats.historicalLandslideRisk * 25;
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Hazard",
        name:        "Landslide history",
        severity:    hazardStats.landslideIncidents > 5 ? "HIGH" : hazardStats.landslideIncidents > 2 ? "MEDIUM" : "LOW",
        score:       round(penalty),
        description: `${hazardStats.landslideIncidents} landslide incidents in ${district} during this season over the past ${hazardStats.yearsAnalysed} years. Nepal's hilly terrain is prone to landslides especially during monsoon.`,
        source:      "BIPAD Nepal disaster database",
      });
      recommendations.push({ type: "ROUTE", text: "Check for road blockages. Carry emergency contacts for DoR (Department of Roads)." });
    }

    // Earthquake history
    if (hazardStats.historicalEarthquakeRisk > 0.1) {
      const penalty = hazardStats.historicalEarthquakeRisk * 20;
      totalPenalty += penalty;
      riskFactors.push({
        category:    "Hazard",
        name:        "Seismic activity",
        severity:    hazardStats.maxEarthquakeMag >= 6 ? "HIGH" : "MEDIUM",
        score:       round(penalty),
        description: `${hazardStats.earthquakeCount} earthquakes (M3.5+) recorded within 150km in this season over the past ${hazardStats.yearsAnalysed} years. Largest: M${hazardStats.maxEarthquakeMag.toFixed(1)}.`,
        source:      "USGS Earthquake Catalog",
      });
    }
  }

  // ── 3. Seasonal risk factors ─────────────────────────────────────────────────

  const seasonalFactors = getSeasonalRiskFactors(month, province, altitude ?? 0);
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
      detail:         `At ${alt}m, Acute Mountain Sickness is a real risk. Symptoms: headache, nausea, dizziness. Acclimatise properly — ascend no more than 300–500m/day above 3000m. Carry Diamox if advised by doctor.`,
      affectedGroups: ["all travelers", "especially those from low-altitude areas"],
    });

    recommendations.push({ type: "MEDICAL",  text: "Consult a doctor about Diamox (acetazolamide) before travelling above 3000m." });
    recommendations.push({ type: "TIMING",   text: "Allow 1–2 rest days at intermediate altitude before ascending further." });

    if (userHealth?.homeAltitude !== undefined && userHealth.homeAltitude < 500 && alt > 3000) {
      const altDiff = alt - userHealth.homeAltitude;
      healthAdvisories.push({
        condition:      "Altitude acclimatisation — elevated risk",
        risk:           "HIGH",
        detail:         `You are travelling from ${userHealth.homeAltitude}m to ${alt}m — a difference of ${altDiff}m. This is a significant change. Your body needs additional time to acclimatise. Risk of AMS is higher for travelers from lowlands.`,
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
      detail:         `Temperature regularly drops to ${weatherStats.avgTempMin}°C. Risk of hypothermia if unprepared. Ensure proper layering: base layer → insulation → waterproof outer layer.`,
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
        detail:         `At ${alt}m, reduced oxygen levels increase cardiac workload. People with heart conditions face significantly higher risk of cardiac events at altitude. Medical consultation is strongly advised before this trip.`,
        affectedGroups: ["heart condition"],
      });
      recommendations.push({ type: "MEDICAL", text: "Mandatory cardiology clearance before travelling above 2000m with a heart condition." });
    }

    if (userHealth.chronicConditions.includes("asthma") && weatherStats && weatherStats.avgRainfall > 15) {
      totalPenalty += 5;
      healthAdvisories.push({
        condition:      "Asthma — cold + damp conditions",
        risk:           "MEDIUM",
        detail:         `Cold, damp conditions during this season can trigger asthma attacks. Carry rescue inhaler (salbutamol). Avoid early morning outdoor activity when temperatures are lowest.`,
        affectedGroups: ["asthma"],
      });
    }

    if (userHealth.chronicConditions.includes("diabetes") && (alt > 3000 || (weatherStats && weatherStats.avgTempMin < 5))) {
      healthAdvisories.push({
        condition:      "Diabetes management at altitude/cold",
        risk:           "MEDIUM",
        detail:         `Altitude and cold both affect insulin absorption and blood sugar regulation. Monitor more frequently. Insulin can freeze — keep it close to your body. Carry extra snacks for hypoglycaemia.`,
        affectedGroups: ["diabetes"],
      });
    }

    if (userHealth.mobilityLimited && (hazardStats?.historicalLandslideRisk ?? 0) > 0.2) {
      totalPenalty += 8;
      healthAdvisories.push({
        condition:      "Mobility — difficult terrain risk",
        risk:           "HIGH",
        detail:         `This destination has a history of landslides during this season. Uneven, debris-covered, or washed-out roads significantly increase risk for those with mobility limitations.`,
        affectedGroups: ["mobility limited"],
      });
    }

    if (userHealth.fitnessLevel === "LOW" && alt > 2500) {
      totalPenalty += 6;
      healthAdvisories.push({
        condition:      "Low fitness — high altitude exertion",
        risk:           "MEDIUM",
        detail:         `At ${alt}m, even moderate walking becomes strenuous due to reduced oxygen. Low fitness increases exhaustion risk. Consider shorter daily distances and build in more rest days.`,
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
        description: "Solo travel increases risk in remote areas. No one to assist in emergencies. Share itinerary with someone before departure.",
        source:      "Safety guidelines",
      });
      recommendations.push({ type: "MEDICAL", text: "Register your trek with Nepal Tourism Board. Share itinerary with emergency contact." });
    }
  }

  // ── 5. Disease / health seasonal risks ──────────────────────────────────────

  const diseaseRisks = getDiseaseSeasonal(month, province, alt);
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

// ── AI seasonal context generator ────────────────────────────────────────────

function fallbackIsSpecific(altitude: number, season: string): boolean {
  const isVHigh = altitude > 4000;
  const isHigh  = altitude > 2500;

  if (season === "Monsoon")                return true;
  if (season === "Post-monsoon (Autumn)")  return true;
  if (season === "Winter" && isVHigh)      return true;
  if (season === "Pre-monsoon (Spring)" && isHigh) return true;

  return false;
}

export async function generateSeasonalContext(params: {
  destinationName: string;
  district:        string;
  province:        string;
  altitude:        number;
  month:           number;
  season:          string;
}): Promise<string> {
  const { destinationName, district, province, altitude, month, season } = params;

  const monthNames = ["","January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const monthName  = monthNames[month];

  if (fallbackIsSpecific(altitude, season)) {
    return fallbackSeasonalContext(destinationName, district, altitude, monthName, season);
  }

  const prompt = `Write 2-3 sentences describing what it is like to travel to "${destinationName}" in ${district}, ${province} Province, Nepal in ${monthName} (${season} season). Altitude: ${altitude > 0 ? `${altitude.toLocaleString()}m` : "lowland"}.

Be specific to this exact destination — mention its altitude, what the weather is like there in ${monthName}, any specific risks or benefits of visiting at this time, and one practical note for travellers. Do not use generic Nepal-wide statements. Do not mention other destinations like Everest or Annapurna unless this IS one of those. Keep it factual and under 60 words.`;

  const text = await callAI(prompt, {
    system: "You are a Nepal travel expert. Write factual, destination-specific travel context. Plain text only, no bullet points, no markdown.",
    maxTokens: 150,
  });

  return text?.trim() || fallbackSeasonalContext(destinationName, district, altitude, monthName, season);
}

// Fallback if Claude is unavailable
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
    return `${monthName} brings heavy monsoon rainfall to ${name} (${district}). Landslide and flooding risk is elevated. ${isHigh ? "High trails become slippery and dangerous." : "Roads may be cut off."}`;
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

function getSeasonalRiskFactors(month: number, province: string, altitude: number): RiskFactor[] {
  const factors: RiskFactor[] = [];

  // Monsoon season baseline risk
  if (month >= 6 && month <= 9) {
    factors.push({
      category:    "Seasonal",
      name:        "Active monsoon season",
      severity:    "HIGH",
      score:       15,
      description: "Nepal's monsoon (June–September) brings intense rainfall, active landslides, flooding of rivers, and road closures. This is the highest-risk season for travel to hilly and mountainous regions.",
      source:      "Nepal meteorological seasonal data",
    });
  }

  // Pre-monsoon thunderstorms at altitude
  if ((month === 4 || month === 5) && altitude > 3500) {
    factors.push({
      category:    "Seasonal",
      name:        "Pre-monsoon afternoon thunderstorms",
      severity:    "MEDIUM",
      score:       8,
      description: "April–May sees frequent afternoon thunderstorms above 3500m. Start treks early and aim to reach camp before 1pm. Lightning risk on exposed ridges.",
      source:      "Nepal trekking seasonal guidelines",
    });
  }

  // Winter snow at altitude
  if ((month === 12 || month <= 2) && altitude > 3500) {
    factors.push({
      category:    "Seasonal",
      name:        "Winter snow — pass closures",
      severity:    altitude > 4500 ? "HIGH" : "MEDIUM",
      score:       altitude > 4500 ? 12 : 6,
      description: `Winter snowfall above ${altitude}m can close passes for days or weeks. Check pass conditions before departure. Some routes are officially closed December–March.`,
      source:      "TAAN Nepal seasonal closure data",
    });
  }

  return factors;
}

function getDiseaseSeasonal(month: number, province: string, altitude: number): {
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
      detail:         "Terai lowlands during monsoon and post-monsoon have elevated mosquito activity. Risk of malaria and dengue. Use DEET insect repellent, sleep under mosquito nets, wear long sleeves at dusk.",
      affectedGroups: ["all travelers to lowland areas"],
    });
    recommendations.push({ type: "MEDICAL", text: "Consider antimalarials for Terai travel. Use DEET repellent. Cover skin at dusk." });
  }

  // Waterborne diseases — monsoon everywhere
  if (month >= 6 && month <= 9) {
    advisories.push({
      condition:      "Waterborne diseases (Typhoid, Cholera, Giardia)",
      risk:           "MEDIUM",
      detail:         "Monsoon season contaminates water sources. Drink only bottled or purified water. Avoid salads, raw vegetables, and street food. Ensure typhoid and hepatitis A vaccinations are current.",
      affectedGroups: ["all travelers"],
    });
    recommendations.push({ type: "MEDICAL", text: "Carry water purification tablets or filter. Avoid tap water and uncooked foods." });
    recommendations.push({ type: "MEDICAL", text: "Ensure Typhoid, Hepatitis A vaccinations are current before travel." });
  }

  // Respiratory in Kathmandu Valley
  if ((province === "Bagmati") && (month >= 11 || month <= 3)) {
    advisories.push({
      condition:      "Air pollution — Kathmandu Valley",
      risk:           "MEDIUM",
      detail:         "Winter temperature inversions trap particulate matter in the Kathmandu Valley. PM2.5 levels regularly exceed WHO safe limits. Wear N95 mask in urban areas.",
      affectedGroups: ["asthma", "elderly", "children", "heart condition"],
    });
    recommendations.push({ type: "GEAR", text: "Carry N95 masks for Kathmandu Valley. Check real-time AQI at aqi.in before outdoor activity." });
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
