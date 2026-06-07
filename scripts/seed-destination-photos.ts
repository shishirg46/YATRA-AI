#!/usr/bin/env node
/**
 * scripts/seed-destination-photos.ts
 *
 * Fetches photos for all destinations that don't have an image yet.
 * Sources: Wikipedia → Wikimedia Commons (GeoSearch) → Unsplash (if configured)
 * Uploads to Cloudinary, stores URL on the Destination record.
 *
 * Run: npx tsx scripts/seed-destination-photos.ts
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { findDestinationPhotos } from "../lib/media/photo-sources";
import { uploadImageFromUrl } from "../lib/media/cloudinary";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("Fetching destinations without photos…");

  const destinations = await prisma.destination.findMany({
    where: { image: null },
    orderBy: [{ popularityScore: "desc" }, { dataQualityScore: "desc" }]
  });

  console.log(`Found ${destinations.length} destinations needing photos.`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < destinations.length; i++) {
    const dest = destinations[i];
    const query = `${dest.name} ${dest.district} Nepal`;
    process.stdout.write(`[${i + 1}/${destinations.length}] ${dest.name}… `);

    try {
      const photos = await findDestinationPhotos(dest.name, dest.latitude, dest.longitude);
      if (photos.length === 0) {
        const altPhotos = await findDestinationPhotos(query, dest.latitude, dest.longitude);
        photos.push(...altPhotos);
      }

      if (photos.length === 0) {
        console.log("×");
        failed++;
        continue;
      }

      const uploaded = await uploadImageFromUrl(photos[0].url, dest.id, 0);

      if (!uploaded && photos.length > 1) {
        const fallback = await uploadImageFromUrl(photos[1].url, dest.id, 0);
        if (!fallback) {
          console.log("! upload");
          failed++;
          continue;
        }
        await prisma.destination.update({
          where: { id: dest.id },
          data: { image: fallback.secure_url },
        });
      } else if (!uploaded) {
        console.log("! upload");
        failed++;
        continue;
      } else {
        await prisma.destination.update({
          where: { id: dest.id },
          data: { image: uploaded.secure_url },
        });
      }

      success++;
      console.log("✓");

      if (i < destinations.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      console.log("✗");
      failed++;
    }
  }

  console.log(`\nDone. ${success} uploaded, ${failed} failed.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
