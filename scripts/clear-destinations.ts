#!/usr/bin/env node

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("Clearing all destinations...");
  const { count } = await prisma.destination.deleteMany();
  console.log(`Deleted ${count} destinations.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("Clear failed:", e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
