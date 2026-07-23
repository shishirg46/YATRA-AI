import type { Destination, UserProfile } from "@/app/dashboard/_components/types";
import { computeImplicitInterests } from "@/lib/recommendations/implicit-preferences";

type RecommendationTier = {
  id: number;
  label: string;
  reason: string;
};

type RankedDestination = {
  destination: Destination;
  score: number;
  tier: RecommendationTier;
  signals: {
    preference: boolean;
    health: boolean;
    safe: boolean;
    caution: boolean;
    nearby: boolean;
    popular: boolean;
    distanceKm: number | null;
  };
};

const TIERS: RecommendationTier[] = [
  { id: 1, label: "Best match — preference, health, safe, nearby", reason: "Matches your interests, suitable for your health profile, safe, and close to you." },
  { id: 2, label: "Strong match — preference, health, nearby", reason: "Matches your interests, suitable for your health profile, nearby, with minor safety cautions." },
  { id: 3, label: "Great match — preference, safe, nearby", reason: "Matches your interests, safe, and close to you." },
  { id: 4, label: "Good match — preference, safe", reason: "Matches your interests and is safe to visit." },
  { id: 5, label: "Interest match — caution", reason: "Matches your interests. Moderate risk accepted due to limited safe options." },
  { id: 6, label: "Popular nearby — safe", reason: "Popular destination that is safe and nearby." },
  { id: 7, label: "Popular — safe", reason: "Popular and safe destination." },
  { id: 8, label: "Popular — caution", reason: "Popular destination with moderate risk. Fallback when safer options are unavailable." },
];

const HARD_FILTER_TERMS = [
  "blocked road",
  "blocked route",
  "road blocked",
  "route blocked",
  "closed road",
  "road closed",
  "closed route",
  "route closed",
  "flooded road",
  "road flooded",
  "active flood",
  "active floods",
  "recent flood",
  "recent floods",
  "landslide-affected",
  "active landslide",
  "active landslides",
  "recent landslide",
  "recent landslides",
  "danger alert",
  "active alert",
  "do not travel",
];

const PREFERENCE_KEYWORDS: Record<string, string[]> = {
  trekking: ["trek", "trekking", "mountain", "hill", "camp", "trail", "himal"],
  hiking: ["trek", "hiking", "hill", "mountain", "trail", "viewpoint"],
  adventure: ["mountain", "trek", "camp", "waterfall", "trail", "viewpoint"],
  cultural: ["culture", "cultural", "heritage", "temple", "monastery", "gumba", "palace"],
  heritage: ["heritage", "temple", "monastery", "gumba", "palace", "historic"],
  religious: ["religious", "temple", "monastery", "gumba", "sacred"],
  spiritual: ["spiritual", "temple", "monastery", "gumba", "sacred"],
  nature: ["nature", "lake", "forest", "waterfall", "riverside", "hill", "wildlife"],
  wildlife: ["wildlife", "forest", "national park", "reserve", "jungle"],
  relaxing: ["lake", "viewpoint", "riverside"],
  family: ["lake", "temple", "viewpoint"],
  solo: ["lake", "temple", "viewpoint"],
};

/** Minimum popularity score to qualify as "popular" for lower tiers */
const POPULAR_THRESHOLD = 0.5;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radiusKm = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return radiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

type SearchField = "name" | "district" | "province" | "tags" | "reasoning" | "routeRisk";

const SAFETY_BOILERPLATE_PATTERNS = [
  "Trekking — exposed terrain increases landslide and wind risk",
  "Solo travel (×1.2) — no group safety net",
  "High risk tolerance — penalties weighted",
  "Low risk tolerance — penalties weighted",
  "No significant current hazards — conditions appear favourable",
];

const ROUTE_BOILERPLATE_PATTERNS = [
  "flood risk during monsoon trekking",
];

function getSearchField(destination: Destination, field: SearchField): string {
  switch (field) {
    case "name": return normalize(destination.name);
    case "district": return normalize(destination.district);
    case "province": return normalize(destination.province);
    case "tags": return normalize((destination.tags ?? []).join(" "));
    case "reasoning":
      return normalize(
        (destination.reasoning ?? []).filter(
          (r) => !SAFETY_BOILERPLATE_PATTERNS.some((pattern) => r.startsWith(pattern))
        ).join(" ")
      );
    case "routeRisk":
      return normalize(
        (destination.routeRisk?.decisionTrace?.reasoning ?? []).filter(
          (r) => !ROUTE_BOILERPLATE_PATTERNS.some((pattern) => r.includes(pattern))
        ).join(" ")
      );
  }
}

