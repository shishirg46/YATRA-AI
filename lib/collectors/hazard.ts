/**
 * FILE: hazard.ts
 * LOCATION: /lib/collectors/hazard.ts
 * PURPOSE: Collects hazard data from multiple sources, merges using worst-case
 *          logic, and returns normalised 0–1 risk indices.
 *
 * SOURCES (all free, no extra API keys needed except OWM which you already have):
 *
 *  1. BIPAD portal      — Nepal government disaster DB (flood, landslide incidents)
 *     https://bipadportal.gov.np/api/v1/incident/
 *
 *  2. NASA EONET        — Active natural events worldwide (floods, wildfires, storms)
 *     https://eonet.gsfc.nasa.gov/api/v3/events
 *
 *  3. ReliefWeb API     — UN humanitarian disaster reports for Nepal
     *     https://api.reliefweb.int/v2/disasters
 *
 *  4. USGS Earthquake   — Earthquakes within 100km of the coordinate in last 30 days
 *     https://earthquake.usgs.gov/fdsnws/event/1/query
 *
 *  5. OpenAQ            — Real air quality sensor readings near the coordinate
 *     https://api.openaq.org/v2/measurements
 *     (Falls back to OWM air quality if OpenAQ has no nearby sensors)
 *
 * MERGE STRATEGY: worst-case across all sources
 *   finalIndex = max(source1Index, source2Index, ...)
 *   This ensures a real active event from any source raises the score.
 *
 * GRACEFUL DEGRADATION:
 *   Every source is wrapped in try/catch with a timeout.
 *   If all sources fail → seasonal Nepal defaults.
 *   Sources are queried in parallel for speed.
 *
 * CIRCUIT BREAKER:
 *   Each source has an in-memory circuit breaker. If it fails N times
 *   consecutively, it is skipped for a cooldown period. After cooldown,
 *   it enters half-open state and one request is allowed to probe.
 */

import { externalApiCache } from "@/lib/collectors/external-api-cache";

// ── Circuit breaker ──────────────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  cooldownUntil: number;  // 0 = closed (normal)
  halfOpen: boolean;
  lastAttempt: number;    // monotonic probe guard
}

const CIRCUIT_CONFIG = {
  maxFailures: 3,          // trip after 3 consecutive failures
  cooldownMs: 60_000,      // stay open for 60 seconds
  halfOpenMax: 1,          // allow 1 probe in half-open
};

const circuitState = new Map<string, CircuitState>();

function getCircuitKey(source: string, district: string): string {
  return `${source}:${district}`;
}

function isCircuitOpen(source: string, district: string): boolean {
  const key = getCircuitKey(source, district);
  const state = circuitState.get(key);
  if (!state) return false;
  const now = Date.now();
  if (state.cooldownUntil > now) return true;

  if (state.halfOpen) {
    // Minimum 10s between probe attempts (monotonic-safe)
    if (Math.max(now, state.lastAttempt) - state.lastAttempt < 10_000) return true;
    state.lastAttempt = now;
    console.warn("[circuit] CB_HALFOPEN — allowing probe", { source, district });
    return false; // allow exactly one probe
  }

  return false;
}

function recordFailure(source: string, district: string): void {
  const key = getCircuitKey(source, district);
  const now = Date.now();
  const prev = circuitState.get(key);
  const failures = (prev?.failures ?? 0) + 1;
  if (failures >= CIRCUIT_CONFIG.maxFailures) {
    circuitState.set(key, {
      failures,
      lastFailure: now,
      cooldownUntil: now + CIRCUIT_CONFIG.cooldownMs,
      halfOpen: false,
      lastAttempt: 0,
    });
    console.warn(`[circuit] CB_OPEN — ${source} tripped for ${district}, cooling down ${CIRCUIT_CONFIG.cooldownMs}ms`);
  } else {
    circuitState.set(key, {
      failures,
      lastFailure: now,
      cooldownUntil: 0,
      halfOpen: false,
      lastAttempt: 0,
    });
  }
}

function recordSuccess(source: string, district: string): void {
  const key = getCircuitKey(source, district);
  const wasOpen = circuitState.has(key);
  circuitState.delete(key);
  if (wasOpen) {
    console.warn("[circuit] CB_CLOSED — recovered", { source, district });
  }
}

