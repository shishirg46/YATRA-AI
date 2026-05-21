/**
 * FILE: route.ts
 * LOCATION: /app/api/admin/destinations/unverified/route.ts
 * PURPOSE: Fetch unverified destinations for the verification queue
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json({ message: "Admin access required" }, { status: 403 });
    }

    // Fetch unverified destinations
    const destinations = await prisma.destination.findMany({
      where: { verified: false },
      select: {
        id: true,
        name: true,
        district: true,
        province: true,
        category: true,
        latitude: true,
        longitude: true,
        dataQualityScore: true,
        source: true,
        createdAt: true,
      },
      orderBy: { dataQualityScore: "desc" },
    });

    return NextResponse.json({ destinations });
  } catch (err) {
    console.error("[admin/destinations/unverified]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
