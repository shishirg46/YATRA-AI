import { fetchElevationBatch } from "@/lib/collectors/elevation";
import { fetchWeather } from "@/lib/collectors/weather-dhm";
import {
  fetchHistoricalDisastersNearRoute,
  fetchRealtimeDisastersNearRoute,
} from "@/lib/disaster-pipeline";
export interface StopAnalysis {
  name: string;
  lat: number;
  lon: number;
  terrain: "Flat" | "Rolling" | "Hill" | "Steep Hill" | "Mountain";
  elevation: {
    mean: number;
    max: number;
    min: number;
    slope: number;
  };
  historical: {
    landslides: number;
    floods: number;
    earthquakes: number;
    latestEvent: string | null;
  };
  realtime: {
    recentDisasters: number;
    types: string[];
  };
  weather: {
    rainfall: number;
    temperature: number;
    windSpeed: number;
    description: string;
  };
  confidence: number;
  explanation: string;
}

function classifyTerrain(slopePct: number): StopAnalysis["terrain"] {
  if (slopePct < 3) return "Flat";
  if (slopePct < 8) return "Rolling";
  if (slopePct < 15) return "Hill";
  if (slopePct < 25) return "Steep Hill";
  return "Mountain";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function analyzeStop(
  lat: number,
  lon: number,
  options?: { radiusKm?: number; name?: string }
): Promise<StopAnalysis> {
  const radiusKm = options?.radiusKm ?? 15;
  const name = options?.name ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`;

  const offset = 0.003;

  const samplePoints = [
    { lat, lon },
    { lat: lat + offset, lon },
    { lat: lat - offset, lon },
    { lat, lon: lon + offset },
    { lat, lon: lon - offset },
  ];

  const elevations = await fetchElevationBatch(samplePoints);
  const valid = elevations.filter((e): e is number => e !== null);

  const centerEl = valid[0] ?? 0;
  const offsetEls = valid.slice(1);
  const nOffsets = offsetEls.length;

  const elevationMin = nOffsets > 0 ? Math.min(centerEl, ...offsetEls) : centerEl;
  const elevationMax = nOffsets > 0 ? Math.max(centerEl, ...offsetEls) : centerEl;
  const elevationMean =
    nOffsets > 0
      ? Math.round(
          [centerEl, ...offsetEls].reduce((s, v) => s + v, 0) /
            ([centerEl, ...offsetEls].length)
        )
      : Math.round(centerEl);

  let maxDelta = 0;
  for (const el of offsetEls) {
    const d = Math.abs(el - centerEl);
    if (d > maxDelta) maxDelta = d;
  }
  const distKm = haversineKm(lat, lon, lat + offset, lon);
  const slopePct = distKm > 0 ? Math.min((maxDelta / 1000 / distKm) * 100, 100) : 0;

  const stopPoint = { lat, lon };

  const [historical, realtime, weather] = await Promise.all([
    fetchHistoricalDisastersNearRoute([stopPoint], radiusKm),
    fetchRealtimeDisastersNearRoute([stopPoint], radiusKm, 30),
    fetchWeather(lat, lon),
  ]);

  const landslideCount = historical
    .filter((d) => d.type === "landslide")
    .reduce((s, d) => s + d.count, 0);
  const floodCount = historical
    .filter((d) => d.type === "flood")
    .reduce((s, d) => s + d.count, 0);

  const realtimeTypes = [...new Set(realtime.map((d) => d.type))];

  const weatherData = {
    rainfall: Math.round((weather?.rainfall ?? 0) * 100) / 100,
    temperature: weather?.temperature ?? 20,
    windSpeed: Math.round((weather?.windSpeed ?? 0) * 10) / 10,
    description: weather?.description ?? "no data",
  };

  const hasWeather = weather !== null;
  const weatherFreshness = hasWeather ? 1 : 0;
  const disasterFreshness =
    landslideCount + floodCount > 0 ? 0.9 : 0.5;
  const confidence = Math.round(
    (0.3 * weatherFreshness + 0.4 * disasterFreshness + 0.3) * 100
  ) / 100;

  const terrain = classifyTerrain(slopePct);

  const hazardParts: string[] = [];
  if (landslideCount > 0) hazardParts.push(`${landslideCount} landslides`);
  if (floodCount > 0) hazardParts.push(`${floodCount} floods`);
  const hazardText = hazardParts.length > 0
    ? `Historical records show ${hazardParts.join(" and ")} within ${radiusKm}km.`
    : `No significant historical hazards recorded nearby.`;

  const explanation = `${name} sits in ${terrain.toLowerCase()} terrain at around ${elevationMin}m elevation (range ${elevationMin}-${elevationMax}m, slope ~${slopePct.toFixed(0)}%). ${hazardText} Current weather: ${weatherData.description}, ${weatherData.temperature}°C, ${weatherData.rainfall}mm rain, ${weatherData.windSpeed}m/s wind.`;

  return {
    name,
    lat,
    lon,
    terrain,
    elevation: {
      mean: elevationMean,
      max: elevationMax,
      min: elevationMin,
      slope: Math.round(slopePct),
    },
    historical: {
      landslides: landslideCount,
      floods: floodCount,
      earthquakes: 0,
      latestEvent: null,
    },
    realtime: {
      recentDisasters: realtime.length,
      types: realtimeTypes,
    },
    weather: weatherData,
    confidence,
    explanation,
  };
}
