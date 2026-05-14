/**
 * FILE: route.ts
 * LOCATION: /app/api/assess/route.ts
 * PURPOSE: Collects weather + hazard data for all locations and runs safety scoring
 * TRIGGER: POST /api/assess (protected by ASSESS_SECRET header)
 * FLOW: For each location → fetch weather (OWM) → fetch hazard (BIPAD) → score → save RiskAssessment
 * RUN: curl -X POST http://localhost:3000/api/assess -H "Authorization: Bearer your_secret"
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, AssessmentType, Prisma } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import { computeSafetyScore, LocationContext } from "@/lib/scoring/safety";

// Helper: cast a plain object to Prisma's JSON input type
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function POST(req: NextRequest) {
  // Simple secret check — set ASSESS_SECRET in .env.local
  const auth   = req.headers.get("authorization") ?? "";
  const secret = process.env.ASSESS_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Fetch all locations with their district names (needed for BIPAD query)
  const locations = await prisma.location.findMany({
    include: {
      district: { include: { province: true } },
    },
  });

  if (locations.length === 0) {
    return NextResponse.json({
      message: "No locations found. Run: npx tsx scripts/seed-destinations.ts first.",
    }, { status: 400 });
  }

  const results: { location: string; score: number; level: string; error?: string }[] = [];

  for (const loc of locations) {
    try {
      // ── Step 1: Fetch weather from OpenWeatherMap ──────────────────────────
      const weather = await fetchWeather(loc.latitude, loc.longitude);
      if (!weather) {
        results.push({ location: loc.name, score: 0, level: "UNKNOWN", error: "Weather fetch failed" });
        continue;
      }

      // Store weather snapshot
      await prisma.weatherData.create({
        data: {
          locationId:  loc.id,
          temperature: weather.temperature,
          humidity:    weather.humidity,
          rainfall:    weather.rainfall,
          windSpeed:   weather.windSpeed,
          pressure:    weather.pressure,
          source:      weather.source,
          recordedAt:  new Date(),
        },
      });

      // ── Step 2: Fetch hazard data from multiple sources ───────────────────
      // Pass lat/lon so USGS, OpenAQ, and EONET can query by coordinate
      const hazardRaw = await fetchHazard(loc.district.name, loc.latitude, loc.longitude);

      // Enrich heat index from temperature (hot weather = higher heat risk)
      const heatIndex = Math.max(0, Math.min((weather.temperature - 25) / 20, 1.0));
      const hazard = {
        floodIndex:      hazardRaw.floodIndex,
        landslideIndex:  hazardRaw.landslideIndex,
        earthquakeIndex: hazardRaw.earthquakeIndex ?? 0,
        heatIndex,
        airQuality:      hazardRaw.airQuality,
        source:          hazardRaw.source,
      };

      // Store hazard snapshot
      await prisma.hazardData.create({
        data: {
          locationId:     loc.id,
          floodIndex:     hazard.floodIndex,
          landslideIndex: hazard.landslideIndex,
          heatIndex,
          airQuality:     hazard.airQuality,
          source:         hazard.source,
          recordedAt:     new Date(),
        },
      });

      // ── Step 3: Run safety scoring logic ──────────────────────────────────
      const score = computeSafetyScore(
        {
          temperature: weather.temperature,
          humidity:    weather.humidity,
          rainfall:    weather.rainfall,
          windSpeed:   weather.windSpeed,
          pressure:    weather.pressure,
        },
        {
          floodIndex:      hazard.floodIndex,
          landslideIndex:  hazard.landslideIndex,
          earthquakeIndex: hazard.earthquakeIndex ?? 0,
          heatIndex,
          airQuality:      hazard.airQuality,
        },
        [],                       // no user purposes — general assessment
        AssessmentType.SOLO,      // conservative default
        weather.source,
        {
          altitude:     loc.altitude,
          districtName: loc.district.name,
          locationName: loc.name,
        }
      );

      // ── Step 4: Save RiskAssessment to DB ─────────────────────────────────
      await prisma.riskAssessment.create({
        data: {
          locationId:      loc.id,
          type:            AssessmentType.SOLO,
          safetyScore:     score.safetyScore,
          safetyLevel:     score.safetyLevel,
          confidence:      score.confidence,
          decisionTrace:   toJson(score.decisionTrace),
          weatherSnapshot: toJson(score.weatherSnapshot),
          hazardSnapshot:  toJson(score.hazardSnapshot),
          modelVersion:    "rule-v1",
        },
      });

      // ── Step 5: Write HAZARD notifications for affected users ──────────────
      // Only for HIGH_RISK or EXTREME — notify users whose home district
      // matches this location so they get a real alert, not a synthetic one.
      if (score.safetyLevel === "HIGH_RISK" || score.safetyLevel === "EXTREME") {
        const affectedUsers = await prisma.user.findMany({
          where: { homeLocationId: { not: null } },
          select: { id: true, homeLocationId: true },
        });

        const usersInDistrict = affectedUsers.filter(
          (u) => u.homeLocationId === loc.id
        );

        if (usersInDistrict.length > 0) {
          await prisma.notification.createMany({
            data: usersInDistrict.map((u) => ({
              userId:  u.id,
              message: JSON.stringify({
                _type:      "HAZARD",
                hazardType: score.decisionTrace.reasoning.some((r) => r.toLowerCase().includes("flood"))
                  ? "FLOOD"
                  : score.decisionTrace.reasoning.some((r) => r.toLowerCase().includes("landslide"))
                  ? "LANDSLIDE"
                  : score.decisionTrace.reasoning.some((r) => r.toLowerCase().includes("seismic") || r.toLowerCase().includes("earthquake"))
                  ? "EARTHQUAKE"
                  : "INFO",
                title:    `${score.safetyLevel === "EXTREME" ? "⚠️ Extreme risk" : "🚨 High risk"}: ${loc.name}`,
                body:     score.decisionTrace.reasoning[0] ?? `Safety score: ${score.safetyScore}/100`,
                location: `${loc.district.name}, ${loc.district.province.name}`,
                severity: score.safetyLevel === "EXTREME" ? "CRITICAL" : "HIGH",
              }),
            })),
            skipDuplicates: true,
          });
        }
      }

      results.push({ location: loc.name, score: score.safetyScore, level: score.safetyLevel });
      console.log(`✅ ${loc.name}: score=${score.safetyScore} level=${score.safetyLevel}`);
    } catch (err) {
      console.error(`[assess] Error for ${loc.name}:`, err);
      results.push({ location: loc.name, score: 0, level: "ERROR", error: String(err) });
    }
  }

  return NextResponse.json({
    assessed:  results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
