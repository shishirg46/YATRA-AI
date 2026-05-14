/**
 * scripts/seed-destinations.ts
 * Run: npx tsx scripts/seed-destinations.ts
 *
 * Reads 7 province JSON files and upserts all destinations.
 * Safe to run multiple times — updates coordinates on existing entries.
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import bagmati       from "./destinations/bagmati.json";
import gandaki       from "./destinations/gandaki.json";
import koshi         from "./destinations/koshi.json";
import lumbini       from "./destinations/lumbini.json";
import madhesh       from "./destinations/madhesh.json";
import karnali       from "./destinations/karnali.json";
import sudurpashchim from "./destinations/sudurpashchim.json";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PROVINCE_DATA: Record<string, { district: string; name: string; lat: number; lng: number; alt: number }[]> = {
  "Bagmati":       bagmati,
  "Gandaki":       gandaki,
  "Koshi":         koshi,
  "Lumbini":       lumbini,
  "Madhesh":       madhesh,
  "Karnali":       karnali,
  "Sudurpashchim": sudurpashchim,
};

async function main() {
  const total = Object.values(PROVINCE_DATA).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`🌱 Upserting ${total} destinations across 7 provinces...\n`);

  let created = 0;
  let updated = 0;
  let errors  = 0;

  for (const [provinceName, destinations] of Object.entries(PROVINCE_DATA)) {
    console.log(`\n📍 ${provinceName} Province (${destinations.length} destinations)`);
    console.log("─".repeat(50));

    const province = await prisma.province.upsert({
      where:  { name: provinceName },
      create: { name: provinceName },
      update: {},
    });

    for (const dest of destinations) {
      try {
        const district = await prisma.district.upsert({
          where:  { name_provinceId: { name: dest.district, provinceId: province.id } },
          create: { name: dest.district, provinceId: province.id },
          update: {},
        });

        // Check if already exists so we can log created vs updated
        const existing = await prisma.location.findFirst({
          where:  { name: dest.name, districtId: district.id },
          select: { id: true, latitude: true, longitude: true },
        });

        if (existing) {
          // Always update coordinates — this fixes locations previously seeded with lat:0 lng:0
          await prisma.location.update({
            where: { id: existing.id },
            data: {
              latitude:  dest.lat,
              longitude: dest.lng,
              altitude:  dest.alt,
            },
          });
          const wasZero = existing.latitude === 0 && existing.longitude === 0;
          console.log(`  🔄  ${dest.name} — updated${wasZero ? " (fixed zero coords)" : ""}`);
          updated++;
        } else {
          await prisma.location.create({
            data: {
              name:       dest.name,
              districtId: district.id,
              latitude:   dest.lat,
              longitude:  dest.lng,
              altitude:   dest.alt,
            },
          });
          console.log(`  ✅  ${dest.name} — ${dest.district} (${dest.alt}m)`);
          created++;
        }
      } catch (err) {
        console.error(`  ❌  ${dest.name}: ${err}`);
        errors++;
      }
    }
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`🎉 Done!`);
  console.log(`   ✅ Created : ${created}`);
  console.log(`   🔄 Updated : ${updated}`);
  console.log(`   ❌ Errors  : ${errors}`);
  console.log(`   📊 Total   : ${total}`);
  console.log(`\n👉 Next steps:`);
  console.log(`   1. Delete old RiskAssessment rows (they used lat:0 lng:0)`);
  console.log(`      npx prisma db execute --stdin <<< 'DELETE FROM "RiskAssessment";'`);
  console.log(`   2. Re-run the assess job`);
  console.log(`      curl -X POST http://localhost:3000/api/assess -H "Authorization: Bearer YOUR_SECRET"\n`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
