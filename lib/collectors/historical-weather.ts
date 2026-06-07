import { openMeteoFetch } from "./open-meteo-client";

export interface DailyWeather {
  date: string;
  tempMax: number;
  tempMin: number;
  tempMean: number;
  rainfall: number;
  snowfall: number;
  windSpeedMax: number;
  precipitationHours: number;
}

export interface HistoricalWeatherStats {
  avgTempMax: number;
  avgTempMin: number;
  avgRainfall: number;
  avgWindSpeed: number;
  avgSnowfall: number;
  heavyRainProbability: number;
  freezingProbability: number;
  highWindProbability: number;
  snowProbability: number;
  maxRainfall: number;
  maxWindSpeed: number;
  minTemp: number;
  maxTemp: number;
  days: DailyWeather[];
  yearsAnalysed: number;
  dateRange: string;
}

interface OpenMeteoArchiveResponse {
  daily?: {
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_sum: (number | null)[];
    snowfall_sum: (number | null)[];
    wind_speed_10m_max: (number | null)[];
    precipitation_hours: (number | null)[];
  };
}

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  targetDate: string,
  years: number = 5
): Promise<HistoricalWeatherStats | null> {
  if (lat === 0 && lon === 0) return null;
  if (lat < 26 || lat > 31 || lon < 80 || lon > 89) return null;

  const target = new Date(targetDate);
  if (isNaN(target.getTime())) return null;

  const targetMonth = target.getMonth();
  const targetDay   = target.getDate();

  const startYear  = target.getFullYear() - years;
  const startDate  = new Date(startYear, targetMonth - 1, targetDay);
  const endDate    = new Date(target.getFullYear() - 1, targetMonth + 1, targetDay);

  if (endDate <= startDate) return null;

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url = `https://archive-api.open-meteo.com/v1/archive`
    + `?latitude=${lat}&longitude=${lon}`
    + `&start_date=${fmt(startDate)}&end_date=${fmt(endDate)}`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,precipitation_hours`
    + `&timezone=auto`;

  try {
    const res = await openMeteoFetch(url);
    if (!res || !res.ok) {
      if (res) console.warn(`[historical-weather] Open-Meteo Archive returned ${res.status} for ${lat},${lon}`);
      return null;
    }

    const data = (await res.json()) as OpenMeteoArchiveResponse;
    if (!data.daily?.time?.length) return null;

    const { daily } = data;
    const count = daily.time.length;

    const days: DailyWeather[] = [];
    for (let i = 0; i < count; i++) {
      const tMax = daily.temperature_2m_max[i];
      const tMin = daily.temperature_2m_min[i];
      if (tMax == null || tMin == null) continue;

      days.push({
        date:               daily.time[i],
        tempMax:            tMax,
        tempMin:            tMin,
        tempMean:           (tMax + tMin) / 2,
        rainfall:           daily.precipitation_sum[i] ?? 0,
        snowfall:           daily.snowfall_sum[i] ?? 0,
        windSpeedMax:       (daily.wind_speed_10m_max[i] ?? 0) / 3.6,
        precipitationHours: daily.precipitation_hours[i] ?? 0,
      });
    }

    if (days.length === 0) return null;

    const n = days.length;
    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0);
    const min = (arr: number[]) => (arr.length > 0 ? Math.min(...arr) : 0);

    const tempMaxArr  = days.map((d) => d.tempMax);
    const tempMinArr  = days.map((d) => d.tempMin);
    const rainfallArr = days.map((d) => d.rainfall);
    const windArr     = days.map((d) => d.windSpeedMax);
    const snowArr     = days.map((d) => d.snowfall);

    return {
      avgTempMax:           round(avg(tempMaxArr)),
      avgTempMin:           round(avg(tempMinArr)),
      avgRainfall:          round(avg(rainfallArr)),
      avgWindSpeed:         round(avg(windArr)),
      avgSnowfall:          round(avg(snowArr)),
      heavyRainProbability: days.filter((d) => d.rainfall > 20).length / n,
      freezingProbability:  days.filter((d) => d.tempMin < 0).length / n,
      highWindProbability:  days.filter((d) => d.windSpeedMax > 10).length / n,
      snowProbability:      days.filter((d) => d.snowfall > 0).length / n,
      maxRainfall:          round(max(rainfallArr)),
      maxWindSpeed:         round(max(windArr)),
      minTemp:              round(min(tempMinArr)),
      maxTemp:              round(max(tempMaxArr)),
      days,
      yearsAnalysed:        years,
      dateRange:            `${fmt(startDate)} – ${fmt(endDate)}`,
    };
  } catch (err) {
    console.warn(`[historical-weather] Open-Meteo Archive fetch failed for ${lat},${lon}:`, err);
    return null;
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
