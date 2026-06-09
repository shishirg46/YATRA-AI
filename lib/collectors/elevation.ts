import { openMeteoFetch } from "./open-meteo-client";

export async function fetchElevationBatch(
  points: { lat: number; lon: number }[]
): Promise<(number | null)[]> {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.lat.toFixed(5)).join(",");
  const lons = points.map((p) => p.lon.toFixed(5)).join(",");
  const res = await openMeteoFetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`
  );
  if (!res?.ok) return points.map(() => null);
  const data = await res.json();
  return data?.elevation ?? points.map(() => null);
}
