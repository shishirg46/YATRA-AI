import { prisma } from "@/lib/prisma";
import type { RoutePoint } from "@/lib/analysis/route-safety";

const BASELINE_PREFIX = "baseline-historical-v1";

type BaselineWeather = {
  temperature: number;
  humidity: number;
  rainfall: number;
  windSpeed: number;
  pressure: number;
  description: string;
  source: string;
  timestamp: string;
};

type BaselineHazard = {
  floodIndex: number;
  landslideIndex: number;
  earthquakeIndex: number;
  heatIndex: number;
  airQuality: number;
  source: string;
};

type BaselineHistoricalWeather = {
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
  days: Array<{ date: string; tempMax: number; tempMin: number; tempMean: number; rainfall: number; snowfall: number; windSpeedMax: number; precipitationHours: number }>;
  yearsAnalysed: number;
  dateRange: string;
};

type BaselineHistoricalHazard = {
  floodIncidents: number;
  landslideIncidents: number;
  earthquakeCount: number;
  maxEarthquakeMag: number;
  historicalFloodRisk: number;
  historicalLandslideRisk: number;
  historicalEarthquakeRisk: number;
  notableEvents: Array<{ date: string; type: string; description: string; severity: "LOW" | "MEDIUM" | "HIGH" }>;
  yearsAnalysed: number;
  source: string;
};

export async function getBaselineForPlace(place: RoutePoint, departureDate: string): Promise<{
  currentWeather: BaselineWeather | null;
  currentHazard: BaselineHazard | null;
  historicalWeather: BaselineHistoricalWeather | null;
  historicalHazard: BaselineHistoricalHazard | null;
}> {
  const location = await findLocation(place);
  if (!location) {
    return {
      currentWeather: null,
      currentHazard: null,
      historicalWeather: null,
      historicalHazard: null,
    };
  }

  const month = Math.max(1, Math.min(12, new Date(departureDate).getMonth() + 1));
  const sourceTag = `${BASELINE_PREFIX}:m${String(month).padStart(2, "0")}`;

  const [weatherRow, hazardRow] = await Promise.all([
    prisma.weatherData.findFirst({
      where: { locationId: location.id, source: sourceTag },
      orderBy: { recordedAt: "desc" },
    }),
    prisma.hazardData.findFirst({
      where: { locationId: location.id, source: sourceTag },
      orderBy: { recordedAt: "desc" },
    }),
  ]);

  const currentWeather = weatherRow
    ? {
        temperature: weatherRow.temperature,
        humidity: weatherRow.humidity,
        rainfall: weatherRow.rainfall,
        windSpeed: weatherRow.windSpeed,
        pressure: weatherRow.pressure ?? 1012,
        description: "Historical baseline estimate",
        source: weatherRow.source ?? BASELINE_PREFIX,
        timestamp: weatherRow.recordedAt.toISOString(),
      }
    : null;

  const currentHazard = hazardRow
    ? {
        floodIndex: hazardRow.floodIndex ?? 0,
        landslideIndex: hazardRow.landslideIndex ?? 0,
        earthquakeIndex: 0,
        heatIndex: hazardRow.heatIndex ?? 0,
        airQuality: hazardRow.airQuality ?? 0.4,
        source: hazardRow.source ?? BASELINE_PREFIX,
      }
    : null;

  const historicalWeather = weatherRow ? buildHistoricalWeather(weatherRow) : null;
  const historicalHazard = hazardRow ? buildHistoricalHazard(hazardRow) : null;

  return {
    currentWeather,
    currentHazard,
    historicalWeather,
    historicalHazard,
  };
}

async function findLocation(place: RoutePoint) {
  if (place.id && !place.id.startsWith("waypoint-")) {
    const byId = await prisma.location.findUnique({ where: { id: place.id } });
    if (byId) return byId;
  }

  if (place.district) {
    const byNameDistrict = await prisma.location.findFirst({
      where: {
        name: place.name,
        district: { name: place.district },
      },
    });
    if (byNameDistrict) return byNameDistrict;
  }

  return prisma.location.findFirst({ where: { name: place.name } });
}

function buildHistoricalWeather(weatherRow: {
  temperature: number;
  rainfall: number;
  windSpeed: number;
  recordedAt: Date;
}): BaselineHistoricalWeather {
  const avgTemp = weatherRow.temperature;
  const avgRainfall = weatherRow.rainfall;
  const avgWind = weatherRow.windSpeed;

  return {
    avgTempMax: avgTemp + 4,
    avgTempMin: avgTemp - 5,
    avgRainfall,
    avgWindSpeed: avgWind,
    avgSnowfall: avgTemp <= 2 ? 1.5 : 0,
    heavyRainProbability: avgRainfall > 20 ? 0.65 : avgRainfall > 10 ? 0.35 : 0.1,
    freezingProbability: avgTemp <= 2 ? 0.45 : 0.03,
    highWindProbability: avgWind > 8 ? 0.3 : 0.1,
    snowProbability: avgTemp <= 2 ? 0.4 : 0,
    maxRainfall: avgRainfall * 1.8,
    maxWindSpeed: avgWind * 1.7,
    minTemp: avgTemp - 8,
    maxTemp: avgTemp + 8,
    days: [],
    yearsAnalysed: 5,
    dateRange: `baseline around ${weatherRow.recordedAt.toISOString().split("T")[0]}`,
  };
}

function buildHistoricalHazard(hazardRow: {
  floodIndex: number | null;
  landslideIndex: number | null;
  recordedAt: Date;
}): BaselineHistoricalHazard {
  const flood = hazardRow.floodIndex ?? 0;
  const landslide = hazardRow.landslideIndex ?? 0;

  return {
    floodIncidents: Math.round(flood * 12),
    landslideIncidents: Math.round(landslide * 12),
    earthquakeCount: 0,
    maxEarthquakeMag: 0,
    historicalFloodRisk: flood,
    historicalLandslideRisk: landslide,
    historicalEarthquakeRisk: 0,
    notableEvents: [
      {
        date: hazardRow.recordedAt.toISOString().split("T")[0],
        type: "Baseline",
        description: "Seeded seasonal baseline profile",
        severity: flood + landslide > 1 ? "HIGH" : flood + landslide > 0.5 ? "MEDIUM" : "LOW",
      },
    ],
    yearsAnalysed: 5,
    source: BASELINE_PREFIX,
  };
}
