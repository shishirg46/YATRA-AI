/**
 * FILE: weather.ts
 * LOCATION: /lib/collectors/weather.ts
 * PURPOSE: Fetches current weather for a coordinate using multiple sources
 *          with intelligent merging and Nepal-specific risk detection.
 *
 * SETUP: Add to .env.local for enhanced behavior
 *   OPENWEATHER_API_KEY=your_key_here        # Free: https://openweathermap.org/api
 *   WEATHERAPI_API_KEY=your_key_here        # Free: https://www.weatherapi.com
 *   BIPAD_API_KEY=your_key_here             # Nepal disaster alerts
 *
 * NOTES:
 * - Open-Meteo is primary (best global coverage)
 * - WeatherAPI is secondary (good for South Asia)
 * - OpenWeatherMap is tertiary fallback
 * - DHM Nepal provides official forecasts
 * - BIPAD integration for real-time disaster alerts
 */

import { DHM_FORECAST_STATIONS, findNearestDhmStation, haversineKm } from "@/lib/weather/dhm-stations";

export interface WeatherSnapshot {
  temperature: number;  // °C
  humidity:    number;  // %
  rainfall:    number;  // mm/h
  windSpeed:   number;  // m/s
  pressure:    number;  // hPa
  description: string;
  source:      string;
  timestamp:   string;
  sourceLabel?: string;
  officialSource?: boolean;
  stationName?: string;
  stationDistanceKm?: number;
  // Enhanced fields
  lastUpdated?: string;
  sourcesUsed?: string[];
  risks?: WeatherRisk[];
  bipadAlerts?: BipadAlert[];
}

