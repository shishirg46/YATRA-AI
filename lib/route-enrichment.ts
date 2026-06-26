// Route enrichment: select key points, reverse-geocode, normalize, dedupe
// Usage: import { enrichRoute } from './lib/route-enrichment'

type CoordPair = [number, number]; // [lon, lat]
import { reverseGeocodeNepal } from "@/lib/routing/nominatim";

type LatLon = { lat: number; lon: number };

function toRadians(deg: number) { return deg * Math.PI / 180; }
function toDegrees(rad: number) { return rad * 180 / Math.PI; }

function haversineMeters(a: LatLon, b: LatLon) {
  const R = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat/2);
  const sinDLon = Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon), Math.sqrt(1 - (sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon)));
  return R * c;
}

function bearingDeg(a: LatLon, b: LatLon) {
  const y = Math.sin(toRadians(b.lon - a.lon)) * Math.cos(toRadians(b.lat));
  const x = Math.cos(toRadians(a.lat))*Math.sin(toRadians(b.lat)) - Math.sin(toRadians(a.lat))*Math.cos(toRadians(b.lat))*Math.cos(toRadians(b.lon - a.lon));
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function titleCase(s: string) {
  return s.split(/\s+/).map(w => w.length ? (w[0].toUpperCase() + w.slice(1).toLowerCase()) : '').join(' ');
}

function normalizePlaceName(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // remove parenthetical content
  s = s.replace(/\s*\(.*?\)\s*/g, ' ');
  // split by commas and prefer the token that looks like a settlement (first token usually)
  const tokens = s.split(',').map(t => t.trim()).filter(Boolean);
  s = tokens[0] || s;
  // remove common suffixes/words
  s = s.replace(/\bmunicipality\b/ig, '');
  s = s.replace(/\bmetropolitan city\b/ig, '');
  s = s.replace(/\bsub-metropolitan\b/ig, '');
  s = s.replace(/\bward\s*\d+\b/ig, '');
  s = s.replace(/\bward\s*[:\-]?\s*\d+\b/ig, '');
  s = s.replace(/\bward\s+no\.\s*\d+\b/ig, '');
  // remove trailing district/state/country fragments like "Jhapa District" or ", Nepal"
  s = s.replace(/,?\s*[^,]*\bDistrict\b.*$/i, '');
  s = s.replace(/,?\s*Province\b.*$/i, '');
  s = s.replace(/,?\s*Nepal\b.*$/i, '');
  // remove street keywords if injected
  s = s.replace(/\broad\b/ig, '');
  s = s.replace(/\bstreet\b/ig, '');
  s = s.replace(/\b(?:lane|st|rd|ave|a?v?\.)\b/ig, '');
  // collapse multiple spaces
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return null;
  return titleCase(s);
}

async function reversePlace(lat: number, lon: number): Promise<string | null> {
  const reverse = await reverseGeocodeNepal(lat, lon);
  return reverse?.shortName ?? null;
}

function selectKeyPointsFromCoords(coords: CoordPair[]): LatLon[] {
  if (!coords || coords.length === 0) return [];
  // convert to LatLon array
  const pts: LatLon[] = coords.map(([lon, lat]) => ({ lat, lon }));
  const selected: LatLon[] = [];
  // always include first
  selected.push(pts[0]);
  let lastIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dSinceLast = haversineMeters(pts[lastIdx], pts[i]);
    // select every ~2km
    if (dSinceLast >= 2000) {
      selected.push(pts[i]);
      lastIdx = i;
      continue;
    }
    // detect noticeable direction change
    if (i > 1) {
      const b1 = bearingDeg(pts[i-1], pts[i]);
      const b0 = bearingDeg(pts[i-2], pts[i-1]);
      const delta = Math.abs(((b1 - b0 + 540) % 360) - 180); // smallest angle
      if (delta > 30 && dSinceLast >= 200) {
        selected.push(pts[i]);
        lastIdx = i;
      }
    }
  }
  // always include last
  if (pts.length > 1) selected.push(pts[pts.length - 1]);
  return selected;
}

export async function enrichRoute(origin: LatLon, destination: LatLon, routeCoords: CoordPair[]) {
  // 1) select key points
  const keyPoints = selectKeyPointsFromCoords(routeCoords);
  // ensure first/last correspond to origin/destination if provided
  if (keyPoints.length === 0 && origin && destination) {
    keyPoints.push(origin, destination);
  }

  // 2) reverse geocode each selected point
  const placesRaw: (string | null)[] = [];
  for (const p of keyPoints) {
    try {
      const place = await reversePlace(p.lat, p.lon);
      placesRaw.push(place);
    } catch (err) {
      placesRaw.push(null);
    }
  }

  // 3) normalize
  const canonical = placesRaw.map(pr => normalizePlaceName(pr));

  // 4) collapse consecutive duplicates (by lowercase canonical)
  const collapsed: { lat: number; lon: number; place: string | null }[] = [];
  for (let i = 0; i < keyPoints.length; i++) {
    const p = keyPoints[i];
    const place = canonical[i] === null ? null : canonical[i];
    const last = collapsed[collapsed.length - 1];
    const thisKey = place ? place.toLowerCase() : null;
    const lastKey = last && last.place ? last.place.toLowerCase() : null;
    if (thisKey === lastKey) {
      // skip duplicate
      continue;
    }
    collapsed.push({ lat: p.lat, lon: p.lon, place });
  }

  // Build final JSON
  const originPlace = collapsed.length ? collapsed[0].place : null;
  const destinationPlace = collapsed.length ? collapsed[collapsed.length - 1].place : null;

  const route = collapsed.map((c, idx) => ({ index: idx, lat: c.lat, lon: c.lon, place: c.place }));

  return { origin: originPlace, destination: destinationPlace, route };
}

export default enrichRoute;