function getSearchText(destination: Destination) {
  return normalize([
    destination.name,
    destination.district,
    destination.province,
    ...(destination.tags ?? []),
    ...(destination.reasoning ?? []).filter(
      (r) => !SAFETY_BOILERPLATE_PATTERNS.some((pattern) => r.startsWith(pattern))
    ),
    ...(destination.routeRisk?.decisionTrace?.reasoning ?? []).filter(
      (r) => !ROUTE_BOILERPLATE_PATTERNS.some((pattern) => r.includes(pattern))
    ),
  ].join(" "));
}

function fieldMatchesPreference(fieldText: string, preference: string): boolean {
  if (fieldText.includes(preference)) return true;
  return (PREFERENCE_KEYWORDS[preference] ?? []).some((keyword) => fieldText.includes(keyword));
}

function matchesPreference(destination: Destination, profile: UserProfile | null, implicitInterests?: Set<string>) {
  const explicitPrefs = [
    ...(profile?.preference?.interests ?? []),
    ...(profile?.preference?.travelStyle ?? []),
  ].map(normalize).filter(Boolean);

  const allInterests = [...new Set([
    ...explicitPrefs,
    ...(implicitInterests ? [...implicitInterests].map(normalize) : []),
  ])];

  if (allInterests.length === 0) return false;

  const searchText = getSearchText(destination);
  return allInterests.some((preference) => {
    if (!searchText.includes(preference) &&
        !(PREFERENCE_KEYWORDS[preference] ?? []).some((keyword) => searchText.includes(keyword))) {
      return false;
    }

    const fields: SearchField[] = ["name", "tags", "reasoning", "district", "routeRisk"];
    const matchCount = fields.filter((field) =>
      fieldMatchesPreference(getSearchField(destination, field), preference)
    ).length;

    return matchCount >= 2;
  });
}

function distanceFromProfile(destination: Destination, profile: UserProfile | null) {
  const lat = profile?.preference?.locationLat;
  const lon = profile?.preference?.locationLng;
  if (lat == null || lon == null || destination.latitude == null || destination.longitude == null) {
    return null;
  }
  return haversineKm(lat, lon, destination.latitude, destination.longitude);
}

function isNearby(destination: Destination, profile: UserProfile | null, distanceKm: number | null) {
  if (distanceKm != null) {
    const preferredMax = profile?.preference?.maxDistanceKm;
    return distanceKm <= (preferredMax && preferredMax > 0 ? preferredMax : 120);
  }

  return !!profile?.homeLocation?.province && destination.province === profile.homeLocation.province;
}

/**
 * Health signal: only true when explicit health data exists AND
 * the destination is appropriate for the user's health profile.
 * If no health data, returns false (health-requiring tiers are skipped).
 */
function getHealthSignal(destination: Destination, profile: UserProfile | null): boolean {
  const health = profile?.health;
  if (!health) return false;

  if (health.mobilityLimited && destination.routeAccessible === false) return false;
  if (health.fitnessLevel === "LOW" && (destination.altitude ?? 0) > 1800) return false;
  if (health.chronicConditions?.some((c) => ["asthma", "heart", "hypertension"].includes(c))) {
    if (destination.altitude && destination.altitude > 2500) return false;
  }

  return true;
}

function getPopularSignal(destination: Destination): boolean {
  return (destination.popularityScore ?? 0) > POPULAR_THRESHOLD;
}

export function isHardFilteredRecommendation(destination: Destination) {
  if (destination.safetyLevel === "HIGH_RISK" || destination.safetyLevel === "EXTREME") return true;
  if (destination.routeRisk?.routeRiskLevel === "HIGH_RISK" || destination.routeRisk?.routeRiskLevel === "EXTREME") return true;
  if (destination.recommendationMeta?.closedOrRestricted || destination.recommendationMeta?.unavailablePermit) return true;

  const routeText = normalize(destination.routeRisk?.decisionTrace?.reasoning?.join(" ") ?? "");
  return HARD_FILTER_TERMS.some((term) => routeText.includes(term));
}

/**
 * 8-tier priority system:
 *
 *  1. Preference + Health + Safe      + Nearby   (highest)
 *  2. Preference + Health + Caution    + Nearby
 *  3. Preference           + Safe      + Nearby
 *  4. Preference           + Safe
 *  5. Preference           + Caution
 *  6. Popular              + Safe      + Nearby
 *  7. Popular              + Safe
 *  8. Popular              + Caution              (lowest)
 */
