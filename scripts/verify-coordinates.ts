#!/usr/bin/env node
/**
 * Verifies all places, destinations, and locations for coordinate errors.
 * Run: npx tsx scripts/verify-coordinates.ts
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const VALID_LAT = (v: number | null | undefined) => v != null && v >= -90 && v <= 90;
const VALID_LNG = (v: number | null | undefined) => v != null && v >= -180 && v <= 180;
const IS_ZERO = (v: number | null | undefined) => v != null && Math.abs(v) < 0.001;
const IS_NEPAL = (lat: number, lng: number) => lat >= 26 && lat <= 31 && lng >= 80 && lng <= 89;

interface Issue {
  table: string;
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  issue: string;
  extra?: string;
}

async function main() {
  const issues: Issue[] = [];

  // ── 1. Destinations ──────────────────────────────────────────────────────
  const destinations = await prisma.destination.findMany({ orderBy: { name: "asc" } });
  console.log(`\n📊 Destinations: ${destinations.length} total`);

  for (const d of destinations) {
    if (!VALID_LAT(d.latitude) || !VALID_LNG(d.longitude)) {
      issues.push({ table: "destination", id: d.id, name: d.name, lat: d.latitude, lng: d.longitude, issue: "Invalid coordinates (outside -90/90 or -180/180)" });
    } else if (IS_ZERO(d.latitude) && IS_ZERO(d.longitude)) {
      issues.push({ table: "destination", id: d.id, name: d.name, lat: d.latitude, lng: d.longitude, issue: "Coordinates are (0, 0) — likely unset/error" });
    } else if (!IS_NEPAL(d.latitude, d.longitude)) {
      issues.push({ table: "destination", id: d.id, name: d.name, lat: d.latitude, lng: d.longitude, issue: "Coordinates outside Nepal bounds" });
    }
  }

  // ── 2. Places ────────────────────────────────────────────────────────────
  const places = await prisma.place.findMany({ include: { district: true }, orderBy: { name: "asc" } });
  console.log(`📊 Places: ${places.length} total`);

  // Group places by name to find duplicates with conflicting coords
  const placeByName = new Map<string, typeof places>();
  for (const p of places) {
    const key = p.name.toLowerCase();
    if (!placeByName.has(key)) placeByName.set(key, []);
    placeByName.get(key)!.push(p);
  }

  for (const [pname, dups] of placeByName) {
    if (dups.length > 1) {
      const lats = new Set(dups.map((p) => p.latitude.toFixed(4)));
      const lngs = new Set(dups.map((p) => p.longitude.toFixed(4)));
      if (lats.size > 1 || lngs.size > 1) {
        for (const p of dups) {
          issues.push({
            table: "place", id: p.id, name: p.name, lat: p.latitude, lng: p.longitude,
            issue: `Duplicate name with conflicting coordinates (${dups.length} entries)`,
            extra: `type=${p.type} district=${p.district?.name ?? "?"}`,
          });
        }
      }
    }
  }

  for (const p of places) {
    if (!VALID_LAT(p.latitude) || !VALID_LNG(p.longitude)) {
      issues.push({ table: "place", id: p.id, name: p.name, lat: p.latitude, lng: p.longitude, issue: "Invalid coordinates" });
    } else if (IS_ZERO(p.latitude) && IS_ZERO(p.longitude)) {
      issues.push({ table: "place", id: p.id, name: p.name, lat: p.latitude, lng: p.longitude, issue: "Coordinates are (0, 0)" });
    } else if (!IS_NEPAL(p.latitude, p.longitude)) {
      issues.push({ table: "place", id: p.id, name: p.name, lat: p.latitude, lng: p.longitude, issue: "Coordinates outside Nepal bounds", extra: `type=${p.type}` });
    }
  }

  // ── 3. Locations ─────────────────────────────────────────────────────────
  const locations = await prisma.location.findMany({ include: { district: { include: { province: true } } }, orderBy: { name: "asc" } });
  console.log(`📊 Locations: ${locations.length} total`);

  for (const l of locations) {
    if (!VALID_LAT(l.latitude) || !VALID_LNG(l.longitude)) {
      issues.push({ table: "location", id: l.id, name: l.name, lat: l.latitude, lng: l.longitude, issue: "Invalid coordinates" });
    } else if (IS_ZERO(l.latitude) && IS_ZERO(l.longitude)) {
      issues.push({ table: "location", id: l.id, name: l.name, lat: l.latitude, lng: l.longitude, issue: "Coordinates are (0, 0)" });
    } else if (!IS_NEPAL(l.latitude, l.longitude)) {
      issues.push({ table: "location", id: l.id, name: l.name, lat: l.latitude, lng: l.longitude, issue: "Coordinates outside Nepal bounds", extra: `district=${l.district.name} province=${l.district.province.name}` });
    }
  }

  // ── 4. RouteNodes ────────────────────────────────────────────────────────
  const nodes = await prisma.routeNode.findMany({ orderBy: { name: "asc" } });
  console.log(`📊 RouteNodes: ${nodes.length} total`);

  for (const n of nodes) {
    if (!VALID_LAT(n.latitude) || !VALID_LNG(n.longitude)) {
      issues.push({ table: "route_node", id: n.id, name: n.name, lat: n.latitude, lng: n.longitude, issue: "Invalid coordinates" });
    } else if (IS_ZERO(n.latitude) && IS_ZERO(n.longitude)) {
      issues.push({ table: "route_node", id: n.id, name: n.name, lat: n.latitude, lng: n.longitude, issue: "Coordinates are (0, 0)" });
    } else if (!IS_NEPAL(n.latitude, n.longitude)) {
      issues.push({ table: "route_node", id: n.id, name: n.name, lat: n.latitude, lng: n.longitude, issue: "Coordinates outside Nepal bounds" });
    }
  }

  // ── Print Results ────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(80)}`);
  if (issues.length === 0) {
    console.log("✅ No coordinate issues found across all tables.");
  } else {
    console.log(`❌ Found ${issues.length} issues:\n`);
    for (const iss of issues) {
      console.log(`  [${iss.table.toUpperCase()}] "${iss.name}" (id: ${iss.id.slice(0, 8)}…)`);
      console.log(`    📍 lat=${iss.lat ?? "null"}, lng=${iss.lng ?? "null"}`);
      console.log(`    ⚠  ${iss.issue}`);
      if (iss.extra) console.log(`    ℹ  ${iss.extra}`);
      console.log();
    }
  }

  // ── Summary stats ────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("SUMMARY:");
  console.log(`  Destinations: ${destinations.length} total, ${issues.filter((i) => i.table === "destination").length} issues`);
  console.log(`  Places:       ${places.length} total, ${issues.filter((i) => i.table === "place").length} issues`);
  console.log(`  Locations:    ${locations.length} total, ${issues.filter((i) => i.table === "location").length} issues`);
  console.log(`  RouteNodes:   ${nodes.length} total, ${issues.filter((i) => i.table === "route_node").length} issues`);
  console.log(`  TOTAL:        ${issues.length} issues found`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
