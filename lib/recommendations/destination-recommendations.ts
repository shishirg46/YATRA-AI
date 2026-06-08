import type { Destination, UserProfile } from "@/app/dashboard/_components/types";

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
    safe: boolean;
    accessible: boolean;
    partiallyAccessible: boolean;
    preference: boolean;
    nearby: boolean;
    distanceKm: number | null;
  };
};

const TIERS: RecommendationTier[] = [
  { id: 1, label: "Best possible recommendation", reason: "Safe, accessible, preference match, and nearby." },
  { id: 2, label: "Highly suitable", reason: "Safe, accessible, and matches your preferences." },
  { id: 3, label: "Reliable nearby option", reason: "Safe, accessible, and close to your origin." },
  { id: 4, label: "Minor warnings only", reason: "Safe, preference-aligned, nearby, with minor access warnings." },
  { id: 5, label: "Good fallback", reason: "Safe and nearby, with minor access warnings." },
  { id: 6, label: "Limited safety confidence", reason: "Accessible, nearby, and preference-aligned with no known major danger." },
  { id: 7, label: "Open nearby route", reason: "Accessible and nearby with no known major danger." },
  { id: 8, label: "Interest match nearby", reason: "Matches your interests and is nearby, but route-quality data is limited." },
  { id: 9, label: "Preference fallback", reason: "Matches your preferences; shown only when stronger options are unavailable." },
  { id: 10, label: "Nearby fallback", reason: "Nearby option; shown only when stronger options are unavailable." },
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
  trekking: ["trek", "trekking", "mountain", "hill", "camp", "trail", "himal", "village"],
  hiking: ["trek", "hiking", "hill", "mountain", "trail", "viewpoint"],
  adventure: ["mountain", "trek", "camp", "waterfall", "trail", "viewpoint"],
  cultural: ["culture", "cultural", "heritage", "temple", "monastery", "gumba", "palace"],
  heritage: ["heritage", "temple", "monastery", "gumba", "palace", "historic"],
  religious: ["religious", "temple", "monastery", "gumba", "sacred"],
  spiritual: ["spiritual", "temple", "monastery", "gumba", "sacred"],
  nature: ["nature", "lake", "forest", "waterfall", "riverside", "hill", "wildlife"],
  wildlife: ["wildlife", "forest", "national park", "reserve", "jungle"],
  relaxing: ["lake", "viewpoint", "riverside", "settlement", "tourist"],
  family: ["lake", "temple", "tourist", "viewpoint", "municipality"],
  solo: ["tourist", "lake", "temple", "viewpoint", "settlement"],
};

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

function getSearchText(destination: Destination) {
  return normalize([
    destination.name,
    destination.district,
    destination.province,
    destination.category,
    ...(destination.tags ?? []),
    ...destination.reasoning,
    ...(destination.routeRisk?.decisionTrace?.reasoning ?? []),
  ].join(" "));
}

