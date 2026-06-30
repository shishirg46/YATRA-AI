import type { DailyCostBreakdown, BudgetSummary } from "@/lib/types/plan-report";
import type { TravelStyle, VehicleType } from "./trip-types";
import { computeTransportCost } from "./costs";
import type { GeoPoint } from "@/lib/routing/types";

export const AI_SYSTEM_PROMPT = `You are a Nepal travel safety advisor. Be honest, specific, and compassionate. No generic filler. Short paragraphs. Always prioritise safety. Respond with sections using the format described in the prompt.`;

export function scoreToLevel(score: number): "SAFE" | "CAUTION" | "HIGH_RISK" | "EXTREME" {
  if (score >= 80) return "SAFE";
  if (score >= 60) return "CAUTION";
  if (score >= 40) return "HIGH_RISK";
  return "EXTREME";
}

interface CostTierDaily {
  accommodation: number;
  meals: number;
  localTransport: number;
  misc: number;
}

interface CostTier {
  label: string;
  budget: CostTierDaily;
  standard: CostTierDaily;
  luxury: CostTierDaily;
}

const COST_TABLE: Record<string, CostTier> = {
  kathmandu: {
    label: "Kathmandu Valley",
    budget: { accommodation: 1000, meals: 500, localTransport: 300, misc: 200 },
    standard: { accommodation: 1500, meals: 800, localTransport: 500, misc: 400 },
    luxury: { accommodation: 3500, meals: 1500, localTransport: 800, misc: 1000 },
  },
  pokhara: {
    label: "Pokhara city",
    budget: { accommodation: 1200, meals: 400, localTransport: 250, misc: 150 },
    standard: { accommodation: 1800, meals: 700, localTransport: 400, misc: 300 },
    luxury: { accommodation: 4000, meals: 1400, localTransport: 700, misc: 900 },
  },
  chitwan: {
    label: "National park",
    budget: { accommodation: 1800, meals: 600, localTransport: 400, misc: 200 },
    standard: { accommodation: 2500, meals: 900, localTransport: 600, misc: 500 },
    luxury: { accommodation: 5000, meals: 1800, localTransport: 1000, misc: 1200 },
  },
  high_trek: {
    label: "High-altitude trek",
    budget: { accommodation: 500, meals: 800, localTransport: 2000, misc: 300 },
    standard: { accommodation: 800, meals: 1200, localTransport: 3000, misc: 500 },
    luxury: { accommodation: 2000, meals: 2000, localTransport: 4000, misc: 1000 },
  },
  mid_trek: {
    label: "Mid-altitude trek",
    budget: { accommodation: 400, meals: 600, localTransport: 1000, misc: 200 },
    standard: { accommodation: 600, meals: 900, localTransport: 1500, misc: 400 },
    luxury: { accommodation: 1500, meals: 1500, localTransport: 2500, misc: 600 },
  },
  default: {
    label: "General Nepal travel",
    budget: { accommodation: 500, meals: 400, localTransport: 400, misc: 150 },
    standard: { accommodation: 800, meals: 600, localTransport: 600, misc: 300 },
    luxury: { accommodation: 2000, meals: 1200, localTransport: 1000, misc: 700 },
  },
};

function resolveTier(name: string, alt: number | null): CostTier {
  const n = name.toLowerCase();
  if (n.includes("kathmandu") || n.includes("bhaktapur") || n.includes("lalitpur")) return COST_TABLE.kathmandu;
  if (n.includes("pokhara") || n.includes("lakeside") || n.includes("phewa")) return COST_TABLE.pokhara;
  if (n.includes("chitwan") || n.includes("sauraha")) return COST_TABLE.chitwan;
  if ((alt ?? 0) > 3500) return COST_TABLE.high_trek;
  if ((alt ?? 0) > 1500) return COST_TABLE.mid_trek;
  return COST_TABLE.default;
}

export function getCostLabel(name: string, alt: number | null): string {
  return resolveTier(name, alt).label;
}

export function getCosts(name: string, alt: number | null) {
  const tier = resolveTier(name, alt);
  return {
    accommodation: tier.standard.accommodation,
    food: tier.standard.meals,
    transport: tier.standard.localTransport,
    label: tier.label,
  };
}

export function computeTripDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
}

export function computeLivingCost(
  name: string,
  alt: number | null,
  style: TravelStyle,
): DailyCostBreakdown {
  const tier = resolveTier(name, alt);
  const c = tier[style];
  const total = c.accommodation + c.meals + c.localTransport + c.misc;
  return { ...c, total };
}

export function computeBudgetSummary(params: {
  specified: number;
  dailyCost: DailyCostBreakdown;
  tripDays: number;
  transportCost: number;
  travellerCount: number;
  label: string;
}): BudgetSummary {
  const { specified, dailyCost, tripDays, transportCost, travellerCount, label } = params;

  const bAccommodation = Math.round(dailyCost.accommodation * tripDays);
  const bFood = Math.round(dailyCost.meals * tripDays);
  const bLocalTransport = Math.round(dailyCost.localTransport * tripDays);
  const bMisc = Math.round(dailyCost.misc * tripDays);
  const bIntercityTransport = Math.round(transportCost * 2);

  const estimatedTotal = bAccommodation + bFood + bLocalTransport + bMisc + bIntercityTransport;
  const perPerson = specified > 0 ? Math.round(specified / travellerCount) : 0;
  const remainingBudget = specified > 0 ? Math.max(0, specified - estimatedTotal) : 0;
  const feasible = specified === 0 || specified >= estimatedTotal;
  const shortfall = specified > 0 ? Math.max(0, estimatedTotal - specified) : 0;

  return {
    specified,
    estimatedTotal,
    estimatedDays: tripDays,
    tripDays,
    perPerson,
    breakdown: {
      accommodation: bAccommodation,
      food: bFood,
      localTransport: bLocalTransport,
      intercityTransport: bIntercityTransport,
      misc: bMisc,
      label,
    },
    dailyCost,
    transportCost,
    remainingBudget,
    feasible,
    shortfall,
  };
}

export async function computeBudget(input: {
  destinationName: string;
  destinationLat: number;
  destinationLon: number;
  altitude: number | null;
  startDate: string;
  endDate: string;
  budgetNPR: number;
  travellerCount: number;
  travelStyle: TravelStyle;
  vehicle: VehicleType;
  origin: GeoPoint | null;
  signal?: AbortSignal;
}): Promise<BudgetSummary> {
  const tripDays = computeTripDays(input.startDate, input.endDate);
  const dailyCost = computeLivingCost(input.destinationName, input.altitude, input.travelStyle);

  let transportCost = 0;
  if (input.origin) {
    const dest: GeoPoint = { lat: input.destinationLat, lon: input.destinationLon };
    const result = await computeTransportCost(input.origin, dest, input.vehicle, input.signal);
    transportCost = result.oneWayCost;
  }

  return computeBudgetSummary({
    specified: input.budgetNPR,
    dailyCost,
    tripDays,
    transportCost,
    travellerCount: input.travellerCount,
    label: getCostLabel(input.destinationName, input.altitude),
  });
}
