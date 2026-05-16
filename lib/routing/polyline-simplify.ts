import { haversineKm } from "@/lib/routing/geo";

export type LatLon = { lat: number; lon: number };

/** Douglas–Peucker simplification (tolerance in km). */
export function simplifyPolyline(points: LatLon[], toleranceKm = 0.5): LatLon[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistanceKm(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > toleranceKm) {
    const left = simplifyPolyline(points.slice(0, maxIdx + 1), toleranceKm);
    const right = simplifyPolyline(points.slice(maxIdx), toleranceKm);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function perpendicularDistanceKm(p: LatLon, a: LatLon, b: LatLon): number {
  const dAB = haversineKm(a.lat, a.lon, b.lat, b.lon);
  if (dAB < 0.001) return haversineKm(p.lat, p.lon, a.lat, a.lon);

  const dAP = haversineKm(a.lat, a.lon, p.lat, p.lon);
  const dBP = haversineKm(b.lat, b.lon, p.lat, p.lon);
  const cosA = (dAP * dAP + dAB * dAB - dBP * dBP) / (2 * Math.max(dAP, 0.001) * Math.max(dAB, 0.001));
  const t = Math.max(0, Math.min(1, cosA));
  const proj = t * dAB;
  return Math.sqrt(Math.max(0, dAP * dAP - proj * proj));
}

/** Cap point count by uniform sampling — keeps first/last. */
export function decimatePolyline(points: LatLon[], maxPoints = 120): LatLon[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const out: LatLon[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(points.length - 1, Math.round(i * step));
    out.push(points[idx]);
  }
  return out;
}

/** Simplify then decimate for map payloads. */
export function prepareMapPolyline(
  points: LatLon[],
  options?: { toleranceKm?: number; maxPoints?: number }
): LatLon[] {
  if (points.length < 3) return points;
  const tolerance = options?.toleranceKm ?? 0.4;
  const maxPoints = options?.maxPoints ?? 100;
  return decimatePolyline(simplifyPolyline(points, tolerance), maxPoints);
}
