/**
 * FILE: route.ts
 * LOCATION: /app/api/cron/refresh-disasters/route.ts
 * PURPOSE: Cron job — ingests recent disaster data and refreshes safety assessments.
 *
 * TRIGGER: Every 30 minutes via Vercel Cron Jobs (or external cron service).
 *   Production: Configure Vercel CRON_SECRET + Vercel Cron Jobs pointing here.
 *   Local dev:  curl -X POST "http://localhost:3000/api/cron/refresh-disasters?secret=$ASSESS_SECRET"
 *
 * BEHAVIOUR:
 *   1. Ingest realtime disaster data (last 24h from BIPAD + USGS)
 *   2. Ingest historical disaster data (once daily — checks if last run was >12h ago)
 *   3. Run safety assessment for all locations (weather + hazard collection)
 *   4. Clean up stale notifications
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Vercel timeout — 2 minutes for this batch

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDisasterEventTable, ingestRealtime, ingestHistoricalBipad } from "@/lib/disaster-pipeline";
import { fetchHazard } from "@/lib/collectors/hazard";

const CRON_SECRET = process.env.CRON_SECRET ?? process.env.ASSESS_SECRET;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  try {
    console.log("[cron/refresh-disasters] Starting pipeline...");

    // Step 1: Ensure disaster event table exists
    await ensureDisasterEventTable();
    results.table = "ok";

    // Step 2: Ingest realtime disaster data (last 24 hours)
    const realtimeResult = await ingestRealtime(24);
    results.realtime = realtimeResult;
    console.log("[cron/refresh-disasters] Realtime ingestion:", realtimeResult);

    // Step 3: Historical ingestion (once daily — checks internal dedup)
    const historicalResult = await ingestHistoricalBipad(2020, new Date().getFullYear());
    results.historical = historicalResult;
    console.log("[cron/refresh-disasters] Historical ingestion:", historicalResult);

    // Step 4: Refresh hazard data for all locations
    const locations = await prisma.location.findMany({
      where: {
        communityReports: { some: {} }, // Locations with active reports
      },
      take: 50,
    });

    let hazardsRefreshed = 0;
    for (const loc of locations) {
      try {
        const hazard = await fetchHazard(loc.name, loc.latitude, loc.longitude);
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
        hazardsRefreshed++;
      } catch {
        // Individual location failure — skip
      }
    }
    results.hazardsRefreshed = hazardsRefreshed;

    // Step 5: Clean up stale notifications (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deletedNotifs = await prisma.notification.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    });
    results.staleNotificationsCleaned = deletedNotifs.count;

    // Step 6: Clean up stale completed SOS alerts (older than 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deletedAlerts = await prisma.emergencyAlert.deleteMany({
      where: {
        status: "RESOLVED",
        createdAt: { lt: sevenDaysAgo },
      },
    });
    results.staleAlertsCleaned = deletedAlerts.count;

    console.log("[cron/refresh-disasters] Pipeline complete:", results);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error("[cron/refresh-disasters] Fatal error:", error);
    return NextResponse.json({
      success: false,
      message: "Pipeline failed",
      error: String(error),
    }, { status: 500 });
  }
}

export const POST = GET;
