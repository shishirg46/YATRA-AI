export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}

/**
 * Distance from point (px, py) in projected meter space to
 * the line segment from (ax, ay) to (bx, by).
 */
export function pointToSegmentDistM(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);

  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/**
 * Initial bearing from point1 to point2 (degrees, 0–360).
 * Uses haversine formula. 0 = north, 90 = east, 180 = south, 270 = west.
 */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return ((brng % 360) + 360) % 360;
}

export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Check if a coordinate is within Nepal's bounding box
 */
export function isPointInNepal(lat: number, lon: number): boolean {
  // Nepal bounding box: Lat [26.3, 30.5], Lon [80.0, 88.2]
  return lat >= 26.3 && lat <= 30.5 && lon >= 80.0 && lon <= 88.2;
}

/**
 * Thrown when a routing request is outside the supported Nepal region.
 * Used to prevent routing fallbacks that cannot succeed.
 */
export class UnsupportedRegionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRegionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Approximate cross-track distance from point P to segment AB (km). */
export function distanceToSegmentKm(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const dAB = haversineKm(aLat, aLon, bLat, bLon);
  if (dAB < 0.01) return haversineKm(pLat, pLon, aLat, aLon);

  const dAP = haversineKm(aLat, aLon, pLat, pLon);
  const dBP = haversineKm(bLat, bLon, pLat, pLon);

  // Law of cosines on sphere approximation for projection
  const cosA =
    (dAP * dAP + dAB * dAB - dBP * dBP) / (2 * Math.max(dAP, 0.001) * Math.max(dAB, 0.001));
  const t = Math.max(0, Math.min(1, cosA));
  const projDist = t * dAB;
  const along = Math.sqrt(Math.max(0, dAP * dAP - projDist * projDist));
  return along;
}

export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const aWords = na.split(" ");
  const bWords = nb.split(" ");
  const overlap = aWords.filter((w) => w.length > 2 && bWords.includes(w)).length;
  return overlap / Math.max(aWords.length, bWords.length, 1);
}

/**
 * Resample a polyline into evenly-spaced points at `intervalMeters` intervals.
 * Uses linear interpolation between original waypoints.
 */
export function resamplePolyline(
  points: { lat: number; lon: number }[],
  intervalMeters: number
): { lat: number; lon: number }[] {
  if (points.length < 2) return [...points];
  const result: { lat: number; lon: number }[] = [{ ...points[0] }];
  let accumulated = 0;
  for (let i = 1; i < points.length; i++) {
    const segDist =
      haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon) * 1000;
    if (segDist === 0) continue;
    accumulated += segDist;
    if (accumulated >= intervalMeters) {
      const frac = 1 - (accumulated - intervalMeters) / segDist;
      result.push({
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * frac,
        lon: points[i - 1].lon + (points[i].lon - points[i - 1].lon) * frac,
      });
      accumulated = 0;
    }
  }
  const last = points[points.length - 1];
  const lastR = result[result.length - 1];
  if (lastR.lat !== last.lat || lastR.lon !== last.lon) result.push({ ...last });
  return result;
}