export interface WeatherRisk {
  type: "landslide" | "heat" | "cold" | "flood" | "snow";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface BipadAlert {
  id: string;
  title: string;
  description: string;
  location: string;
  severity: "low" | "medium" | "high" | "critical";
  publishedDate: string;
  source: string;
}

export interface WeatherFetchOptions {
  fastMode?: boolean;
  allowNearbyFallback?: boolean;
  openMeteoTimeoutsMs?: number[];
}

interface OpenMeteoForecast {
  current_weather?: {
    temperature: number;
    windspeed:   number;
    winddirection: number;
    weathercode: number;
    time: string;
  };
  hourly?: {
    time: string[];
    temperature_2m?: number[];
    precipitation?: number[];
    relativehumidity_2m?: number[];
    pressure_msl?: number[];
  };
}

interface DhmForecastEntry {
  name: string;
  maxLow: number;
  maxHigh: number;
  minLow: number;
  minHigh: number;
  rainChance: number;
}

interface OWMResponse {
  main:    { temp: number; humidity: number; pressure: number };
  wind:    { speed: number };
  rain?:   { "1h"?: number; "3h"?: number };
  weather: { description: string }[];
  cod:     number;
  message?: string;
}

interface WeatherAPIResponse {
  location?: { name: string; region: string; country: string };
  current?: {
    temp_c: number;
    humidity: number;
    wind_kph: number;
    pressure_mb: number;
    condition: { text: string };
    last_updated: string;
    precip_mm: number;
  };
  error?: {
    code: number;
    message: string;
  };
}

const OPEN_METEO_TIMEZONE = "UTC";
const NEARBY_WEATHER_OFFSETS = [0.05, 0.1, 0.2, 0.4];
const WEATHER_CACHE_MS = 10 * 60 * 1000;
const OPEN_METEO_DEFAULT_COOLDOWN_MS = 60 * 1000;

const weatherCache = new Map<string, { expiresAt: number; value: WeatherSnapshot | null }>();
let openMeteoCooldownUntil = 0;

let openMeteoLastTimeoutLogAt = 0;
let openMeteoTimeoutSuppressed = 0;
let openMeteoLastGenericLogAt = 0;

function maybeLogOpenMeteoTimeout(lat: number, lon: number) {
  const now = Date.now();
  const windowMs = 60_000;
  if (now - openMeteoLastTimeoutLogAt > windowMs) {
    const suffix = openMeteoTimeoutSuppressed > 0
      ? ` (suppressed ${openMeteoTimeoutSuppressed} similar timeouts in last minute)`
      : "";
    console.warn(`[weather] Open-Meteo timeout near (${lat.toFixed(3)},${lon.toFixed(3)})${suffix}`);
    openMeteoLastTimeoutLogAt = now;
    openMeteoTimeoutSuppressed = 0;
    return;
  }
  openMeteoTimeoutSuppressed += 1;
}

function maybeLogOpenMeteoGeneric(message: string) {
  const now = Date.now();
  const windowMs = 30_000;
  if (now - openMeteoLastGenericLogAt > windowMs) {
    console.warn(message);
    openMeteoLastGenericLogAt = now;
  }
}
let bipadWarningLogged = false;

function normalizeTimestampToUtc(value: string): string {
  return /[zZ]|[+\-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

function buildEstimatedSourceMetadata(lat: number, lon: number) {
  const station = findNearestDhmStation(lat, lon);
  return {
    sourceLabel: "Nepal estimate",
    officialSource: false,
    stationName: station.name,
    stationDistanceKm: Math.round(haversineKm(lat, lon, station.lat, station.lon) * 10) / 10,
  };
}

export async function fetchWeather(
  lat: number,
  lon: number,
  options: WeatherFetchOptions = {}
): Promise<WeatherSnapshot | null> {
  if (lat === 0 && lon === 0) return fallback("no-coordinates");

  const cacheKey = getWeatherCacheKey(lat, lon);
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Collect all available weather sources
  const sources: WeatherSnapshot[] = [];

  // Primary: Open-Meteo
  const openMeteo = await fetchOpenMeteo(lat, lon, options);
  if (openMeteo) {
    sources.push(openMeteo);
  }

  // Secondary: WeatherAPI (if available)
  const weatherApi = await fetchWeatherApi(lat, lon);
  if (weatherApi) {
    sources.push(weatherApi);
  }

  // Tertiary: OpenWeatherMap (if Open-Meteo is stale or failed)
  if (!openMeteo || isStale(openMeteo?.timestamp ?? "", 90)) {
    const openWeather = await fetchOpenWeather(lat, lon);
    if (openWeather) {
      sources.push(openWeather);
    }
  }

  // Fallback: DHM Nepal forecast
  if (sources.length === 0) {
    const dhmForecast = await fetchDhmForecastWeather(lat, lon);
    if (dhmForecast) {
      sources.push(dhmForecast);
    }
  }

  // Merge available sources
  let result: WeatherSnapshot;
  if (sources.length > 1) {
    result = mergeWeatherSources(sources);
  } else if (sources.length === 1) {
    result = sources[0];
  } else {
    result = fallback("all-sources-failed");
  }

  // Add Nepal-specific risk detection
  const risks = detectNepalRisks(result, lat, lon);
  result.risks = risks;

  // Add BIPAD alerts if available
  try {
    const bipadAlerts = await fetchBipadAlerts();
    if (bipadAlerts.length > 0) {
      const nearbyAlerts = filterBipadAlertsByLocation(bipadAlerts, lat, lon);
      result.bipadAlerts = nearbyAlerts;
    }
  } catch {
    // Silently fail BIPAD - non-critical
  }

  // Set cache with enhanced result
  setWeatherCache(cacheKey, result);
  return result;
}

async function fetchOpenMeteo(
  lat: number,
  lon: number,
  options: WeatherFetchOptions = {}
): Promise<WeatherSnapshot | null> {
  if (Date.now() < openMeteoCooldownUntil) {
    return null;
  }

  const exact = await fetchOpenMeteoPoint(lat, lon, options);
  if (exact) return exact;

  if (Date.now() < openMeteoCooldownUntil) {
    return null;
  }

  if (options.fastMode || options.allowNearbyFallback === false) {
    return null;
  }

  for (const d of NEARBY_WEATHER_OFFSETS) {
    for (const latSign of [1, -1]) {
      for (const lonSign of [1, -1]) {
        if (Date.now() < openMeteoCooldownUntil) {
          return null;
        }
        const candidateLat = lat + latSign * d;
        const candidateLon = lon + lonSign * d;
        const nearby = await fetchOpenMeteoPoint(candidateLat, candidateLon, options);
        if (nearby) {
          return {
            ...nearby,
            description: `${nearby.description}; nearby-grid`,
            source: `open-meteo-nearby:${candidateLat.toFixed(4)},${candidateLon.toFixed(4)}`,
            ...buildEstimatedSourceMetadata(lat, lon),
          };
        }
      }
    }
  }

  return null;
}

async function fetchOpenMeteoPoint(
  lat: number,
  lon: number,
  options: WeatherFetchOptions = {}
): Promise<WeatherSnapshot | null> {
  const query = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current_weather: "true",
    hourly: "temperature_2m,precipitation,relativehumidity_2m,pressure_msl",
    timezone: OPEN_METEO_TIMEZONE,
  });

  const url = `https://api.open-meteo.com/v1/forecast?${query.toString()}`;
  const attemptTimeoutsMs = options.openMeteoTimeoutsMs?.length
    ? options.openMeteoTimeoutsMs
    : options.fastMode
      ? [4000]
      : [12000, 18000];

  for (let attempt = 0; attempt < attemptTimeoutsMs.length; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(attemptTimeoutsMs[attempt]),
        cache: "no-store",
      });

