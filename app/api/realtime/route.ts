/**
 * FILE: route.ts
 * LOCATION: /app/api/realtime/route.ts
 * PURPOSE: Server-Sent Events (SSE) stream — pushes live data to dashboard
 *
 * SSE keeps a persistent HTTP connection open and streams events as they arrive.
 * No WebSocket server needed — works with Next.js out of the box.
 *
 * EVENTS STREAMED:
 *   { type: "weather",    data: WeatherUpdate[] }   — OWM current weather, every 10 min
 *   { type: "hazard",     data: HazardUpdate[] }    — BIPAD + USGS + EONET, every 5 min
 *   { type: "scores",     data: ScoreUpdate[] }     — recomputed safety scores
 *   { type: "alert",      data: Alert }             — immediate push when critical event found
 *   { type: "heartbeat",  data: { time } }          — keeps connection alive, every 30s
 *
 * CLIENT USAGE:
 *   const es = new EventSource("/api/realtime")
 *   es.onmessage = (e) => handleUpdate(JSON.parse(e.data))
 */

export const dynamic = "force-dynamic";

import { NextRequest }   from "next/server";
import { auth }          from "@/lib/auth";
import { headers }       from "next/headers";
import { prisma }        from "@/lib/prisma";
import { fetchWeather }  from "@/lib/collectors/weather";
import { fetchHazard }   from "@/lib/collectors/hazard";
import { computeSafetyScore, buildHealthFlags } from "@/lib/scoring/safety";
import { withRateLimit } from "@/lib/rate-limit";

// How many locations to update per cycle (avoid hammering APIs)
const LOCATIONS_PER_CYCLE = 20;
const WEATHER_INTERVAL_MS  = 10 * 60 * 1000; // 10 min
const HAZARD_INTERVAL_MS   =  5 * 60 * 1000; // 5 min
const HEARTBEAT_MS         = 30 * 1000;       // 30s

function isPlanLimitReachedError(error: unknown): boolean {
  const direct = error instanceof Error ? error.message : String(error ?? "");
  let nested = "";
  try {
    nested = JSON.stringify(error);
  } catch {
    nested = "";
  }
  return /planLimitReached|Failed to identify your database|Failed to get session/i.test(`${direct} ${nested}`);
}

