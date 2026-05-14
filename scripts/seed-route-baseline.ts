import "dotenv/config";

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { fetchHistoricalWeather } from "../lib/collectors/historical-weather";
import { fetchHistoricalHazard } from "../lib/collectors/historical-hazard";

const BASELINE_SOURCE_PREFIX = "baseline-historical-v1";
const MONTHS = [1, 4, 7, 10];
const YEARS = 5;
const TARGET_YEAR = 2026;
const MAX_ATTEMPTS = 6;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  locationName: string,
  districtName: string,
  lat: number,
  lon: number,
  targetDate: string
) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const [historicalWeather, historicalHazard] = await Promise.all([
      fetchHistoricalWeather(lat, lon, targetDate, YEARS),
      fetchHistoricalHazard(districtName, lat, lon, targetDate, YEARS),
    ]);

    if (historicalWeather && historicalHazard) {
      return { historicalWeather, historicalHazard };
    }

    if (attempt < MAX_ATTEMPTS) {
      const waitMs = 4000 * attempt;
      console.log(`  retry ${attempt}/${MAX_ATTEMPTS - 1} for ${locationName} ${targetDate} after ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  return null;
}

function monthToDate(month: number): string {
  return `${TARGET_YEAR}-${String(month).padStart(2, "0")}-15`;
}

function computeHeatIndex(temperature: number): number {
  return Math.max(0, Math.min((temperature - 25) / 20, 1));
}

function airQualityDefault(locationName: string, districtName: string, altitude: number | null): number {
  const key = `${locationName} ${districtName}`.toLowerCase();
  if (key.includes("kathmandu") || key.includes("thamel") || key.includes("butwal") || key.includes("nepalgunj")) {
    return 0.7;
  }
  if ((altitude ?? 0) >= 2500) return 0.18;
  if ((altitude ?? 0) >= 1400) return 0.3;
  if ((altitude ?? 0) <= 300) return 0.45;
  return 0.35;
}

async function main() {
  const locations = await prisma.location.findMany({
    include: { district: true },
    orderBy: [{ district: { name: "asc" } }, { name: "asc" }],
  });

  if (!locations.length) {
    console.log("No locations found. Run seed-destinations first.");
    return;
  }

  console.log(`Seeding real monthly baselines for ${locations.length} locations...`);
  console.log(`Months: ${MONTHS.join(", ")} | Historical years: ${YEARS} | Target year labels: ${TARGET_YEAR}\n`);

  let ok = 0;
  let failed = 0;
  let inserted = 0;

  for (const loc of locations) {
    let locationOk = 0;

    for (const month of MONTHS) {
      const targetDate = monthToDate(month);
      const source = `${BASELINE_SOURCE_PREFIX}:m${String(month).padStart(2, "0")}`;
      const recordedAt = new Date(Date.UTC(TARGET_YEAR, month - 1, 15, 0, 0, 0));

      try {
        const result = await fetchWithRetry(
          loc.name,
          loc.district.name,
          loc.latitude,
          loc.longitude,
          targetDate
        );

        if (!result) {
          failed++;
          continue;
        }
        const { historicalWeather, historicalHazard } = result;

        await prisma.weatherData.deleteMany({
          where: {
            locationId: loc.id,
            source,
          },
        });

        await prisma.hazardData.deleteMany({
          where: {
            locationId: loc.id,
            source,
          },
        });

        await prisma.weatherData.create({
          data: {
            locationId: loc.id,
            temperature: historicalWeather.avgTempMax,
            humidity: 65,
            rainfall: historicalWeather.avgRainfall,
            windSpeed: historicalWeather.avgWindSpeed,
            pressure: 1011,
            source,
            recordedAt,
          },
        });

        await prisma.hazardData.create({
          data: {
            locationId: loc.id,
            floodIndex: historicalHazard.historicalFloodRisk,
            landslideIndex: historicalHazard.historicalLandslideRisk,
            heatIndex: computeHeatIndex(historicalWeather.avgTempMax),
            airQuality: airQualityDefault(loc.name, loc.district.name, loc.altitude),
            source,
            recordedAt,
          },
        });

        locationOk++;
        inserted += 2;
      } catch {
        failed++;
      }

      // Keep provider request rate low to avoid 429 bursts.
      await sleep(1500);
    }

    if (locationOk > 0) {
      ok++;
      console.log(`- ${loc.name} (${loc.district.name}): ${locationOk}/${MONTHS.length} months seeded`);
    }
  }

  console.log("\nBaseline seed complete.");
  console.log(`  Locations seeded: ${ok}/${locations.length}`);
  console.log(`  Rows inserted: ${inserted}`);
  console.log(`  Failed month fetches: ${failed}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error("seed-route-baseline failed:", err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
