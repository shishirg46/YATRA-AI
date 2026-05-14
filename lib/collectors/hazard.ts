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
 *     https://api.reliefweb.int/v1/disasters
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
 */

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
  lon: number
): Promise<HazardSnapshot> {

  // Query all sources in parallel — each returns partial indices or null on failure
  const [bipad, eonet, reliefweb, usgs, airQuality] = await Promise.all([
    fetchBipad(districtName),
    fetchEonet(lat, lon),
    fetchReliefWeb(districtName),
    fetchUsgsEarthquake(lat, lon),
    fetchAirQuality(lat, lon, districtName),
  ]);

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

  // If no real data from any source, use seasonal fallback
  const hasRealData = sources.length > 0;
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

async function fetchBipad(district: string): Promise<BipadResult | null> {
  try {
    const from = daysAgo(30);
    const url  = `https://bipadportal.gov.np/api/v1/incident/?district__title_en=${encodeURIComponent(district)}&date_of_incident__gte=${from}&format=json&limit=100`;

    const res = await fetch(url, {
      signal:  AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
      cache:   "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json() as { results?: { incident_type?: { title?: string }; hazard?: { title?: string } }[] };
    const incidents = data.results ?? [];

    let flood = 0, landslide = 0;

    for (const inc of incidents) {
      const type = (inc.incident_type?.title ?? inc.hazard?.title ?? "").toLowerCase();
      if (type.includes("flood") || type.includes("inundation") || type.includes("बाढी")) flood++;
      if (type.includes("landslide") || type.includes("debris") || type.includes("पहिरो")) landslide++;
    }

    return {
      floodIndex:     Math.min(flood / 5, 1.0),
      landslideIndex: Math.min(landslide / 5, 1.0),
    };
  } catch {
    return null;
  }
}

// ── Source 2: NASA EONET ─────────────────────────────────────────────────────
// Active natural events within ~200km of the coordinate

interface EonetResult { floodIndex: number; landslideIndex: number }

async function fetchEonet(lat: number, lon: number): Promise<EonetResult | null> {
  try {
    // EONET categories: 12=Landslides, 9=Sea and Lake Ice, 10=Severe Storms, 6=Floods
    const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&bbox=${lon - 2},${lat - 2},${lon + 2},${lat + 2}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      cache:  "no-store",
    });

    if (!res.ok) return null;

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
      // Severe storms also raise flood risk
      if (cats.includes("severeStorms")) floodEvents += 0.5;
    }

    // Each active EONET event in the region is significant — cap at 2 events = index 1.0
    return {
      floodIndex:     Math.min(floodEvents / 2, 1.0),
      landslideIndex: Math.min(landslideEvents / 2, 1.0),
    };
  } catch {
    return null;
  }
}

// ── Source 3: ReliefWeb API ──────────────────────────────────────────────────
// UN humanitarian disaster reports mentioning Nepal + district

interface ReliefWebResult { floodIndex: number }

async function fetchReliefWeb(district: string): Promise<ReliefWebResult | null> {
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

    const res = await fetch("https://api.reliefweb.int/v1/disasters?appname=yatraai", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(8_000),
      cache:  "no-store",
    });

    if (!res.ok) return null;

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

      // Check if this disaster mentions the district or is a general Nepal disaster
      const mentionsDistrict = name.includes(district.toLowerCase());

      if (isFlood) {
        floodCount += mentionsDistrict ? 1.5 : 0.5; // weight higher if district-specific
      }
    }

    return { floodIndex: Math.min(floodCount / 3, 1.0) };
  } catch {
    return null;
  }
}

// ── Source 4: USGS Earthquake API ────────────────────────────────────────────
// Earthquakes within 100km of the coordinate in the last 30 days

async function fetchUsgsEarthquake(lat: number, lon: number): Promise<number | null> {
  try {
    // Skip if no real coordinates
    if (lat === 0 && lon === 0) return null;

    const from = daysAgo(30);
    const url  = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${from}&latitude=${lat}&longitude=${lon}&maxradiuskm=100&minmagnitude=3.0`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      cache:  "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      features?: { properties?: { mag?: number } }[]
    };

    const quakes = data.features ?? [];
    if (quakes.length === 0) return 0;

    // Find the maximum magnitude in the period
    const maxMag = Math.max(...quakes.map((q) => q.properties?.mag ?? 0));

    // Convert magnitude to 0–1 index
    // Mag 3.0 = 0.1 (minor), Mag 5.0 = 0.5 (moderate), Mag 7.0+ = 1.0 (major)
    if (maxMag >= 7.0) return 1.0;
    if (maxMag >= 6.0) return 0.8;
    if (maxMag >= 5.0) return 0.5;
    if (maxMag >= 4.0) return 0.3;
    return 0.1;
  } catch {
    return null;
  }
}

// ── Source 5: Air Quality — OpenAQ + OWM fallback ────────────────────────────
// OpenAQ has ground-level sensors across Nepal (Kathmandu Valley especially)
// Falls back to OWM air pollution API if no nearby OpenAQ sensor

async function fetchAirQuality(lat: number, lon: number, district: string): Promise<number> {
  // Try OpenAQ first — more accurate for Nepal urban areas
  const openAQ = await fetchOpenAQ(lat, lon);
  if (openAQ !== null) return openAQ;

  // Fall back to OWM air pollution
  const owm = await fetchOwmAirQuality(lat, lon);
  if (owm !== null) return owm;

  // Last resort: district-based defaults
  return defaultAirQuality(district);
}

async function fetchOpenAQ(lat: number, lon: number): Promise<number | null> {
  try {
    if (lat === 0 && lon === 0) return null;

    // Search for measurements within 25km radius, last 24h
    const url = `https://api.openaq.org/v2/measurements?coordinates=${lat},${lon}&radius=25000&limit=100&parameter=pm25&order_by=datetime&sort=desc`;

    const res = await fetch(url, {
      signal:  AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
      cache:   "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      results?: { value?: number; parameter?: string }[]
    };

    const readings = (data.results ?? [])
      .filter((r) => r.parameter === "pm25" && typeof r.value === "number" && r.value > 0)
      .map((r) => r.value as number);

    if (readings.length === 0) return null;

    // Average the readings
    const avgPm25 = readings.reduce((a, b) => a + b, 0) / readings.length;

    // Convert PM2.5 (μg/m³) to 0–1 index using WHO + Nepal standards
    // WHO guideline: 15 μg/m³ annual, 25 μg/m³ 24h
    // Nepal: Kathmandu often 60–200+ μg/m³
    if (avgPm25 >= 150) return 1.0;   // hazardous
    if (avgPm25 >= 100) return 0.8;   // very unhealthy
    if (avgPm25 >= 55)  return 0.6;   // unhealthy
    if (avgPm25 >= 35)  return 0.4;   // unhealthy for sensitive groups
    if (avgPm25 >= 12)  return 0.2;   // moderate
    return 0.05;                       // good
  } catch {
    return null;
  }
}

async function fetchOwmAirQuality(lat: number, lon: number): Promise<number | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || lat === 0 && lon === 0) return null;

  try {
    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(6_000), cache: "no-store" });
    if (!res.ok) return null;

    const data = await res.json() as { list?: { main?: { aqi?: number } }[] };
    const aqi  = data.list?.[0]?.main?.aqi ?? 2; // OWM: 1=Good 2=Fair 3=Moderate 4=Poor 5=VeryPoor

    const map: Record<number, number> = { 1: 0.0, 2: 0.2, 3: 0.5, 4: 0.75, 5: 1.0 };
    return map[aqi] ?? 0.2;
  } catch {
    return null;
  }
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
