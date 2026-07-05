// ─── AI Planner Prompts ──────────────────────────────────────────────────────
// The LLM receives pre-computed structured facts and performs no spatial
// reasoning — only summarization, prioritization, explanation, and comparison.

import type { PlannerRouteInput, PlannerPreferences } from "./types";

export const SYSTEM_PROMPT = `You are Yatra AI's route safety planner for Nepal. Your role is to analyze pre-computed route intelligence data and provide clear, actionable safety assessments.

## Rules
1. NEVER perform spatial reasoning — you receive structured facts, not raw geometry.
2. NEVER estimate distances, positions, or offsets. All spatial data is pre-computed.
3. NEVER identify or guess roads, junctions, or locations beyond what is provided.
4. Summarize, prioritize, explain, and compare only using the facts given to you.
5. Your output must be valid JSON matching the specified schema exactly.
6. Be concise and direct — this is for a driver or traveler.

## Assessment Thresholds
- severityScore >= 75 → assessment: "avoid" — serious hazards, recommend alternative route
- severityScore >= 50 → assessment: "high_risk" — significant hazards, caution strongly advised
- severityScore >= 25 → assessment: "caution" — moderate hazards, normal caution advised
- severityScore < 25  → assessment: "safe" — minimal hazards, route is safe

## Hazard Type Guidance
- **landslide**: Common in monsoon (June-September) in hilly/mountain terrain. Can cause blockages for hours to days.
- **flood**: Risk on low-lying roads and near river crossings. Flash floods are unpredictable.
- **avalanche**: High altitude, winter/spring. Extreme danger, likely impassable.
- **earthquake**: Rare but catastrophic. Widespread road damage possible.
- **wildlife**: Animal crossings, especially in forested areas at dawn/dusk/night.
- **other**: Miscellaneous hazards (road construction, local events, etc.).

## Output Requirements
- hazardHotspots: list the most significant hazard locations along the route, ordered by descending severity.
- timingAdvice: based on hazard types (e.g., wildlife at night, landslide in monsoon afternoon).
- recommendations: actionable driver advice (max 5 items).
- alternativeRoutes: if severityScore >= 50, suggest at least one alternative. Use judgment based on the data.`;

export function buildContext(input: PlannerRouteInput): string {
  const { summary, hazards, clusters, segments, totalDistanceKm, totalDurationMin, confidence, osmWayCount } = input;

  const segmentsSummary = segments
    .filter((s) => s.hazardCount > 0)
    .map((s) =>
      `  - Segment ${s.orderIndex}: ${s.roadName ?? "unnamed"} (${s.highway ?? "unknown"}), `
      + `${s.startKm.toFixed(1)}–${s.endKm.toFixed(1)}km, ${s.lengthM.toFixed(0)}m, `
      + `${s.hazardCount} hazards, severity score ${s.severityScore}, ${s.affectedPercent.toFixed(1)}% affected`,
    )
    .join("\n");

  const hazardsByType = Object.entries(summary.totalHazardTypes)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `  - ${type}: ${count}`)
    .join("\n");

  const hazardDetails = hazards
    .sort((a, b) => b.km - a.km)
    .map((h) =>
      `  - At ${h.km.toFixed(2)}km: ${h.hazardType} (severity: ${h.severity}), confidence: ${h.confidence ?? "N/A"}, source: ${h.source ?? "N/A"} — ${h.roadName ?? "unnamed road"}`,
    )
    .join("\n");

  const clusterDetails = clusters
    .sort((a, b) => a.startKm - b.startKm)
    .map((c) =>
      `  - ${c.hazardType} cluster: ${c.startKm.toFixed(1)}–${c.endKm.toFixed(1)}km, ${c.hazardCount} events, `
      + `severity: ${c.severity}, avg confidence: ${c.avgConfidence.toFixed(2)}`,
    )
    .join("\n");

  return `## Route Overview
- Distance: ${totalDistanceKm.toFixed(1)} km
- Duration: ${totalDurationMin} min
- Route confidence: ${(confidence * 100).toFixed(1)}%
- OSM ways traversed: ${osmWayCount}

## Route Summary
- Overall severity score: ${summary.severityScore}/100
- Assessment: ${summary.severityScore >= 75 ? "avoid" : summary.severityScore >= 50 ? "high_risk" : summary.severityScore >= 25 ? "caution" : "safe"}
- Highest severity: ${summary.highestSeverity}
- Most common hazard: ${summary.mostCommonType}
- Total hazards: ${summary.totalHazards}
- Hazards by type:
${hazardsByType}

## Impact
- Estimated delay: ${summary.estimatedDelayMin} min
- Affected distance: ${summary.affectedDistanceM.toFixed(0)}m (${summary.affectedPercent.toFixed(1)}% of route)
- Detour recommended: ${summary.recommendDetour ? "Yes" : "No"}

## Hazard Details
${hazardDetails || "  (none)"}

## Hazard Clusters
${clusterDetails || "  (none)"}

## Affected Segments
${segmentsSummary || "  (none)"}`;
}

export function buildUserMessage(
  input: PlannerRouteInput,
  preferences?: PlannerPreferences,
): string {
  const prefBlock = preferences
    ? `\n\n## User Preferences\n${JSON.stringify(preferences, null, 2)}`
    : "";

  return `Analyze the following route data and provide a structured safety assessment.${prefBlock}

${buildContext(input)}

Respond with valid JSON matching the planner output schema.`;
}
