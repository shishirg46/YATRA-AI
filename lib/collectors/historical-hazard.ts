/**
 * FILE: historical-hazard.ts
 * LOCATION: /lib/collectors/historical-hazard.ts
 * PURPOSE: Fetches historical disaster incidents for a district + season
 *          to determine if a destination has a history of hazards
 *          during a specific time of year.
 *
 * SOURCES:
 *  1. BIPAD portal — historical Nepal disaster incidents
 *  2. USGS — earthquake history for the coordinate
 */

const HISTORICAL_CONFIG = {
  BIPAD_PAGE_SIZE: 100,
  DEFAULT_YEARS: 5,
  DEFAULT_RADIUS_KM: 150,
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  REQUEST_TIMEOUT_MS: 10_000,
  EQ_MAG_WEIGHT: 0.6,
  EQ_FREQ_WEIGHT: 0.4,
} as const;

import { externalApiCache } from "./external-api-cache";

export interface HistoricalHazardStats {
  schemaVersion: 2;

  // Incident counts over past years for this season
  floodIncidents:     number;
  landslideIncidents: number;
  earthquakeCount:    number;
  maxEarthquakeMag:   number;

  // Risk indices (0–1) derived from history
  historicalFloodRisk:     number;
  historicalLandslideRisk: number;
  historicalEarthquakeRisk: number;

