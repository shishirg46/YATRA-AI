/**
 * FILE: weather-dhm.ts
 * LOCATION: /lib/collectors/weather-dhm.ts
 * PURPOSE: Fetches weather from Nepal DHM API safely (production-safe)
 */

export interface WeatherSnapshot {
  temperature: number;
  humidity: number;
  rainfall: number;
  windSpeed: number;
  pressure?: number;
  description: string;
  source: string;
  timestamp: string;
  sourceLabel: string;
  officialSource: boolean;
  stationName?: string;
  stationDistanceKm?: number;
  weatherName?: string;
  heatIndex?: number;
  maxTemp?: number;
  minTemp?: number;
  precipitationProbability?: number;
}

export interface WeatherRisk {
  type: "landslide" | "heat" | "cold" | "flood" | "snow";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface DhmForecastResponse {
  stations?: DhmStation[];
  hourly_forecast?: DhmHourlyForecast[];
  daily_forecast?: DhmDailyForecast[];
}

export interface DhmStation {
  id: string;
  name: string;
  distance: number;
  latest_value?: {
    datetime: string;
    value: number;
  };
}

export interface DhmHourlyForecast {
  air_temperature: number;
  relative_humidity: number;
  precipitation_amount: number;
  hourly_precipitation: number;
  wind_speed: number;
  weather_name: string;
  heat_index: number;
}

export interface DhmDailyForecast {
  max_temperature: number;
  min_temperature: number;
  precipitation_probability: number;
}

const WEATHER_CACHE_MS = 10 * 60 * 1000;
const weatherCache = new Map<string, { expiresAt: number; value: WeatherSnapshot | null }>();

/**
 * MAIN ENTRY
 */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherSnapshot | null> {
  if (lat === 0 && lon === 0) return fallback("no-coordinates");

  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const result = await fetchOpenMeteo(lat, lon);
  setWeatherCache(cacheKey, result);

  return result;
}

/**
 * DHM FETCH (FIXED)
 */
async function fetchDhmWeather(lat: number, lon: number): Promise<WeatherSnapshot | null> {
  // Try DHM first with short timeout
  try {
    const url = `https://dhm.gov.np/mfd/api/forecast?lat=${lat}&lng=${lon}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[weather] DHM API ${res.status}`);
      return fallback("dhm-error");
    }

    const data = (await res.json()) as DhmForecastResponse;

    const hourly = Array.isArray(data.hourly_forecast)
      ? data.hourly_forecast
      : [];

    if (hourly.length === 0) {
      return fallback("dhm-no-data");
    }

    const current = hourly[0];

    /**
     * SAFE STATION HANDLING (FIXED CRASH HERE)
     */
    const stations = Array.isArray(data.stations)
      ? data.stations
      : [];

    let nearestStation: DhmStation | null =
      stations.length > 0 ? stations[0] : null;

    if (stations.length > 1) {
      nearestStation = stations.reduce((nearest, station) =>
        station.distance < nearest.distance ? station : nearest
      );
    }

    /**
     * SAFE STATION TEMP (NO CRASH EVER)
     */
    const stationTemp =
      nearestStation?.latest_value?.value ??
      current.air_temperature;

    /**
     * RETURN NORMALIZED SNAPSHOT
     */
    return {
      temperature: Math.round(stationTemp * 10) / 10,
      humidity: current.relative_humidity ?? 60,
      rainfall:
        current.precipitation_amount ??
        current.hourly_precipitation ??
        0,
      windSpeed: Math.round((current.wind_speed ?? 0) * 10) / 10,
      description: current.weather_name ?? "Fair",
      source: "dhm-mfd-api",
      timestamp: new Date().toISOString(),
      sourceLabel: "Nepal DHM",
      officialSource: true,

      stationName: nearestStation?.name,
      stationDistanceKm: nearestStation
        ? Math.round((nearestStation.distance / 1000) * 10) / 10
        : undefined,

      weatherName: current.weather_name,
      heatIndex: current.heat_index,
      maxTemp: data.daily_forecast?.[0]?.max_temperature,
      minTemp: data.daily_forecast?.[0]?.min_temperature,
      precipitationProbability:
        data.daily_forecast?.[0]?.precipitation_probability,
    };
  } catch (err) {
    console.warn(`[weather] DHM fetch failed:`, err);
    return fallback("dhm-unreachable");
  }
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<WeatherSnapshot | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return fetchDhmWeather(lat, lon);

    const data = await res.json() as {
      current?: { temperature_2m: number; relative_humidity_2m: number; precipitation: number; wind_speed_10m: number; weather_code: number };
    };

    if (!data.current) return fetchDhmWeather(lat, lon);

    const code = data.current.weather_code;
    const desc = code === 0 ? "Clear" : [1, 2, 3].includes(code) ? "Partly cloudy" : [45, 48].includes(code) ? "Foggy" : [51, 53, 55].includes(code) ? "Drizzle" : [61, 63, 65].includes(code) ? "Rain" : [71, 73, 75].includes(code) ? "Snow" : [95, 96, 99].includes(code) ? "Thunderstorm" : "Fair";

    return {
      temperature: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
      rainfall: data.current.precipitation,
      windSpeed: data.current.wind_speed_10m,
      description: desc,
      source: "open-meteo",
      timestamp: new Date().toISOString(),
      sourceLabel: "Open-Meteo",
      officialSource: false,
    };
  } catch {
    return fetchDhmWeather(lat, lon);
  }
}

/**
 * CACHE
 */
function setWeatherCache(
  key: string,
  value: WeatherSnapshot | null
): void {
  weatherCache.set(key, {
    expiresAt: Date.now() + WEATHER_CACHE_MS,
    value,
  });
}

/**
 * FALLBACK
 */
function fallback(reason: string): WeatherSnapshot {
  return {
    temperature: 18,
    humidity: 60,
    rainfall: 0,
    windSpeed: 3,
    description: `fallback:${reason}`,
    source: `fallback:${reason}`,
    timestamp: new Date().toISOString(),
    sourceLabel: "Nepal estimate",
    officialSource: false,
  };
}