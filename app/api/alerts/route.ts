/**
 * FILE: route.ts
 * LOCATION: /app/api/alerts/route.ts
 * PURPOSE: Polls BIPAD portal for live disaster incidents and writes
 *          real notifications to all users whose home district matches.
 *
 * TRIGGER: POST /api/alerts (protected by ASSESS_SECRET)
 * RUN EVERY: 30 minutes via cron or manually
 *
 * Also called on GET /api/alerts to return recent BIPAD incidents
 * without writing notifications — used by the dashboard to show
 * live Nepal-wide hazard feed.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { PrismaClient }              from "@/app/generated/prisma/client";
import { PrismaPg }                  from "@prisma/adapter-pg";
import { Pool }                      from "pg";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── BIPAD incident types we care about ───────────────────────────────────────

const HAZARD_TYPE_MAP: Record<string, string> = {
  flood:      "FLOOD",
  inundation: "FLOOD",
  "बाढी":     "FLOOD",
  landslide:  "LANDSLIDE",
  debris:     "LANDSLIDE",
  "पहिरो":   "LANDSLIDE",
  earthquake: "EARTHQUAKE",
  "भूकम्प":  "EARTHQUAKE",
  fire:       "FIRE",
  "आगलागी":  "FIRE",
  storm:      "STORM",
  hailstorm:  "STORM",
};

function getHazardType(typeStr: string): string {
  const lower = typeStr.toLowerCase();
  for (const [key, val] of Object.entries(HAZARD_TYPE_MAP)) {
    if (lower.includes(key)) return val;
  }
  return "INFO";
}

function getSeverity(hazardType: string, deaths: number, injured: number): string {
  if (deaths > 5 || hazardType === "EARTHQUAKE") return "CRITICAL";
  if (deaths > 0 || injured > 5)                 return "HIGH";
  if (injured > 0 || hazardType === "FLOOD")      return "MEDIUM";
  return "LOW";
}

// ── Fetch from BIPAD ──────────────────────────────────────────────────────────

interface BipadIncident {
  id:               number;
  title?:           string;
  incident_type?:   { title?: string };
  hazard?:          { title?: string };
  district?:        { title?: string; title_ne?: string };
  local_level?:     { title?: string };
  date_of_incident?: string;
  loss?:            { death?: number; injured?: number; estimated_loss?: number };
  description?:     string;
}

async function fetchBipadIncidents(hours = 48): Promise<BipadIncident[]> {
  const from = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().split("T")[0];
  const url  = `https://bipadportal.gov.np/api/v1/incident/?date_of_incident__gte=${from}&format=json&limit=50&ordering=-date_of_incident`;

  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(15_000),
      headers: { Accept: "application/json" },
      cache:   "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: BipadIncident[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

// ── GET — return live BIPAD feed (no auth required for reading) ───────────────

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  const incidents = await fetchBipadIncidents(48);

  const feed = incidents.map((inc) => {
    const typeStr     = inc.incident_type?.title ?? inc.hazard?.title ?? "";
    const hazardType  = getHazardType(typeStr);
    const deaths      = inc.loss?.death    ?? 0;
    const injured     = inc.loss?.injured  ?? 0;
    const district    = inc.district?.title ?? "Nepal";
    const localLevel  = inc.local_level?.title;
    const location    = localLevel ? `${localLevel}, ${district}` : district;

    return {
      id:          `bipad-${inc.id}`,
      type:        hazardType,
      title:       inc.title ?? `${typeStr} in ${district}`,
      body:        inc.description ?? `${typeStr} reported in ${location}.${deaths > 0 ? ` Deaths: ${deaths}.` : ""}${injured > 0 ? ` Injured: ${injured}.` : ""}`,
      location,
      district,
      severity:    getSeverity(hazardType, deaths, injured),
      date:        inc.date_of_incident ?? new Date().toISOString().split("T")[0],
      time:        new Date().toISOString(),
      read:        false,
      source:      "BIPAD",
    };
  });

  return NextResponse.json(feed);
}

// ── POST — poll BIPAD and write notifications to affected users ───────────────

export async function POST(req: NextRequest) {
  // Protect with ASSESS_SECRET
  const authHeader = req.headers.get("authorization") ?? "";
  const secret     = process.env.ASSESS_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const incidents = await fetchBipadIncidents(24);
  if (incidents.length === 0) {
    return NextResponse.json({ message: "No recent BIPAD incidents found.", written: 0 });
  }

  // Load all users with their home district
  const users = await prisma.user.findMany({
    where:   { homeLocationId: { not: null } },
    select: {
      id:           true,
      homeLocation: {
        select: { district: { select: { name: true } } },
      },
    },
  });

  let written = 0;

  for (const inc of incidents) {
    const typeStr    = inc.incident_type?.title ?? inc.hazard?.title ?? "";
    const hazardType = getHazardType(typeStr);
    const deaths     = inc.loss?.death   ?? 0;
    const injured    = inc.loss?.injured ?? 0;
    const district   = inc.district?.title ?? "";
    const localLevel = inc.local_level?.title;
    const location   = localLevel ? `${localLevel}, ${district}` : district;
    const severity   = getSeverity(hazardType, deaths, injured);
    const title      = inc.title ?? `${typeStr || "Hazard"} in ${district}`;
    const body       = inc.description
      ?? `${typeStr} reported in ${location}.${deaths > 0 ? ` Deaths: ${deaths}.` : ""}${injured > 0 ? ` Injured: ${injured}.` : ""}`;

    // Only notify users whose home district matches the incident district
    const affectedUsers = users.filter((u) => {
      const homeDistrict = u.homeLocation?.district?.name?.toLowerCase() ?? "";
      return homeDistrict && district.toLowerCase().includes(homeDistrict);
    });

    if (affectedUsers.length === 0) continue;

    const message = JSON.stringify({
      _type:      "HAZARD",
      hazardType,
      title,
      body,
      location,
      severity,
      bipadId:    inc.id,
      date:       inc.date_of_incident,
    });

    // Avoid duplicate notifications for the same BIPAD incident
    const dedupeKey = `bipad-${inc.id}`;
    const existing  = await prisma.notification.findFirst({
      where: { message: { contains: dedupeKey } },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.notification.createMany({
      data: affectedUsers.map((u) => ({ userId: u.id, message })),
    });

    written += affectedUsers.length;
    console.log(`[alerts] ${title} → ${affectedUsers.length} users notified`);
  }

  return NextResponse.json({
    incidents: incidents.length,
    written,
    timestamp: new Date().toISOString(),
  });
}