function enterHalfOpen(source: string, district: string): void {
  const key = getCircuitKey(source, district);
  const prev = circuitState.get(key);
  if (prev) {
    circuitState.set(key, { ...prev, halfOpen: true, cooldownUntil: 0 });
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function fetchWithRetry(
  label: string,
  district: string,
  fn: (opts?: { signal?: AbortSignal }) => Promise<Response | null>,
  retries = 2,
  externalSignal?: AbortSignal,
): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (externalSignal?.aborted) return null;

    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** attempt, 4000);
      const sleep = new Promise<void>((r) => setTimeout(r, backoff));
      const abort = externalSignal
        ? new Promise<void>((_, reject) => {
            externalSignal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true });
          })
        : null;
      try {
        await (abort ? Promise.race([sleep, abort]) : sleep);
      } catch {
        return null;
      }
    }

    try {
      const res = await fn({ signal: externalSignal });
      if (res && res.ok) {
        recordSuccess(label, district);
        return res;
      }
    } catch {
      // fall through to retry
    }
  }
  recordFailure(label, district);
  return null;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface HazardSnapshot {
  floodIndex:     number; // 0–1
  landslideIndex: number; // 0–1
  earthquakeIndex: number; // 0–1 (NEW)
  heatIndex:      number; // 0–1 (filled by assess route from OWM temp)
  airQuality:     number; // 0–1
  source:         string; // which sources contributed
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function fetchHazard(
  districtName: string,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<HazardSnapshot> {

  // Query all sources in parallel — each returns partial indices or null on failure
  if (isCircuitOpen("bipad", districtName)) {
    enterHalfOpen("bipad", districtName);
  }
  if (isCircuitOpen("eonet", districtName)) {
    enterHalfOpen("eonet", districtName);
  }
  if (isCircuitOpen("reliefweb", districtName)) {
    enterHalfOpen("reliefweb", districtName);
  }
  if (isCircuitOpen("usgs", districtName)) {
    enterHalfOpen("usgs", districtName);
  }
  if (isCircuitOpen("openaq", districtName)) {
    enterHalfOpen("openaq", districtName);
  }

  const settled = await Promise.allSettled([
    fetchBipad(districtName, signal),
    fetchEonet(lat, lon, signal),
    fetchReliefWeb(districtName, signal),
    fetchUsgsEarthquake(lat, lon, signal),
    fetchAirQuality(lat, lon, districtName, signal),
  ]);
  const bipad     = settled[0].status === "fulfilled" ? settled[0].value : null;
  const eonet     = settled[1].status === "fulfilled" ? settled[1].value : null;
  const reliefweb = settled[2].status === "fulfilled" ? settled[2].value : null;
  const usgs      = settled[3].status === "fulfilled" ? settled[3].value : null;
  const airQuality = settled[4].status === "fulfilled" ? settled[4].value : 0;

  const sources: string[] = [];

  // Flood index — worst case across BIPAD, EONET, ReliefWeb
  let floodIndex = 0;
  if (bipad)      { floodIndex = Math.max(floodIndex, bipad.floodIndex);      sources.push("bipad"); }
  if (eonet)      { floodIndex = Math.max(floodIndex, eonet.floodIndex);      sources.push("eonet"); }
  if (reliefweb)  { floodIndex = Math.max(floodIndex, reliefweb.floodIndex);  sources.push("reliefweb"); }

  // Landslide index — worst case across BIPAD, EONET
  let landslideIndex = 0;
  if (bipad) landslideIndex = Math.max(landslideIndex, bipad.landslideIndex);
  if (eonet) landslideIndex = Math.max(landslideIndex, eonet.landslideIndex);

  // If all sources returned zero-index data (no observed incidents), use seasonal fallback
  const HAZARD_DATA_THRESHOLD = 0.05;
  const hasRealData =
    sources.length > 0 &&
    (floodIndex > HAZARD_DATA_THRESHOLD || landslideIndex > HAZARD_DATA_THRESHOLD);
  if (!hasRealData) {
    const [fallbackFlood, fallbackLandslide] = seasonalFallback();
    floodIndex     = fallbackFlood;
    landslideIndex = fallbackLandslide;
    sources.push("seasonal-fallback");
  }

  return {
    floodIndex:      round(floodIndex),
    landslideIndex:  round(landslideIndex),
    earthquakeIndex: round(usgs ?? 0),
    heatIndex:       0, // filled by assess route from OWM temperature
    airQuality:      round(airQuality),
    source:          sources.join("+") || "fallback",
  };
}

// ── Source 1: BIPAD Nepal ────────────────────────────────────────────────────

interface BipadResult { floodIndex: number; landslideIndex: number }

async function fetchBipad(district: string, signal?: AbortSignal): Promise<BipadResult | null> {
  if (isCircuitOpen("bipad", district)) return null;
  return externalApiCache.getOrFetch(
    `bipad:${district}`,
    5 * 60_000,
    async () => {
      try {
        const from = daysAgo(30);
        const url  = `https://bipadportal.gov.np/api/v1/incident/?district__title_en=${encodeURIComponent(district)}&incident_on__gt=${from}&format=json&limit=100`;

        const res = await fetchWithRetry("bipad", district, async (opts) => {
          const r = await fetch(url, {
            signal:  opts?.signal ?? AbortSignal.timeout(10_000),
            headers: { Accept: "application/json" },
            cache:   "no-store",
          });
          return r.ok ? r : null;
        }, 2, signal);

        if (!res) return null;

        const data = await res.json() as { results?: { incident_type?: { title?: string }; hazard?: { title?: string } }[] };
        const incidents = data.results ?? [];

        let flood = 0, landslide = 0;

        for (const inc of incidents) {
          const type = (inc.incident_type?.title ?? inc.hazard?.title ?? "").toLowerCase();
          if (type.includes("flood") || type.includes("inundation") || type.includes("बाढी")) flood++;
          if (type.includes("landslide") || type.includes("debris") || type.includes("पहिरो")) landslide++;
        }

        recordSuccess("bipad", district);
        return {
          floodIndex:     Math.min(flood / 5, 1.0),
          landslideIndex: Math.min(landslide / 5, 1.0),
        };
      } catch {
        recordFailure("bipad", district);
        return null;
      }
    },
    { timeoutMs: 20_000, negativeTtlMs: 30_000, signal },
  );
}

// ── Source 2: NASA EONET ─────────────────────────────────────────────────────
// Active natural events within ~200km of the coordinate

interface EonetResult { floodIndex: number; landslideIndex: number }

async function fetchEonet(lat: number, lon: number, signal?: AbortSignal): Promise<EonetResult | null> {
  const district = "global";
  if (isCircuitOpen("eonet", district)) return null;
  return externalApiCache.getOrFetch(
    `eonet:${lat.toFixed(1)}:${lon.toFixed(1)}`,
    15 * 60_000,
    async () => {
      try {
        const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&bbox=${lon - 2},${lat - 2},${lon + 2},${lat + 2}`;

        const res = await fetchWithRetry("eonet", district, async (opts) => {
          const r = await fetch(url, {
            signal: opts?.signal ?? AbortSignal.timeout(8_000),
            cache:  "no-store",
          });
          return r.ok ? r : null;
        }, 2, signal);

        if (!res) return null;

        const data = await res.json() as {
          events?: { categories?: { id: string }[]; geometry?: { coordinates: number[] }[] }[]
        };

        const events = data.events ?? [];

        let floodEvents     = 0;
        let landslideEvents = 0;

        for (const evt of events) {
          const cats = evt.categories?.map((c) => c.id) ?? [];
          if (cats.includes("floods"))     floodEvents++;
          if (cats.includes("landslides")) landslideEvents++;
          if (cats.includes("severeStorms")) floodEvents += 0.5;
        }

        recordSuccess("eonet", district);
        return {
          floodIndex:     Math.min(floodEvents / 2, 1.0),
          landslideIndex: Math.min(landslideEvents / 2, 1.0),
        };
      } catch {
        recordFailure("eonet", district);
        return null;
      }
    },
    { timeoutMs: 20_000, negativeTtlMs: 30_000, signal },
  );
}

// ── Source 3: ReliefWeb API ──────────────────────────────────────────────────
// UN humanitarian disaster reports mentioning Nepal + district

interface ReliefWebResult { floodIndex: number }

async function fetchReliefWeb(district: string, signal?: AbortSignal): Promise<ReliefWebResult | null> {
  if (isCircuitOpen("reliefweb", district)) return null;
  return externalApiCache.getOrFetch(
    `reliefweb:${district}`,
    30 * 60_000,
    async () => {
      try {
        const body = JSON.stringify({
          filter: {
            operator: "AND",
            conditions: [
              { field: "country.iso3", value: "NPL" },
              { field: "status",       value: "ongoing" },
            ],
          },
          fields: { include: ["name", "status", "type", "date"] },
          limit: 20,
        });

        const res = await fetchWithRetry("reliefweb", district, async (opts) => {
          const r = await fetch("https://api.reliefweb.int/v2/disasters?appname=yatraai", {
            method:  "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body,
            signal: opts?.signal ?? AbortSignal.timeout(8_000),
            cache:  "no-store",
          });
          return r.ok ? r : null;
        }, 2, signal);

        if (!res) return null;

        const data = await res.json() as {
          data?: { fields?: { name?: string; type?: { name?: string }[] } }[]
        };

        const disasters = data.data ?? [];
        let floodCount  = 0;

        for (const d of disasters) {
          const name  = (d.fields?.name ?? "").toLowerCase();
          const types = (d.fields?.type ?? []).map((t) => (t.name ?? "").toLowerCase());

          const isFlood = types.some((t) => t.includes("flood")) ||
                          name.includes("flood") || name.includes("monsoon");

          const mentionsDistrict = name.includes(district.toLowerCase());

          if (isFlood) {
            floodCount += mentionsDistrict ? 1.5 : 0.5;
          }
        }

        recordSuccess("reliefweb", district);
        return { floodIndex: Math.min(floodCount / 3, 1.0) };
      } catch {
        recordFailure("reliefweb", district);
        return null;
      }
    },
    { timeoutMs: 20_000, negativeTtlMs: 30_000, signal },
  );
}

// ── Source 4: USGS Earthquake API ────────────────────────────────────────────
// Earthquakes within 100km of the coordinate in the last 30 days

async function fetchUsgsEarthquake(lat: number, lon: number, signal?: AbortSignal): Promise<number | null> {
  if (lat === 0 && lon === 0) return null;

  const district = "global";
  if (isCircuitOpen("usgs", district)) return null;
  return externalApiCache.getOrFetch(
    `usgs:${lat.toFixed(1)}:${lon.toFixed(1)}`,
    5 * 60_000,
    async () => {
      try {
        const from = daysAgo(30);
        const url  = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${from}&latitude=${lat}&longitude=${lon}&maxradiuskm=100&minmagnitude=3.0`;

        const res = await fetchWithRetry("usgs", district, async (opts) => {
          const r = await fetch(url, {
            signal: opts?.signal ?? AbortSignal.timeout(8_000),
            cache:  "no-store",
          });
          return r.ok ? r : null;
        }, 2, signal);

        if (!res) return null;

        const data = await res.json() as {
          features?: { properties?: { mag?: number } }[]
        };

        const quakes = data.features ?? [];
        if (quakes.length === 0) return 0;

        const maxMag = Math.max(...quakes.map((q) => q.properties?.mag ?? 0));

        if (maxMag >= 7.0) return 1.0;
        if (maxMag >= 6.0) return 0.8;
        if (maxMag >= 5.0) return 0.5;
        if (maxMag >= 4.0) return 0.3;
        return 0.1;
      } catch {
        recordFailure("usgs", district);
        return null;
      }
    },
    { timeoutMs: 20_000, negativeTtlMs: 30_000, signal },
  );
}

// ── Source 5: Air Quality — OpenAQ + OWM fallback ────────────────────────────
// OpenAQ has ground-level sensors across Nepal (Kathmandu Valley especially)
// Falls back to OWM air pollution API if no nearby OpenAQ sensor

async function fetchAirQuality(lat: number, lon: number, district: string, signal?: AbortSignal): Promise<number> {
  const openAQ = await fetchOpenAQ(lat, lon, signal);
  if (openAQ !== null) return openAQ;

  const owm = await fetchOwmAirQuality(lat, lon, signal);
  if (owm !== null) return owm;

  return defaultAirQuality(district);
}

async function fetchOpenAQ(lat: number, lon: number, signal?: AbortSignal): Promise<number | null> {
  if (lat === 0 && lon === 0) return null;

  const district = "global";
  if (isCircuitOpen("openaq", district)) return null;
  return externalApiCache.getOrFetch(
    `openaq:${lat.toFixed(1)}:${lon.toFixed(1)}`,
    10 * 60_000,
    async () => {
      try {
        const url = `https://api.openaq.org/v2/measurements?coordinates=${lat},${lon}&radius=25000&limit=100&parameter=pm25&order_by=datetime&sort=desc`;

        const res = await fetchWithRetry("openaq", district, async (opts) => {
          const r = await fetch(url, {
            signal:  opts?.signal ?? AbortSignal.timeout(8_000),
            headers: { Accept: "application/json" },
            cache:   "no-store",
          });
          return r.ok ? r : null;
        }, 2, signal);

        if (!res) return null;

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

        recordSuccess("openaq", district);
        if (avgPm25 >= 150) return 1.0;
        if (avgPm25 >= 100) return 0.8;
        if (avgPm25 >= 55)  return 0.6;
        if (avgPm25 >= 35)  return 0.4;
        if (avgPm25 >= 12)  return 0.2;
        return 0.05;
      } catch {
        recordFailure("openaq", district);
        return null;
      }
    },
    { timeoutMs: 20_000, negativeTtlMs: 30_000, signal },
  );
}

async function fetchOwmAirQuality(lat: number, lon: number, signal?: AbortSignal): Promise<number | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || lat === 0 && lon === 0) return null;

  const district = "global";
  if (isCircuitOpen("owm", district)) return null;
  return externalApiCache.getOrFetch(
    `owm:${lat.toFixed(1)}:${lon.toFixed(1)}`,
    10 * 60_000,
    async () => {
      try {
        const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
        const res = await fetchWithRetry("owm", district, async (opts) => {
          const r = await fetch(url, { signal: opts?.signal ?? AbortSignal.timeout(6_000), cache: "no-store" });
          return r.ok ? r : null;
        }, 2, signal);
        if (!res) return null;

        const data = await res.json() as { list?: { main?: { aqi?: number } }[] };
        const aqi  = data.list?.[0]?.main?.aqi ?? 2;

        const map: Record<number, number> = { 1: 0.0, 2: 0.2, 3: 0.5, 4: 0.75, 5: 1.0 };
        return map[aqi] ?? 0.2;
      } catch {
        recordFailure("owm", district);
        return null;
      }
    },
    { timeoutMs: 15_000, negativeTtlMs: 30_000, signal },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Season-aware fallback when ALL external sources are unreachable.
 * Nepal monsoon: June–September → elevated flood + landslide risk
 */
function seasonalFallback(): [number, number] {
  const month     = new Date().getMonth() + 1; // 1–12
  const isMonsoon = month >= 6 && month <= 9;
  const isShoulder = month === 5 || month === 10;

  if (isMonsoon)  return [0.55, 0.55];
  if (isShoulder) return [0.20, 0.20];
  return                 [0.05, 0.05];
}

/**
 * District-based air quality defaults — last resort when all APIs fail.
 * Based on known Nepal air quality patterns.
 */
function defaultAirQuality(district: string): number {
  const d = district.toLowerCase();
  if (["kathmandu","bhaktapur","lalitpur","kavrepalanchok"].some((x) => d.includes(x))) return 0.65;
  if (["bara","parsa","rupandehi","banke","kailali"].some((x) => d.includes(x)))         return 0.35;
  if (["solukhumbu","manang","mustang","humla","dolpa","mugu"].some((x) => d.includes(x))) return 0.05;
  return 0.15;
}

/** Returns YYYY-MM-DD for N days ago */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/** Round to 2 decimal places */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
