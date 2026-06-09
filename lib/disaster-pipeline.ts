import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/routing/geo";

export type DisasterType = "flood" | "landslide" | "earthquake";

export interface DisasterEventRecord {
  externalId: string;
  type: DisasterType;
  lat: number;
  lon: number;
  date: string;
  severity: string;
  source: "bipad" | "usgs";
  metadata?: Record<string, unknown>;
}

export interface SegmentRiskInput {
  sampledPoints: { lat: number; lon: number }[];
  weather?: {
    rain_mm_per_hr?: number;
    wind_kph?: number;
  };
  realtimeDisasters?: Array<{ type: DisasterType; lat: number; lon: number }>;
  historicalDisasters?: Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>;
}

export interface SegmentRiskOutput {
  riskPercent: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  breakdown: {
    weather: number;
    realtime: number;
    historical: number;
    terrain: number;
  };
  alerts: string[];
  note?: string;
  clusters?: {
    realtime: number;
    historical: number;
    total: number;
  };
}

export interface DisasterCluster {
  type: DisasterType;
  center: { lat: number; lon: number };
  count: number;
  nearestDistanceKm: number;
  region: "Terai" | "Hill" | "Mountain";
}

export interface RouteRiskSegment {
  from: string;
  to: string;
  midpoint: { lat: number; lon: number };
  region: "Terai" | "Hill" | "Mountain";
  risk: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  alerts: string[];
}

export interface RouteRiskResult {
  routeRisk: { percent: number; level: "LOW" | "MEDIUM" | "HIGH" };
  clusters: number;
  alerts: string[];
  segments: RouteRiskSegment[];
}

/**
 * Per-segment independent hazard scores.
 * Each hazard is evaluated independently for each route segment.
 * - Mountain roads → naturally higher landslide exposure
 * - River corridors → naturally higher flood exposure
 * - Weather effects → vary by location and time
 */
export interface IndependentHazardScores {
  landslideExposure: number;    // 0-100, based on gradient + terrain + rainfall + historical
  floodExposure: number;        // 0-100, based on river proximity + terrain + rainfall + historical
  weatherRisk: number;          // 0-100, based on rainfall + wind + temperature
  roadConditionRisk: number;    // 0-100, based on surface type + gradient + reliability
  seismicRisk: number;          // 0-100, based on earthquake history + proximity
  composite: number;            // 0-100, weighted blend
}

export interface HazardEvaluationInput extends SegmentRiskInput {
  avgLat?: number;              // Used to infer terrain zone
  avgGradient?: number | null;  // Used for landslide/road condition scoring
  hasRiverProximity?: boolean;  // Used for flood scoring
  surfaceType?: string | null;  // Used for road condition scoring
  reliabilityScore?: number | null; // Used for road condition scoring
  landslideRisk?: number | null;    // Edge-level static risk
  floodRisk?: number | null;        // Edge-level static risk
}

