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

export interface HistoricalHazardStats {
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

  yearsAnalysed: number;
  source:        string;
}

/**
 * Fetch historical hazard data for a district during a specific month window.
 * Looks back N years at the same month ± 1 month window.
 */
export async function fetchHistoricalHazard(
  districtName: string,
  lat:          number,
  lon:          number,
  targetDate:   string, // YYYY-MM-DD
  years:        number = 5,
  seismicRadiusKm: number = 150
): Promise<HistoricalHazardStats> {

  const target      = new Date(targetDate);
  const targetMonth = target.getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const [bipadStats, usgsStats] = await Promise.all([
    fetchBipadHistorical(districtName, targetMonth, currentYear, years),
    fetchUsgsHistorical(lat, lon, targetMonth, currentYear, years, seismicRadiusKm),
  ]);

  // Combine notable events from all sources
  const notableEvents = [
    ...bipadStats.notableEvents,
    ...usgsStats.notableEvents,
  ].sort((a, b) => b.date.localeCompare(a.date));

  // Historical risk indices — normalised over years analysed
  // More incidents in the same season = higher index
  const historicalFloodRisk     = Math.min(bipadStats.floodIncidents     / (years * 3), 1.0);
  const historicalLandslideRisk = Math.min(bipadStats.landslideIncidents / (years * 3), 1.0);
  const historicalEarthquakeRisk = usgsStats.earthquakeRisk;

  return {
    floodIncidents:     bipadStats.floodIncidents,
    landslideIncidents: bipadStats.landslideIncidents,
    earthquakeCount:    usgsStats.count,
    maxEarthquakeMag:   usgsStats.maxMag,

    historicalFloodRisk:      round(historicalFloodRisk),
    historicalLandslideRisk:  round(historicalLandslideRisk),
    historicalEarthquakeRisk: round(historicalEarthquakeRisk),

    notableEvents: notableEvents.slice(0, 10), // top 10 most recent
    yearsAnalysed: years,
    source:        "bipad+usgs",
  };
}

// ── BIPAD Historical ──────────────────────────────────────────────────────────

interface BipadStats {
  floodIncidents:     number;
  landslideIncidents: number;
  notableEvents: HistoricalHazardStats["notableEvents"];
}

async function fetchBipadHistorical(
  district:    string,
  targetMonth: number,
  currentYear: number,
  years:       number
): Promise<BipadStats> {

  let floodIncidents     = 0;
  let landslideIncidents = 0;
  const notableEvents: BipadStats["notableEvents"] = [];

  // Query each past year separately so we get the same seasonal window
  const requests = Array.from({ length: years }, (_, i) => {
    const year  = currentYear - years + i;
    // ±1 month window around target month
    const mFrom = Math.max(1,  targetMonth - 1);
    const mTo   = Math.min(12, targetMonth + 1);
    const from  = `${year}-${String(mFrom).padStart(2, "0")}-01`;
    const to    = `${year}-${String(mTo).padStart(2, "0")}-28`;
    return fetchBipadRange(district, from, to, year);
  });

  const results = await Promise.allSettled(requests);

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    floodIncidents     += result.value.flood;
    landslideIncidents += result.value.landslide;
    notableEvents.push(...result.value.events);
  }

  return { floodIncidents, landslideIncidents, notableEvents };
}

