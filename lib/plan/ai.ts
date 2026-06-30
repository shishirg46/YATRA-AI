import { callAI } from "@/lib/ai/client";
import { AI_SYSTEM_PROMPT } from "./config";
import type { PromptFacts, AiResult } from "./pipeline-types";

export function buildPrompt(facts: PromptFacts): string {
  const {
    destination, travelDate, season, tripType,
    memberAnalyses, leaderAnalysis,
    groupScore, groupLevel, groupAvgScore, conflict, mostVulnerable,
    budget, alternatives,
    pillarDetails, routeFlags, evidenceSummary,
  } = facts;

  const memberSummary = memberAnalyses
    .map((m) =>
      `${m.name}${m.isLeader ? " (leader)" : ""}: score ${m.score}/100 (${m.level})${m.healthFlags.length > 0 ? ` — ${m.healthFlags.slice(0, 2).join(", ")}` : ""}`,
    )
    .join("\n");

  const altSummary = alternatives.slice(0, 3)
    .map((a) => `${a.name} (${a.district}): ${a.safetyScore}/100 — est. NPR ${a.estimatedNPR.toLocaleString()}`)
    .join("\n");

  const isUnsafe = groupLevel === "HIGH_RISK" || groupLevel === "EXTREME";

  return `Nepal travel safety analysis. Be specific and honest.

Destination: ${destination.name}, ${destination.district}, ${destination.province} Province${destination.altitude ? ` (${destination.altitude}m)` : ""}
Travel date: ${travelDate} (${season})
Trip type: ${tripType}

${tripType === "GROUP"
    ? `GROUP ANALYSIS (conservative — uses WORST member score):
Group score: ${groupScore}/100 (${groupLevel}) — avg: ${groupAvgScore}/100
${conflict ? `CONFLICT: ${mostVulnerable?.name} is the most vulnerable member (${mostVulnerable?.score}/100)` : "No conflict detected."}
Members:
${memberSummary}`
    : `SOLO ANALYSIS:
Score: ${groupScore}/100 (${groupLevel})
Top risks: ${leaderAnalysis.topRisks.join(", ") || "none"}`}

Seasonal context: ${leaderAnalysis.riskReport.seasonalContext}
Top risk factors: ${leaderAnalysis.riskReport.riskFactors.slice(0, 3).map((f) => `${f.name} (${f.severity})`).join(", ") || "none"}
Health advisories: ${leaderAnalysis.riskReport.healthAdvisories.map((h) => h.condition).join(", ") || "none"}

Pillar breakdown:
- Route historic: ${pillarDetails.routeHistoric.score}/${pillarDetails.routeHistoric.maxPoints} (${pillarDetails.routeHistoric.level})
- Route recent: ${pillarDetails.routeRealtime.score}/${pillarDetails.routeRealtime.maxPoints} (${pillarDetails.routeRealtime.level})
- Destination safety: ${pillarDetails.destinationSafety.score}/${pillarDetails.destinationSafety.maxPoints} (${pillarDetails.destinationSafety.level})
- Weather safety: ${pillarDetails.weatherSafety.score}/${pillarDetails.weatherSafety.maxPoints} (${pillarDetails.weatherSafety.level})
- Personal safety: ${pillarDetails.personalSafety.score}/${pillarDetails.personalSafety.maxPoints} (${pillarDetails.personalSafety.level})
${routeFlags.length > 0 ? `Route flags: ${routeFlags.slice(0, 3).map((f) => `${f.where}: ${f.what} (${f.status})`).join("; ")}` : ""}

Evidence summary:
- ${evidenceSummary.routeHistoricalCount} historical route incidents, ${evidenceSummary.routeRealtimeCount} recent incidents
- Flood risk: ${Math.round(evidenceSummary.destinationFloodRisk * 100)}%, Landslide risk: ${Math.round(evidenceSummary.destinationLandslideRisk * 100)}%
- Live temperature: ${evidenceSummary.liveTemperature}°C, Rainfall: ${evidenceSummary.liveRainfall}mm
- Forecast rain risk: ${evidenceSummary.forecastRainRisk}

Budget: ${budget.specified > 0 ? `NPR ${budget.specified.toLocaleString()} total (NPR ${budget.perPerson.toLocaleString()} per person). Est. trip cost: NPR ${budget.estimatedTotal.toLocaleString()}. ${budget.feasible ? "Budget sufficient." : `Shortfall: NPR ${budget.shortfall.toLocaleString()}.`}` : "Not specified."}

${alternatives.length > 0 ? `Safer alternatives in same province:
${altSummary}` : "No safer alternatives found."}

Respond with exactly five sections. Each section starts with --- SECTION NAME --- on its own line. Write 1-4 plain sentences per section. No JSON. No markdown.

--- VERDICT ---
Write exactly 1-2 plain sentences summarising the overall safety assessment. Mention the score (${groupScore}/100) and whether travel is advisable for this trip. Keep this brief — it is a summary only.

${isUnsafe ? `--- RISK EXPLANATION ---
Write 3-4 plain sentences explaining exactly why this destination is unsafe for this date/group. Be specific about the risks, referencing the pillar scores and evidence above. Do NOT repeat the verdict — provide additional detail here.` : `--- RISK EXPLANATION ---
Write 2-3 plain sentences explaining the general risk factors for this trip. Mention the key concerns to be aware of. Do NOT repeat the verdict — provide additional detail here.`}

${conflict ? `--- HEALTH WARNING ---
Write 1-2 plain sentences about health-specific risks for this trip, especially for ${mostVulnerable?.name} who has the lowest score.` : `--- HEALTH WARNING ---
Write 1-2 plain sentences about health-specific risks for this trip.`}

--- BUDGET ADVICE ---
Write 1 plain sentence about budget feasibility for this trip.

--- TOP TIP ---
Write 1 plain sentence with the single most important actionable tip for this specific trip.`;
}