export async function ensureDisasterEventTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS yatra_disaster_events (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT NOT NULL,
      type TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      severity TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source, external_id)
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_disaster_events_lat_lon ON yatra_disaster_events (lat, lon);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_disaster_events_date ON yatra_disaster_events (date);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_disaster_events_type ON yatra_disaster_events (type);`);
}

export async function fetchBipadData(startDate: string, endDate: string): Promise<any> {
  const incidentBase = "https://bipadportal.gov.np/api/v1/incident/";
  const eventBase = "https://bipadportal.gov.np/api/v1/event/";

  const incidentQueries = [
    // Rich endpoint variant (recommended)
    `?rainBasin=&rainStation=&riverBasin=&riverStation=&hazard=&inventoryItems=&incident_on__gt=${encodeURIComponent(startDate)}&incident_on__lt=${encodeURIComponent(endDate)}&expand=loss,event,wards&ordering=-incident_on&limit=500&data_source=drr_api`,
    // Keep only strict window variants; broad gte/lte variants can leak national data.
    `?incident_on__gt=${encodeURIComponent(startDate)}&incident_on__lt=${encodeURIComponent(endDate)}&limit=500&offset=0&ordering=-incident_on&data_source=drr_api`,
    `?date_of_incident__gt=${encodeURIComponent(startDate)}&date_of_incident__lt=${encodeURIComponent(endDate)}&limit=500&offset=0&ordering=-date_of_incident`,
  ];

  const eventQueries = [
    `?rainBasin=&rainStation=&riverBasin=&riverStation=&hazard=&inventoryItems=&incident_on__gt=${encodeURIComponent(startDate)}&incident_on__lt=${encodeURIComponent(endDate)}&ordering=-incident_on&limit=500&data_source=drr_api`,
    `?incident_on__gt=${encodeURIComponent(startDate)}&incident_on__lt=${encodeURIComponent(endDate)}&ordering=-incident_on&limit=500&data_source=drr_api`,
  ];

  const incidentRows = await fetchBipadRows(incidentBase, incidentQueries, "incident", startDate, endDate);
  const eventRows = await fetchBipadRows(eventBase, eventQueries, "event", startDate, endDate);

  const dedup = new Map<string, any>();
  for (const r of [...incidentRows, ...eventRows]) {
    const k = String(r?.id ?? `${r?.incident_on ?? r?.date_of_incident ?? "unknown"}:${r?.title ?? r?.event?.title ?? "unknown"}`);
    if (!dedup.has(k)) dedup.set(k, r);
  }
  return { results: [...dedup.values()] };
}

async function fetchBipadRows(
  base: string,
  queries: string[],
  label: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const merged: any[] = [];
  const seenIds = new Set<string>();
  const startTs = Date.parse(startDate);
  const endTs = Date.parse(endDate);

  for (const query of queries) {
    let url: string | null = `${base}${query}`;
    let page = 0;
    try {
      while (url) {
        page += 1;
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`BIPAD ${label} failed ${res.status} url=${url} body=${body.slice(0, 240)}`);
        }
        const data = await res.json() as { results?: any[]; next?: string | null };
        const rows = Array.isArray(data?.results) ? data.results : [];
        for (const row of rows) {
          const rowTs = Date.parse(String(row?.incident_on ?? row?.date_of_incident ?? ""));
          if (Number.isFinite(startTs) && Number.isFinite(endTs) && Number.isFinite(rowTs)) {
            if (rowTs < startTs || rowTs > endTs) continue;
          }
          const id = String(row?.id ?? "");
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);
          merged.push(row);
        }
        url = data?.next ?? null;
        if (page > 200) break;
      }
      if (merged.length > 0) {
        console.log(`[disaster-ingest] bipad ${label} success: fetched=${merged.length} query=${query.slice(0, 100)}...`);
        // Stop at first successful query variant to avoid overfetch from looser fallbacks.
        break;
      }
    } catch (error) {
      console.warn(`[disaster-ingest] bipad ${label} query failed: ${String(error)}`);
    }
  }

  return merged;
}

export function transformBipad(data: any): DisasterEventRecord[] {
  const rows = Array.isArray(data?.results) ? data.results : [];
  let droppedNoCoords = 0;
  let droppedUnknownType = 0;

  function extractCoords(item: any): { lat: number; lon: number } | null {
    const candidates = [
      item?.point?.coordinates,
      item?.point_geojson?.coordinates,
      item?.geometry?.coordinates,
      item?.location?.coordinates,
      item?.incident_location?.coordinates,
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length >= 2) {
        const lon = Number(c[0]);
        const lat = Number(c[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
      }
    }
    const lat = Number(item?.latitude ?? item?.lat);
    const lon = Number(item?.longitude ?? item?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return null;
  }

  function classifyType(item: any): DisasterType | null {
    const blob = [
      item?.event?.title,
      item?.event?.title_en,
      item?.event?.title_np,
      item?.hazard?.title,
      item?.hazard?.title_en,
      item?.hazard?.title_np,
      item?.incident_type?.title,
      item?.incident_type?.title_en,
      item?.incident_type?.title_np,
      item?.title,
      item?.description,
      item?.remarks,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (
      blob.includes("flood") ||
      blob.includes("inundation") ||
      blob.includes("flash flood") ||
      blob.includes("बाढी")
    ) return "flood";
    if (
      blob.includes("landslide") ||
      blob.includes("debris flow") ||
      blob.includes("पहिरो")
    ) return "landslide";
    if (
      blob.includes("earthquake") ||
      blob.includes("aftershock") ||
      blob.includes("भूकम्प")
    ) return "earthquake";
    return null;
  }

  const transformed = rows
    .map((item: any) => {
      const coords = extractCoords(item);
      if (!coords) {
        droppedNoCoords += 1;
        return null;
      }
      const type = classifyType(item);
      if (!type) {
        droppedUnknownType += 1;
        return null;
      }
      const loss = Number(item?.loss?.estimated_loss ?? 0);
      const severity = loss > 1_000_000 ? "high" : loss > 100_000 ? "medium" : "low";
      const people = item?.people_affected || item?.loss || {};
      return {
        externalId: String(item?.id ?? crypto.randomUUID()),
        type,
        lat: coords.lat,
        lon: coords.lon,
        date: item?.incident_on || item?.date_of_incident || new Date().toISOString(),
        severity,
        source: "bipad",
        metadata: {
          title: String(item?.event?.title || item?.incident_type?.title || item?.hazard?.title || item?.title || ""),
          district: item?.district?.title_en ?? null,
          ward: item?.ward?.title_en ?? null,
          municipality: item?.municipality?.title_en ?? null,
          province: item?.province?.title_en ?? null,
          dead: Number(people?.death ?? people?.dead ?? 0),
          injured: Number(people?.injured ?? 0),
          missing: Number(people?.missing ?? 0),
          affected: Number(people?.affected ?? 0),
          displaced: Number(people?.displaced ?? 0),
          estimated_loss: Number(item?.loss?.estimated_loss ?? 0),
          houses_damaged: Number(item?.loss?.houses_damaged ?? 0),
          livestock_loss: Number(item?.loss?.livestock_loss ?? 0),
          incident_url: item?.url ?? null,
        },
      };
    })
    .filter((d: DisasterEventRecord | null): d is DisasterEventRecord => !!d)
    .filter((d: DisasterEventRecord) => Number.isFinite(d.lat) && Number.isFinite(d.lon));

  console.log(`[disaster-ingest] transformBipad rows=${rows.length} kept=${transformed.length} droppedNoCoords=${droppedNoCoords} droppedUnknownType=${droppedUnknownType}`);
  return transformed;
}

export async function fetchUsgsRealtime(days = 7): Promise<DisasterEventRecord[]> {
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  // Nepal-focused bounding box to avoid global earthquake leakage.
  const minLatitude = 26.2;
  const maxLatitude = 30.5;
  const minLongitude = 80.0;
  const maxLongitude = 89.0;
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&minlatitude=${minLatitude}&maxlatitude=${maxLatitude}&minlongitude=${minLongitude}&maxlongitude=${maxLongitude}&minmagnitude=3.0`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`USGS failed ${res.status}`);
  const data = await res.json() as any;
  const features = Array.isArray(data?.features) ? data.features : [];
  return features
    .filter((f: any) => Array.isArray(f?.geometry?.coordinates))
    .map((f: any) => {
      const mag = Number(f?.properties?.mag ?? 0);
      return {
        externalId: String(f?.id ?? crypto.randomUUID()),
        type: "earthquake" as const,
        lat: Number(f.geometry.coordinates[1]),
        lon: Number(f.geometry.coordinates[0]),
        date: new Date(Number(f?.properties?.time ?? Date.now())).toISOString(),
        severity: mag >= 6 ? "high" : mag >= 5 ? "medium" : "low",
        source: "usgs" as const,
        metadata: { mag, place: f?.properties?.place ?? null },
      };
    })
    .filter((d: DisasterEventRecord) => Number.isFinite(d.lat) && Number.isFinite(d.lon));
}

export async function storeDisasterEvents(records: DisasterEventRecord[]): Promise<number> {
  if (!records.length) return 0;
  await ensureDisasterEventTable();
  let inserted = 0;
  for (const r of records) {
    const result = await prisma.$executeRawUnsafe(
      `INSERT INTO yatra_disaster_events (external_id, type, lat, lon, date, severity, source, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (source, external_id) DO NOTHING;`,
      r.externalId,
      r.type,
      r.lat,
      r.lon,
      r.date,
      r.severity,
      r.source,
      JSON.stringify(r.metadata ?? {})
    );
    if (Number(result) > 0) inserted += 1;
  }
  return inserted;
}