async function realtimeHandler(req: NextRequest) {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    if (isPlanLimitReachedError(error)) {
      return Response.json(
        { message: "Database unavailable: provider account limit reached (planLimitReached)." },
        { status: 503 }
      );
    }
    throw error;
  }
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // Load user profile for personalised scoring
  const [userHealth, user] = await Promise.all([
    prisma.userHealth.findUnique({
      where:  { userId },
      select: { fitnessLevel: true, mobilityLimited: true, chronicConditions: true, allergies: true },
    }),
    prisma.user.findUnique({
      where:   { id: userId },
      include: { homeLocation: { include: { district: { include: { province: true } } } } },
    }),
  ]);

  const healthFlags = userHealth ? buildHealthFlags(userHealth) : [];

  // Load locations that have been assessed — prioritise user's home province first
  const homeProvince = user?.homeLocation?.district?.province?.name ?? "";
  const locations    = await prisma.location.findMany({
    where:   { riskReports: { some: {} } },
    include: { district: { include: { province: true } } },
    orderBy: homeProvince
      ? [
          { district: { province: { name: "asc" } } }, // home province sorts first due to client filter
        ]
      : { name: "asc" },
    take: 100, // stream updates for top 100 assessed locations
  });

  // Sort: home province first, then rest
  const sorted = [
    ...locations.filter((l) => l.district.province.name === homeProvince),
    ...locations.filter((l) => l.district.province.name !== homeProvince),
  ];

      let lastWeatherCycle = 0;
      let lastHazardCycle  = 0;
      let cycleIndex       = 0;
      let tickRunning      = false;
      let tickTimer: ReturnType<typeof setTimeout> | null = null;

      const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        try {
          const msg = `data: ${JSON.stringify({ type: event, data, time: new Date().toISOString() })}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch { /* client disconnected */ }
      }

      function assertAlive() {
        if (req.signal.aborted) throw new Error("CLIENT_DISCONNECTED");
      }

      // Send initial heartbeat immediately
      send("heartbeat", { time: new Date().toISOString(), message: "Connected to YatraAI real-time feed" });

      // ── Heartbeat loop ───────────────────────────────────────────────────────
      const heartbeatTimer = setInterval(() => {
        send("heartbeat", { time: new Date().toISOString() });
      }, HEARTBEAT_MS);

      // ── Main data loop (recursive setTimeout + tickRunning guard) ──────────
      async function scheduleTick() {
        if (req.signal.aborted) { cleanup(); return; }
        tickTimer = setTimeout(runTick, 60_000);
      }

      async function runTick() {
        if (tickRunning) {
          console.warn("[realtime] TICK_SKIP — previous tick still running");
          scheduleTick();
          return;
        }

        tickRunning = true;
        const tickAbort = new AbortController();
        const tickTimeout = setTimeout(() => {
          tickAbort.abort(new Error("TICK_TIMEOUT"));
        }, 45_000);

        try {
          assertAlive();
          const now = Date.now();
          const start = (cycleIndex * LOCATIONS_PER_CYCLE) % Math.max(sorted.length, 1);
          const batch = sorted.slice(start, start + LOCATIONS_PER_CYCLE);
          cycleIndex++;

          // ── Weather updates (every 10 min) ─────────────────────────────────
          if (now - lastWeatherCycle >= WEATHER_INTERVAL_MS) {
            lastWeatherCycle = now;
            assertAlive();

            const weatherResults = await Promise.allSettled(
              batch.map(async (loc) => {
                const w = await fetchWeather(loc.latitude, loc.longitude, req.signal);
                if (!w) return null;

                await withTimeout(
                  prisma.weatherData.create({
                    data: {
                      locationId:  loc.id,
                      temperature: w.temperature,
                      humidity:    w.humidity,
                      rainfall:    w.rainfall,
                      windSpeed:   w.windSpeed,
                      pressure:    w.pressure,
                      source:      w.source,
                      recordedAt:  new Date(),
                    },
                  }),
                  5_000,
                ).catch((e) => {
                  console.warn("[realtime] DB_WRITE_SKIP weather", { locationId: loc.id, reason: e?.message ?? e });
                });

                return {
                  locationId:  loc.id,
                  name:        loc.name,
                  temperature: w.temperature,
                  rainfall:    w.rainfall,
                  windSpeed:   w.windSpeed,
                  humidity:    w.humidity,
                  description: w.description,
                  source:      w.source,
                  sourceLabel: w.sourceLabel,
                  officialSource: w.officialSource,
                  stationName: w.stationName,
                  stationDistanceKm: w.stationDistanceKm,
                };
              })
            );

            const valid = weatherResults
              .filter((r) => r.status === "fulfilled" && r.value != null)
              .map((r) => (r as PromiseFulfilledResult<object>).value);
            if (valid.length > 0) send("weather", valid);
          }

          // ── Hazard updates (every 5 min) ───────────────────────────────────
          if (now - lastHazardCycle >= HAZARD_INTERVAL_MS) {
            lastHazardCycle = now;
            assertAlive();

            const scoreUpdates: unknown[] = [];
            const alerts: unknown[]       = [];

            const hazardResults = await Promise.allSettled(
              batch.map(async (loc) => {
                assertAlive();
                const weatherP  = fetchWeather(loc.latitude, loc.longitude, req.signal);
                const hazardP   = fetchHazard(loc.latitude, loc.longitude, prisma, tickAbort.signal);
                const [weather, hazardRaw] = await Promise.allSettled([weatherP, hazardP]);

                const weatherVal = weather.status === "fulfilled" ? weather.value : null;
                const hazardVal  = hazardRaw.status === "fulfilled" ? hazardRaw.value : null;
                if (!weatherVal || !hazardVal) return null;

                const heatIndex = Math.max(0, Math.min((weatherVal.temperature - 25) / 20, 1.0));
                const hazard    = { ...hazardVal, heatIndex };

                const score = computeSafetyScore(
                  { temperature: weatherVal.temperature, humidity: weatherVal.humidity, rainfall: weatherVal.rainfall, windSpeed: weatherVal.windSpeed, pressure: weatherVal.pressure ?? 1013 },
                  { floodIndex: hazard.floodIndex, landslideIndex: hazard.landslideIndex, earthquakeIndex: hazard.earthquakeIndex ?? 0, stormIndex: hazard.stormIndex ?? 0, accidentIndex: hazard.accidentIndex ?? 0, heatIndex, airQuality: hazard.airQuality },
                  healthFlags,
                  "SOLO",
                  weatherVal.source,
                  { altitude: loc.altitude, districtName: loc.district.name, locationName: loc.name }
                );

                await withTimeout(
                  prisma.riskAssessment.create({
                    data: {
                      locationId:      loc.id,
                      type:            "SOLO",
                      safetyScore:     score.safetyScore,
                      safetyLevel:     score.safetyLevel,
                      confidence:      score.confidence,
                      decisionTrace:   score.decisionTrace as never,
                      weatherSnapshot: score.weatherSnapshot as never,
                      hazardSnapshot:  score.hazardSnapshot as never,
                      modelVersion:    "realtime-v1",
                    },
                  }),
                  5_000,
                ).catch((e) => {
                  console.warn("[realtime] DB_WRITE_SKIP riskAssessment", { locationId: loc.id, reason: e?.message ?? e });
                });

                scoreUpdates.push({
                  locationId:  loc.id,
                  name:        loc.name,
                  district:    loc.district.name,
                  province:    loc.district.province.name,
                  altitude:    loc.altitude,
                  safetyScore: score.safetyScore,
                  safetyLevel: score.safetyLevel,
                  confidence:  score.confidence,
                  reasoning:   score.decisionTrace.reasoning.slice(0, 2),
                  weather: {
                    temperature: weatherVal.temperature,
                    rainfall:    weatherVal.rainfall,
                    windSpeed:   weatherVal.windSpeed,
                  },
                  hazard: {
                    floodIndex:     hazard.floodIndex,
                    landslideIndex: hazard.landslideIndex,
                    earthquakeIndex: hazard.earthquakeIndex ?? 0,
                    airQuality:     hazard.airQuality,
                  },
                });

                if (score.safetyLevel === "EXTREME" || score.safetyLevel === "HIGH_RISK") {
                  alerts.push({
                    locationId:  loc.id,
                    name:        loc.name,
                    safetyLevel: score.safetyLevel,
                    safetyScore: score.safetyScore,
                    reason:      score.decisionTrace.reasoning[0],
                  });
                }

                return null;
              })
            );

            if (scoreUpdates.length > 0) send("scores",  scoreUpdates);
            if (alerts.length > 0)       send("alert",   alerts);
          }

          // Drain microtasks before scheduling next tick
          await new Promise<void>((resolve) => setImmediate(resolve));
        } catch (e) {
          if ((e as Error)?.message === "CLIENT_DISCONNECTED") {
            cleanup();
            return;
          }
          console.warn("[realtime] TICK_ERROR", e);
        } finally {
          clearTimeout(tickTimeout);
          tickRunning = false;
          if (!req.signal.aborted) scheduleTick();
        }
      }

      // Start first tick after 5s
      tickTimer = setTimeout(runTick, 5_000);

      function cleanup() {
        clearInterval(heartbeatTimer);
        if (tickTimer) clearTimeout(tickTimer);
        try { controller.close(); } catch { /* already closed */ }
      }

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const raced = await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("DB_TIMEOUT")), ms);
    }),
  ]);
  clearTimeout(timer!);
  return raced;
}

export const GET = withRateLimit(realtimeHandler, { max: 10, windowSeconds: 60 });
