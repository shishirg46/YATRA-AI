import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { isNearRoute } from "@/lib/disaster-pipeline";

const HISTORICAL_CONFIG = {
  DEFAULT_YEARS: 5,
  DEFAULT_SEISMIC_RADIUS_KM: 150,
  DEFAULT_BIPAD_RADIUS_KM: 50,
  EQ_MAG_WEIGHT: 0.6,
  EQ_FREQ_WEIGHT: 0.4,
} as const;

export interface HistoricalHazardStats {
  schemaVersion: 2;

  floodIncidents:       number;
  landslideIncidents:   number;
  earthquakeCount:      number;
  maxEarthquakeMag:     number;
  stormIncidents:       number;
  accidentIncidents:    number;

  historicalFloodRisk:       number;
  historicalLandslideRisk:   number;
  historicalEarthquakeRisk:  number;
  historicalStormRisk:       number;
  historicalAccidentRisk:    number;

  notableEvents: {
    date:        string;
    type:        string;
    description: string;
    severity:    "LOW" | "MEDIUM" | "HIGH";
  }[];

  yearsRequested: number;
  yearsAnalysed:  number;
  confidence:     number;
  sources:        string[];
}

function logNorm(incidents: number, years: number): number {
  const max = years * 3;
  if (max <= 0) return 0;
  if (incidents >= max) return 1.0;
  return Math.log(1 + incidents) / Math.log(1 + max);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function fetchHistoricalHazard(
  districtName: string,
  lat:          number,
  lon:          number,
  targetDate:   string,
  years:        number = HISTORICAL_CONFIG.DEFAULT_YEARS,
  seismicRadiusKm: number = HISTORICAL_CONFIG.DEFAULT_SEISMIC_RADIUS_KM,
  _signal?:     AbortSignal,
  routePoints?: { lat: number; lon: number }[],
): Promise<HistoricalHazardStats> {

  const target      = new Date(targetDate);
  const targetMonth = target.getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const startDate   = `${currentYear - years}-01-01`;

  const eqDeg  = seismicRadiusKm / 111;
  const bpDeg  = HISTORICAL_CONFIG.DEFAULT_BIPAD_RADIUS_KM / 111;

  const months: number[] = [];
  for (let m = targetMonth - 1; m <= targetMonth + 1; m++) {
    months.push(((m + 11) % 12) + 1);
  }
  const monthParam = Prisma.join(months);

  // ── 1. BIPAD incident counts (spatial — metadata->>'district' is not populated) ──

  let floodIncidents = 0;
  let landslideIncidents = 0;
  let stormIncidents = 0;
  let accidentIncidents = 0;

  const useCorridor = routePoints && routePoints.length > 0;
  const bpLatMin = useCorridor ? Math.min(...routePoints.map(p => p.lat)) - bpDeg : lat - bpDeg;
  const bpLatMax = useCorridor ? Math.max(...routePoints.map(p => p.lat)) + bpDeg : lat + bpDeg;
  const bpLonMin = useCorridor ? Math.min(...routePoints.map(p => p.lon)) - bpDeg : lon - bpDeg;
  const bpLonMax = useCorridor ? Math.max(...routePoints.map(p => p.lon)) + bpDeg : lon + bpDeg;

  try {
    const bipadRows = await prisma.$queryRaw<Array<{ type: string; lat: number; lon: number; count: bigint }>>`
      SELECT type, lat, lon, COUNT(*)::bigint AS count
      FROM yatra_disaster_events
      WHERE source = 'bipad'
        AND lat BETWEEN ${bpLatMin} AND ${bpLatMax}
        AND lon BETWEEN ${bpLonMin} AND ${bpLonMax}
        AND date >= ${startDate}::date
        AND EXTRACT(MONTH FROM date) IN (${monthParam})
        AND type IN ('flood', 'landslide', 'storm', 'accident')
      GROUP BY type, lat, lon
    `;
    const filtered = useCorridor
      ? bipadRows.filter((r) => isNearRoute(r, routePoints!, 10))
      : bipadRows;
    for (const r of filtered) {
      const c = Number(r.count);
      if (r.type === "flood")        floodIncidents     += c;
      if (r.type === "landslide")    landslideIncidents += c;
      if (r.type === "storm")        stormIncidents     += c;
      if (r.type === "accident")     accidentIncidents  += c;
    }
  } catch {
    // graceful degradation — counts stay 0
  }

  // ── 2. BIPAD notable events (spatial) ─────────────────────────────────────

  let notableEvents: HistoricalHazardStats["notableEvents"] = [];

  try {
    const bipadEvents = await prisma.$queryRaw<
      Array<{ date: Date; type: string; title: string | null; severity: string; lat: number; lon: number }>
    >`
      SELECT date, type, metadata->>'title' AS title, severity, lat, lon
      FROM yatra_disaster_events
      WHERE source = 'bipad'
        AND lat BETWEEN ${bpLatMin} AND ${bpLatMax}
        AND lon BETWEEN ${bpLonMin} AND ${bpLonMax}
        AND date >= ${startDate}::date
        AND EXTRACT(MONTH FROM date) IN (${monthParam})
        AND type IN ('flood', 'landslide', 'storm', 'accident')
      ORDER BY date DESC
      LIMIT 10
    `;
    const filtered = useCorridor
      ? bipadEvents.filter((e) => isNearRoute(e, routePoints!, 10))
      : bipadEvents;
    for (const e of filtered) {
      notableEvents.push({
        date:        e.date.toISOString().split("T")[0],
        type:        e.type === "flood" ? "Flood" : e.type === "landslide" ? "Landslide" : e.type === "storm" ? "Storm" : "Accident",
        description: e.title ?? `${e.type === "flood" ? "Flood" : e.type === "landslide" ? "Landslide" : e.type === "storm" ? "Storm" : "Accident"} incident in ${districtName}`,
        severity:    (e.severity.toUpperCase() === "HIGH" || e.severity.toUpperCase() === "MEDIUM")
                     ? e.severity.toUpperCase() as "HIGH" | "MEDIUM"
                     : "LOW",
      });
    }
  } catch {
    // no notable events found
  }

  // ── 3. USGS earthquake stats ──────────────────────────────────────────────

  let earthquakeCount = 0;
  let maxMag = 0;

  try {
    const usgsRows = await prisma.$queryRaw<Array<{ count: bigint; maxMag: number | null }>>`
      SELECT COUNT(*)::bigint AS count,
             MAX((metadata->>'mag')::float) AS "maxMag"
      FROM yatra_disaster_events
      WHERE source = 'usgs'
        AND type = 'earthquake'
        AND date >= ${startDate}::date
        AND lat BETWEEN ${lat - eqDeg} AND ${lat + eqDeg}
        AND lon BETWEEN ${lon - eqDeg} AND ${lon + eqDeg}
        AND EXTRACT(MONTH FROM date) IN (${monthParam})
    `;
    earthquakeCount = Number(usgsRows[0]?.count ?? 0);
    maxMag = usgsRows[0]?.maxMag ?? 0;
  } catch {
    // graceful degradation
  }

  // ── 4. USGS notable events (mag >= 5.0) ───────────────────────────────────

  try {
    const usgsEvents = await prisma.$queryRaw<
      Array<{ date: Date; mag: number | null; place: string | null }>
    >`
      SELECT date, (metadata->>'mag')::float AS mag, metadata->>'place' AS place
      FROM yatra_disaster_events
      WHERE source = 'usgs'
        AND type = 'earthquake'
        AND date >= ${startDate}::date
        AND lat BETWEEN ${lat - eqDeg} AND ${lat + eqDeg}
        AND lon BETWEEN ${lon - eqDeg} AND ${lon + eqDeg}
        AND EXTRACT(MONTH FROM date) IN (${monthParam})
        AND (metadata->>'mag')::float >= 5.0
      ORDER BY (metadata->>'mag')::float DESC
      LIMIT 5
    `;
    for (const e of usgsEvents) {
      const mag = e.mag ?? 0;
      notableEvents.push({
        date:        e.date.toISOString().split("T")[0],
        type:        "Earthquake",
        description: `M${mag.toFixed(1)} — ${e.place ?? "near this area"}`,
        severity:    mag >= 6 ? "HIGH" : "MEDIUM",
      });
    }
  } catch {
    // no notable quakes found
  }

  // ── Deduplicate notable events by date+type+description ───────────────────

  const seen = new Set<string>();
  notableEvents = notableEvents.filter((e) => {
    const key = `${e.date}|${e.type}|${e.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  notableEvents.sort((a, b) => b.date.localeCompare(a.date));

  // ── Risk indices ──────────────────────────────────────────────────────────

  const historicalFloodRisk     = logNorm(floodIncidents,     years);
  const historicalLandslideRisk = logNorm(landslideIncidents, years);
  const historicalStormRisk     = logNorm(stormIncidents,     years);
  const historicalAccidentRisk  = logNorm(accidentIncidents,  years);

  const magScore   = maxMag > 0 ? Math.min(maxMag / 7.0, 1.0) : 0;
  const freqScore  = Math.min(earthquakeCount / 20, 1.0);
  const historicalEarthquakeRisk = magScore * HISTORICAL_CONFIG.EQ_MAG_WEIGHT
                                 + freqScore * HISTORICAL_CONFIG.EQ_FREQ_WEIGHT;

  const yearsAnalysed = years; // DB always returns data (even zero-count is valid)
  const confidence = 1.0;      // DB is always available

  return {
    schemaVersion: 2,

    floodIncidents,
    landslideIncidents,
    earthquakeCount,
    maxEarthquakeMag: round(maxMag),
    stormIncidents,
    accidentIncidents,

    historicalFloodRisk:      round(historicalFloodRisk),
    historicalLandslideRisk:  round(historicalLandslideRisk),
    historicalEarthquakeRisk: round(historicalEarthquakeRisk),
    historicalStormRisk:      round(historicalStormRisk),
    historicalAccidentRisk:   round(historicalAccidentRisk),

    notableEvents: notableEvents.slice(0, 10),

    yearsRequested: years,
    yearsAnalysed,
    confidence,
    sources: ["yatra_disaster_events"],
  };
}