      if (res.status === 429) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        const cooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : OPEN_METEO_DEFAULT_COOLDOWN_MS;
        openMeteoCooldownUntil = Date.now() + cooldownMs;
        maybeLogOpenMeteoGeneric(`[weather] Open-Meteo 429 - cooling down for ${Math.round(cooldownMs / 1000)}s`);
        return null;
      }

      if (!res.ok) {
        maybeLogOpenMeteoGeneric(`[weather] Open-Meteo ${res.status} response`);
        return null;
      }

      const data = await res.json() as OpenMeteoForecast;
      const current = data.current_weather;
      const hourly = data.hourly;

      if (!current || !hourly || !hourly.time?.length) {
        maybeLogOpenMeteoGeneric("[weather] Open-Meteo missing current data");
        return null;
      }

      const targetTimestamp = Date.parse(current.time);
      const idx = hourly.time.findIndex((t) => t === current.time);
      const resolvedIndex = idx >= 0 ? idx : findClosestHourIndex(hourly.time, targetTimestamp);

      const humidity = resolvedIndex >= 0 && hourly.relativehumidity_2m?.[resolvedIndex] != null
        ? hourly.relativehumidity_2m[resolvedIndex]
        : 60;
      const pressure = resolvedIndex >= 0 && hourly.pressure_msl?.[resolvedIndex] != null
        ? hourly.pressure_msl[resolvedIndex]
        : 1013;
      const rainfall = resolvedIndex >= 0 && hourly.precipitation?.[resolvedIndex] != null
        ? hourly.precipitation[resolvedIndex]
        : 0;

      const temperature = current.temperature ?? (
        resolvedIndex >= 0 && "temperature_2m" in hourly && hourly.temperature_2m?.[resolvedIndex] != null
          ? hourly.temperature_2m[resolvedIndex]
          : 18
      );

      return {
        temperature: Math.round(temperature * 10) / 10,
        humidity,
        rainfall: Math.round(rainfall * 100) / 100,
        windSpeed: Math.round(current.windspeed * 10) / 10,
        pressure: Math.round(pressure * 10) / 10,
        description: `open-meteo:${current.weathercode}`,
        source: "open-meteo",
        timestamp: normalizeTimestampToUtc(current.time),
        ...buildEstimatedSourceMetadata(lat, lon),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "");
      const timeoutLike = /timeout|aborted|TimeoutError/i.test(message);
      const isLast = attempt === attemptTimeoutsMs.length - 1;

      if (!isLast) {
        await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 300)));
        continue;
      }

      if (timeoutLike) {
        maybeLogOpenMeteoTimeout(lat, lon);
      } else {
        maybeLogOpenMeteoGeneric(`[weather] Open-Meteo fetch failed: ${message}`);
      }
      return null;
    }
  }

  return null;
}

