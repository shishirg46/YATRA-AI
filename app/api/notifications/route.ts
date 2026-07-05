/**
 * FILE: route.ts
 * LOCATION: /app/api/notifications/route.ts
 * PURPOSE: Returns notifications for the logged-in user
 *
 * THREE SOURCES:
 *  1. DB Notification rows — HAZARD (from assess job / alert poller),
 *                            TRIP_INVITE, TRIP_RESPONSE
 *  2. Live BIPAD feed — fetched in real-time via shared bipad-alerts module
 *  3. Fresh DB re-fetch if new live incidents were persisted
 *
 * DEDUPLICATION: Live BIPAD incidents that already have a DB row are skipped
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth }         from "@/lib/auth";
import { headers }      from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { fetchRecentBipadIncidents } from "@/lib/bipad-alerts";

type NotifType = "FLOOD" | "LANDSLIDE" | "EARTHQUAKE" | "FIRE" | "STORM" | "INFO" | "TRIP_START" | "TRIP_END" | "TRIP_REMINDER";
type Severity  = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface FlatNotification {
  id:       string;
  type:     NotifType;
  title:    string;
  body:     string;
  location: string;
  severity: Severity;
  time:     string;
  read:     boolean;
  source?:  string;
  planId?:  string;
  action?:  { type: string; planId: string };
}


// ── Parse a DB notification row into Notification shape ──────────────────────

function parseDbRow(row: { id: string; isRead: boolean; createdAt: Date }, data: Record<string, unknown>): FlatNotification | null {
  if (data._type === "PROFILE") return null;

  if (data._type === "HAZARD") {
    // Only show HAZARD notifications that came from real-time BIPAD incidents
    if (!data.bipadId) return null;
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

  if (data._type === "TRIP_START" || data._type === "TRIP_END" || data._type === "TRIP_REMINDER") {
    return {
      id:       row.id,
      type:     data._type as "TRIP_START" | "TRIP_END" | "TRIP_REMINDER",
      title:    (data.title  ?? "Trip update") as string,
      body:     (data.body   ?? "") as string,
      location: "Trip update",
      severity: "LOW" as Severity,
      time:     row.createdAt.toISOString(),
      read:     row.isRead,
      planId:   data.planId as string,
      action:   { type: data._type as string, planId: data.planId as string },
    };
  }

  return null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

async function getNotificationsHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  // Fetch DB notifications + live BIPAD in parallel
  const [dbRows, liveAlerts] = await Promise.all([
    prisma.notification.findMany({
      where:   {
        userId:  session.user.id,
        message: { not: { contains: '"_type":"PROFILE"' } },
      },
      orderBy: { createdAt: "desc" },
      take:    50,
    }),
    fetchRecentBipadIncidents(48),
  ]);

  // Parse DB notifications using shared helper
  const dbNotifications: FlatNotification[] = dbRows.flatMap((row) => {
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

  // Include all live incidents across Nepal, skip ones already in DB
  const liveIncidents: FlatNotification[] = liveAlerts
    .filter((a) => !dbBipadIds.has(a.id))
    .map((a) => ({
      id: a.id,
      type: a.type as NotifType,
      title: a.title,
      body: a.body,
      location: a.location,
      severity: a.severity as Severity,
      time: new Date(a.date).toISOString(),
      read: false,
      source: "BIPAD",
    }));

  // Persist new BIPAD incidents to DB so read state survives refresh
  if (liveIncidents.length > 0) {
    await prisma.notification.createMany({
      data: liveIncidents.map((n) => ({
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

    const allNotifications: FlatNotification[] = updatedRows.flatMap((row) => {
      try {
        const data = JSON.parse(row.message);
        if (data._type === "PROFILE") return [];
        return [parseDbRow(row, data)];
      } catch { return []; }
    }).filter(Boolean) as FlatNotification[];

    return NextResponse.json(
      allNotifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    );
  }

  // No new live incidents — just return what we have
  const all = [...dbNotifications]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return NextResponse.json(all);
}

export const GET = withRateLimit(getNotificationsHandler, { max: 30, windowSeconds: 60 });
