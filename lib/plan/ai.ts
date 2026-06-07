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

Respond ONLY with a single JSON object. Every value must be a plain text string — no nested objects, no JSON inside JSON.
IMPORTANT: Fields marked EMPTY must be set to empty string "", do not skip them.

{
  "verdict": "The overall score is ${groupScore}/100 (${groupLevel}). Mention the baseline rating then explain what seasonal factors bring it down. Write 2-3 plain sentences. Be direct.",
  "whyUnsafe": "${isUnsafe ? "Write 2-3 plain sentences explaining exactly why this destination is unsafe for this date/group. Be specific about the risks." : ""}",
  "groupConflict": "${conflict ? "Write 2 plain sentences about which member is at most risk and why, using their name." : ""}",
  "riskExplanation": "Write 3-4 plain sentences about the specific risks for this destination on this date. Use plain language.",
  "healthWarning": "Write 1-2 plain sentences about health-specific risks for this trip.",
  "budgetAdvice": "Write 1 plain sentence about budget feasibility for this trip.",
  "alternativeReason": "${isUnsafe || conflict ? "Write 2-3 plain sentences explaining why the alternatives are better and which one you recommend." : ""}",
  "topTip": "Write 1 plain sentence with the single most important actionable tip for this specific trip."
}

WRONG (nested JSON inside a string): {"verdict": "{\\"Score\\": 95}", ...}
RIGHT (plain text inside string): {"verdict": "This destination is safe to visit. The weather is favorable and route conditions are good.", ...}`;
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
    const parsed = JSON.parse(cleaned);

    // Fix nested JSON: if a value looks like a JSON object string, extract just the text
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === "string" && parsed[key].startsWith("{")) {
        try {
          const inner = JSON.parse(parsed[key]);
          parsed[key] = Object.values(inner).join(". ") || parsed[key];
        } catch {
          // not parseable, keep as-is
        }
      }
    }

    // Sanity: if verdict says safe, clear whyUnsafe and alternativeReason
    const safeWords = ["safe", "advisable", "good to go", "recommended", "fine to travel"];
    if (safeWords.some((w) => (parsed.verdict ?? "").toLowerCase().includes(w))) {
      parsed.whyUnsafe = "";
      parsed.alternativeReason = "";
    }

    return { ...fallback, ...parsed };
  } catch {
    return { ...fallback, verdict: aiRaw.replace(/[{}"]/g, "").slice(0, 300) };
  }
}
