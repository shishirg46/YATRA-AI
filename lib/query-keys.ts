export const planKeys = {
  all: ["plan"] as const,
  analysis: (destinationId: string, startDate: string, endDate: string) =>
    ["plan", "analysis", destinationId, startDate, endDate] as const,
};
