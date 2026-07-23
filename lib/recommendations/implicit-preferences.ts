export type BehaviorMetrics = Record<string, any>;

export interface ImplicitPreferences {
  implicitInterests: Set<string>;
  categoryWeights: Record<string, number>;
  altitudePreference: "HIGH" | "LOW" | "NONE";
  topCategories: string[];
}

const CATEGORY_TO_INTERESTS: Record<string, string[]> = {
  VIEWPOINT: ["hiking", "nature"],
  TREKKING_VILLAGE: ["trekking", "hiking", "adventure"],
  LAKE: ["nature", "relaxing"],
  HILL: ["hiking", "nature", "adventure"],
  MOUNTAIN: ["trekking", "adventure", "nature"],
  TOURIST_ATTRACTION: ["cultural", "heritage"],
  MUNICIPALITY: ["cultural"],
  CHOWK: ["cultural"],
  TEMPLE: ["religious", "cultural", "heritage", "spiritual"],
  RIVERSIDE: ["nature", "relaxing"],
  FOREST: ["nature", "wildlife"],
  WATERFALL: ["nature", "adventure"],
  CAMP: ["trekking", "adventure"],
  MOUNTAIN_SETTLEMENT: ["trekking", "hiking", "adventure"],
  OTHER: [],
};

function normalize(v: string) {
  return v.toLowerCase().replace(/[_-]+/g, " ").trim();
}

export function computeImplicitInterests(metrics: BehaviorMetrics | null | undefined): ImplicitPreferences {
  const result: ImplicitPreferences = {
    implicitInterests: new Set<string>(),
    categoryWeights: {},
    altitudePreference: "NONE",
    topCategories: [],
  };

  if (!metrics) return result;

  const categories: Record<string, number> = metrics.categories ?? {};
  const destinations: Record<string, number> = metrics.destinations ?? {};

  const totalClicks = Object.values(categories).reduce((s, c) => s + c, 0);
  if (totalClicks === 0) return result;

  const weightedInterests = new Map<string, number>();

  for (const [cat, count] of Object.entries(categories)) {
    if (count <= 0) continue;
    const weight = Math.min(count / 3, 1);
    result.categoryWeights[cat] = weight;

    const interests = CATEGORY_TO_INTERESTS[cat] ?? [];
    for (const interest of interests) {
      weightedInterests.set(interest, (weightedInterests.get(interest) ?? 0) + weight);
    }
  }

  for (const [interest, weight] of weightedInterests) {
    if (weight >= 0.5) {
      result.implicitInterests.add(interest);
    }
  }

  result.topCategories = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  const highAltCategories = categories.MOUNTAIN ?? 0;
  const highAltCount = highAltCategories + (categories.MOUNTAIN_SETTLEMENT ?? 0) + (categories.TREKKING_VILLAGE ?? 0);
  const lowAltCategories = (categories.LAKE ?? 0) + (categories.RIVERSIDE ?? 0) + (categories.FOREST ?? 0);
  const totalRelevant = highAltCount + lowAltCategories;

  if (totalRelevant >= 3) {
    const highFrac = highAltCount / totalRelevant;
    if (highFrac >= 0.6) result.altitudePreference = "HIGH";
    else if (highFrac <= 0.3) result.altitudePreference = "LOW";
  }

  return result;
}
