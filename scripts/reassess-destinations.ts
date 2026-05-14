import "dotenv/config";

import { PrismaClient, AssessmentType, Prisma } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { fetchWeather } from "../lib/collectors/weather";
import { fetchHazard } from "../lib/collectors/hazard";
import { computeSafetyScore } from "../lib/scoring/safety";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const locations = await prisma.location.findMany({
    include: { district: { include: { province: true } } },
  });

  if (locations.length === 0) {
    console.log("No locations found. Run the seed script first.");
    return;
  }

  console.log(`Refreshing live weather + risk data for ${locations.length} destinations...\n`);

  let ok = 0;
  let failed = 0;

  for (const loc of locations) {
    try {
      const weather = await fetchWeather(loc.latitude, loc.longitude);
      if (!weather) {
        failed++;
        console.log(`- ${loc.name}: weather unavailable`);
        continue;
      }

      await prisma.weatherData.create({
        data: {
          locationId: loc.id,
          temperature: weather.temperature,
          humidity: weather.humidity,
          rainfall: weather.rainfall,
          windSpeed: weather.windSpeed,
          pressure: weather.pressure,
          source: weather.source,
          recordedAt: new Date(),
        },
      });

      const hazardRaw = await fetchHazard(loc.district.name, loc.latitude, loc.longitude);
      const heatIndex = Math.max(0, Math.min((weather.temperature - 25) / 20, 1));
      const hazard = {
        floodIndex: hazardRaw.floodIndex,
        landslideIndex: hazardRaw.landslideIndex,
        earthquakeIndex: hazardRaw.earthquakeIndex ?? 0,
        heatIndex,
        airQuality: hazardRaw.airQuality,
        source: hazardRaw.source,
      };

      await prisma.hazardData.create({
        data: {
          locationId: loc.id,
          floodIndex: hazard.floodIndex,
          landslideIndex: hazard.landslideIndex,
          heatIndex: hazard.heatIndex,
          airQuality: hazard.airQuality,
          source: hazard.source,
          recordedAt: new Date(),
        },
      });

      const score = computeSafetyScore(
        {
          temperature: weather.temperature,
          humidity: weather.humidity,
          rainfall: weather.rainfall,
          windSpeed: weather.windSpeed,
          pressure: weather.pressure,
        },
        {
          floodIndex: hazard.floodIndex,
          landslideIndex: hazard.landslideIndex,
          earthquakeIndex: hazard.earthquakeIndex,
          heatIndex: hazard.heatIndex,
          airQuality: hazard.airQuality,
        },
        [],
        AssessmentType.SOLO,
        weather.source,
        {
          altitude: loc.altitude,
          districtName: loc.district.name,
          locationName: loc.name,
        }
      );

      await prisma.riskAssessment.create({
        data: {
          locationId: loc.id,
          type: AssessmentType.SOLO,
          safetyScore: score.safetyScore,
          safetyLevel: score.safetyLevel,
          confidence: score.confidence,
          decisionTrace: toJson(score.decisionTrace),
          weatherSnapshot: toJson(score.weatherSnapshot),
          hazardSnapshot: toJson(score.hazardSnapshot),
          modelVersion: "rule-v1-script",
        },
      });

      ok++;
      console.log(`- ${loc.name}: ${weather.temperature.toFixed(1)}C via ${weather.source}`);
    } catch (error) {
      failed++;
      console.log(`- ${loc.name}: failed (${String(error)})`);
    }

    await sleep(250);
  }

  console.log(`\nDone.`);
  console.log(`  Success: ${ok}`);
  console.log(`  Failed: ${failed}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error) => {
  console.error("Reassessment failed:", error);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
