/**
 * FILE: route.ts
 * LOCATION: /app/api/assess/status/route.ts
 * PURPOSE: Check if safety data is stale and optionally trigger reassessment
 *
 * GET /api/assess/status
 *   Returns: { lastAssessed, hoursAgo, isStale, totalLocations, assessed }
 *
 * POST /api/assess/status
 *   Triggers reassessment if data is stale (>24h old)
 *   Returns immediately — reassessment runs in background
 *   Safe to call on every dashboard load — won't reassess if data is fresh
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { PrismaClient }              from "@/app/generated/prisma/client";
import { PrismaPg }                  from "@prisma/adapter-pg";
import { Pool }                      from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const STALE_AFTER_HOURS = 24; // reassess if older than this

function isPlanLimitReachedError(error: unknown): boolean {
  const direct = error instanceof Error ? error.message : String(error ?? "");
  let nested = "";
  try {
    nested = JSON.stringify(error);
  } catch {
    nested = "";
  }
  return /planLimitReached|Failed to identify your database|Failed to get session/i.test(`${direct} ${nested}`);
}

async function getSessionOr503() {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    if (isPlanLimitReachedError(error)) {
      return NextResponse.json(
        { message: "Database unavailable: provider account limit reached (planLimitReached)." },
        { status: 503 }
      );
    }
    throw error;
  }
}

export async function GET() {
  const sessionOrResponse = await getSessionOr503();
  if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
  const session = sessionOrResponse;
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const latest = await prisma.riskAssessment.findFirst({
    orderBy: { createdAt: "desc" },
    select:  { createdAt: true },
  });

  const total    = await prisma.location.count();
  const assessed = await prisma.location.count({ where: { riskReports: { some: {} } } });

  if (!latest) {
    return NextResponse.json({ lastAssessed: null, hoursAgo: null, isStale: true, total, assessed });
  }

  const hoursAgo = (Date.now() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);
  const isStale  = hoursAgo > STALE_AFTER_HOURS;

  return NextResponse.json({
    lastAssessed: latest.createdAt.toISOString(),
    hoursAgo:     Math.round(hoursAgo * 10) / 10,
    isStale,
    total,
    assessed,
  });
}

export async function POST(req: NextRequest) {
  const sessionOrResponse = await getSessionOr503();
  if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
  const session = sessionOrResponse;
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  // Check staleness first
  const latest = await prisma.riskAssessment.findFirst({
    orderBy: { createdAt: "desc" },
    select:  { createdAt: true },
  });

  if (latest) {
    const hoursAgo = (Date.now() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursAgo < STALE_AFTER_HOURS) {
      return NextResponse.json({
        triggered: false,
        reason:    `Data is fresh (${Math.round(hoursAgo)}h old, threshold: ${STALE_AFTER_HOURS}h)`,
        hoursAgo:  Math.round(hoursAgo * 10) / 10,
      });
    }
  }

  // Trigger reassessment in background — don't await so this returns immediately
  const assessUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/assess`;
  const secret    = process.env.ASSESS_SECRET ?? "";

  fetch(assessUrl, {
    method:  "POST",
    headers: { Authorization: `Bearer ${secret}` },
  }).then(() => {
    console.log("[assess/status] Background reassessment completed");
  }).catch((err) => {
    console.error("[assess/status] Background reassessment failed:", err);
  });

  return NextResponse.json({
    triggered: true,
    reason:    latest
      ? `Data was stale (>${STALE_AFTER_HOURS}h old) — reassessment started in background`
      : "No assessment data found — first run started in background",
  });
}
