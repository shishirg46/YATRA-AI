/**
 * Precompute destination embeddings using @xenova/transformers.
 * Run: npx tsx scripts/embed-destinations.ts
 *
 * Generates 384-dim vectors from destination text (name + description + tags + district)
 * and upserts them into the destination_embedding table.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "..", ".env") });

import { Pool } from "pg";

const url = new URL(process.env.DATABASE_URL || "postgresql://yatra:yatra123@localhost:5433/yatraai?schema=public");
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port, 10) || 5432,
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  max: 3,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 10000,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("[embed] Loading destinations...");
  const destinations = await prisma.destination.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      tags: true,
      district: true,
      province: true,
      category: true,
    },
  });
  console.log(`[embed] Loaded ${destinations.length} destinations`);

  const { pipeline } = await import("@xenova/transformers");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  let done = 0;
  for (const dest of destinations) {
    const text = [
      dest.name,
      dest.description ?? "",
      (dest.tags ?? []).join(" "),
      dest.district,
      dest.province,
      dest.category,
    ]
      .filter(Boolean)
      .join(" | ");

    const output = await extractor(text, { pooling: "mean", normalize: true });
    const vector = Array.from(output.data) as number[];

    await prisma.$executeRawUnsafe(
      `INSERT INTO "destination_embedding" ("destinationId", vector, "createdAt", "updatedAt")
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT ("destinationId")
       DO UPDATE SET vector = $2::jsonb, "updatedAt" = NOW()`,
      dest.id,
      JSON.stringify(vector),
    );

    done++;
    if (done % 50 === 0) {
      console.log(`[embed] ${done}/${destinations.length} destinations processed`);
    }
  }

  console.log(`[embed] Done — ${done} embeddings upserted`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[embed] Fatal:", err);
  process.exit(1);
});
