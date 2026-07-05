const numberFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 1,
});

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "NPR",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const relativeFormatter = new Intl.RelativeTimeFormat("en-IN", {
  numeric: "auto",
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return String(value);
  return dateFormatter.format(d);
}

export function formatDistance(value: number): string {
  if (value < 1) return `${Math.round(value * 1000)} m`;
  return `${formatNumber(value)} km`;
}

export function formatTemperature(value: number): string {
  return `${Math.round(value)}°C`;
}

export function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatRelativeTime(minutes: number): string {
  if (minutes < 60) return relativeFormatter.format(-Math.round(minutes), "minutes");
  if (minutes < 1440) return relativeFormatter.format(-Math.round(minutes / 60), "hours");
  return relativeFormatter.format(-Math.round(minutes / 1440), "days");
}

export const formatters: Record<string, (value: string | number) => string> = {
  number: (v) => formatNumber(Number(v)),
  currency: (v) => formatCurrency(Number(v)),
  distance: (v) => formatDistance(Number(v)),
  temperature: (v) => formatTemperature(Number(v)),
  percentage: (v) => formatPercentage(Number(v)),
  date: (v) => formatDate(String(v)),
  relative: (v) => formatRelativeTime(Number(v)),
};
