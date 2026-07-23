/**
 * FILE: hazard.ts
 * LOCATION: /lib/collectors/hazard.ts
 * PURPOSE: Queries disaster event counts from the ingested DB table and live
 *          air quality, returning both normalised 0–1 risk indices and raw counts.
 *
 * DATA SOURCE CHANGE (Jul 2026):
 *   Previously: Live BIPAD/EONET/ReliefWeb/USGS APIs.
 *   Now:        yatra_disaster_events table (populated by cron job).
 *
 *   Live APIs retained for air quality only (real-time PM2.5 — no DB equivalent).
 *
 * RADIUS: 5 km bounding box around (lat, lon). Uses the existing
 *   idx_disaster_events_lat_lon index.
 *
 * EARTHQUAKE INDEX: Derived from max magnitude stored in USGS metadata.
 *
 * GRACEFUL DEGRADATION:
 *   - DB query fails → all zeros returned (no disasters known).
 *   - No events found → zeros (accurate — no disasters = no risk).
 *   - Air quality all fail → district default (unchanged).
 */

import { externalApiCache } from "@/lib/collectors/external-api-cache";

// ── Output types ──────────────────────────────────────────────────────────────

export interface HazardSnapshot {
  floodIndex:      number; // 0–1 derived from 5-year incident count
  landslideIndex:  number; // 0–1 derived from 5-year incident count
  earthquakeIndex: number; // 0–1 derived from max USGS magnitude
  stormIndex:      number; // 0–1 derived from 5-year incident count
  accidentIndex:   number; // 0–1 derived from 5-year incident count
  heatIndex:       number; // 0–1 (filled by assess route from OWM temp)
  airQuality:      number; // 0–1 live PM2.5
  source:          string;
  floodCount:      number; // raw incidents (5 yr, 5 km radius)
  landslideCount:  number;
  earthquakeCount: number;
  stormCount:      number;
  accidentCount:   number;
}

interface DbCountRow { type: string; count: bigint }
interface DbMagRow   { maxMag: number | null }

// ── Main entry point ──────────────────────────────────────────────────────────

