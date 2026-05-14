/**
 * FILE: historical-weather.ts
 * LOCATION: /lib/collectors/historical-weather.ts
 * PURPOSE: Fetches historical daily weather for a coordinate + date range
 *          using Open-Meteo Historical Weather API (free, no API key needed)
 *
 * API: https://archive-api.open-meteo.com/v1/archive
 * Covers: 1940–present, global coverage, daily resolution
 *
 * WE USE THIS TO:
 *  1. Get weather stats for the same week/month across past 5 years
 *  2. Calculate averages, extremes, and risk probabilities for a future date
 *  3. Answer: "Is April historically safe in Solukhumbu?"
 */

export interface DailyWeather {
  date:                string;
  tempMax:             number;  // °C
  tempMin:             number;  // °C
  tempMean:            number;  // °C
  rainfall:            number;  // mm
  snowfall:            number;  // cm
  windSpeedMax:        number;  // m/s
  precipitationHours: number;   // hours of rain per day
}

export interface HistoricalWeatherStats {
  // Averages over the historical period
  avgTempMax:          number;
  avgTempMin:          number;
  avgRainfall:         number;
  avgWindSpeed:        number;
  avgSnowfall:         number;

  // Risk probabilities (0–1)
  heavyRainProbability:  number; // % days with rain > 20mm
  freezingProbability:   number; // % days with temp < 0°C
  highWindProbability:   number; // % days with wind > 10 m/s
  snowProbability:       number; // % days with snowfall > 0

  // Extremes
  maxRainfall:   number;
  maxWindSpeed:  number;
  minTemp:       number;
  maxTemp:       number;

  // Raw daily data
  days: DailyWeather[];

  // Meta
  yearsAnalysed: number;
  dateRange:     string;
}

/**
 * Fetch historical weather stats for a location on a target date.
 * Analyses the same ±7 days window across the past N years.
 *
 * Example: target = 2026-07-15, years = 5
 * → fetches July 8–22 for 2021, 2022, 2023, 2024, 2025
 * → returns statistics over those ~35 days
 */
export async function fetchHistoricalWeather(
  lat:        number,
  lon:        number,
  targetDate: string,  // YYYY-MM-DD (the planned travel date)
  years:      number = 5
): Promise<HistoricalWeatherStats | null> {

  if (lat === 0 && lon === 0) return null;

  const target = new Date(targetDate);
  const month  = target.getMonth() + 1; // 1–12
  const day    = target.getDate();

  // Build date ranges: same ±7 day window for each past year
  const allDays: DailyWeather[] = [];
  const currentYear = new Date().getFullYear();

  // Build one big request covering all past years at once
  // OpenMeteo supports multi-year ranges in a single call
  const startYear = currentYear - years;
  const endYear   = currentYear - 1; // don't include future dates

  // Start = 7 days before target month/day in startYear
  const startDate = new Date(startYear, month - 1, Math.max(1, day - 7));
  const endDate   = new Date(endYear,   month - 1, Math.min(28, day + 7));

  const startStr = startDate.toISOString().split("T")[0];
  const endStr   = endDate.toISOString().split("T")[0];

  try {
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude",          String(lat));
    url.searchParams.set("longitude",         String(lon));
    url.searchParams.set("start_date",        startStr);
    url.searchParams.set("end_date",          endStr);
    url.searchParams.set("daily",             [
      "temperature_2m_max",
      "temperature_2m_min",
      "temperature_2m_mean",
      "precipitation_sum",
      "snowfall_sum",
      "wind_speed_10m_max",
      "precipitation_hours",
    ].join(","));
    url.searchParams.set("timezone",          "Asia/Kathmandu");
    url.searchParams.set("wind_speed_unit",   "ms");

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
      cache:  "no-store",
    });

    if (!res.ok) {
      console.warn(`[historical-weather] OpenMeteo ${res.status} for (${lat},${lon})`);
      return null;
    }

    const data = await res.json() as {
      daily?: {
        time:                    string[];
        temperature_2m_max:      number[];
        temperature_2m_min:      number[];
        temperature_2m_mean:     number[];
        precipitation_sum:       number[];
        snowfall_sum:            number[];
        wind_speed_10m_max:      number[];
        precipitation_hours:     number[];
      };
    };

    const d = data.daily;
    if (!d || !d.time?.length) return null;

    for (let i = 0; i < d.time.length; i++) {
      allDays.push({
        date:               d.time[i],
        tempMax:            d.temperature_2m_max[i]   ?? 0,
        tempMin:            d.temperature_2m_min[i]   ?? 0,
        tempMean:           d.temperature_2m_mean[i]  ?? 0,
        rainfall:           d.precipitation_sum[i]    ?? 0,
        snowfall:           d.snowfall_sum[i]          ?? 0,
        windSpeedMax:       d.wind_speed_10m_max[i]   ?? 0,
        precipitationHours: d.precipitation_hours[i]  ?? 0,
      });
    }

    if (allDays.length === 0) return null;

    return buildStats(allDays, years, `${startStr} to ${endStr}`);
  } catch (err) {
    console.warn(`[historical-weather] Fetch failed:`, err);
    return null;
  }
}

function buildStats(days: DailyWeather[], years: number, dateRange: string): HistoricalWeatherStats {
  const n = days.length;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const max = (arr: number[]) => Math.max(...arr);
  const min = (arr: number[]) => Math.min(...arr);

  const tempMaxArr    = days.map((d) => d.tempMax);
  const tempMinArr    = days.map((d) => d.tempMin);
  const rainfallArr   = days.map((d) => d.rainfall);
  const windArr       = days.map((d) => d.windSpeedMax);
  const snowArr       = days.map((d) => d.snowfall);

  return {
    avgTempMax:   round(avg(tempMaxArr)),
    avgTempMin:   round(avg(tempMinArr)),
    avgRainfall:  round(avg(rainfallArr)),
    avgWindSpeed: round(avg(windArr)),
    avgSnowfall:  round(avg(snowArr)),

    heavyRainProbability: round(days.filter((d) => d.rainfall > 20).length / n),
    freezingProbability:  round(days.filter((d) => d.tempMin < 0).length  / n),
    highWindProbability:  round(days.filter((d) => d.windSpeedMax > 10).length / n),
    snowProbability:      round(days.filter((d) => d.snowfall > 0).length / n),

    maxRainfall:  round(max(rainfallArr)),
    maxWindSpeed: round(max(windArr)),
    minTemp:      round(min(tempMinArr)),
    maxTemp:      round(max(tempMaxArr)),

    days,
    yearsAnalysed: years,
    dateRange,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
