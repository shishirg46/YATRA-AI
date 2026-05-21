/**
 * FILE: route.ts
 * LOCATION: /app/api/destinations/summary/route.ts
 * PURPOSE: Returns destination ingestion and verification summary for the dashboard.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const [total, verified, routeAccessible, unverifiedCount, categoryCounts, topDestinations, topUnverified] = await Promise.all([
      prisma.destination.count(),
      prisma.destination.count({ where: { verified: true } }),
      prisma.destination.count({ where: { routeAccessible: true } }),
      prisma.destination.count({ where: { verified: false } }),
      prisma.destination.groupBy({
        by: ["category"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),
      prisma.destination.findMany({
        where: { verified: true },
        orderBy: { dataQualityScore: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          district: true,
          province: true,
          latitude: true,
          longitude: true,
          altitude: true,
          category: true,
          dataQualityScore: true,
          verified: true,
          routeAccessible: true,
        },
      }),
      prisma.destination.findMany({
        where: { verified: false },
        orderBy: { sourceLastFetch: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          district: true,
          province: true,
          latitude: true,
          longitude: true,
          altitude: true,
          category: true,
          dataQualityScore: true,
          verified: true,
          routeAccessible: true,
        },
      }),
    ]);

    const topCategories = categoryCounts.map((item) => `${item.category} (${item._count.id})`);

    return NextResponse.json({
      total,
      verified,
      routeAccessible,
      unverifiedCount,
      topCategories,
      topDestinations,
      topUnverified,
    });
  } catch (err) {
    console.error("[destinations/summary]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
