export const AI_SYSTEM_PROMPT = `You are a Nepal travel safety advisor. Be honest, specific, and compassionate. No generic filler. Short paragraphs. Always prioritise safety. Respond ONLY with valid JSON. No markdown, no backticks, no preamble.`;

export function scoreToLevel(score: number): "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME" {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}

const COST_TABLE: Record<string, { accommodation: number; food: number; transport: number; label: string }> = {
  kathmandu: { accommodation: 1500, food: 800, transport: 500, label: "Kathmandu Valley" },
  pokhara: { accommodation: 1800, food: 700, transport: 400, label: "Pokhara city" },
  chitwan: { accommodation: 2500, food: 900, transport: 600, label: "National park" },
  high_trek: { accommodation: 800, food: 1200, transport: 3000, label: "High-altitude trek" },
  mid_trek: { accommodation: 600, food: 900, transport: 1500, label: "Mid-altitude trek" },
  default: { accommodation: 800, food: 600, transport: 600, label: "General Nepal travel" },
};

export function getCosts(name: string, alt: number | null) {
  const n = name.toLowerCase();
  if (n.includes("kathmandu") || n.includes("bhaktapur") || n.includes("lalitpur")) return COST_TABLE.kathmandu;
  if (n.includes("pokhara") || n.includes("lakeside") || n.includes("phewa")) return COST_TABLE.pokhara;
  if (n.includes("chitwan") || n.includes("sauraha")) return COST_TABLE.chitwan;
  if ((alt ?? 0) > 3500) return COST_TABLE.high_trek;
  if ((alt ?? 0) > 1500) return COST_TABLE.mid_trek;
  return COST_TABLE.default;
}

export function computeBudget(costs: ReturnType<typeof getCosts>, altitude: number | null, budgetNPR: number, travellerCount: number) {
  const dailyCost = costs.accommodation + costs.food + costs.transport;
  const estDays = (altitude ?? 0) > 3000 ? 7 : (altitude ?? 0) > 1500 ? 4 : 2;
  const estTotal = dailyCost * estDays;
  const perPerson = budgetNPR > 0 ? Math.round(budgetNPR / travellerCount) : 0;
  const feasible = budgetNPR === 0 || budgetNPR >= estTotal;
  const shortfall = budgetNPR > 0 ? Math.max(0, estTotal - budgetNPR) : 0;
  return { specified: budgetNPR, estimatedTotal: estTotal, perPerson, feasible, shortfall, dailyCost, estDays };
}
