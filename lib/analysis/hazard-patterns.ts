import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";

export interface HistoricPattern {
  type: "flood" | "landslide";
  total: number;
  monsoon: number;
  dry: number;
}

export interface RealtimeRisk {
  severity: "HIGH";
  reasons: string[];
}

export interface HistoricRisk {
  severity: "HIGH" | "MEDIUM" | "LOW";
  patterns: HistoricPattern[];
}

export interface SegmentHazardPattern {
  realtime?: RealtimeRisk;
  historic?: HistoricRisk;
  terrain: "Terai" | "Hill" | "Mountain";
  season: "Monsoon" | "Dry";
}

export interface SegmentHazardInput {
  index: number;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  floodIndex: number;
  landslideIndex: number;
  rainfall: number;
}

function classifyTerrain(lat: number): "Terai" | "Hill" | "Mountain" {
  if (lat < 27.0) return "Terai";
  if (lat < 28.2) return "Hill";
  return "Mountain";
}

function isMonsoon(date: Date): boolean {
  const m = date.getMonth();
  return m >= 5 && m <= 8;
}

function currentSeason(): "Monsoon" | "Dry" {
  return isMonsoon(new Date()) ? "Monsoon" : "Dry";
}

const HISTORIC_THRESHOLDS = {
  HIGH: 8,
  MEDIUM: 4,
} as const;

export function computeRealtimeRisk(
  segment: SegmentHazardInput,
  recentEvents = 0,
): RealtimeRisk | undefined {
  const reasons: string[] = [];

  if (segment.floodIndex > 0.75) {
    reasons.push(`Flood index ${Math.round(segment.floodIndex * 100)}%`);
  }
  if (segment.landslideIndex > 0.75) {
    reasons.push(`Landslide index ${Math.round(segment.landslideIndex * 100)}%`);
  }
  if (segment.rainfall > 40) {
    reasons.push(`Heavy rainfall ${segment.rainfall}mm/h`);
  }
  if (recentEvents >= 2) {
    reasons.push(`${recentEvents} recent disaster events nearby (last 30 days)`);
  }

  if (reasons.length > 0) {
    return { severity: "HIGH", reasons };
  }
  return undefined;
}

export async function fetchSegmentHistoricPatterns(
  segments: SegmentHazardInput[],
  radiusKm = 5,
): Promise<Map<number, HistoricRisk | undefined>> {
  if (segments.length === 0) return new Map();

  const allPoints = segments.flatMap((s) => [
    { lat: s.fromLat, lon: s.fromLon },
    { lat: s.toLat, lon: s.toLon },
  ]);

  const deg = radiusKm / 111;
  const latMin = Math.min(...allPoints.map((p) => p.lat)) - deg;
  const latMax = Math.max(...allPoints.map((p) => p.lat)) + deg;
  const lonMin = Math.min(...allPoints.map((p) => p.lon)) - deg;
  const lonMax = Math.max(...allPoints.map((p) => p.lon)) + deg;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ type: string; lat: number; lon: number; date: Date }>
  >(
    `SELECT type, lat, lon, date
     FROM yatra_disaster_events
     WHERE date >= '2020-01-01'
       AND type IN ('flood','landslide')
       AND lat BETWEEN $1 AND $2
       AND lon BETWEEN $3 AND $4`,
    latMin,
    latMax,
    lonMin,
    lonMax,
  );

  const midpoints = segments.map((s) => ({
    index: s.index,
    lat: (s.fromLat + s.toLat) / 2,
    lon: (s.fromLon + s.toLon) / 2,
  }));

  function nearestSegmentIndex(
    lat: number,
    lon: number,
  ): number | null {
    let best: number | null = null;
    let bestDist = radiusKm;
    for (const m of midpoints) {
      const d = haversineKm(lat, lon, m.lat, m.lon);
      if (d < bestDist) {
        bestDist = d;
        best = m.index;
      }
    }
    return best;
  }

  type AccKey = string;
  const acc = new Map<
    AccKey,
    { type: "flood" | "landslide"; monsoon: number; dry: number; total: number }
  >();

  for (const row of rows) {
    const segIdx = nearestSegmentIndex(row.lat, row.lon);
    if (segIdx === null) continue;

    const type = row.type === "landslide" ? "landslide" : "flood";
    const key = `${segIdx}|${type}`;

    let entry = acc.get(key);
    if (!entry) {
      entry = { type, monsoon: 0, dry: 0, total: 0 };
      acc.set(key, entry);
    }
    entry.total++;
    if (isMonsoon(row.date)) {
      entry.monsoon++;
    } else {
      entry.dry++;
    }
  }

  const result = new Map<number, HistoricRisk | undefined>();

  for (const seg of segments) {
    const patterns: HistoricPattern[] = [];
    for (const [key, data] of acc) {
      const [segIdx] = key.split("|");
      if (Number(segIdx) !== seg.index) continue;
      patterns.push(data);
    }

    if (patterns.length === 0) {
      result.set(seg.index, undefined);
      continue;
    }

    const totalIncidents = patterns.reduce((s, p) => s + p.total, 0);
    let severity: "HIGH" | "MEDIUM" | "LOW";
    if (totalIncidents >= HISTORIC_THRESHOLDS.HIGH) {
      severity = "HIGH";
    } else if (totalIncidents >= HISTORIC_THRESHOLDS.MEDIUM) {
      severity = "MEDIUM";
    } else {
      severity = "LOW";
    }

    result.set(seg.index, { severity, patterns });
  }

  return result;
}