async function fetchBipadRange(
  district: string,
  from:     string,
  to:       string,
  year:     number
): Promise<{ flood: number; landslide: number; events: HistoricalHazardStats["notableEvents"] } | null> {
  try {
    const url = `https://bipadportal.gov.np/api/v1/incident/?district__title_en=${encodeURIComponent(district)}&date_of_incident__gte=${from}&date_of_incident__lte=${to}&format=json&limit=100`;

    const res = await fetch(url, {
      signal:  AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
      cache:   "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      results?: {
        incident_type?:  { title?: string };
        hazard?:         { title?: string };
        date_of_incident?: string;
        loss?:           { estimated_loss?: number };
        description?:    string;
      }[]
    };

    const incidents = data.results ?? [];
    let flood = 0, landslide = 0;
    const events: HistoricalHazardStats["notableEvents"] = [];

    for (const inc of incidents) {
      const type = (inc.incident_type?.title ?? inc.hazard?.title ?? "").toLowerCase();
      const isFlood     = type.includes("flood")     || type.includes("बाढी");
      const isLandslide = type.includes("landslide") || type.includes("पहिरो");

      if (isFlood)     flood++;
      if (isLandslide) landslide++;

      if (isFlood || isLandslide) {
        const loss = inc.loss?.estimated_loss ?? 0;
        events.push({
          date:        inc.date_of_incident ?? `${year}`,
          type:        isFlood ? "Flood" : "Landslide",
          description: inc.description ?? `${isFlood ? "Flood" : "Landslide"} incident in ${district}`,
          severity:    loss > 1_000_000 ? "HIGH" : loss > 100_000 ? "MEDIUM" : "LOW",
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
  notableEvents:  HistoricalHazardStats["notableEvents"];
}

async function fetchUsgsHistorical(
  lat:         number,
  lon:         number,
  targetMonth: number,
  currentYear: number,
  years:       number,
  radiusKm:    number
): Promise<UsgsStats> {
  if (lat === 0 && lon === 0) {
    return { count: 0, maxMag: 0, earthquakeRisk: 0, notableEvents: [] };
  }

  try {
    // Query earthquakes M3.5+ within configurable radius over the past N years
    const from = `${currentYear - years}-01-01`;
    const to   = new Date().toISOString().split("T")[0];

    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${from}&endtime=${to}&latitude=${lat}&longitude=${lon}&maxradiuskm=${radiusKm}&minmagnitude=4.5&orderby=magnitude`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      cache:  "no-store",
    });

    if (!res.ok) return { count: 0, maxMag: 0, earthquakeRisk: 0, notableEvents: [] };

    const data = await res.json() as {
      features?: {
        properties?: { mag?: number; place?: string; time?: number };
        geometry?:   { coordinates?: number[] };
      }[]
    };

    const quakes = data.features ?? [];

    // Filter to same season (±1 month)
    const seasonalQuakes = quakes.filter((q) => {
      if (!q.properties?.time) return true;
      const qMonth = new Date(q.properties.time).getMonth() + 1;
      return Math.abs(qMonth - targetMonth) <= 1;
    });

    const mags    = seasonalQuakes.map((q) => q.properties?.mag ?? 0);
    const maxMag  = mags.length > 0 ? Math.max(...mags) : 0;
    const count   = seasonalQuakes.length;

    // Risk index based on count + magnitude
    let earthquakeRisk = 0;
    if (maxMag >= 6.0) earthquakeRisk = 0.9;
    else if (maxMag >= 5.0) earthquakeRisk = 0.6;
    else if (maxMag >= 4.0) earthquakeRisk = 0.3;
    else if (count > 10) earthquakeRisk = 0.2;
    else if (count > 5)  earthquakeRisk = 0.1;

    // Build notable events for significant quakes (M5+)
    const notableEvents: HistoricalHazardStats["notableEvents"] = quakes
      .filter((q) => (q.properties?.mag ?? 0) >= 5.0)
      .slice(0, 5)
      .map((q) => ({
        date:        new Date(q.properties?.time ?? 0).toISOString().split("T")[0],
        type:        "Earthquake",
        description: `M${q.properties?.mag?.toFixed(1)} — ${q.properties?.place ?? "near this area"}`,
        severity:    (q.properties?.mag ?? 0) >= 6 ? "HIGH" : "MEDIUM" as "HIGH" | "MEDIUM",
      }));

    return { count, maxMag, earthquakeRisk, notableEvents };
  } catch {
    return { count: 0, maxMag: 0, earthquakeRisk: 0, notableEvents: [] };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