  // Notable past disasters
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

/** Circular month difference: Dec (12) and Jan (1) are 1 apart, not 11. */
function circularMonthDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

/**
 * Logarithmic normalization for incident counts.
 * Reduces saturation in districts with frequent disasters.
 *
 * TODO: Replace with percentile normalization once nationwide
 *       incident distributions are available.
 */
function logNorm(incidents: number, years: number): number {
  const max = years * 3;
  if (max <= 0) return 0;
  return Math.log(1 + incidents) / Math.log(1 + max);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fetch historical hazard data for a district during a specific month window.
 * Looks back N years at the same month ± 1 month window.
 */
export async function fetchHistoricalHazard(
  districtName: string,
  lat:          number,
  lon:          number,
  targetDate:   string,
  years:        number = HISTORICAL_CONFIG.DEFAULT_YEARS,
  seismicRadiusKm: number = HISTORICAL_CONFIG.DEFAULT_RADIUS_KM,
  signal?:      AbortSignal,
): Promise<HistoricalHazardStats> {

  const target      = new Date(targetDate);
  const targetMonth = target.getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const [bipadStats, usgsStats] = await Promise.all([
    fetchBipadHistorical(districtName, targetMonth, currentYear, years, signal),
    fetchUsgsHistorical(lat, lon, targetMonth, currentYear, years, seismicRadiusKm, signal),
  ]);

  // Deduplicate notable events by date+type+description
  const seen = new Set<string>();
  const deduped = [...bipadStats.notableEvents, ...usgsStats.notableEvents].filter((e) => {
    const key = `${e.date}|${e.type}|${e.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const notableEvents = deduped.sort((a, b) => b.date.localeCompare(a.date));

  // Historical risk indices — normalised over years analysed
  const historicalFloodRisk     = logNorm(bipadStats.floodIncidents,     years);
  const historicalLandslideRisk = logNorm(bipadStats.landslideIncidents, years);
  const historicalEarthquakeRisk = usgsStats.earthquakeRisk;

  // Confidence: fraction of sources successfully queried
  const bipadYearsOk = bipadStats.yearsAnalysed;
  const usgsOk       = usgsStats.yearsAnalysed > 0 ? 1 : 0;
  const totalOk      = bipadYearsOk + usgsOk;
  const totalMax     = years + 1;

  return {
    schemaVersion: 2,

    floodIncidents:     bipadStats.floodIncidents,
    landslideIncidents: bipadStats.landslideIncidents,
    earthquakeCount:    usgsStats.count,
    maxEarthquakeMag:   usgsStats.maxMag,

    historicalFloodRisk:      round(historicalFloodRisk),
    historicalLandslideRisk:  round(historicalLandslideRisk),
    historicalEarthquakeRisk: round(historicalEarthquakeRisk),

    notableEvents: notableEvents.slice(0, 10),
    yearsRequested: years,
    yearsAnalysed:  bipadYearsOk,
    confidence:     totalMax > 0 ? round(totalOk / totalMax) : 0,
    sources:        ["bipad", "usgs"],
  };
}

// ── BIPAD Historical ──────────────────────────────────────────────────────────

interface BipadStats {
  floodIncidents:     number;
  landslideIncidents: number;
  yearsAnalysed:      number;
  notableEvents: HistoricalHazardStats["notableEvents"];
}

async function fetchBipadHistorical(
  district:    string,
  targetMonth: number,
  currentYear: number,
  years:       number,
  signal?:     AbortSignal,
): Promise<BipadStats> {

  const cacheKey = `bipad-historical:${district}:${targetMonth}:${years}:${currentYear}`;

  const cached = await externalApiCache.getOrFetch(
    cacheKey,
    HISTORICAL_CONFIG.CACHE_TTL_MS,
    async () => {
      let floodIncidents     = 0;
      let landslideIncidents = 0;
      let yearsAnalysed      = 0;
      const notableEvents: BipadStats["notableEvents"] = [];

      const requests = Array.from({ length: years }, (_, i) => {
        const year  = currentYear - years + i;
        const mFrom = Math.max(1,  targetMonth - 1);
        const mTo   = Math.min(12, targetMonth + 1);
        const from  = `${year}-${String(mFrom).padStart(2, "0")}-01`;
        const lastDay = String(new Date(year, mTo, 0).getDate()).padStart(2, "0");
        const to    = `${year}-${String(mTo).padStart(2, "0")}-${lastDay}`;
        return fetchBipadRange(district, from, to, year, signal);
      });

      const results = await Promise.allSettled(requests);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const year   = currentYear - years + i;
        if (result.status !== "fulfilled" || !result.value) {
          console.warn("[historical-hazard] BIPAD year %d failed:", year, result.status === "rejected" ? result.reason : "null response");
          continue;
        }
        floodIncidents     += result.value.flood;
        landslideIncidents += result.value.landslide;
        notableEvents.push(...result.value.events);
        yearsAnalysed++;
      }

      return { floodIncidents, landslideIncidents, yearsAnalysed, notableEvents } as BipadStats;
    },
    { timeoutMs: HISTORICAL_CONFIG.REQUEST_TIMEOUT_MS * years, negativeTtlMs: 60_000, signal },
  );
  return cached ?? { floodIncidents: 0, landslideIncidents: 0, yearsAnalysed: 0, notableEvents: [] };
}

const HAZARD_TERMS = {
  flood:     ["flood", "बाढी"],
  landslide: ["landslide", "पहिरो"],
} as const;

interface BipadIncident {
  incident_type?:  { title?: string };
  hazard?:         { title?: string };
  date_of_incident?: string;
  loss?:           { estimated_loss?: number };
  description?:    string;
}

async function fetchBipadRange(
  district: string,
  from:     string,
  to:       string,
  year:     number,
  signal?:  AbortSignal,
): Promise<{ flood: number; landslide: number; events: HistoricalHazardStats["notableEvents"] } | null> {
  try {
    const pageSize = HISTORICAL_CONFIG.BIPAD_PAGE_SIZE;
    let offset = 0;
    let allIncidents: BipadIncident[] = [];

    while (true) {
      const url = `https://bipadportal.gov.np/api/v1/incident/?district__title_en=${encodeURIComponent(district)}&incident_on__gt=${from}&incident_on__lt=${to}&format=json&limit=${pageSize}&offset=${offset}`;

      const res = await fetch(url, {
        signal:  signal
          ? AbortSignal.any([AbortSignal.timeout(HISTORICAL_CONFIG.REQUEST_TIMEOUT_MS), signal])
          : AbortSignal.timeout(HISTORICAL_CONFIG.REQUEST_TIMEOUT_MS),
        headers: { Accept: "application/json" },
        cache:   "no-store",
      });

      if (!res.ok) return null;

      const data = await res.json() as { results?: BipadIncident[] };
      if (!Array.isArray(data.results)) return null;

      const results = data.results;
      allIncidents.push(...results);

      if (results.length < pageSize) break;
      offset += pageSize;
    }

    let flood = 0, landslide = 0;
    const events: HistoricalHazardStats["notableEvents"] = [];

    for (const inc of allIncidents) {
      const type = (inc.incident_type?.title ?? inc.hazard?.title ?? "").toLowerCase();
      const isFlood     = HAZARD_TERMS.flood.some((t) => type.includes(t));
      const isLandslide = HAZARD_TERMS.landslide.some((t) => type.includes(t));

      if (isFlood)     flood++;
      if (isLandslide) landslide++;

      if (isFlood || isLandslide) {
        const loss = inc.loss?.estimated_loss ?? 0;
        let severity: "HIGH" | "MEDIUM" | "LOW" = "LOW";
        if (loss > 1_000_000) severity = "HIGH";
        else if (loss > 100_000) severity = "MEDIUM";

        events.push({
          date:        inc.date_of_incident ?? `${year}`,
          type:        isFlood ? "Flood" : "Landslide",
          description: inc.description ?? `${isFlood ? "Flood" : "Landslide"} incident in ${district}`,
          severity,
        });
      }
    }

    return { flood, landslide, events };
  } catch {
    return null;
  }
}

// ── USGS Historical ───────────────────────────────────────────────────────────

interface UsgsStats {
  count:          number;
  maxMag:         number;
  earthquakeRisk: number;
  yearsAnalysed:  number;
  notableEvents:  HistoricalHazardStats["notableEvents"];
}

async function fetchUsgsHistorical(
  lat:         number,
  lon:         number,
  targetMonth: number,
  currentYear: number,
  years:       number,
  radiusKm:    number,
  signal?:     AbortSignal,
): Promise<UsgsStats> {
  if (lat === 0 && lon === 0) {
    return { count: 0, maxMag: 0, earthquakeRisk: 0, yearsAnalysed: 0, notableEvents: [] };
  }

  const cacheKey = `usgs-historical:${lat}:${lon}:${targetMonth}:${years}:${currentYear}:${radiusKm}`;

  const cached = await externalApiCache.getOrFetch(
    cacheKey,
    HISTORICAL_CONFIG.CACHE_TTL_MS,
    async () => {
      const from = `${currentYear - years}-01-01`;
      const to   = new Date().toISOString().split("T")[0];

      const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${from}&endtime=${to}&latitude=${lat}&longitude=${lon}&maxradiuskm=${radiusKm}&minmagnitude=4.5&orderby=magnitude`;

      try {
        const res = await fetch(url, {
          signal: signal
            ? AbortSignal.any([AbortSignal.timeout(HISTORICAL_CONFIG.REQUEST_TIMEOUT_MS), signal])
            : AbortSignal.timeout(HISTORICAL_CONFIG.REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });

        if (!res.ok) return { count: 0, maxMag: 0, earthquakeRisk: 0, yearsAnalysed: 0, notableEvents: [] };

        const data = await res.json() as {
          features?: {
            properties?: { mag?: number; place?: string; time?: number };
            geometry?:   { coordinates?: number[] };
          }[]
        };

        if (!Array.isArray(data.features)) {
          return { count: 0, maxMag: 0, earthquakeRisk: 0, yearsAnalysed: 0, notableEvents: [] };
        }

        const quakes = data.features;

        // Filter to same season using circular month comparison
        const seasonalQuakes = quakes.filter((q) => {
          if (!q.properties?.time) return true;
          const qMonth = new Date(q.properties.time).getMonth() + 1;
          return circularMonthDiff(qMonth, targetMonth) <= 1;
        });

        const mags   = seasonalQuakes.map((q) => q.properties?.mag ?? 0);
        const maxMag = mags.length > 0 ? Math.max(...mags) : 0;
        const count  = seasonalQuakes.length;

        // Continuous risk model combining magnitude + frequency
        const magScore   = Math.min(maxMag / 7.0, 1.0);
        const freqScore  = Math.min(count / 20, 1.0);
        const earthquakeRisk = magScore * HISTORICAL_CONFIG.EQ_MAG_WEIGHT
                             + freqScore * HISTORICAL_CONFIG.EQ_FREQ_WEIGHT;

        // Notable events for significant quakes (M5+)
        const notableEvents: HistoricalHazardStats["notableEvents"] = quakes
          .filter((q) => (q.properties?.mag ?? 0) >= 5.0)
          .slice(0, 5)
          .map((q) => ({
            date:        new Date(q.properties?.time ?? 0).toISOString().split("T")[0],
            type:        "Earthquake",
            description: `M${q.properties?.mag?.toFixed(1)} — ${q.properties?.place ?? "near this area"}`,
            severity:    (q.properties?.mag ?? 0) >= 6 ? "HIGH" : "MEDIUM" as "HIGH" | "MEDIUM",
          }));

        return { count, maxMag, earthquakeRisk, yearsAnalysed: 1, notableEvents } as UsgsStats;
      } catch {
        return { count: 0, maxMag: 0, earthquakeRisk: 0, yearsAnalysed: 0, notableEvents: [] } as UsgsStats;
      }
    },
    { timeoutMs: HISTORICAL_CONFIG.REQUEST_TIMEOUT_MS, negativeTtlMs: 60_000, signal },
  );
  return cached ?? { count: 0, maxMag: 0, earthquakeRisk: 0, yearsAnalysed: 0, notableEvents: [] };
}


