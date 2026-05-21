import { callAI } from "@/lib/ai/client";
import { AI_SYSTEM_PROMPT } from "./config";
import type { OriginLocation } from "./resolver";

type MemberAnalysis = {
  name: string;
  username: string | null;
  isLeader: boolean;
  score: number;
  level: string;
  topRisks: string[];
  healthFlags: string[];
  riskReport: {
    season: string;
    seasonalContext: string;
    riskFactors: { name: string; severity: string }[];
    healthAdvisories: { condition: string }[];
    recommendations: any[];
    notableEvents: any[];
    weatherStats: any;
    confidence: number;
  };
};

type Alternative = {
  name: string;
  district: string;
  safetyScore: number;
  estimatedNPR: number;
};

type Budget = {
  specified: number;
  estimatedTotal: number;
  feasible: boolean;
  shortfall: number;
  perPerson: number;
};

export function buildPrompt(
  location: { name: string; district: { name: string; province: { name: string } }; altitude: number | null },
  travelDate: string,
  tripType: "SOLO" | "GROUP",
  memberAnalyses: MemberAnalysis[],
  leaderAnalysis: MemberAnalysis,
  groupScore: number,
  groupLevel: string,
  groupAvgScore: number,
  conflict: boolean,
  mostVulnerable: { name: string; score: number } | undefined,
  budget: Budget,
  sortedAlternatives: Alternative[],
  ai: {
    verdict: string;
    whyUnsafe: string;
    groupConflict: string;
    riskExplanation: string;
    healthWarning: string;
    budgetAdvice: string;
    alternativeReason: string;
    topTip: string;
  },
) {
  const memberSummary = memberAnalyses
    .map((m) =>
      `${m.name}${m.isLeader ? " (leader)" : ""}: score ${m.score}/100 (${m.level})${m.healthFlags.length > 0 ? ` — ${m.healthFlags.slice(0, 2).join(", ")}` : ""}`,
    )
    .join("\n");

  const altSummary = sortedAlternatives.slice(0, 3)
    .map((a) => `${a.name} (${a.district}): ${a.safetyScore}/100 — est. NPR ${a.estimatedNPR.toLocaleString()}`)
    .join("\n");

  const isUnsafe = groupLevel === "HIGH_RISK" || groupLevel === "EXTREME";

  return `Nepal travel safety analysis. Be specific and honest.

Destination: ${location.name}, ${location.district.name}, ${location.district.province.name} Province${location.altitude ? ` (${location.altitude}m)` : ""}
Travel date: ${travelDate} (${leaderAnalysis.riskReport.season})
Trip type: ${tripType}

${tripType === "GROUP"
    ? `GROUP ANALYSIS (conservative — uses WORST member score):
Group score: ${groupScore}/100 (${groupLevel}) — avg: ${groupAvgScore}/100
${conflict ? `\u26a0\ufe0f CONFLICT: ${mostVulnerable?.name} is the most vulnerable member (${mostVulnerable?.score}/100)` : "No conflict detected."}
Members:
${memberSummary}`
    : `SOLO ANALYSIS:
Score: ${groupScore}/100 (${groupLevel})
Top risks: ${leaderAnalysis.topRisks.join(", ") || "none"}`}

Seasonal context: ${leaderAnalysis.riskReport.seasonalContext}
Top risk factors: ${leaderAnalysis.riskReport.riskFactors.slice(0, 3).map((f) => `${f.name} (${f.severity})`).join(", ") || "none"}
Health advisories: ${leaderAnalysis.riskReport.healthAdvisories.map((h) => h.condition).join(", ") || "none"}

Budget: ${budget.specified > 0 ? `NPR ${budget.specified.toLocaleString()} total (NPR ${budget.perPerson.toLocaleString()} per person). Est. trip cost: NPR ${budget.estimatedTotal.toLocaleString()}. ${budget.feasible ? "Budget sufficient." : `Shortfall: NPR ${budget.shortfall.toLocaleString()}.`}` : "Not specified."}

${sortedAlternatives.length > 0 ? `Safer alternatives in same province:
${altSummary}` : "No safer alternatives found."}

Respond with this exact JSON structure:
{
  "verdict": "2-3 sentences: is this trip advisable? Be direct.",
  "whyUnsafe": "${isUnsafe ? "2-3 sentences explaining exactly why this destination is unsafe for this date/group" : ""}",
  "groupConflict": "${conflict ? "2 sentences about which member is at risk and why, using their name" : ""}",
  "riskExplanation": "3-4 sentences: specific risks for this destination on this date in plain language",
  "healthWarning": "1-2 sentences about health-specific risks (skip if no health conditions)",
  "budgetAdvice": "1 sentence about budget feasibility (skip if no budget)",
  "alternativeReason": "${isUnsafe || conflict ? "2-3 sentences: why the alternatives are better and which one you specifically recommend" : ""}",
  "topTip": "Single most important actionable tip for this specific trip"
}`;
}

export async function callAiAnalysis(prompt: string): Promise<{
  verdict: string;
  whyUnsafe: string;
  groupConflict: string;
  riskExplanation: string;
  healthWarning: string;
  budgetAdvice: string;
  alternativeReason: string;
  topTip: string;
}> {
  const fallback = {
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

  try {
    const cleaned = aiRaw.replace(/```json|```/g, "").trim();
    return { ...fallback, ...JSON.parse(cleaned) };
  } catch {
    return { ...fallback, verdict: aiRaw.slice(0, 300) };
  }
}
