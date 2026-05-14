/**
 * FILE: route.ts
 * LOCATION: /app/api/user/health/route.ts
 * PURPOSE: Create or update the UserHealth record for the current user
 *
 * POST /api/user/health
 *   Called from onboarding step 3 — creates or fully overwrites health data
 *   Body: { bloodType?, fitnessLevel, mobilityLimited, chronicConditions[], allergies[] }
 *
 * PATCH /api/user/health
 *   Called from dashboard "Edit health" panel — updates only the provided fields
 *   Body: any subset of the same fields
 *
 * Both endpoints upsert (create if not exists, update if exists) so they're
 * safe to call multiple times without duplicating records.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Shared shape for both POST and PATCH bodies
type HealthBody = {
  bloodType?:         string | null;
  fitnessLevel?:      "LOW" | "MODERATE" | "HIGH";
  mobilityLimited?:   boolean;
  chronicConditions?: string[];
  allergies?:         string[];
};

// ── POST — full upsert (onboarding) ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as HealthBody;

  // fitnessLevel is required on POST
  if (!body.fitnessLevel) {
    return NextResponse.json({ message: "fitnessLevel is required." }, { status: 400 });
  }

  const validLevels = ["LOW", "MODERATE", "HIGH"];
  if (!validLevels.includes(body.fitnessLevel)) {
    return NextResponse.json({ message: "fitnessLevel must be LOW, MODERATE, or HIGH." }, { status: 400 });
  }

  try {
    await prisma.userHealth.upsert({
      where:  { userId: session.user.id },
      create: {
        userId:            session.user.id,
        bloodType:         body.bloodType         ?? null,
        fitnessLevel:      body.fitnessLevel,
        mobilityLimited:   body.mobilityLimited   ?? false,
        chronicConditions: body.chronicConditions ?? [],
        allergies:         body.allergies         ?? [],
      },
      update: {
        bloodType:         body.bloodType         ?? null,
        fitnessLevel:      body.fitnessLevel,
        mobilityLimited:   body.mobilityLimited   ?? false,
        chronicConditions: body.chronicConditions ?? [],
        allergies:         body.allergies         ?? [],
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[health/post]", err);
    return NextResponse.json({ message: "Failed to save health info." }, { status: 500 });
  }
}

// ── PATCH — partial update (dashboard edit panel) ────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as HealthBody;

  // Validate fitnessLevel if provided
  if (body.fitnessLevel) {
    const validLevels = ["LOW", "MODERATE", "HIGH"];
    if (!validLevels.includes(body.fitnessLevel)) {
      return NextResponse.json({ message: "fitnessLevel must be LOW, MODERATE, or HIGH." }, { status: 400 });
    }
  }

  // Build only the fields that were actually sent
  const data: Partial<{
    bloodType:         string | null;
    fitnessLevel:      "LOW" | "MODERATE" | "HIGH";
    mobilityLimited:   boolean;
    chronicConditions: string[];
    allergies:         string[];
  }> = {};

  if ("bloodType"         in body) data.bloodType         = body.bloodType ?? null;
  if ("fitnessLevel"      in body) data.fitnessLevel      = body.fitnessLevel;
  if ("mobilityLimited"   in body) data.mobilityLimited   = body.mobilityLimited;
  if ("chronicConditions" in body) data.chronicConditions = body.chronicConditions;
  if ("allergies"         in body) data.allergies         = body.allergies;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "No fields provided." }, { status: 400 });
  }

  try {
    // Use upsert so PATCH works even if the health record hasn't been created yet
    await prisma.userHealth.upsert({
      where:  { userId: session.user.id },
      create: {
        userId:            session.user.id,
        bloodType:         data.bloodType         ?? null,
        fitnessLevel:      data.fitnessLevel      ?? "MODERATE",
        mobilityLimited:   data.mobilityLimited   ?? false,
        chronicConditions: data.chronicConditions ?? [],
        allergies:         data.allergies         ?? [],
      },
      update: data,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[health/patch]", err);
    return NextResponse.json({ message: "Failed to update health info." }, { status: 500 });
  }
}

// ── GET — fetch current health data (for dashboard drawer) ───────────────────

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json(null, { status: 401 });
  }

  const health = await prisma.userHealth.findUnique({
    where:  { userId: session.user.id },
    select: {
      bloodType:         true,
      fitnessLevel:      true,
      mobilityLimited:   true,
      chronicConditions: true,
      allergies:         true,
    },
  });

  return NextResponse.json(health ?? null);
}
