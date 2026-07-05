export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "EXTREME"] as const;

export const SEVERITY_ORDER: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  EXTREME: 3,
};

export const SEVERITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  EXTREME: "Extreme",
};
