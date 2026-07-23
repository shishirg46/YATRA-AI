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
import { AssessmentType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchWeather } from "@/lib/collectors/weather";
import { fetchHazard } from "@/lib/collectors/hazard";
import { computeSafetyScore } from "@/lib/scoring/safety";

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
      // ── Step 1: Fetch weather from DHM API ──────────────────────────
      const weather = await fetchWeather(loc.latitude, loc.longitude, req.signal);
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
      const hazardRaw = await fetchHazard(loc.latitude, loc.longitude, prisma, req.signal);

      // Enrich heat index from temperature (hot weather = higher heat risk)
      const heatIndex = Math.max(0, Math.min((weather.temperature - 25) / 20, 1.0));
      const hazard = {
        floodIndex:      hazardRaw.floodIndex,
        landslideIndex:  hazardRaw.landslideIndex,
        earthquakeIndex: hazardRaw.earthquakeIndex ?? 0,
        stormIndex:      hazardRaw.stormIndex,
        accidentIndex:   hazardRaw.accidentIndex,
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
          pressure:    weather.pressure ?? 1013,
        },
        {
          floodIndex:      hazard.floodIndex,
          landslideIndex:  hazard.landslideIndex,
          earthquakeIndex: hazard.earthquakeIndex,
          stormIndex:      hazard.stormIndex,
          accidentIndex:   hazard.accidentIndex,
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
          decisionTrace:   score.decisionTrace as never,
          weatherSnapshot: score.weatherSnapshot as never,
          hazardSnapshot:  score.hazardSnapshot as never,
          modelVersion:    "rule-v1",
        },
      });

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