export async function fetchHazard(
  lat: number,
  lon: number,
  prisma: any,
  signal?: AbortSignal,
): Promise<HazardSnapshot> {
  const FIVE_YEARS_AGO = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000);
  const RADIUS_KM = 5;
  const deg = RADIUS_KM / 111;

  // ── 1. Disaster counts from DB (spatial query, 5 yr window) ────────────

  let floodCount = 0, landslideCount = 0, earthquakeCount = 0, stormCount = 0, accidentCount = 0;

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT type, COUNT(*)::bigint AS count
       FROM yatra_disaster_events
        WHERE date >= $1
          AND type IN ('flood','landslide','earthquake','storm','accident')
          AND NOT (source = 'bipad' AND type = 'earthquake')
          AND lat BETWEEN $2 AND $3
          AND lon BETWEEN $4 AND $5
       GROUP BY type`,
      FIVE_YEARS_AGO,
      lat - deg, lat + deg,
      lon - deg, lon + deg,
    );

    for (const r of rows as DbCountRow[]) {
      const n = Number(r.count);
      if (r.type === "flood")        floodCount     += n;
      else if (r.type === "landslide") landslideCount += n;
      else if (r.type === "earthquake") earthquakeCount += n;
      else if (r.type === "storm")     stormCount    += n;
      else if (r.type === "accident")  accidentCount += n;
    }
  } catch {
    // DB read failure — graceful degradation to zeros
  }

  // ── 2. Earthquake index from max magnitude ──────────────────────────────

  let earthquakeIndex = 0;
  if (earthquakeCount > 0) {
    try {
      const magRows = await prisma.$queryRawUnsafe(
        `SELECT MAX((metadata->>'mag')::float) AS "maxMag"
         FROM yatra_disaster_events
         WHERE type = 'earthquake'
           AND source = 'usgs'
           AND metadata->>'mag' IS NOT NULL
           AND lat BETWEEN $1 AND $2
           AND lon BETWEEN $3 AND $4`,
        lat - deg, lat + deg,
        lon - deg, lon + deg,
      );
      const maxMag = (magRows as DbMagRow[])[0]?.maxMag ?? 0;
      if (maxMag >= 7.0) earthquakeIndex = 1.0;
      else if (maxMag >= 6.0) earthquakeIndex = 0.8;
      else if (maxMag >= 5.0) earthquakeIndex = 0.5;
      else if (maxMag >= 4.0) earthquakeIndex = 0.3;
      else if (maxMag >= 3.0) earthquakeIndex = 0.1;
    } catch {
      // fall through — index stays 0
    }
  }

  // ── 3. Normalised indices from counts ───────────────────────────────────

  const floodIndex     = Math.min(floodCount / 5, 1.0);
  const landslideIndex = Math.min(landslideCount / 5, 1.0);
  const stormIndex     = Math.min(stormCount / 5, 1.0);
  const accidentIndex  = Math.min(accidentCount / 5, 1.0);

  // ── 4. Live air quality (real-time PM2.5 — no DB equivalent) ────────────

  const airQuality = await fetchAirQuality(lat, lon, signal);

  const source = "db";

  return {
    floodIndex:      round(floodIndex),
    landslideIndex:  round(landslideIndex),
    earthquakeIndex: round(earthquakeIndex),
    stormIndex:      round(stormIndex),
    accidentIndex:   round(accidentIndex),
    heatIndex:       0,
    airQuality:      round(airQuality),
    source,
    floodCount,
    landslideCount,
    earthquakeCount,
    stormCount,
    accidentCount,
  };
}

// ── Air Quality — OpenAQ + OWM fallback ────────────────────────────────────
// (Retained as live API — PM2.5 is real-time sensor data, not a disaster event.)

async function fetchAirQuality(lat: number, lon: number, signal?: AbortSignal): Promise<number> {
  const openAQ = await fetchOpenAQ(lat, lon, signal);
  if (openAQ !== null) return openAQ;

  const owm = await fetchOwmAirQuality(lat, lon, signal);
  if (owm !== null) return owm;

  return defaultAirQuality();
}

async function fetchOpenAQ(lat: number, lon: number, signal?: AbortSignal): Promise<number | null> {
  if (lat === 0 && lon === 0) return null;

  return externalApiCache.getOrFetch(
    `openaq:${lat.toFixed(1)}:${lon.toFixed(1)}`,
    10 * 60_000,
    async () => {
      try {
        const url = `https://api.openaq.org/v2/measurements?coordinates=${lat},${lon}&radius=25000&limit=100&parameter=pm25&order_by=datetime&sort=desc`;
        const res = await fetch(url, {
          signal: signal ?? AbortSignal.timeout(8_000),
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) return null;

        const data = await res.json() as {
          results?: { value?: number; parameter?: string }[]
        };

        const readings = (data.results ?? [])
          .filter((r) => r.parameter === "pm25" && typeof r.value === "number" && r.value > 0)
          .map((r) => r.value as number);

        if (readings.length === 0) return null;

        const avgPm25 = readings.reduce((a, b) => a + b, 0) / readings.length;

        if (avgPm25 >= 100 && readings.length <= 2) {
          console.warn(`[hazard] OpenAQ anomalous high PM2.5 avg=${avgPm25.toFixed(1)} readings=[${readings.map(r => r.toFixed(1)).join(",")}] at ${lat.toFixed(3)},${lon.toFixed(3)} — possible faulty sensor`);
        }

        if (avgPm25 >= 150) return 1.0;
        if (avgPm25 >= 100) return 0.8;
        if (avgPm25 >= 55)  return 0.6;
        if (avgPm25 >= 35)  return 0.4;
        if (avgPm25 >= 12)  return 0.2;
        return 0.05;
      } catch {
        return null;
      }
    },
    { timeoutMs: 20_000, negativeTtlMs: 30_000, signal },
  );
}

async function fetchOwmAirQuality(lat: number, lon: number, signal?: AbortSignal): Promise<number | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || (lat === 0 && lon === 0)) return null;

  return externalApiCache.getOrFetch(
    `owm:${lat.toFixed(1)}:${lon.toFixed(1)}`,
    10 * 60_000,
    async () => {
      try {
        const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
        const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(6_000), cache: "no-store" });
        if (!res.ok) return null;

        const data = await res.json() as { list?: { main?: { aqi?: number } }[] };
        const aqi  = data.list?.[0]?.main?.aqi ?? 2;
        const map: Record<number, number> = { 1: 0.0, 2: 0.2, 3: 0.5, 4: 0.75, 5: 1.0 };
        return map[aqi] ?? 0.2;
      } catch {
        return null;
      }
    },
    { timeoutMs: 15_000, negativeTtlMs: 30_000, signal },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultAirQuality(): number {
  return 0.15;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
