/**
 * FILE: route.ts
 * LOCATION: /app/api/notifications/route.ts
 * PURPOSE: Returns notifications for the logged-in user
 *
 * TWO SOURCES:
 *  1. DB Notification rows — HAZARD (from assess job / alert poller),
 *                            TRIP_INVITE, TRIP_RESPONSE
 *  2. Live BIPAD feed — fetched in real-time for the user's home district
 *     so incidents like "Flood warning at Gaurishankar-9, Dolakha" appear
 *     immediately without waiting for the alert poller to run
 *
 * DEDUPLICATION: Live BIPAD incidents that already have a DB row are skipped
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth }         from "@/lib/auth";
import { headers }      from "next/headers";
import { prisma } from "@/lib/prisma";

type NotifType = "FLOOD" | "LANDSLIDE" | "EARTHQUAKE" | "FIRE" | "STORM" | "INFO";
type Severity  = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface Notification {
  id:       string;
  type:     NotifType;
  title:    string;
  body:     string;
  location: string;
  severity: Severity;
  time:     string;
  read:     boolean;
  source?:  string;
  action?:  { type: string; planId: string };
}

// ── BIPAD live fetch ──────────────────────────────────────────────────────────

const HAZARD_TYPE_MAP: Record<string, NotifType> = {
  flood: "FLOOD", inundation: "FLOOD", "बाढी": "FLOOD",
  landslide: "LANDSLIDE", debris: "LANDSLIDE", "पहिरो": "LANDSLIDE",
  earthquake: "EARTHQUAKE", "भूकम्प": "EARTHQUAKE",
  fire: "FIRE", "आगलागी": "FIRE",
  storm: "STORM", hailstorm: "STORM",
};

function getHazardType(s: string): NotifType {
  const lower = s.toLowerCase();
  for (const [k, v] of Object.entries(HAZARD_TYPE_MAP)) {
    if (lower.includes(k)) return v;
  }
  return "INFO";
}

function getSeverity(type: string, deaths: number, injured: number): Severity {
  if (deaths > 5 || type === "EARTHQUAKE") return "CRITICAL";
  if (deaths > 0 || injured > 5)           return "HIGH";
  if (injured > 0 || type === "FLOOD")     return "MEDIUM";
  return "LOW";
}

async function fetchLiveBipad(districtName: string): Promise<Notification[]> {
  if (!districtName) return [];
  try {
    const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split("T")[0];
    const url  = `https://bipadportal.gov.np/api/v1/incident/?district__title_en=${encodeURIComponent(districtName)}&date_of_incident__gte=${from}&format=json&limit=20&ordering=-date_of_incident`;

    const res = await fetch(url, {
      signal:  AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
      cache:   "no-store",
    });

    if (!res.ok) return [];

    const data = await res.json() as {
      results?: {
        id:              number;
        title?:          string;
        incident_type?:  { title?: string };
        hazard?:         { title?: string };
        district?:       { title?: string };
        local_level?:    { title?: string };
        date_of_incident?: string;
        loss?:           { death?: number; injured?: number };
        description?:    string;
      }[]
    };

    return (data.results ?? []).map((inc) => {
      const typeStr    = inc.incident_type?.title ?? inc.hazard?.title ?? "";
      const hazardType = getHazardType(typeStr);
      const deaths     = inc.loss?.death   ?? 0;
      const injured    = inc.loss?.injured ?? 0;
      const district   = inc.district?.title ?? districtName;
      const localLevel = inc.local_level?.title;
      const location   = localLevel ? `${localLevel}, ${district}` : district;

      return {
        id:       `bipad-${inc.id}`,
        type:     hazardType,
        title:    inc.title ?? `${typeStr || "Incident"} in ${district}`,
        body:     inc.description
          ?? `${typeStr} reported in ${location}.${deaths > 0 ? ` Deaths: ${deaths}.` : ""}${injured > 0 ? ` Injured: ${injured}.` : ""}`,
        location,
        severity: getSeverity(hazardType, deaths, injured),
        time:     inc.date_of_incident
          ? new Date(inc.date_of_incident).toISOString()
          : new Date().toISOString(),
        read:     false,
        source:   "BIPAD",
      };
    });
  } catch {
    return [];
  }
}

// ── Parse a DB notification row into Notification shape ──────────────────────

function parseDbRow(row: { id: string; isRead: boolean; createdAt: Date }, data: Record<string, unknown>): Notification | null {
  if (data._type === "PROFILE") return null;

  if (data._type === "HAZARD") {
    return {
      id:       row.id,
      type:     (data.hazardType ?? "INFO") as NotifType,
      title:    (data.title    ?? "Safety alert") as string,
      body:     (data.body     ?? "") as string,
      location: (data.location ?? "Nepal") as string,
      severity: (data.severity ?? "LOW") as Severity,
      time:     row.createdAt.toISOString(),
      read:     row.isRead,
      source:   "DB",
    };
  }

  if (data._type === "TRIP_INVITE") {
    return {
      id:       row.id,
      type:     "INFO" as NotifType,
      title:    `${data.fromName} invited you to "${data.planTitle}"`,
      body:     `${data.stops} stop${(data.stops as number) !== 1 ? "s" : ""} · Tap to view and respond`,
      location: "Trip invitation",
      severity: "LOW" as Severity,
      time:     row.createdAt.toISOString(),
      read:     row.isRead,
      action:   { type: "TRIP", planId: data.planId as string },
    };
  }

  if (data._type === "TRIP_RESPONSE") {
    return {
      id:       row.id,
      type:     "INFO" as NotifType,
      title:    `${data.fromName} ${data.action === "accept" ? "joined" : "declined"} "${data.planTitle}"`,
      body:     data.action === "accept" ? "Your group is growing!" : "They won't be joining this trip.",
      location: "Trip update",
      severity: "LOW" as Severity,
      time:     row.createdAt.toISOString(),
      read:     row.isRead,
      action:   { type: "TRIP", planId: data.planId as string },
    };
  }

  return null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  // Load user's home district for BIPAD live query
  const user = await prisma.user.findUnique({
    where:   { id: session.user.id },
    select: {
      homeLocation: {
        select: { district: { select: { name: true } } },
      },
    },
  });

  const homeDistrict = user?.homeLocation?.district?.name ?? "";

  // Fetch DB notifications + live BIPAD in parallel
  const [dbRows, liveIncidents] = await Promise.all([
    prisma.notification.findMany({
      where:   {
        userId:  session.user.id,
        message: { not: { contains: '"_type":"PROFILE"' } },
      },
      orderBy: { createdAt: "desc" },
      take:    50,
    }),
    fetchLiveBipad(homeDistrict),
  ]);

  // Parse DB notifications using shared helper
  const dbNotifications: Notification[] = dbRows.flatMap((row) => {
    try {
      const data = JSON.parse(row.message);
      const parsed = parseDbRow(row, data);
      return parsed ? [parsed] : [];
    } catch { return []; }
  });

  // Collect IDs already in DB so we don't show BIPAD duplicates
  const dbBipadIds = new Set(
    dbRows
      .map((r) => { try { return JSON.parse(r.message)?.bipadId; } catch { return null; } })
      .filter(Boolean)
      .map((id) => `bipad-${id}`)
  );

  // Filter live incidents — skip ones already written to DB
  const newLiveIncidents = liveIncidents.filter((n) => !dbBipadIds.has(n.id));

  // Persist new BIPAD incidents to DB so read state survives refresh
  if (newLiveIncidents.length > 0) {
    await prisma.notification.createMany({
      data: newLiveIncidents.map((n) => ({
        userId:  session.user.id,
        message: JSON.stringify({
          _type:      "HAZARD",
          hazardType: n.type,
          title:      n.title,
          body:       n.body,
          location:   n.location,
          severity:   n.severity,
          bipadId:    n.id.replace("bipad-", ""),
          source:     "BIPAD",
        }),
        isRead:    false,
        createdAt: new Date(n.time),
      })),
      skipDuplicates: true,
    });

    // Re-fetch DB rows to include the newly created ones with real IDs
    const updatedRows = await prisma.notification.findMany({
      where:   {
        userId:  session.user.id,
        message: { not: { contains: '"_type":"PROFILE"' } },
      },
      orderBy: { createdAt: "desc" },
      take:    50,
    });

    const allNotifications: Notification[] = updatedRows.flatMap((row) => {
      try {
        const data = JSON.parse(row.message);
        if (data._type === "PROFILE") return [];
        return [parseDbRow(row, data)];
      } catch { return []; }
    }).filter(Boolean) as Notification[];

    return NextResponse.json(
      allNotifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    );
  }

  // No new live incidents — just return what we have
  const all = [...dbNotifications]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return NextResponse.json(all);
}
