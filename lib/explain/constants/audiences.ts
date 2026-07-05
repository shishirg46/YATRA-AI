export const AUDIENCES = ["TRAVELER", "PROFESSIONAL", "EMERGENCY"] as const;

export const AUDIENCE_LABELS: Record<string, string> = {
  TRAVELER: "General Traveler",
  PROFESSIONAL: "Professional / Guide",
  EMERGENCY: "Emergency Services",
};
