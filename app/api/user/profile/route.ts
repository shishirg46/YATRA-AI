export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    name?:              string;
    username?:          string;
    province?:          string;
    district?:          string;
    interests?:         string[];
    travelStyle?:       string[];
    riskTolerance?:     string;
    maxDistanceKm?:     number;
    typicalDurationDays?: number;
  };

  const userId = session.user.id;

  try {
    // ── 1. Direct user-table fields ───────────────────────────────────────────
    const userUpdate: Record<string, unknown> = {};

    if (body.name?.trim()) {
      userUpdate.name = body.name.trim();
    }

    if (body.username?.trim()) {
      const clean = body.username.trim().toLowerCase().replace(/^@/, "");

      const existing = await prisma.user.findFirst({
        where: { username: clean, id: { not: userId } },
        select: { id: true },
      });
      if (existing) {
        return NextResponse.json({ message: "Username is already taken." }, { status: 409 });
      }

      userUpdate.username        = clean;
      userUpdate.displayUsername = body.username.trim().replace(/^@/, "");
    }

    // ── 2. Home location ──────────────────────────────────────────────────────
    if (body.province?.trim() && body.district?.trim()) {
      const province = await prisma.province.upsert({
        where:  { name: body.province },
        create: { name: body.province },
        update: {},
      });
      const district = await prisma.district.upsert({
        where:  { name_provinceId: { name: body.district, provinceId: province.id } },
        create: { name: body.district, provinceId: province.id },
        update: {},
      });
      const location = await prisma.location.upsert({
        where:  { name_districtId: { name: body.district, districtId: district.id } },
        create: { name: body.district, districtId: district.id, latitude: 0, longitude: 0 },
        update: {},
      });
      userUpdate.homeLocationId = location.id;
    }

    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: userUpdate });
    }

    // ── 3. UserPreference (Interests, Travel Style, Risk Tolerance) ─────────
    if (body.interests || body.travelStyle || body.riskTolerance || body.maxDistanceKm !== undefined || body.typicalDurationDays !== undefined) {
      await prisma.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          interests: body.interests ?? [],
          travelStyle: body.travelStyle ?? [],
          riskTolerance: body.riskTolerance ?? "MEDIUM",
          maxDistanceKm: body.maxDistanceKm,
          typicalDurationDays: body.typicalDurationDays,
        },
        update: {
          ...(body.interests && { interests: body.interests }),
          ...(body.travelStyle && { travelStyle: body.travelStyle }),
          ...(body.riskTolerance && { riskTolerance: body.riskTolerance }),
          ...(body.maxDistanceKm !== undefined && { maxDistanceKm: body.maxDistanceKm }),
          ...(body.typicalDurationDays !== undefined && { typicalDurationDays: body.typicalDurationDays }),
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[profile/patch]", err);
    return NextResponse.json({ message: "Failed to update profile." }, { status: 500 });
  }
}
