export type DisasterType =
  | "earthquake"
  | "flood"
  | "landslide"
  | "storm"
  | "accident"
  | "fire"
  | "avalanche"
  | "other";

export const TYPE_PATTERNS: Record<Exclude<DisasterType, "other">, string[]> = {
  flood:      ["flood", "inundation", "flash flood", "बाढी"],
  landslide:  ["landslide", "debris flow", "पहिरो"],
  earthquake: ["earthquake", "aftershock", "भूकम्प"],
  storm:      ["storm", "thunderstorm", "cyclone", "hail", "तुफान"],
  accident:   ["road accident", "accident", "दुर्घटना"],
  fire:       ["fire", "आगो"],
  avalanche:  ["avalanche", "snow avalanche", "हिमपहिरो"],
};
