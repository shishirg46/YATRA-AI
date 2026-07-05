/**
 * FILE: safety.ts
 * LOCATION: /lib/scoring/safety.ts
 * PURPOSE: Safety scoring — combines real-time weather/hazard data
 *          with static location risk factors (altitude, terrain, seismic zone etc.)
 *
 * SCORING MODEL: 100 - penalties
 *
 * PENALTY SOURCES:
 *
 * A) STATIC LOCATION FACTORS (always apply, season-independent)
 *   Altitude risk       0–25 pts   (>4500m = extreme, >3500m = high, >2500m = moderate)
 *   Terrain/remoteness  0–10 pts   (remote high-altitude areas)
 *   Seismic zone        0–10 pts   (known high-risk earthquake districts in Nepal)
 *   Air quality baseline 0–8 pts   (Kathmandu Valley always polluted)
 *
 * B) REAL-TIME WEATHER (from OpenWeatherMap)
 *   Rainfall            0–20 pts
 *   Wind                0–10 pts
 *   Temperature extreme 0–10 pts
 *
 * C) REAL-TIME HAZARD (from BIPAD + EONET + USGS + OpenAQ)
 *   Flood index         0–25 pts
 *   Landslide index     0–25 pts
 *   Earthquake index    0–20 pts
 *   Heat index          0–5  pts
 *   Air quality (live)  0–5  pts
 *
 * D) PURPOSE + HEALTH MULTIPLIERS
 *   TREKKING  → landslide ×1.8, wind ×1.3
 *   SOLO      → all ×1.2
 *   TOURISM   → air quality ×1.5
 *   Health conditions applied per-flag
 *
 * SCORE → LEVEL:
 *   80–100  SAFE
 *   60–79   CAUTION
 *   40–59   HIGH_RISK
 *   0–39    EXTREME
 */

export interface WeatherInput {
  temperature: number;
  humidity:    number;
  rainfall:    number;
  windSpeed:   number;
  pressure:    number;
}

export interface HazardInput {
  floodIndex:      number;
  landslideIndex:  number;
  earthquakeIndex: number;
  heatIndex:       number;
  airQuality:      number;
}

export interface LocationContext {
  altitude:     number | null;
  districtName: string;
  locationName: string;
}

export type SafetyLevel = "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME";

export interface ScoreResult {
  safetyScore:     number;
  safetyLevel:     SafetyLevel;
  confidence:      number;
  weatherSnapshot: WeatherInput;
  hazardSnapshot:  HazardInput;
  decisionTrace: {
    penalties:    Record<string, number>;
    multipliers:  Record<string, number>;
    totalPenalty: number;
    reasoning:    string[];
  };
}

// ── Static seismic risk districts in Nepal ────────────────────────────────────
// Based on Nepal National Seismic Hazard maps + 2015 earthquake impact zones
const HIGH_SEISMIC_DISTRICTS = new Set([
  "sindhupalchok", "gorkha", "nuwakot", "dolakha", "kavrepalanchok",
  "rasuwa", "dhading", "makwanpur", "lamjung", "kaski",
  "solukhumbu", "ramechhap", "sindhuli", "okhaldhunga",
]);

const MODERATE_SEISMIC_DISTRICTS = new Set([
  "kathmandu", "bhaktapur", "lalitpur", "tanahu", "syangja",
  "parbat", "baglung", "myagdi", "mustang", "manang",
  "rukum", "rolpa", "jajarkot", "surkhet", "dailekh",
]);

// ── Kathmandu Valley air quality baseline ────────────────────────────────────
const HIGH_POLLUTION_DISTRICTS = new Set([
  "kathmandu", "bhaktapur", "lalitpur", "kavrepalanchok",
]);
const MODERATE_POLLUTION_DISTRICTS = new Set([
  "bara", "parsa", "rupandehi", "banke", "kailali", "chitwan",
]);

// ── Safety score cache (in-memory, 15-min TTL) ───────────────────────────────

interface CacheEntry {
  result: ScoreResult;
  expiresAt: number;
}

