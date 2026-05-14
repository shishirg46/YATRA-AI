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
import { PrismaClient }  from "@/app/generated/prisma/client";
import { PrismaPg }      from "@prisma/adapter-pg";
import { Pool }          from "pg";
import { fetchWeather }  from "@/lib/collectors/weather";
import { fetchHazard }   from "@/lib/collectors/hazard";
import { computeSafetyScore, buildHealthFlags } from "@/lib/scoring/safety";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

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

export async function GET(req: NextRequest) {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    if (isPlanLimitReachedError(error)) {
      return Response.json(
        { error: "Database unavailable: provider account limit reached (planLimitReached)." },
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        try {
          const msg = `data: ${JSON.stringify({ type: event, data, time: new Date().toISOString() })}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch { /* client disconnected */ }
      }

      // Send initial heartbeat immediately
      send("heartbeat", { time: new Date().toISOString(), message: "Connected to YatraAI real-time feed" });

      // ── Heartbeat loop ───────────────────────────────────────────────────────
      const heartbeatTimer = setInterval(() => {
        send("heartbeat", { time: new Date().toISOString() });
      }, HEARTBEAT_MS);

      // ── Main data loop ───────────────────────────────────────────────────────
      const dataTimer = setInterval(async () => {
        const now = Date.now();

        // Pick the batch of locations for this cycle
        const start = (cycleIndex * LOCATIONS_PER_CYCLE) % Math.max(sorted.length, 1);
        const batch = sorted.slice(start, start + LOCATIONS_PER_CYCLE);
        cycleIndex++;

        // ── Weather updates (every 10 min) ─────────────────────────────────────
        if (now - lastWeatherCycle >= WEATHER_INTERVAL_MS) {
          lastWeatherCycle = now;

          const weatherUpdates = await Promise.all(
            batch.map(async (loc) => {
              try {
                const w = await fetchWeather(loc.latitude, loc.longitude);
                if (!w) return null;

                // Save to DB
                await prisma.weatherData.create({
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
                }).catch(() => {}); // ignore duplicate errors

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
              } catch { return null; }
            })
          );

          const valid = weatherUpdates.filter(Boolean);
          if (valid.length > 0) send("weather", valid);
        }

        // ── Hazard updates (every 5 min) ───────────────────────────────────────
        if (now - lastHazardCycle >= HAZARD_INTERVAL_MS) {
          lastHazardCycle = now;

          const scoreUpdates: unknown[] = [];
          const alerts: unknown[]       = [];

          await Promise.all(
            batch.map(async (loc) => {
              try {
                const [weather, hazardRaw] = await Promise.all([
                  fetchWeather(loc.latitude, loc.longitude),
                  fetchHazard(loc.district.name, loc.latitude, loc.longitude),
                ]);

                if (!weather) return;

                const heatIndex = Math.max(0, Math.min((weather.temperature - 25) / 20, 1.0));
                const hazard    = { ...hazardRaw, heatIndex };

                // Recompute score with user's health flags
                const score = computeSafetyScore(
                  { temperature: weather.temperature, humidity: weather.humidity, rainfall: weather.rainfall, windSpeed: weather.windSpeed, pressure: weather.pressure },
                  { floodIndex: hazard.floodIndex, landslideIndex: hazard.landslideIndex, earthquakeIndex: hazard.earthquakeIndex ?? 0, heatIndex, airQuality: hazard.airQuality },
                  healthFlags,
                  "SOLO",
                  weather.source,
                  { altitude: loc.altitude, districtName: loc.district.name, locationName: loc.name }
                );

                // Save new assessment
                await prisma.riskAssessment.create({
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
                }).catch(() => {});

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
                    temperature: weather.temperature,
                    rainfall:    weather.rainfall,
                    windSpeed:   weather.windSpeed,
                  },
                  hazard: {
                    floodIndex:     hazard.floodIndex,
                    landslideIndex: hazard.landslideIndex,
                    earthquakeIndex: hazard.earthquakeIndex ?? 0,
                    airQuality:     hazard.airQuality,
                  },
                });

                // Push immediate alert if critical
                if (score.safetyLevel === "EXTREME" || score.safetyLevel === "HIGH_RISK") {
                  // Check if we already alerted for this location recently
                  const recentAlert = await prisma.notification.findFirst({
                    where: {
                      userId:    userId,
                      message:   { contains: loc.id },
                      createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }, // 6h
                    },
                  });

                  if (!recentAlert) {
                    const alertMsg = {
                      _type:      "HAZARD",
                      hazardType: hazard.floodIndex > 0.5 ? "FLOOD" : hazard.landslideIndex > 0.5 ? "LANDSLIDE" : hazard.earthquakeIndex > 0.3 ? "EARTHQUAKE" : "INFO",
                      title:      `${score.safetyLevel === "EXTREME" ? "⚠️ Extreme" : "🚨 High"} risk: ${loc.name}`,
                      body:       score.decisionTrace.reasoning[0] ?? `Score dropped to ${score.safetyScore}/100`,
                      location:   `${loc.district.name}, ${loc.district.province.name}`,
                      severity:   score.safetyLevel === "EXTREME" ? "CRITICAL" : "HIGH",
                      locationId: loc.id,
                    };

                    await prisma.notification.create({
                      data: { userId, message: JSON.stringify(alertMsg) },
                    }).catch(() => {});

                    alerts.push({
                      locationId:  loc.id,
                      name:        loc.name,
                      safetyLevel: score.safetyLevel,
                      safetyScore: score.safetyScore,
                      reason:      score.decisionTrace.reasoning[0],
                    });
                  }
                }
              } catch { /* skip this location */ }
            })
          );

          if (scoreUpdates.length > 0) send("scores",  scoreUpdates);
          if (alerts.length > 0)       send("alert",   alerts);
        }
      }, 60_000); // tick every 60s, but only runs heavy work on schedule

      // Run first hazard cycle immediately after 5s
      setTimeout(async () => {
        lastHazardCycle = Date.now() - HAZARD_INTERVAL_MS + 5000; // trigger on next tick
      }, 5000);

      // Cleanup when client disconnects
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeatTimer);
        clearInterval(dataTimer);
        try { controller.close(); } catch { /* already closed */ }
      });
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
