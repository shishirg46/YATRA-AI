/**
 * FILE: route.ts
 * LOCATION: /app/api/admin/stats/route.ts
 * PURPOSE: Fetch admin dashboard statistics
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

    // Fetch all stats in parallel
    const [
      totalDestinations,
      verifiedDestinations,
      unverifiedDestinations,
      routeAccessibleDestinations,
      totalUsers,
      activeUsers,
      totalHazards,
      qualityScores,
      latestDestinations,
      latestHazards,
      recentActivities,
    ] = await Promise.all([
      prisma.destination.count(),
      prisma.destination.count({ where: { verified: true } }),
      prisma.destination.count({ where: { verified: false } }),
      prisma.destination.count({ where: { routeAccessible: true } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { isActive: true, deletedAt: null } }),
      prisma.hazardData.count(),
      prisma.destination.findMany({
        select: { dataQualityScore: true },
        where: { dataQualityScore: { not: null } },
      }),
      prisma.destination.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
      prisma.hazardData.findMany({
        take: 5,
        orderBy: { recordedAt: "desc" },
        include: {
          location: {
            include: {
              district: {
                include: {
                  province: true,
                },
              },
            },
          },
        },
      }),
      prisma.auditLog.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const avgQuality =
      qualityScores.length > 0
        ? qualityScores.reduce((sum, d) => sum + (d.dataQualityScore ?? 0), 0) / qualityScores.length
        : 0;

    return NextResponse.json({
      totalDestinations,
      verifiedDestinations,
      unverifiedDestinations,
      routeAccessibleDestinations,
      totalUsers,
      activeUsers,
      totalHazards,
      averageDataQualityScore: avgQuality,
      latestDestinations,
      latestHazards,
      recentActivities,
    });
  } catch (err) {
    console.error("[admin/stats]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