function matchesPreference(destination: Destination, profile: UserProfile | null) {
  const preferences = [
    ...(profile?.preference?.interests ?? []),
    ...(profile?.preference?.travelStyle ?? []),
  ].map(normalize).filter(Boolean);

  if (preferences.length === 0) return false;

  const searchText = getSearchText(destination);
  return preferences.some((preference) => {
    if (searchText.includes(preference)) return true;
    return (PREFERENCE_KEYWORDS[preference] ?? []).some((keyword) => searchText.includes(keyword));
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

export function isHardFilteredRecommendation(destination: Destination) {
  if (destination.safetyLevel === "HIGH_RISK" || destination.safetyLevel === "EXTREME") return true;
  if (destination.routeRisk?.routeRiskLevel === "HIGH_RISK" || destination.routeRisk?.routeRiskLevel === "EXTREME") return true;
  if (destination.recommendationMeta?.closedOrRestricted || destination.recommendationMeta?.unavailablePermit) return true;

  const routeText = normalize(destination.routeRisk?.decisionTrace?.reasoning?.join(" ") ?? "");
  return HARD_FILTER_TERMS.some((term) => routeText.includes(term));
}

function getTier(signals: RankedDestination["signals"], destination: Destination): RecommendationTier | null {
  const noKnownMajorDanger = destination.safetyLevel === "SAFE" || destination.safetyLevel === "CAUTION";

  if (signals.safe && signals.accessible && signals.preference && signals.nearby) return TIERS[0];
  if (signals.safe && signals.accessible && signals.preference) return TIERS[1];
  if (signals.safe && signals.accessible && signals.nearby) return TIERS[2];
  if (signals.safe && signals.partiallyAccessible && signals.preference && signals.nearby) return TIERS[3];
  if (signals.safe && signals.partiallyAccessible && signals.nearby) return TIERS[4];
  if (noKnownMajorDanger && signals.accessible && signals.preference && signals.nearby) return TIERS[5];
  if (noKnownMajorDanger && signals.accessible && signals.nearby) return TIERS[6];
  if (noKnownMajorDanger && signals.preference && signals.nearby) return TIERS[7];
  if (noKnownMajorDanger && signals.preference) return TIERS[8];
  if (noKnownMajorDanger && signals.nearby) return TIERS[9];
  return null;
}

function tieBreakerScore(destination: Destination, profile: UserProfile | null, distanceKm: number | null) {
  let score = destination.safetyScore;
  score += destination.routeRisk?.routeRiskScore ? destination.routeRisk.routeRiskScore * 0.45 : 25;
  score += destination.verified ? 10 : 0;
  score += destination.dataQualityScore ? Math.min(destination.dataQualityScore, 100) * 0.08 : 0;
  score += destination.confidence ? destination.confidence * 0.05 : 0;
  if (distanceKm != null) score += Math.max(0, 35 - distanceKm / 4);

  const health = profile?.health;
  if (health?.mobilityLimited && destination.routeAccessible === false) score -= 50;
  if (health?.fitnessLevel === "LOW" && destination.altitude && destination.altitude > 1800) score -= 30;
  if (health?.chronicConditions?.some((c) => ["asthma", "heart", "hypertension"].includes(c))) {
    if (destination.altitude && destination.altitude > 2500) score -= 35;
  }

  return score;
}

export function rankRecommendedDestinations(
  destinations: Destination[],
  profile: UserProfile | null,
): RankedDestination[] {
  return destinations
    .filter((destination) => !isHardFilteredRecommendation(destination))
    .map((destination) => {
      const routeLevel = destination.routeRisk?.routeRiskLevel;
      const distanceKm = distanceFromProfile(destination, profile);
      const safe = destination.safetyLevel === "SAFE";
      const accessible = destination.routeAccessible !== false && (!routeLevel || routeLevel === "SAFE");
      const partiallyAccessible =
        !accessible &&
        (destination.routeAccessible !== false || routeLevel === "SAFE" || routeLevel === "CAUTION") &&
        (!routeLevel || routeLevel === "CAUTION" || routeLevel === "SAFE");
      const preference = matchesPreference(destination, profile);
      const nearby = isNearby(destination, profile, distanceKm);
      const signals = { safe, accessible, partiallyAccessible, preference, nearby, distanceKm };
      const tier = getTier(signals, destination);
      if (!tier) return null;

      return {
        destination,
        signals,
        tier,
        score: (11 - tier.id) * 1000 + tieBreakerScore(destination, profile, distanceKm),
      };
    })
    .filter((item): item is RankedDestination => item !== null)
    .sort((a, b) => b.score - a.score);
}

export function recommendationSortScore(destination: Destination, profile: UserProfile | null) {
  if (isHardFilteredRecommendation(destination)) return -100_000 + destination.safetyScore;
  return rankRecommendedDestinations([destination], profile)[0]?.score ?? destination.safetyScore;
}