function getTier(signals: RankedDestination["signals"], destination: Destination): RecommendationTier | null {
  const { preference, health, safe, caution, nearby, popular } = signals;

  if (preference && health && safe && nearby) return TIERS[0];
  if (preference && health && caution && nearby) return TIERS[1];
  if (preference && safe && nearby) return TIERS[2];
  if (preference && safe) return TIERS[3];
  if (preference && caution) return TIERS[4];
  if (popular && safe && nearby) return TIERS[5];
  if (popular && safe) return TIERS[6];
  if (popular && caution) return TIERS[7];

  return null;
}

const TERRAIN_INTERESTS = new Set(["trekking", "hiking", "adventure", "nature", "wildlife"]);
const LOWLAND_INTERESTS = new Set(["relaxing", "family"]);

function tieBreakerScore(destination: Destination, profile: UserProfile | null, distanceKm: number | null, categoryWeights?: Record<string, number>) {
  let score = destination.safetyScore;
  score += destination.routeRisk?.routeRiskScore ? destination.routeRisk.routeRiskScore * 0.45 : 25;
  score += destination.verified ? 10 : 0;
  score += destination.dataQualityScore ? Math.min(destination.dataQualityScore, 100) * 0.08 : 0;
  score += destination.confidence ? destination.confidence * 0.05 : 0;
  if (distanceKm != null) score += Math.max(0, 35 - distanceKm / 4);

  // Implicit category affinity boost
  if (categoryWeights && destination.category) {
    const catWeight = categoryWeights[destination.category] ?? 0;
    if (catWeight > 0) {
      score += catWeight * 15;
    }
  }

  const altitude = destination.altitude ?? 0;
  const interests = new Set((profile?.preference?.interests ?? []).map(normalize));

  if (altitude > 0) {
    const hasTerrainInterest = [...interests].some((i) => TERRAIN_INTERESTS.has(i));
    const hasLowlandInterest = [...interests].some((i) => LOWLAND_INTERESTS.has(i));

    if (hasTerrainInterest && !hasLowlandInterest) {
      score += Math.min(altitude / 100, 30);
    }
    if (hasLowlandInterest && !hasTerrainInterest) {
      if (altitude < 500) score += 10;
    }
  }

  const health = profile?.health;
  if (health?.mobilityLimited && destination.routeAccessible === false) score -= 50;
  if (health?.fitnessLevel === "LOW" && altitude > 1800) score -= 30;
  if (health?.chronicConditions?.some((c) => ["asthma", "heart", "hypertension"].includes(c))) {
    if (altitude > 2500) score -= 35;
  }

  return score;
}

export function rankRecommendedDestinations(
  destinations: Destination[],
  profile: UserProfile | null,
): RankedDestination[] {
  const implicit = computeImplicitInterests(profile?.behavior?.metrics);

  return destinations
    .filter((destination) => !isHardFilteredRecommendation(destination))
    .map((destination) => {
      const distanceKm = distanceFromProfile(destination, profile);
      const safe = destination.safetyLevel === "SAFE";
      const caution = destination.safetyLevel === "CAUTION";
      const preference = matchesPreference(destination, profile, implicit.implicitInterests);
      const health = getHealthSignal(destination, profile);
      const nearby = isNearby(destination, profile, distanceKm);
      const popular = getPopularSignal(destination);

      const signals = { preference, health, safe, caution, nearby, popular, distanceKm };
      const tier = getTier(signals, destination);
      if (!tier) return null;

      return {
        destination,
        signals,
        tier,
        score: (8 - tier.id) * 1000 + tieBreakerScore(destination, profile, distanceKm, implicit.categoryWeights),
      };
    })
    .filter((item): item is RankedDestination => item !== null)
    .sort((a, b) => b.score - a.score);
}

export function recommendationSortScore(destination: Destination, profile: UserProfile | null) {
  if (isHardFilteredRecommendation(destination)) return -100_000 + destination.safetyScore;
  const ranked = rankRecommendedDestinations([destination], profile);
  if (ranked.length > 0) return ranked[0].score;

  const hasPref = (profile?.preference?.interests?.length ?? 0) > 0;
  if (hasPref) return -50_000 + destination.safetyScore;

  return destination.safetyScore;
}