export async function ingestHistoricalBipad(
  fromYear = 2020,
  toYear = new Date().getFullYear()
): Promise<{ inserted: number; years: number[]; progress: Array<{ year: number; fetched: number; inserted: number; skipped: number }> }> {
  let inserted = 0;
  const years: number[] = [];
  const progress: Array<{ year: number; fetched: number; inserted: number; skipped: number }> = [];

  console.log(`[disaster-ingest] historical backfill start: ${fromYear} -> ${toYear}`);
  for (let y = fromYear; y <= toYear; y++) {
    years.push(y);
    const start = `${y}-01-01`;
    const end = `${y}-12-31`;
    const data = await fetchBipadData(start, end);
    const transformed = transformBipad(data);
    const insertedYear = await storeDisasterEvents(transformed);
    inserted += insertedYear;
    const skipped = transformed.length - insertedYear;
    progress.push({ year: y, fetched: transformed.length, inserted: insertedYear, skipped });
    console.log(`[disaster-ingest] year=${y} fetched=${transformed.length} inserted=${insertedYear} skipped=${skipped} totalInserted=${inserted}`);
  }
  console.log(`[disaster-ingest] historical backfill complete: totalInserted=${inserted}`);
  return { inserted, years, progress };
}

export async function ensureRecentRealtimeData(maxAgeHours = 1): Promise<void> {
  await ensureDisasterEventTable();
  const latest = await prisma.yatra_disaster_events.findFirst({
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  if (!latest) {
    await ingestRealtime(24);
    return;
  }
  const ageHours = (Date.now() - new Date(latest.date).getTime()) / 3600000;
  if (ageHours > maxAgeHours) {
    await ingestRealtime(24);
  }
}

export async function ingestRealtime(lastHours = 24): Promise<{ inserted: number }> {
  const now = new Date();
  const start = new Date(now.getTime() - lastHours * 60 * 60 * 1000).toISOString().split("T")[0];
  const end = now.toISOString().split("T")[0];
  const [bipadData, quakes] = await Promise.all([
    fetchBipadData(start, end).then(transformBipad).catch(() => [] as DisasterEventRecord[]),
    fetchUsgsRealtime(7).catch(() => [] as DisasterEventRecord[]),
  ]);
  const merged = [...bipadData, ...quakes];
  console.log(`[disaster-ingest] realtime start: hours=${lastHours} fetched=${merged.length} (bipad=${bipadData.length}, usgs=${quakes.length})`);
  const inserted = await storeDisasterEvents(merged);
  console.log(`[disaster-ingest] realtime complete: inserted=${inserted}`);
  return { inserted };
}

export async function fetchHistoricalDisastersNearRoute(
  routePoints: { lat: number; lon: number }[],
  radiusKm = 5
): Promise<Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>> {
  if (!routePoints.length) return [];
  await ensureDisasterEventTable();
  const latMin = Math.min(...routePoints.map((p) => p.lat)) - radiusKm / 111;
  const latMax = Math.max(...routePoints.map((p) => p.lat)) + radiusKm / 111;
  const lonMin = Math.min(...routePoints.map((p) => p.lon)) - radiusKm / 111;
  const lonMax = Math.max(...routePoints.map((p) => p.lon)) + radiusKm / 111;

  const rows = await prisma.$queryRawUnsafe<Array<{ type: string; lat: number; lon: number; count: number }>>(
    `SELECT type, lat, lon, COUNT(*)::int as count
     FROM yatra_disaster_events
     WHERE source = 'bipad'
       AND date >= '2020-01-01'
       AND type IN ('flood','landslide')
       AND lat BETWEEN $1 AND $2
       AND lon BETWEEN $3 AND $4
     GROUP BY type, lat, lon;`,
    latMin, latMax, lonMin, lonMax
  );

  const mapped = rows.map((r) => ({ type: r.type as "flood" | "landslide", lat: r.lat, lon: r.lon, count: Number(r.count) }));
  return mapped.filter((d) => isNearRoute(d, routePoints, radiusKm));
}

export async function getDisasterImpactSummary(
  routePoints: { lat: number; lon: number }[],
  radiusKm = 10
): Promise<{ dead: number; injured: number; missing: number; affected: number; displaced: number }> {
  if (!routePoints.length) return { dead: 0, injured: 0, missing: 0, affected: 0, displaced: 0 };
  await ensureDisasterEventTable();
  const latMin = Math.min(...routePoints.map((p) => p.lat)) - radiusKm / 111;
  const latMax = Math.max(...routePoints.map((p) => p.lat)) + radiusKm / 111;
  const lonMin = Math.min(...routePoints.map((p) => p.lon)) - radiusKm / 111;
  const lonMax = Math.max(...routePoints.map((p) => p.lon)) + radiusKm / 111;

  const rows = await prisma.$queryRawUnsafe<Array<{
    dead: number | null; injured: number | null; missing: number | null; affected: number | null; displaced: number | null;
  }>>(
    `SELECT
      COALESCE(SUM((metadata->>'dead')::int),0)      AS dead,
      COALESCE(SUM((metadata->>'injured')::int),0)   AS injured,
      COALESCE(SUM((metadata->>'missing')::int),0)   AS missing,
      COALESCE(SUM((metadata->>'affected')::int),0)  AS affected,
      COALESCE(SUM((metadata->>'displaced')::int),0) AS displaced
     FROM yatra_disaster_events
     WHERE type IN ('flood','landslide','earthquake')
       AND lat BETWEEN $1 AND $2
       AND lon BETWEEN $3 AND $4;`,
    latMin, latMax, lonMin, lonMax
  );
  const row = rows[0] ?? { dead: 0, injured: 0, missing: 0, affected: 0, displaced: 0 };
  return {
    dead: Number(row.dead ?? 0),
    injured: Number(row.injured ?? 0),
    missing: Number(row.missing ?? 0),
    affected: Number(row.affected ?? 0),
    displaced: Number(row.displaced ?? 0),
  };
}

export async function fetchRealtimeDisastersNearRoute(
  routePoints: { lat: number; lon: number }[],
  radiusKm = 8,
  days = 7
): Promise<Array<{ type: DisasterType; lat: number; lon: number }>> {
  if (!routePoints.length) return [];
  await ensureDisasterEventTable();
  const deg = radiusKm / 111;
  const latMin = Math.min(...routePoints.map((p) => p.lat)) - deg;
  const latMax = Math.max(...routePoints.map((p) => p.lat)) + deg;
  const lonMin = Math.min(...routePoints.map((p) => p.lon)) - deg;
  const lonMax = Math.max(...routePoints.map((p) => p.lon)) + deg;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = await prisma.$queryRawUnsafe<Array<{ type: DisasterType; lat: number; lon: number }>>(
    `SELECT type, lat, lon
     FROM yatra_disaster_events
     WHERE date >= $1
       AND severity != 'low'
       AND lat BETWEEN $2 AND $3
       AND lon BETWEEN $4 AND $5;`,
    since, latMin, latMax, lonMin, lonMax
  );
  const deduped = dedupeRealtimeEvents(rows);
  return deduped.filter((d) => isNearRoute(d, routePoints, radiusKm));
}

export async function fetchDHMWeather(lat: number, lon: number): Promise<{ rain_mm_per_hr: number; wind_kph: number }> {
  // Using DHM API instead of Open-Meteo
  try {
    const url = `https://dhm.gov.np/mfd/api/forecast?lat=${lat}&lng=${lon}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { rain_mm_per_hr: 0, wind_kph: 0 };
    
    const data = await res.json() as any;
    // DHM provides wind_speed in m/s, convert to kph (1 m/s = 3.6 kph)
    const windMps = Number(data?.hourly_forecast?.[0]?.wind_speed ?? 0);
    const windKph = windMps * 3.6;
    
    return {
      rain_mm_per_hr: Number(data?.hourly_forecast?.[0]?.hourly_precipitation ?? 0),
      wind_kph: windKph,
    };
  } catch {
    return { rain_mm_per_hr: 0, wind_kph: 0 };
  }
}

export function calculateRisk(
  routePoints: { lat: number; lon: number }[],
  realtime: Array<{ type: DisasterType; lat: number; lon: number }>,
  historical: Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>,
  weather: { rain_mm_per_hr?: number; wind_kph?: number }
): SegmentRiskOutput {
  return calculateSegmentHazardRisk({
    sampledPoints: sampleRoutePoints(routePoints, 10),
    realtimeDisasters: realtime,
    historicalDisasters: historical,
    weather,
  });
}

export function calculateSegmentOwnedRouteRisk(input: {
  routePoints: { lat: number; lon: number }[];
  realtimeDisasters: Array<{ type: DisasterType; lat: number; lon: number }>;
  historicalDisasters: Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>;
  weather: { rain_mm_per_hr?: number; wind_kph?: number };
  segments?: Array<{ from?: string; to?: string; midpoint?: { lat: number; lon: number } }>;
}): RouteRiskResult {
  const routePoints = sampleRoutePoints(input.routePoints ?? [], 10);
  if (!routePoints.length) {
    return {
      routeRisk: { percent: 15, level: "LOW" },
      clusters: 0,
      alerts: ["No data available, using baseline risk"],
      segments: [],
    };
  }

  const segments = buildRouteSegments(routePoints, input.segments);
  const nearRealtime = (input.realtimeDisasters ?? []).filter((d) => isNearAnySegment(d, segments, 10));
  const nearHistorical = (input.historicalDisasters ?? []).filter((d) => isNearAnySegment(d, segments, 10));

  const realtimeBySegment = assignRealtimeToNearestSegment(nearRealtime, segments);
  const historicalBySegment = assignHistoricalToNearestSegment(nearHistorical, segments);

  const segmentOutputs: RouteRiskSegment[] = [];
  let totalClusters = 0;
  const routeAlertKeys = new Set<string>();
  const routeAlerts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segRealtime = realtimeBySegment.get(i) ?? [];
    const segHistorical = historicalBySegment.get(i) ?? [];

    const realtimeClusters = clusterRealtimeDisasters(segRealtime, seg.points, 5);
    const historicalClusters = clusterHistoricalDisasters(segHistorical, seg.points, 5);
    totalClusters += realtimeClusters.length + historicalClusters.length;

    const scored = scoreSegmentFromClusters({
      segment: seg,
      realtimeClusters,
      historicalClusters,
      weather: input.weather ?? {},
    });

    for (const msg of scored.alerts) {
      const key = msg;
      if (routeAlertKeys.has(key)) continue;
      routeAlertKeys.add(key);
      routeAlerts.push(msg);
    }

    segmentOutputs.push({
      from: seg.from,
      to: seg.to,
      midpoint: seg.midpoint,
      region: seg.region,
      risk: scored.riskPercent,
      level: scored.riskLevel,
      alerts: scored.alerts,
    });
  }

  const avg = segmentOutputs.length
    ? Math.round(segmentOutputs.reduce((s, seg) => s + seg.risk, 0) / segmentOutputs.length)
    : 15;
  const routeLevel: "LOW" | "MEDIUM" | "HIGH" = avg > 70 ? "HIGH" : avg > 40 ? "MEDIUM" : "LOW";

  return {
    routeRisk: { percent: Math.min(100, avg), level: routeLevel },
    clusters: totalClusters,
    alerts: routeAlerts,
    segments: segmentOutputs,
  };
}

export function calculateSegmentHazardRisk(input: SegmentRiskInput): SegmentRiskOutput {
  let weatherRisk = 0;
  let realtimeRiskRaw = 0;
  let historicalRiskRaw = 0;
  let terrainRisk = 0;
  const alertKeys = new Set<string>();
  const alerts: string[] = [];

  const routePoints = sampleRoutePoints(input.sampledPoints ?? [], 10);
  const rain = Number(input.weather?.rain_mm_per_hr ?? 0);
  const realtime = input.realtimeDisasters ?? [];
  const historical = input.historicalDisasters ?? [];

  // Critical: route-buffer filtering before any risk math.
  const filteredRealtime = realtime.filter((d) => isNearRoute(d, routePoints, 10));
  const filteredHistorical = historical.filter((d) => isNearRoute(d, routePoints, 10));
  const realtimeClusters = clusterRealtimeDisasters(filteredRealtime, routePoints, 5);
  const historicalClusters = clusterHistoricalDisasters(filteredHistorical, routePoints, 5);

  if (rain > 30) {
    weatherRisk += 0.7;
    addAlert(alertKeys, alerts, "weather:heavy-rain", "Heavy rain detected");
  } else if (rain > 10) {
    weatherRisk += 0.4;
    addAlert(alertKeys, alerts, "weather:moderate-rain", "Moderate rainfall");
  } else if (rain > 2) {
    weatherRisk += 0.1;
  }
  // Additional weather contribution from high wind, still capped later.
  const wind = Number(input.weather?.wind_kph ?? 0);
  if (wind > 60) weatherRisk += 0.2;
  else if (wind > 35) weatherRisk += 0.1;

  // Cluster-driven raw signals (no per-point multiplication).
  realtimeRiskRaw = realtimeClusters.reduce((sum, c) => {
    const base =
      c.type === "earthquake" ? 1.1 :
      c.type === "landslide" ? 1.0 : 0.9;
    const distanceFactor = c.nearestDistanceKm <= 5 ? 1.0 : 0.6;
    return sum + base * distanceFactor;
  }, 0);

  historicalRiskRaw = historicalClusters.reduce((sum, c) => {
    const intensity =
      c.count >= 12 ? 1.3 :
      c.count >= 8 ? 1.0 :
      c.count >= 5 ? 0.8 : 0.4;
    const distanceFactor = c.nearestDistanceKm <= 5 ? 1.0 : 0.7;
    return sum + intensity * distanceFactor;
  }, 0);

  // Region-aware priors only when local clustered hazards match terrain profile.
  const teraiFloodClusters = historicalClusters.filter((c) => c.region === "Terai" && c.type === "flood").length;
  const hillLandslideClusters = historicalClusters.filter((c) => c.region === "Hill" && c.type === "landslide").length;
  if (teraiFloodClusters > 0) historicalRiskRaw += Math.min(0.4, teraiFloodClusters * 0.08);
  if (hillLandslideClusters > 0) historicalRiskRaw += Math.min(0.4, hillLandslideClusters * 0.08);

  // Terrain heuristic fallback (lat proxy for Nepal hills vs terai)
  if (routePoints.length > 0) {
    const avgLat = routePoints.reduce((s, p) => s + p.lat, 0) / routePoints.length;
    terrainRisk = avgLat > 27.2 ? 0.3 : avgLat > 26.8 ? 0.2 : 0.1;
  } else {
    terrainRisk = 0.15;
  }

  const hasAnyData =
    routePoints.length > 0 ||
    filteredRealtime.length > 0 ||
    filteredHistorical.length > 0 ||
    rain > 0;
  if (!hasAnyData) {
    return {
      riskPercent: 15,
      riskLevel: "LOW",
      breakdown: { weather: 0, realtime: 0, historical: 0, terrain: 15 },
      alerts: ["No data available, using baseline risk"],
      note: "No data available, using baseline risk",
      clusters: { realtime: 0, historical: 0, total: 0 },
    };
  }

  // Critical normalization caps to prevent >100 inflation.
  weatherRisk = clamp01(weatherRisk);
  const realtimeRisk = Math.min(1, realtimeRiskRaw / 30);
  const historicalRisk = Math.min(1, historicalRiskRaw / 50);

  const total =
    weatherRisk * 0.4 +
    realtimeRisk * 0.3 +
    historicalRisk * 0.2 +
    terrainRisk * 0.1;

  const riskPercent = Math.min(100, Math.round(total * 100));
  let riskLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (riskPercent > 70) riskLevel = "HIGH";
  else if (riskPercent > 40) riskLevel = "MEDIUM";

  for (const c of historicalClusters) {
    if (c.type === "landslide" && c.count >= 5) {
      addAlert(
        alertKeys,
        alerts,
        `landslide:${c.region}:high`,
        `Landslide-prone zone near ${clusterAreaLabel(c)}`
      );
    }
    if (c.type === "flood" && c.region === "Terai") {
      addAlert(alertKeys, alerts, "flood:terai:history", "Flood history in Terai belt");
    }
  }
  for (const c of realtimeClusters) {
    if (c.type === "earthquake" && c.count >= 2) {
      addAlert(
        alertKeys,
        alerts,
        `earthquake:${c.region}:active`,
        `Seismic activity cluster in ${c.region} region`
      );
    }
  }
  if (realtimeClusters.length > 0) {
    addAlert(alertKeys, alerts, "realtime:any", "Active disaster activity near route");
  }

  return {
    riskPercent,
    riskLevel,
    breakdown: {
      weather: Math.round(weatherRisk * 0.4 * 100),
      realtime: Math.round(realtimeRisk * 0.3 * 100),
      historical: Math.round(historicalRisk * 0.2 * 100),
      terrain: Math.round(terrainRisk * 0.1 * 100),
    },
    alerts,
    clusters: {
      realtime: realtimeClusters.length,
      historical: historicalClusters.length,
      total: realtimeClusters.length + historicalClusters.length,
    },
  };
}

/**
 * Evaluate per-segment hazard scores independently.
 *
 * Each hazard type is computed independently so that the safety layer
 * can answer "How safe is this segment from landslides?" separately
 * from "How safe is this segment from floods?"
 *
 * This replaces the old blended approach where every segment showed
 * the same hazard categories.
 *
 * - Mountain roads → higher landslide exposure
 * - River corridors → higher flood exposure
 * - Weather effects → vary by location and time
 * - Road condition → based on surface type + gradient + reliability
 * - Seismic risk → based on earthquake history + proximity
 */
export function calculateIndependentHazardScores(input: HazardEvaluationInput): IndependentHazardScores {
  const routePoints = sampleRoutePoints(input.sampledPoints ?? [], 10);
  const avgLat = input.avgLat ?? (
    routePoints.length > 0
      ? routePoints.reduce((s, p) => s + p.lat, 0) / routePoints.length
      : 27.5
  );
  const rain = Number(input.weather?.rain_mm_per_hr ?? 0);
  const wind = Number(input.weather?.wind_kph ?? 0);
  const realtime = input.realtimeDisasters ?? [];
  const historical = input.historicalDisasters ?? [];

  const filteredRealtime = realtime.filter((d) => isNearRoute(d, routePoints, 10));
  const filteredHistorical = historical.filter((d) => isNearRoute(d, routePoints, 10));
  const realtimeClusters = clusterRealtimeDisasters(filteredRealtime, routePoints, 5);
  const historicalClusters = clusterHistoricalDisasters(filteredHistorical, routePoints, 5);

  // Determine terrain zone
  const terrain: "TERAI" | "HILL" | "MOUNTAIN" = avgLat < 27.0 ? "TERAI" : avgLat < 28.2 ? "HILL" : "MOUNTAIN";

  // ── 1. Landslide Exposure (0-100) ──────────────────────────────────
  let landslideScore = 0;

  // Terrain base: mountain roads are naturally landslide-prone
  if (terrain === "MOUNTAIN") landslideScore += 30;
  else if (terrain === "HILL") landslideScore += 15;
  else landslideScore += 5;

  // Edge-level static risk
  const edgeLandslide = input.landslideRisk ?? 0;
  landslideScore += edgeLandslide * 30;

  // Gradient contribution
  const gradient = input.avgGradient ?? 0;
  if (gradient > 15) landslideScore += 20;
  else if (gradient > 10) landslideScore += 12;
  else if (gradient > 5) landslideScore += 6;

  // Rainfall triggers
  if (rain > 30) landslideScore += 20;
  else if (rain > 10) landslideScore += 10;
  else if (rain > 2) landslideScore += 3;

  // Historical landslide clusters
  const lsClusters = historicalClusters.filter((c) => c.type === "landslide");
  for (const c of lsClusters) {
    const intensity = c.count >= 12 ? 1.3 : c.count >= 8 ? 1.0 : c.count >= 5 ? 0.8 : 0.4;
    const distanceFactor = c.nearestDistanceKm <= 5 ? 1.0 : 0.7;
    landslideScore += intensity * distanceFactor * 10;
  }

  // Realtime landslide events
  const realtimeLs = realtimeClusters.filter((c) => c.type === "landslide");
  landslideScore += realtimeLs.length * 15;

  landslideScore = clampToRange(landslideScore, 0, 100);

  // ── 2. Flood Exposure (0-100) ─────────────────────────────────────
  let floodScore = 0;

  // Terrain base: Terai is flood-prone
  if (terrain === "TERAI") floodScore += 25;
  else if (terrain === "HILL") floodScore += 8;
  else floodScore += 2;

  // Edge-level static flood risk
  const edgeFlood = input.floodRisk ?? 0;
  floodScore += edgeFlood * 30;

  // River proximity
  if (input.hasRiverProximity) floodScore += 15;

  // Rainfall triggers
  if (rain > 30) floodScore += 25;
  else if (rain > 10) floodScore += 12;
  else if (rain > 2) floodScore += 4;

  // Historical flood clusters
  const floodClusters = historicalClusters.filter((c) => c.type === "flood");
  for (const c of floodClusters) {
    const intensity = c.count >= 12 ? 1.3 : c.count >= 8 ? 1.0 : c.count >= 5 ? 0.8 : 0.4;
    const distanceFactor = c.nearestDistanceKm <= 5 ? 1.0 : 0.7;
    floodScore += intensity * distanceFactor * 12;
  }

  // Realtime flood events
  const realtimeFlood = realtimeClusters.filter((c) => c.type === "flood");
  floodScore += realtimeFlood.length * 15;

  floodScore = clampToRange(floodScore, 0, 100);

  // ── 3. Weather Risk (0-100) ───────────────────────────────────────
  let weatherScore = 0;

  if (rain > 30) weatherScore += 40;
  else if (rain > 10) weatherScore += 20;
  else if (rain > 2) weatherScore += 5;

  if (wind > 60) weatherScore += 20;
  else if (wind > 35) weatherScore += 10;
  else if (wind > 20) weatherScore += 3;

  // Terrain amplifies weather effects
  if (terrain === "MOUNTAIN") weatherScore = Math.round(weatherScore * 1.3);
  else if (terrain === "HILL") weatherScore = Math.round(weatherScore * 1.1);

  weatherScore = clampToRange(weatherScore, 0, 100);

  // ── 4. Road Condition Risk (0-100) ────────────────────────────────
  let roadScore = 0;

  const surface = input.surfaceType ?? null;
  if (!surface || surface === "UNKNOWN") {
    roadScore += 15;
  } else if (surface === "PAVED") {
    roadScore += 5;
  } else if (surface === "GRAVEL") {
    roadScore += 20;
  } else if (surface === "DIRT") {
    roadScore += 40;
  }

  // Gradient
  if (gradient > 12) roadScore += 20;
  else if (gradient > 8) roadScore += 10;
  else if (gradient > 4) roadScore += 5;

  // Reliability
  const reliability = input.reliabilityScore ?? 0.5;
  roadScore += (1 - reliability) * 30;

  roadScore = clampToRange(roadScore, 0, 100);

  // ── 5. Seismic Risk (0-100) ──────────────────────────────────────
  let seismicScore = 0;

  // Terrain base: mountain/hill areas in Nepal have higher seismic risk
  if (terrain === "MOUNTAIN") seismicScore += 20;
  else if (terrain === "HILL") seismicScore += 12;
  else seismicScore += 5;

  // Realtime earthquake clusters
  const eqClusters = realtimeClusters.filter((c) => c.type === "earthquake");
  for (const c of eqClusters) {
    const distanceFactor = c.nearestDistanceKm <= 5 ? 1.0 : 0.6;
    seismicScore += 20 * distanceFactor;
  }

  // Historical earthquake activity (inferred from clusters)
  const histEq = historicalClusters.filter((c) => c.type === "earthquake");
  seismicScore += Math.min(histEq.length * 8, 30);

  seismicScore = clampToRange(seismicScore, 0, 100);

  // ── Composite (0-100) ────────────────────────────────────────────
  const composite = Math.round(
    landslideScore * 0.25 +
    floodScore * 0.20 +
    weatherScore * 0.20 +
    roadScore * 0.20 +
    seismicScore * 0.15
  );

  return {
    landslideExposure: Math.round(landslideScore),
    floodExposure: Math.round(floodScore),
    weatherRisk: Math.round(weatherScore),
    roadConditionRisk: Math.round(roadScore),
    seismicRisk: Math.round(seismicScore),
    composite: Math.min(100, composite),
  };
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clusterAreaLabel(cluster: DisasterCluster): string {
  return nearestAreaName(cluster.center.lat, cluster.center.lon);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function dedupeRealtimeEvents(rows: Array<{ type: DisasterType; lat: number; lon: number }>): Array<{ type: DisasterType; lat: number; lon: number }> {
  const seen = new Set<string>();
  const out: Array<{ type: DisasterType; lat: number; lon: number }> = [];
  for (const r of rows) {
    const key = `${r.type}:${r.lat.toFixed(4)}:${r.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function addAlert(keys: Set<string>, out: string[], key: string, message: string): void {
  if (keys.has(key)) return;
  keys.add(key);
  out.push(message);
}

function sampleRoutePoints(points: { lat: number; lon: number }[], step = 10): { lat: number; lon: number }[] {
  if (!points.length) return [];
  const safeStep = Math.max(1, Math.floor(step));
  const sampled = points.filter((_, i) => i % safeStep === 0);
  const last = points[points.length - 1];
  if (!sampled.some((p) => p.lat === last.lat && p.lon === last.lon)) sampled.push(last);
  return sampled;
}

const AREA_ANCHORS: Array<{ name: string; lat: number; lon: number }> = [
  { name: "Kathmandu", lat: 27.7172, lon: 85.3240 },
  { name: "Pokhara", lat: 28.2096, lon: 83.9856 },
  { name: "Mugling", lat: 27.8170, lon: 84.7700 },
  { name: "Butwal", lat: 27.7000, lon: 83.4500 },
  { name: "Itahari", lat: 26.6670, lon: 87.2780 },
  { name: "Dharan", lat: 26.8142, lon: 87.2797 },
  { name: "Hetauda", lat: 27.4280, lon: 85.0322 },
  { name: "Nepalgunj", lat: 28.0500, lon: 81.6167 },
  { name: "Dhangadhi", lat: 28.6958, lon: 80.5850 },
  { name: "Birtamode", lat: 26.6450, lon: 87.9890 },
];

function nearestAreaName(lat: number, lon: number): string {
  let best = AREA_ANCHORS[0];
  let minDist = Number.POSITIVE_INFINITY;
  for (const a of AREA_ANCHORS) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    if (d < minDist) {
      minDist = d;
      best = a;
    }
  }
  return minDist <= 70 ? best.name : "nearby route corridor";
}

function scoreSegmentFromClusters(input: {
  segment: {
    from: string;
    to: string;
    region: "Terai" | "Hill" | "Mountain";
  };
  realtimeClusters: DisasterCluster[];
  historicalClusters: DisasterCluster[];
  weather: { rain_mm_per_hr?: number; wind_kph?: number };
}): { riskPercent: number; riskLevel: "LOW" | "MEDIUM" | "HIGH"; alerts: string[] } {
  let weatherRisk = 0;
  const rain = Number(input.weather.rain_mm_per_hr ?? 0);
  const wind = Number(input.weather.wind_kph ?? 0);

  if (rain > 30) weatherRisk += 0.7;
  else if (rain > 10) weatherRisk += 0.4;
  else if (rain > 2) weatherRisk += 0.1;
  if (wind > 60) weatherRisk += 0.2;
  else if (wind > 35) weatherRisk += 0.1;
  weatherRisk = clamp01(weatherRisk);

  let realtimeRiskRaw = 0;
  for (const c of input.realtimeClusters) {
    const base = c.type === "earthquake" ? 1.1 : c.type === "landslide" ? 1.0 : 0.9;
    const distanceFactor = c.nearestDistanceKm <= 5 ? 1.0 : 0.6;
    realtimeRiskRaw += base * distanceFactor;
  }

  let historicalRiskRaw = 0;
  for (const c of input.historicalClusters) {
    const intensity = c.count >= 12 ? 1.3 : c.count >= 8 ? 1.0 : c.count >= 5 ? 0.8 : 0.4;
    const distanceFactor = c.nearestDistanceKm <= 5 ? 1.0 : 0.7;
    historicalRiskRaw += intensity * distanceFactor;
  }

  // Region-aware priors for this segment only.
  if (input.segment.region === "Terai") {
    const floodClusters = input.historicalClusters.filter((c) => c.type === "flood").length;
    historicalRiskRaw += Math.min(0.4, floodClusters * 0.08);
  }
  if (input.segment.region === "Hill") {
    const landslideClusters = input.historicalClusters.filter((c) => c.type === "landslide").length;
    historicalRiskRaw += Math.min(0.4, landslideClusters * 0.08);
  }

  const realtimeRisk = Math.min(1, realtimeRiskRaw / 30);
  const historicalRisk = Math.min(1, historicalRiskRaw / 50);
  const terrainRisk = input.segment.region === "Mountain" ? 0.3 : input.segment.region === "Hill" ? 0.2 : 0.1;

  const totalRisk =
    weatherRisk * 0.4 +
    realtimeRisk * 0.3 +
    historicalRisk * 0.2 +
    Math.min(0.3, terrainRisk) * 0.1;
  const riskPercent = Math.min(100, Math.round(totalRisk * 100));
  const riskLevel: "LOW" | "MEDIUM" | "HIGH" =
    riskPercent > 70 ? "HIGH" : riskPercent > 40 ? "MEDIUM" : "LOW";

  const keys = new Set<string>();
  const alerts: string[] = [];
  for (const c of input.historicalClusters) {
    if (c.type === "landslide" && c.count >= 5) {
      addAlert(keys, alerts, "landslide:high", `Landslide-prone zone near ${input.segment.to}`);
    }
    if (c.type === "flood" && input.segment.region === "Terai") {
      addAlert(keys, alerts, "flood:terai", "Flood history in Terai belt");
    }
  }
  for (const c of input.realtimeClusters) {
    if (c.type === "earthquake" && c.count >= 3) {
      addAlert(keys, alerts, "quake:cluster", `Seismic activity cluster near ${input.segment.to}`);
    }
  }
  if (!alerts.length && riskPercent >= 45) {
    addAlert(keys, alerts, "generic:elevated", `Elevated multi-hazard exposure near ${input.segment.to}`);
  }

  return { riskPercent, riskLevel, alerts };
}

function buildRouteSegments(
  routePoints: { lat: number; lon: number }[],
  provided?: Array<{ from?: string; to?: string; midpoint?: { lat: number; lon: number } }>
): Array<{
  from: string;
  to: string;
  midpoint: { lat: number; lon: number };
  points: { lat: number; lon: number }[];
  region: "Terai" | "Hill" | "Mountain";
}> {
  if (provided && provided.length) {
    return provided.map((s, idx) => {
      const fallbackPoint = routePoints[Math.min(idx, routePoints.length - 1)] ?? routePoints[0];
      const midpoint = s.midpoint ?? fallbackPoint;
      return {
        from: s.from || `Segment ${idx + 1} Start`,
        to: s.to || `Segment ${idx + 1} End`,
        midpoint,
        points: [midpoint],
        region: inferRegionFromLat(midpoint.lat),
      };
    });
  }

  const segments: Array<{
    from: string;
    to: string;
    midpoint: { lat: number; lon: number };
    points: { lat: number; lon: number }[];
    region: "Terai" | "Hill" | "Mountain";
  }> = [];
  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    const from = nearestAreaName(a.lat, a.lon);
    const to = nearestAreaName(b.lat, b.lon);
    segments.push({
      from,
      to,
      midpoint: mid,
      points: [a, mid, b],
      region: inferRegionFromLat(mid.lat),
    });
  }
  return segments.length ? segments : [{
    from: "Origin",
    to: "Destination",
    midpoint: routePoints[Math.floor(routePoints.length / 2)],
    points: routePoints,
    region: inferRegionFromLat(routePoints[Math.floor(routePoints.length / 2)].lat),
  }];
}

function isNearAnySegment(
  disaster: { lat: number; lon: number },
  segments: Array<{ midpoint: { lat: number; lon: number }; points: { lat: number; lon: number }[] }>,
  radiusKm = 10
): boolean {
  return segments.some((seg) => minDistanceKmToRoute(disaster, seg.points.length ? seg.points : [seg.midpoint]) <= radiusKm);
}

function assignRealtimeToNearestSegment(
  disasters: Array<{ type: DisasterType; lat: number; lon: number }>,
  segments: Array<{ midpoint: { lat: number; lon: number } }>
): Map<number, Array<{ type: DisasterType; lat: number; lon: number }>> {
  const map = new Map<number, Array<{ type: DisasterType; lat: number; lon: number }>>();
  for (const d of disasters) {
    let bestIdx = -1;
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < segments.length; i++) {
      const m = segments[i].midpoint;
      const dist = haversineKm(d.lat, d.lon, m.lat, m.lon);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) continue;
    const arr = map.get(bestIdx) ?? [];
    arr.push(d);
    map.set(bestIdx, arr);
  }
  return map;
}

function assignHistoricalToNearestSegment(
  disasters: Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>,
  segments: Array<{ midpoint: { lat: number; lon: number } }>
): Map<number, Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>> {
  const map = new Map<number, Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>>();
  for (const d of disasters) {
    let bestIdx = -1;
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < segments.length; i++) {
      const m = segments[i].midpoint;
      const dist = haversineKm(d.lat, d.lon, m.lat, m.lon);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) continue;
    const arr = map.get(bestIdx) ?? [];
    arr.push(d);
    map.set(bestIdx, arr);
  }
  return map;
}

function minDistanceKmToRoute(point: { lat: number; lon: number }, routePoints: { lat: number; lon: number }[]): number {
  if (!routePoints.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const p of routePoints) {
    const d = haversineKm(point.lat, point.lon, p.lat, p.lon);
    if (d < min) min = d;
  }
  return min;
}

function isNearRoute(
  disaster: { lat: number; lon: number },
  routePoints: { lat: number; lon: number }[],
  radiusKm = 10
): boolean {
  return minDistanceKmToRoute(disaster, routePoints) <= radiusKm;
}

function inferRegionFromLat(lat: number): "Terai" | "Hill" | "Mountain" {
  if (lat < 27.0) return "Terai";
  if (lat < 28.0) return "Hill";
  return "Mountain";
}

function clusterRealtimeDisasters(
  events: Array<{ type: DisasterType; lat: number; lon: number }>,
  routePoints: { lat: number; lon: number }[],
  clusterRadiusKm = 5
): DisasterCluster[] {
  const clusters: DisasterCluster[] = [];
  for (const e of events) {
    const candidate = clusters.find((c) => c.type === e.type && haversineKm(c.center.lat, c.center.lon, e.lat, e.lon) <= clusterRadiusKm);
    if (!candidate) {
      clusters.push({
        type: e.type,
        center: { lat: e.lat, lon: e.lon },
        count: 1,
        nearestDistanceKm: minDistanceKmToRoute(e, routePoints),
        region: inferRegionFromLat(e.lat),
      });
      continue;
    }
    const newCount = candidate.count + 1;
    candidate.center = {
      lat: (candidate.center.lat * candidate.count + e.lat) / newCount,
      lon: (candidate.center.lon * candidate.count + e.lon) / newCount,
    };
    candidate.count = newCount;
    candidate.nearestDistanceKm = Math.min(candidate.nearestDistanceKm, minDistanceKmToRoute(e, routePoints));
  }
  return clusters.filter((c) => c.nearestDistanceKm <= 10);
}

function clusterHistoricalDisasters(
  events: Array<{ type: "flood" | "landslide"; lat: number; lon: number; count: number }>,
  routePoints: { lat: number; lon: number }[],
  clusterRadiusKm = 5
): DisasterCluster[] {
  const clusters: DisasterCluster[] = [];
  for (const e of events) {
    const candidate = clusters.find((c) => c.type === e.type && haversineKm(c.center.lat, c.center.lon, e.lat, e.lon) <= clusterRadiusKm);
    if (!candidate) {
      clusters.push({
        type: e.type,
        center: { lat: e.lat, lon: e.lon },
        count: Math.max(1, e.count),
        nearestDistanceKm: minDistanceKmToRoute(e, routePoints),
        region: inferRegionFromLat(e.lat),
      });
      continue;
    }
    const prevWeight = candidate.count;
    const nextWeight = prevWeight + Math.max(1, e.count);
    candidate.center = {
      lat: (candidate.center.lat * prevWeight + e.lat * e.count) / nextWeight,
      lon: (candidate.center.lon * prevWeight + e.lon * e.count) / nextWeight,
    };
    candidate.count = nextWeight;
    candidate.nearestDistanceKm = Math.min(candidate.nearestDistanceKm, minDistanceKmToRoute(e, routePoints));
  }
  return clusters.filter((c) => c.nearestDistanceKm <= 10);
}


