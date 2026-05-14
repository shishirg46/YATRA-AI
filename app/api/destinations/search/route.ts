/**
 * FILE: route.ts
 * LOCATION: /app/api/destinations/search/route.ts
 * PURPOSE: Autocomplete search for destinations — used by Plan a Trip page
 * GET /api/destinations/search?q=kathmandu
 * Returns up to 10 matching locations with name, district, province, altitude
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

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  const locations = await prisma.location.findMany({
    where: {
      OR: [
        { name:     { contains: q, mode: "insensitive" } },
        { district: { name: { contains: q, mode: "insensitive" } } },
        { district: { province: { name: { contains: q, mode: "insensitive" } } } },
      ],
    },
    include: {
      district: { include: { province: true } },
    },
    take: 10,
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    locations.map((l) => ({
      id:       l.id,
      name:     l.name,
      district: l.district.name,
      province: l.district.province.name,
      altitude: l.altitude,
      latitude: l.latitude,
      longitude: l.longitude,
    }))
  );
}
