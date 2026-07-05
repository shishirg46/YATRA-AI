import type { ExplanationContext, ConfidenceReport } from "../types";

export function computeConfidence(ctx: ExplanationContext): ConfidenceReport {
  const input = ctx.report;

  const weatherPillar = scoreWeatherConfidence(input);
  const disasterPillar = scoreDisasterConfidence(input);
  const routePillar = scoreRouteConfidence(input);
  const healthPillar = scoreHealthConfidence(input);
  const historicalPillar = scoreHistoricalConfidence(input);

  const pillars = {
    weather: weatherPillar.score,
    disaster: disasterPillar.score,
    route: routePillar.score,
    health: healthPillar.score,
    historical: historicalPillar.score,
  };

  const overall = Math.round(
    (weatherPillar.score + disasterPillar.score + routePillar.score + healthPillar.score + historicalPillar.score) / 5,
  );

  const fallbacks: string[] = [
    ...weatherPillar.fallbacks,
    ...disasterPillar.fallbacks,
    ...routePillar.fallbacks,
    ...healthPillar.fallbacks,
    ...historicalPillar.fallbacks,
  ];

  const reasons: string[] = [
    ...weatherPillar.reasons,
    ...disasterPillar.reasons,
    ...routePillar.reasons,
    ...healthPillar.reasons,
    ...historicalPillar.reasons,
  ];

  return {
    score: overall,
    pillars,
    freshness: {
      weatherMinutes: weatherPillar.freshnessMinutes,
      disasterMinutes: disasterPillar.freshnessMinutes,
    },
    providers: {
      weather: weatherPillar.provider,
      routing: routePillar.provider,
      disaster: disasterPillar.providers,
      airQuality: "OpenAQ",
    },
    fallbacks,
    reasons,
  };
}

interface PillarScore {
  score: number;
  freshnessMinutes: number;
  provider: string;
  providers: string[];
  fallbacks: string[];
  reasons: string[];
}

function scoreWeatherConfidence(input: any): PillarScore {
  const lw = input.liveWeather;
  const ws = input.weatherStats;
  const fallbacks: string[] = [];
  const reasons: string[] = [];

  let score = 50;

  if (lw && lw.description !== "fallback:weather") {
    score += 30;
    reasons.push("Live DHM weather available");
  } else if (lw) {
    score += 10;
    fallbacks.push("Weather used fallback provider");
    reasons.push("Weather using fallback provider");
  }

  if (ws) {
    score += 20;
    reasons.push("Historical weather data complete");
  }

  const freshnessMinutes = lw ? 15 : 1440;

  return {
    score: Math.min(score, 100),
    freshnessMinutes,
    provider: lw?.sourceLabel ?? lw?.source ?? "Historical average",
    providers: [],
    fallbacks,
    reasons,
  };
}

function scoreDisasterConfidence(input: any): PillarScore {
  const lh = input.liveHazard;
  const drr = input.disasterRouteRisk;
  const fallbacks: string[] = [];
  const reasons: string[] = [];

  let score = 40;

  if (lh && lh.source !== "fallback") {
    score += 35;
    reasons.push("Live BIPAD disaster data available");
  } else {
    score += 10;
    fallbacks.push("Disaster data using historical only");
    reasons.push("Disaster data from historical records");
  }

  if (drr) {
    score += 25;
    reasons.push("Route disaster assessment complete");
  }

  return {
    score: Math.min(score, 100),
    freshnessMinutes: lh ? 30 : 1440,
    provider: "BIPAD",
    providers: lh ? ["BIPAD", "USGS"] : ["USGS (historical)"],
    fallbacks,
    reasons,
  };
}

function scoreRouteConfidence(input: any): PillarScore {
  const rr = input.routeRisk;
  const rp = input.routePillar;
  const fallbacks: string[] = [];
  const reasons: string[] = [];

  let score = 50;

  if (rr) {
    score += 25;
    reasons.push("Route risk analysis complete");
  }

  if (rp) {
    score += 25;
    reasons.push("Route pillar assessment available");
  }

  const hasOpenRouteService = input.routePlan?.source === "ors" || input.routePlan?.source === "openrouteservice";
  if (hasOpenRouteService) {
    reasons.push("OpenRouteService route generated");
  }

  return {
    score: Math.min(score, 100),
    freshnessMinutes: 60,
    provider: "OpenRouteService",
    providers: [],
    fallbacks,
    reasons,
  };
}

function scoreHealthConfidence(input: any): PillarScore {
  const members = input.memberAnalyses;
  const health = input.healthAdvisories;
  const fallbacks: string[] = [];
  const reasons: string[] = [];

  let score = 60;

  if (members && members.length > 0) {
    score += 20;
    reasons.push("Member health profiles available");
  }

  if (health && health.length > 0) {
    score += 20;
    reasons.push("Health advisories evaluated");
  }

  if (!members || members.length === 0) {
    fallbacks.push("No member health data provided");
    reasons.push("Health based on general destination data");
  }

  return {
    score: Math.min(score, 100),
    freshnessMinutes: 120,
    provider: "User profile",
    providers: [],
    fallbacks,
    reasons,
  };
}

function scoreHistoricalConfidence(input: any): PillarScore {
  const ws = input.weatherStats;
  const hs = input.weatherStats?.historicalHazardStats;
  const fallbacks: string[] = [];
  const reasons: string[] = [];

  let score = 50;

  if (ws) {
    score += 25;
    reasons.push("Historical weather data complete");
  }

  if (hs) {
    score += 25;
    reasons.push("Historical hazard data complete");
  }

  if (!ws) {
    fallbacks.push("Historical weather estimated");
    reasons.push("Historical weather estimated from regional data");
  }

  return {
    score: Math.min(score, 100),
    freshnessMinutes: 4320,
    provider: "Historical data",
    providers: [],
    fallbacks,
    reasons,
  };
}