const SCORE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const scoreCache = new Map<string, CacheEntry>();

function safeCacheKey(
  weather: WeatherInput,
  hazard: HazardInput,
  purposes: string[],
  assessmentType: string,
  dataSource: string,
  location?: LocationContext,
  riskTolerance?: "LOW" | "MEDIUM" | "HIGH",
): string {
  const loc = location ? `${location.districtName}|${location.altitude ?? 0}` : "";
  return `${weather.temperature.toFixed(1)},${weather.rainfall.toFixed(1)},${weather.windSpeed.toFixed(1)}|${hazard.floodIndex.toFixed(2)},${hazard.landslideIndex.toFixed(2)}|${purposes.join(",")}|${assessmentType}|${dataSource}|${loc}|${riskTolerance ?? ""}`;
}

// ── Main scoring function ─────────────────────────────────────────────────────

export function computeSafetyScore(
  weather:        WeatherInput,
  hazard:         HazardInput,
  purposes:       string[],
  assessmentType: string,
  dataSource:     string,
  location?:      LocationContext,
  riskTolerance?: "LOW" | "MEDIUM" | "HIGH",
): ScoreResult {
  // Check cache first
  const key = safeCacheKey(weather, hazard, purposes, assessmentType, dataSource, location, riskTolerance);
  const cached = scoreCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const penalties:   Record<string, number> = {};
  const multipliers: Record<string, number> = {};
  const reasoning:   string[]               = [];

  const alt      = location?.altitude ?? 0;
  const district = (location?.districtName ?? "").toLowerCase();
  const name     = (location?.locationName  ?? "").toLowerCase();

  // ── A. STATIC LOCATION FACTORS ────────────────────────────────────────────

  // 1. Altitude penalty — the higher the destination, the higher the baseline risk
  //    regardless of current weather.
  if (alt >= 5500) {
    penalties.altitude = 12;
    reasoning.push(`Extreme altitude (${alt.toLocaleString()}m) — severe hypoxia risk, requires professional guide`);
  } else if (alt >= 4500) {
    penalties.altitude = 8;
    reasoning.push(`Very high altitude (${alt.toLocaleString()}m) — high AMS risk, acclimatisation mandatory`);
  } else if (alt >= 3500) {
    penalties.altitude = 5;
    reasoning.push(`High altitude (${alt.toLocaleString()}m) — AMS risk, ascend slowly`);
  } else if (alt >= 2500) {
    penalties.altitude = 2;
  } else if (alt >= 1500) {
    penalties.altitude = 1;
  } else {
    penalties.altitude = 0;
  }

  // 2. Remoteness / accessibility penalty
  //    High-altitude remote destinations have no hospital access
  const isRemote = alt > 3000 || [
    "upper mustang", "dolpo", "limi", "humla", "simikot",
    "tsum valley", "manaslu", "kanchenjunga",
  ].some((r) => name.includes(r));

  if (isRemote && alt >= 4000) {
    penalties.remoteness = 5;
    reasoning.push("Very remote — no road access, nearest hospital hours away by helicopter");
  } else if (isRemote && alt > 3000) {
    penalties.remoteness = 3;
    reasoning.push("Remote area — limited medical facilities, emergency evacuation difficult");
  } else if (isRemote) {
    penalties.remoteness = 1;
  } else {
    penalties.remoteness = 0;
  }

  // 3. Seismic zone baseline
  if (HIGH_SEISMIC_DISTRICTS.has(district)) {
    penalties.seismicZone = 10;
    reasoning.push(`${location?.districtName} is in a high seismic hazard zone — 2015 earthquake epicentre region`);
  } else if (MODERATE_SEISMIC_DISTRICTS.has(district)) {
    penalties.seismicZone = 5;
    reasoning.push(`${location?.districtName} has moderate historical seismic activity`);
  } else {
    penalties.seismicZone = 0;
  }

  // 4. Air quality baseline (structural — valley inversion, urbanisation)
  if (HIGH_POLLUTION_DISTRICTS.has(district)) {
    penalties.airBaseline = 8;
    reasoning.push("Kathmandu Valley has chronically poor air quality (PM2.5 frequently exceeds WHO limits)");
  } else if (MODERATE_POLLUTION_DISTRICTS.has(district)) {
    penalties.airBaseline = 4;
  } else {
    penalties.airBaseline = 0;
  }

  // ── B. REAL-TIME WEATHER ──────────────────────────────────────────────────

  // Rainfall
  penalties.rainfall = Math.min((weather.rainfall / 50) * 20, 20);

  // Wind
  penalties.wind = Math.min((weather.windSpeed / 20) * 10, 10);

  // Temperature extremes
  if (weather.temperature < 0) {
    penalties.temperature = Math.min(Math.abs(weather.temperature) / 20 * 10, 5);
    reasoning.push(`Sub-zero temperature (${weather.temperature}°C) — hypothermia risk`);
  } else if (weather.temperature > 38) {
    penalties.temperature = Math.min((weather.temperature - 38) / 10 * 10, 5);
    reasoning.push(`Extreme heat (${weather.temperature}°C) — heat stroke risk`);
  } else {
    penalties.temperature = 0;
  }

  // ── C. REAL-TIME HAZARD ───────────────────────────────────────────────────

  penalties.flood      = hazard.floodIndex     * 15;
  penalties.landslide  = hazard.landslideIndex * 5;
  penalties.earthquake = hazard.earthquakeIndex * 4;
  penalties.heatIndex  = hazard.heatIndex      * 5;
  penalties.airQuality = hazard.airQuality     * 5;

  // ── D. PURPOSE MULTIPLIERS ────────────────────────────────────────────────

  const hasTrekking = purposes.includes("TREKKING");
  const hasSolo     = purposes.includes("SOLO");
  const hasTourism  = purposes.includes("TOURISM");

  if (hasTrekking) {
    multipliers.landslide_trekking = 1.8;
    multipliers.wind_trekking      = 1.3;
    penalties.landslide *= 1.8;
    penalties.wind      *= 1.3;
    reasoning.push("Trekking — exposed terrain increases landslide and wind risk");
  }

  if (hasSolo) {
    const m = 1.2;
    multipliers.solo = m;
    Object.keys(penalties).forEach((k) => { penalties[k] *= m; });
    reasoning.push("Solo travel (×1.2) — no group safety net");
  }

  if (hasTourism) {
    multipliers.airQuality_tourism = 1.5;
    penalties.airQuality  *= 1.5;
    penalties.airBaseline *= 1.5;
  }

  // ── E. HEALTH MULTIPLIERS ─────────────────────────────────────────────────

  const hasHeart    = purposes.includes("HEALTH:heart");
  const hasAsthma   = purposes.includes("HEALTH:asthma");
  const hasLowFit   = purposes.includes("HEALTH:low_fitness");
  const hasMobility = purposes.includes("HEALTH:mobility");
  const hasDiabetes = purposes.includes("HEALTH:diabetes");

  if (hasHeart) {
    multipliers.temperature_heart = 2.0;
    multipliers.altitude_heart    = 1.8;
    penalties.temperature *= 2.0;
    penalties.altitude    *= 1.8;
    reasoning.push("Heart condition — temperature extremes and altitude weighted higher");
  }
  if (hasAsthma) {
    multipliers.airQuality_asthma  = 2.0;
    multipliers.airBaseline_asthma = 2.0;
    penalties.airQuality  *= 2.0;
    penalties.airBaseline *= 2.0;
    reasoning.push("Asthma — air quality weighted ×2.0");
  }
  if (hasLowFit) {
    multipliers.altitude_lowfit  = 1.5;
    multipliers.landslide_lowfit = 1.5;
    penalties.altitude   *= 1.5;
    penalties.landslide  *= 1.5;
    reasoning.push("Low fitness — altitude and terrain risk weighted higher");
  }
  if (hasMobility) {
    multipliers.landslide_mobility  = 1.6;
    multipliers.remoteness_mobility = 1.6;
    penalties.landslide  *= 1.6;
    penalties.remoteness *= 1.6;
    reasoning.push("Mobility limitation — terrain risk weighted ×1.6");
  }
  if (hasDiabetes) {
    multipliers.altitude_diabetes     = 1.3;
    multipliers.remoteness_diabetes   = 1.4;
    penalties.altitude   *= 1.3;
    penalties.remoteness *= 1.4;
    reasoning.push("Diabetes — remote high-altitude areas weighted higher (insulin management risk)");
  }

  // ── F. RISK TOLERANCE ADJUSTMENT ──────────────────────────────────────────

  if (riskTolerance === "LOW") {
    const m = 1.3;
    Object.keys(penalties).forEach((k) => { penalties[k] *= m; });
    reasoning.push("Low risk tolerance — penalties weighted ×1.3");
  } else if (riskTolerance === "HIGH") {
    const m = 0.8;
    Object.keys(penalties).forEach((k) => { penalties[k] *= m; });
    reasoning.push("High risk tolerance — penalties weighted ×0.8");
  }

  // ── G. COMPUTE FINAL SCORE ────────────────────────────────────────────────

  let totalPenalty = Object.values(penalties).reduce((s, p) => s + p, 0);
  totalPenalty = Math.min(totalPenalty, 100);
  const safetyScore  = Math.max(0, Math.round(100 - totalPenalty));
  const safetyLevel  = scoreToLevel(safetyScore);

  // ── H. REASONING STRINGS ──────────────────────────────────────────────────

  if (penalties.rainfall    > 5)  reasoning.push(`Heavy rainfall (${weather.rainfall}mm/h) — road conditions affected`);
  if (penalties.flood       > 10) reasoning.push(`Elevated flood risk (index: ${hazard.floodIndex.toFixed(2)})`);
  if (penalties.landslide   > 10) reasoning.push(`Landslide risk (index: ${hazard.landslideIndex.toFixed(2)})`);
  if (penalties.earthquake  > 5)  reasoning.push(`Recent seismic activity nearby (index: ${hazard.earthquakeIndex.toFixed(2)})`);
  if (penalties.airQuality  > 2)  reasoning.push(`Air quality concern (index: ${hazard.airQuality.toFixed(2)})`);
  if (penalties.wind        > 5)  reasoning.push(`High winds (${weather.windSpeed}m/s)`);

  if (reasoning.length === 0) {
    reasoning.push("No significant current hazards — conditions appear favourable");
  }

  const isStaticFallback = dataSource.startsWith("fallback");
  const isEstimatedLive = dataSource.startsWith("dhm-") || dataSource.startsWith("dhm-mfd-api");
  const confidence = isStaticFallback ? 0.55 : isEstimatedLive ? 0.85 : 0.85;

  const result: ScoreResult = {
    safetyScore,
    safetyLevel,
    confidence,
    weatherSnapshot: weather,
    hazardSnapshot:  hazard,
    decisionTrace: {
      penalties:    roundValues(penalties),
      multipliers,
      totalPenalty: Math.round(totalPenalty * 100) / 100,
      reasoning,
    },
  };

  // Store in cache
  scoreCache.set(key, { result, expiresAt: Date.now() + SCORE_CACHE_TTL_MS });

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreToLevel(score: number): SafetyLevel {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}

function roundValues(obj: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, Math.round(v * 100) / 100])
  );
}

export function buildHealthFlags(health: {
  fitnessLevel:      string;
  mobilityLimited:   boolean;
  chronicConditions: string[];
  allergies?:        string[];
}): string[] {
  const flags: string[] = [];
  if (health.fitnessLevel === "LOW")                              flags.push("HEALTH:low_fitness");
  if (health.mobilityLimited)                                     flags.push("HEALTH:mobility");
  if (health.chronicConditions.includes("heart"))                 flags.push("HEALTH:heart");
  if (health.chronicConditions.includes("asthma"))                flags.push("HEALTH:asthma");
  if (health.chronicConditions.includes("hypertension"))          flags.push("HEALTH:heart");
  if (health.chronicConditions.includes("diabetes"))              flags.push("HEALTH:diabetes");
  return [...new Set(flags)];
}