async function fetchDhmForecastWeather(lat: number, lon: number): Promise<WeatherSnapshot | null> {
  try {
    const res = await fetch("https://www.dhm.gov.np/", {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[weather] DHM ${res.status} while loading homepage forecast`);
      return null;
    }

    const html = await res.text();
    const entries = parseDhmForecastEntries(html);
    if (entries.length === 0) {
      console.warn("[weather] DHM homepage did not expose forecast entries");
      return null;
    }

    const station = findNearestDhmForecastStation(lat, lon, entries);
    if (!station) return null;

    const avgMax = (station.forecast.maxLow + station.forecast.maxHigh) / 2;
    const avgMin = (station.forecast.minLow + station.forecast.minHigh) / 2;
    const estimatedTemp = Math.round((((avgMax + avgMin) / 2) * 10)) / 10;

    return {
      temperature: estimatedTemp,
      humidity: 60,
      rainfall: station.forecast.rainChance > 0 ? Math.round((station.forecast.rainChance / 100) * 2 * 100) / 100 : 0,
      windSpeed: 3,
      pressure: 1013,
      description: `dhm-forecast:${station.station.name} max ${station.forecast.maxLow}-${station.forecast.maxHigh}C min ${station.forecast.minLow}-${station.forecast.minHigh}C rain ${station.forecast.rainChance}%`,
      source: `dhm-forecast-nearest:${station.station.name.toLowerCase()}`,
      timestamp: new Date().toISOString(),
      sourceLabel: "Nepal DHM",
      officialSource: true,
      stationName: station.station.name,
      stationDistanceKm: Math.round(haversineKm(lat, lon, station.station.lat, station.station.lon) * 10) / 10,
    };
  } catch (err) {
    console.warn("[weather] DHM forecast fallback failed:", err);
    return null;
  }
}

export async function fetchOpenWeather(
  lat: number,
  lon: number
): Promise<WeatherSnapshot | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;

  if (!apiKey) {
    console.warn("[weather] OPENWEATHER_API_KEY not set");
    return null;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
    const res  = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      cache:  "no-store",
    });

    if (!res.ok) {
      console.warn(`[weather] OWM ${res.status} for (${lat},${lon})`);
      return null;
    }

    const data = await res.json() as OWMResponse;
    if (data.cod !== 200) {
      console.warn(`[weather] OWM body error for (${lat},${lon}): ${data.message}`);
      return null;
    }

    const rainfall = data.rain?.["1h"] ?? (data.rain?.["3h"] ? data.rain["3h"] / 3 : 0);

    return {
      temperature: Math.round(data.main.temp * 10) / 10,
      humidity:    data.main.humidity,
      rainfall:    Math.round(rainfall * 100) / 100,
      windSpeed:   Math.round(data.wind.speed * 10) / 10,
      pressure:    data.main.pressure,
      description: data.weather[0]?.description ?? "unknown",
      source:      "openweathermap",
      timestamp:   new Date().toISOString(),
      ...buildEstimatedSourceMetadata(lat, lon),
    };
  } catch (err) {
    console.warn(`[weather] OWM fetch failed for (${lat},${lon}):`, err);
    return null;
  }
}

export async function fetchWeatherApi(
  lat: number,
  lon: number
): Promise<WeatherSnapshot | null> {
  const apiKey = process.env.WEATHERAPI_API_KEY;

  if (!apiKey) {
    console.warn("[weather] WEATHERAPI_API_KEY not set");
    return null;
  }

  try {
    const url = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${lat},${lon}&aqi=no`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[weather] WeatherAPI ${res.status} for (${lat},${lon})`);
      return null;
    }

    const data = await res.json() as WeatherAPIResponse;
    if (data.error) {
      console.warn(`[weather] WeatherAPI error for (${lat},${lon}): ${data.error.message}`);
      return null;
    }

    if (!data.current || !data.location) {
      console.warn(`[weather] WeatherAPI missing data for (${lat},${lon})`);
      return null;
    }

    return {
      temperature: Math.round(data.current.temp_c * 10) / 10,
      humidity: data.current.humidity,
      rainfall: Math.round(data.current.precip_mm * 100) / 100,
      windSpeed: Math.round((data.current.wind_kph / 3.6) * 10) / 10, // Convert kph to m/s
      pressure: data.current.pressure_mb,
      description: data.current.condition?.text ?? "unknown",
      source: "weatherapi",
      timestamp: normalizeTimestampToUtc(data.current.last_updated),
      ...buildEstimatedSourceMetadata(lat, lon),
    };
  } catch (err) {
    console.warn(`[weather] WeatherAPI fetch failed for (${lat},${lon}):`, err);
    return null;
  }
}

function getWeatherCacheKey(lat: number, lon: number) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function setWeatherCache(key: string, value: WeatherSnapshot | null) {
  weatherCache.set(key, {
    expiresAt: Date.now() + WEATHER_CACHE_MS,
    value,
  });
}

function findClosestHourIndex(times: string[], targetTimestamp: number): number {
  let closest = -1;
  let smallestDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < times.length; i++) {
    const ts = Date.parse(times[i]);
    if (Number.isNaN(ts)) continue;
    const diff = Math.abs(ts - targetTimestamp);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = i;
    }
  }

  return closest;
}

function fallback(reason: string): WeatherSnapshot {
  return {
    temperature: 18,
    humidity:    60,
    rainfall:    0,
    windSpeed:   3,
    pressure:    1013,
    description: `fallback:${reason}`,
    source:      `fallback:${reason}`,
    timestamp:   new Date().toISOString(),
    sourceLabel: "Nepal estimate",
    officialSource: false,
  };
}

function parseDhmForecastEntries(html: string): DhmForecastEntry[] {
  const matches = html.matchAll(/([A-Za-z][A-Za-z ]+?)\s+Max:\s*(\d+)-(\d+)°C\s+Min:\s*(\d+)-(\d+)°C\s+Rain:\s*(\d+)%/g);
  const entries: DhmForecastEntry[] = [];

  for (const match of matches) {
    const [, rawName, maxLow, maxHigh, minLow, minHigh, rainChance] = match;
    entries.push({
      name: rawName.trim(),
      maxLow: Number(maxLow),
      maxHigh: Number(maxHigh),
      minLow: Number(minLow),
      minHigh: Number(minHigh),
      rainChance: Number(rainChance),
    });
  }

  return entries;
}

function findNearestDhmForecastStation(lat: number, lon: number, entries: DhmForecastEntry[]) {
  const available = DHM_FORECAST_STATIONS.flatMap((station) => {
    const forecast = entries.find((entry) => entry.name.toLowerCase() === station.name.toLowerCase());
    return forecast ? [{ station, forecast }] : [];
  });

  if (available.length === 0) return null;

  return available.reduce((best, current) => {
    const bestDistance = haversineKm(lat, lon, best.station.lat, best.station.lon);
    const currentDistance = haversineKm(lat, lon, current.station.lat, current.station.lon);
    return currentDistance < bestDistance ? current : best;
  });
}

function isStale(timestamp: string, thresholdMinutes: number): boolean {
  const value = Date.parse(normalizeTimestampToUtc(timestamp));
  if (Number.isNaN(value)) return true;
  return (Date.now() - value) > thresholdMinutes * 60_000;
}

/**
 * Merge multiple weather sources with intelligent averaging
 * Priority: Open-Meteo > WeatherAPI > OpenWeatherMap
 */
function mergeWeatherSources(sources: WeatherSnapshot[]): WeatherSnapshot {
  if (sources.length === 0) {
    return fallback("no-sources");
  }

  if (sources.length === 1) {
    return sources[0];
  }

  // Temperature: average all valid sources
  const temps = sources.map(s => s.temperature).filter(t => t != null && !isNaN(t));
  const avgTemp = temps.length > 0
    ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10
    : 18;

  // Humidity: prefer WeatherAPI, then Open-Meteo, then fallback
  const humiditySource = sources.find(s => s.source === "weatherapi") ?? sources[0];
  const humidity = humiditySource.humidity ?? 60;

  // Wind: average all valid sources
  const winds = sources.map(s => s.windSpeed).filter(w => w != null && !isNaN(w));
  const avgWind = winds.length > 0
    ? Math.round((winds.reduce((a, b) => a + b, 0) / winds.length) * 10) / 10
    : 3;

  // Rainfall: take maximum (most conservative for safety)
  const rains = sources.map(s => s.rainfall).filter(r => r != null && !isNaN(r));
  const maxRain = rains.length > 0 ? Math.max(...rains) : 0;

  // Pressure: average all valid sources
  const pressures = sources.map(s => s.pressure).filter(p => p != null && !isNaN(p));
  const avgPressure = pressures.length > 0
    ? Math.round((pressures.reduce((a, b) => a + b, 0) / pressures.length) * 10) / 10
    : 1013;

  // Description: use primary source
  const primary = sources[0];

  // Timestamp: use most recent
  const timestamps = sources.map(s => s.timestamp).filter(t => t);
  const latestTimestamp = timestamps.sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  )[0] ?? new Date().toISOString();

  return {
    temperature: avgTemp,
    humidity,
    rainfall: Math.round(maxRain * 100) / 100,
    windSpeed: avgWind,
    pressure: avgPressure,
    description: primary.description,
    source: sources.map(s => s.source).join("+"),
    timestamp: latestTimestamp,
    lastUpdated: new Date().toISOString(),
    sourcesUsed: sources.map(s => s.source),
    sourceLabel: "Multi-source merge",
    officialSource: sources.some(s => s.officialSource),
    stationName: primary.stationName,
    stationDistanceKm: primary.stationDistanceKm,
  };
}

/**
 * Detect Nepal-specific weather risks
 */
function detectNepalRisks(weather: WeatherSnapshot, lat: number, lon: number): WeatherRisk[] {
  const risks: WeatherRisk[] = [];

  // Check if location is in hilly/mountainous region (approximate)
  const isHilly = lat > 27.5 || (lat > 27 && lon > 85 && lon < 88.5);

  // Landslide risk: heavy rainfall in hilly areas
  if (isHilly && weather.rainfall > 10) {
    risks.push({
      type: "landslide",
      severity: weather.rainfall > 50 ? "high" : weather.rainfall > 25 ? "medium" : "low",
      message: `Heavy rainfall (${weather.rainfall}mm/h) in hilly terrain - increased landslide risk`,
    });
  } else if (isHilly && weather.rainfall > 5) {
    risks.push({
      type: "landslide",
      severity: "low",
      message: `Moderate rainfall (${weather.rainfall}mm/h) in hilly area - monitor conditions`,
    });
  }

  // Heat risk: extreme heat in Terai (southern lowlands)
  if (lat < 27.5 && weather.temperature > 40) {
    risks.push({
      type: "heat",
      severity: "high",
      message: `Extreme heat warning: ${weather.temperature}°C in Terai region`,
    });
  } else if (lat < 27.5 && weather.temperature > 35) {
    risks.push({
      type: "heat",
      severity: "medium",
      message: `Hot conditions: ${weather.temperature}°C - stay hydrated`,
    });
  }

  // Cold risk: high altitude
  if (lat > 28.5 || (lat > 28 && weather.temperature < 0)) {
    risks.push({
      type: "cold",
      severity: weather.temperature < -10 ? "high" : weather.temperature < 0 ? "medium" : "low",
      message: `Freezing conditions: ${weather.temperature}°C - risk of hypothermia`,
    });
  }

  // Snow risk: high altitude with precipitation
  if (lat > 28 && weather.temperature < 2 && weather.rainfall > 0) {
    risks.push({
      type: "snow",
      severity: "medium",
      message: `Snow possible: ${weather.temperature}°C with precipitation`,
    });
  }

  // Flood risk: heavy rainfall anywhere
  if (weather.rainfall > 50) {
    risks.push({
      type: "flood",
      severity: "high",
      message: `Flash flood risk: ${weather.rainfall}mm/h rainfall`,
    });
  } else if (weather.rainfall > 25) {
    risks.push({
      type: "flood",
      severity: "medium",
      message: `Flood watch: ${weather.rainfall}mm/h rainfall`,
    });
  }

  return risks;
}

/**
 * Fetch BIPAD disaster alerts for Nepal
 * Tries multiple endpoints: public first, then authenticated
 */
export async function fetchBipadAlerts(): Promise<BipadAlert[]> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const incidentGt = encodeURIComponent(weekAgo.toISOString());
  const incidentLt = encodeURIComponent(now.toISOString());

  const BIPAD_ENDPOINTS = [
    `https://bipadportal.gov.np/api/v1/incident/?incident_on__gt=${incidentGt}&incident_on__lt=${incidentLt}&expand=loss,event,wards&ordering=-incident_on&limit=200&data_source=drr_api`,
    `https://bipadportal.gov.np/api/v1/event/?incident_on__gt=${incidentGt}&incident_on__lt=${incidentLt}&ordering=-incident_on&limit=200`,
  ];

  const apiKey = process.env.BIPAD_API_KEY;

  // Try public endpoints first
  for (const endpoint of BIPAD_ENDPOINTS) {
    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
      };

      // Add auth if available
      if (apiKey && endpoint.includes("bipad.gov.np")) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(endpoint, {
        headers,
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });

      if (!res.ok) continue;

      const data = await res.json() as any;
      const rows: any[] = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.events)
            ? data.events
            : [];

      const normalized: BipadAlert[] = rows.map((row, idx) => {
        const title =
          row?.event?.title ||
          row?.incident_type?.title ||
          row?.hazard?.title ||
          row?.title ||
          "Disaster Alert";
        const description =
          row?.description ||
          row?.event?.description ||
          row?.details ||
          "BIPAD incident reported";
        const location =
          row?.location ||
          row?.point?.coordinates?.join(",") ||
          row?.wards?.[0]?.title_en ||
          "Nepal";
        const incidentDate =
          row?.incident_on ||
          row?.date_of_incident ||
          row?.created_at ||
          new Date().toISOString();

        return {
          id: String(row?.id ?? `bipad-${idx}`),
          title: String(title),
          description: String(description),
          location: String(location),
          severity: "medium",
          publishedDate: new Date(incidentDate).toISOString(),
          source: "bipad",
        };
      });

      if (normalized.length > 0) return normalized;
    } catch {
      // Try next endpoint
      continue;
    }
  }

  // If no API key and all endpoints failed, return empty
  if (!apiKey) {
    if (!bipadWarningLogged) {
      console.warn("[weather] BIPAD: No public endpoints available and no API key");
      bipadWarningLogged = true;
    }
  }

  return [];
}

/**
 * Filter BIPAD alerts near a location
 */
function filterBipadAlertsByLocation(
  alerts: BipadAlert[],
  lat: number,
  lon: number,
  radiusKm: number = 50
): BipadAlert[] {
  return alerts.filter(alert => {
    // BIPAD alerts may have location coordinates in the description
    // This is a simplified filter - in production, parse actual coordinates
    const alertLat = parseFloat(alert.location.split(",")[0] ?? "0");
    const alertLon = parseFloat(alert.location.split(",")[1] ?? "0");

    if (alertLat === 0 && alertLon === 0) {
      // If no coordinates, include all alerts (conservative)
      return true;
    }

    const distance = haversineKm(lat, lon, alertLat, alertLon);
    return distance <= radiusKm;
  });
}
