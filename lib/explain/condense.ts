import type { EvaluatorInput } from "./types";
import type { CondensedNarrativeInput } from "./providers/types";

export function condenseInput(input: EvaluatorInput): CondensedNarrativeInput {
  return {
    destination: `${input.destination.name}, ${input.destination.district}`,
    travelDates: `${input.startDate} to ${input.endDate}`,
    tripType: input.tripType,
    season: input.season,
    overallScore: input.overallScore,
    overallLevel: input.overallLevel,
    riskFactors: input.riskFactors.map((r) => ({
      name: r.name,
      severity: r.severity,
    })),
    weatherSummary: buildWeatherSummary(input),
    routeSummary: buildRouteSummary(input),
    budget: {
      specified: input.budget.specified,
      estimated: input.budget.estimatedTotal,
      feasible: input.budget.feasible,
    },
    healthSummary: buildHealthSummary(input),
    groupSummary: buildGroupSummary(input),
  };
}

function buildWeatherSummary(input: EvaluatorInput): string {
  const ws = input.weatherStats;
  if (!ws) return "No weather data available";
  const parts: string[] = [];
  parts.push(
    `Avg ${ws.avgTempMax.toFixed(0)}°C / ${ws.avgTempMin.toFixed(0)}°C`,
  );
  if (ws.avgRainfall > 0) parts.push(`rainfall ${ws.avgRainfall.toFixed(0)}mm`);
  if (ws.avgWindSpeed > 0) parts.push(`wind ${ws.avgWindSpeed.toFixed(0)}km/h`);
  if (ws.avgSnowfall > 0) parts.push(`snow ${ws.avgSnowfall.toFixed(0)}cm`);
  if (ws.heavyRainProbability > 0.3)
    parts.push(`${(ws.heavyRainProbability * 100).toFixed(0)}% heavy rain`);
  if (ws.freezingProbability > 0.3)
    parts.push(`${(ws.freezingProbability * 100).toFixed(0)}% freezing`);
  return parts.join(", ") || "No weather data available";
}

function buildRouteSummary(input: EvaluatorInput): string {
  const rp = input.routePlan;
  if (!rp) return "No route data available";
  const segments = rp.segments
    .map((s) => `${s.from}→${s.to} (${s.distanceKm}km, ${s.riskLevel})`)
    .join("; ");
  return `${rp.corridor} — ${segments}`;
}

function buildHealthSummary(input: EvaluatorInput): string {
  const parts: string[] = [];
  const mv = input.mostVulnerableMember;
  if (mv) parts.push(`Highest risk: ${mv.name} (score ${mv.score})`);
  const altitude = input.destination.altitude;
  if (altitude && altitude > 2500) parts.push(`High altitude (${altitude}m)`);
  return parts.join(". ") || "No significant health concerns";
}

function buildGroupSummary(input: EvaluatorInput): string {
  const members = input.memberAnalyses ?? [];
  const avg = Math.round(input.groupAvgScore);
  const conflict = input.conflict ? " (conflict detected)" : "";
  return `${members.length} members, avg score ${avg}/100${conflict}`;
}
