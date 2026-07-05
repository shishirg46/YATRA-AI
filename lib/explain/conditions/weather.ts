import type { Evaluator, ExplanationContext, EvaluatorResult } from "../types";
import { levelToSeverity, levelToAudience } from "../types";
import { computePriority } from "../priority";

export const weatherEvaluator: Evaluator = (ctx: ExplanationContext): EvaluatorResult[] => {
  const results: EvaluatorResult[] = [];
  const input = ctx.report;
  const ws = input.weatherStats;
  const wp = input.weatherPillar;
  const lw = input.liveWeather;

  if (!ws) return results;

  const season = input.season.toLowerCase();
  const dest = input.destination.name;
  const district = input.destination.district;

  if (ws.avgRainfall > 30 || ws.heavyRainProbability > 0.4) {
    const severity = ws.avgRainfall > 50 ? "EXTREME" as const : ws.avgRainfall > 25 ? "HIGH" as const : "MEDIUM" as const;
    const result: EvaluatorResult = {
      condition: "heavy_rainfall",
      severity,
      audience: levelToAudience(severity),
      priority: 0,
      placeholders: {
        destination: dest,
        district,
        season,
        rainfall: ws.avgRainfall,
        heavyRainProbability: Math.round(ws.heavyRainProbability * 100),
        maxRainfall: ws.maxRainfall,
      },
      trace: [`weatherStats.avgRainfall=${ws.avgRainfall}, heavyRainProbability=${ws.heavyRainProbability}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (ws.freezingProbability > 0.1 || ws.avgTempMin < 5) {
    const severity = ws.avgTempMin < -5 ? "EXTREME" as const : ws.avgTempMin < 0 ? "HIGH" as const : "MEDIUM" as const;
    const result: EvaluatorResult = {
      condition: "freezing_temperatures",
      severity,
      audience: levelToAudience(severity),
      priority: 0,
      placeholders: {
        destination: dest,
        district,
        avgTempMin: ws.avgTempMin,
        freezingProbability: Math.round(ws.freezingProbability * 100),
        minTemp: ws.minTemp,
      },
      trace: [`weatherStats.freezingProbability=${ws.freezingProbability}, avgTempMin=${ws.avgTempMin}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (ws.avgWindSpeed > 8) {
    const severity = ws.avgWindSpeed > 15 ? "HIGH" as const : "MEDIUM" as const;
    const result: EvaluatorResult = {
      condition: "high_winds",
      severity,
      audience: levelToAudience(severity),
      priority: 0,
      placeholders: {
        destination: dest,
        district,
        avgWindSpeed: ws.avgWindSpeed,
      },
      trace: [`weatherStats.avgWindSpeed=${ws.avgWindSpeed}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  const month = new Date(input.startDate).getMonth() + 1;
  const isSnowMonsoon = month >= 6 && month <= 9;
  const isSnowWinter = month >= 12 || month <= 2;
  const alt = input.destination.altitude ?? 0;
  const shouldShowSnowfall = (isSnowMonsoon && alt > 4500) || !isSnowMonsoon;

  if (shouldShowSnowfall && (ws.snowProbability > 0.15 || ws.avgSnowfall > 2)) {
    const severity = isSnowWinter && ws.avgSnowfall > 10 ? "HIGH" as const
      : isSnowWinter ? "MEDIUM" as const
      : ws.avgSnowfall > 10 ? "MEDIUM" as const : "LOW" as const;
    const result: EvaluatorResult = {
      condition: "snowfall",
      severity,
      audience: levelToAudience(severity),
      priority: 0,
      placeholders: {
        destination: dest,
        district,
        snowProbability: Math.round(ws.snowProbability * 100),
        avgSnowfall: ws.avgSnowfall,
        altitude: alt,
      },
      trace: [`weatherStats.snowProbability=${ws.snowProbability}, avgSnowfall=${ws.avgSnowfall}`],
    };
    result.priority = computePriority(result);
    results.push(result);
  }

  if (lw?.description && lw.description !== "fallback:weather") {
    if (lw.rainfall > 20) {
      const result: EvaluatorResult = {
        condition: "active_rain",
        severity: "HIGH",
        audience: levelToAudience("HIGH"),
        priority: 0,
        placeholders: {
          destination: dest,
          rainfall: lw.rainfall,
          source: lw.sourceLabel ?? lw.source ?? "live feed",
        },
        trace: [`liveWeather.rainfall=${lw.rainfall}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  if (wp?.forecastWeek) {
    const highRainDays = wp.forecastWeek.filter((d) => d.rainProb > 60 && d.isTravelDate);
    if (highRainDays.length > 0) {
      const result: EvaluatorResult = {
        condition: "forecast_heavy_rain",
        severity: "MEDIUM",
        audience: levelToAudience("CAUTION"),
        priority: 0,
        placeholders: {
          destination: dest,
          district,
          days: highRainDays.length,
          dates: highRainDays.map((d) => d.date).join(", "),
        },
        trace: [`forecastWeek high-rain days: ${highRainDays.length}`],
      };
      result.priority = computePriority(result);
      results.push(result);
    }
  }

  return results;
};