export async function fetchRecentSegmentEvents(
  segments: SegmentHazardInput[],
  radiusKm = 5,
): Promise<Map<number, number>> {
  if (segments.length === 0) return new Map();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const allPoints = segments.flatMap((s) => [
    { lat: s.fromLat, lon: s.fromLon },
    { lat: s.toLat, lon: s.toLon },
  ]);

  const deg = radiusKm / 111;
  const latMin = Math.min(...allPoints.map((p) => p.lat)) - deg;
  const latMax = Math.max(...allPoints.map((p) => p.lat)) + deg;
  const lonMin = Math.min(...allPoints.map((p) => p.lon)) - deg;
  const lonMax = Math.max(...allPoints.map((p) => p.lon)) + deg;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ type: string; lat: number; lon: number; date: Date }>
  >(
    `SELECT type, lat, lon, date
     FROM yatra_disaster_events
     WHERE date >= $1
       AND type IN ('flood','landslide')
       AND lat BETWEEN $2 AND $3
       AND lon BETWEEN $4 AND $5`,
    thirtyDaysAgo,
    latMin,
    latMax,
    lonMin,
    lonMax,
  );

  const midpoints = segments.map((s) => ({
    index: s.index,
    lat: (s.fromLat + s.toLat) / 2,
    lon: (s.fromLon + s.toLon) / 2,
  }));

  const counts = new Map<number, number>();
  for (const seg of segments) {
    counts.set(seg.index, 0);
  }

  for (const row of rows) {
    let bestIdx: number | null = null;
    let bestDist = radiusKm;
    for (const m of midpoints) {
      const d = haversineKm(row.lat, row.lon, m.lat, m.lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = m.index;
      }
    }
    if (bestIdx !== null) {
      counts.set(bestIdx, (counts.get(bestIdx) ?? 0) + 1);
    }
  }

  return counts;
}

export function buildSegmentHazardPattern(
  segment: SegmentHazardInput,
  historic: HistoricRisk | undefined,
  recentEvents = 0,
): SegmentHazardPattern {
  const terrain = classifyTerrain((segment.fromLat + segment.toLat) / 2);
  const season = currentSeason();
  const realtime = computeRealtimeRisk(segment, recentEvents);

  return {
    realtime,
    historic,
    terrain,
    season,
  };
}