function parseSectionedOutput(raw: string, facts: PromptFacts): AiResult {
  const sectionRegex = /^---\s*(\w+(?:\s+\w+)*)\s*---\s*$/m;
  const parts = raw.split(sectionRegex);

  const sections: Record<string, string> = {};
  for (let i = 1; i < parts.length - 1; i += 2) {
    const key = parts[i].trim().toUpperCase().replace(/\s+/g, "_");
    const value = parts[i + 1]?.trim() ?? "";
    sections[key] = value;
  }

  const verdict = sections.VERDICT ?? "";
  const riskExplanation = sections.RISK_EXPLANATION ?? "";
  const healthWarning = sections.HEALTH_WARNING ?? "";
  const budgetAdvice = sections.BUDGET_ADVICE ?? "";
  const topTip = sections.TOP_TIP ?? "";

  const groupLevel = facts.groupLevel;
  const isUnsafe = groupLevel === "HIGH_RISK" || groupLevel === "EXTREME";
  const hasConflict = facts.conflict;

  let whyUnsafe = "";
  if (isUnsafe) {
    whyUnsafe = riskExplanation || verdict;
    const sentences = whyUnsafe.split(/(?<=[.!])\s+/);
    whyUnsafe = sentences.slice(0, 2).join(" ") || whyUnsafe;
  }

  let groupConflict = "";
  if (hasConflict && facts.mostVulnerable) {
    if (verdict.toLowerCase().includes(facts.mostVulnerable.name.toLowerCase())) {
      const sentences = verdict.split(/(?<=[.!])\s+/);
      const mention = sentences.find((s) =>
        s.toLowerCase().includes(facts.mostVulnerable!.name.toLowerCase()),
      );
      groupConflict = mention ?? `Member ${facts.mostVulnerable.name} has the lowest safety score (${facts.mostVulnerable.score}/100).`;
    } else {
      groupConflict = `Member ${facts.mostVulnerable.name} has the lowest safety score (${facts.mostVulnerable.score}/100). Consider their limitations when planning activities.`;
    }
  }

  let alternativeReason = "";
  if (isUnsafe || hasConflict) {
    if (facts.alternatives.length > 0) {
      const topAlt = facts.alternatives[0];
      alternativeReason = `Consider ${topAlt.name} (${topAlt.district}) as a safer alternative (score: ${topAlt.safetyScore}/100).`;
    }
  }

  return {
    verdict,
    whyUnsafe,
    groupConflict,
    riskExplanation,
    healthWarning,
    budgetAdvice,
    alternativeReason,
    topTip,
  };
}

function parseJsonOutput(raw: string): Partial<AiResult> | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === "string" && (parsed[key] as string).startsWith("{")) {
        try {
          const inner = JSON.parse(parsed[key] as string);
          parsed[key] = Object.values(inner).join(". ") || parsed[key];
        } catch {
        }
      }
    }

    const safeWords = ["safe", "advisable", "good to go", "recommended", "fine to travel"];
    const verdictStr = typeof parsed.verdict === "string" ? parsed.verdict : "";
    if (safeWords.some((w) => verdictStr.toLowerCase().includes(w))) {
      parsed.whyUnsafe = "";
      parsed.alternativeReason = "";
    }

    return parsed as unknown as Partial<AiResult>;
  } catch {
    return null;
  }
}

export async function callAiAnalysis(
  prompt: string,
  facts: PromptFacts,
): Promise<AiResult> {
  const fallback: AiResult = {
    verdict: "",
    whyUnsafe: "",
    groupConflict: "",
    riskExplanation: "",
    healthWarning: "",
    budgetAdvice: "",
    alternativeReason: "",
    topTip: "",
  };

  const aiRaw = await callAI(prompt, { system: AI_SYSTEM_PROMPT });
  if (!aiRaw) return fallback;

  const sectionResult = parseSectionedOutput(aiRaw, facts);
  const hasSections = sectionResult.verdict.length > 0;
  if (hasSections) return sectionResult;

  const jsonResult = parseJsonOutput(aiRaw);
  if (jsonResult) {
    return { ...fallback, ...jsonResult };
  }

  return { ...fallback, verdict: aiRaw.replace(/[{}"]/g, "").slice(0, 300) };
}
