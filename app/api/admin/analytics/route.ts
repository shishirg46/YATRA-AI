export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyRole, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    await verifyRole(["ADMIN", "ANALYST"]);

    // 1. Destination stats
    const [
      totalDestinations,
      verifiedDestinations,
      unverifiedDestinations,
      destinationsByCategory,
    ] = await Promise.all([
      prisma.destination.count(),
      prisma.destination.count({ where: { verified: true } }),
      prisma.destination.count({ where: { verified: false } }),
      prisma.destination.groupBy({
        by: ["category"],
        _count: {
          category: true,
        },
      }),
    ]);

    // 2. Risk assessment stats
    const [
      riskLevels,
      avgScoreRaw,
    ] = await Promise.all([
      prisma.riskAssessment.groupBy({
        by: ["safetyLevel"],
        _count: {
          safetyLevel: true,
        },
      }),
      prisma.riskAssessment.aggregate({
        _avg: {
          safetyScore: true,
        },
      }),
    ]);

    // 3. User stats
    const [
      totalUsers,
      usersByRole,
      activeUsers,
      inactiveUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({
        by: ["role"],
        _count: {
          role: true,
        },
      }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
    ]);

    // 4. Audit Log velocity: last 14 days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const auditLogsLast14Days = await prisma.auditLog.findMany({
      where: {
        createdAt: {
          gte: fourteenDaysAgo,
        },
      },
      select: {
        createdAt: true,
      },
    });

    // Group logs by day
    const logTimeline: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      logTimeline[dateStr] = 0;
    }

    auditLogsLast14Days.forEach((log) => {
      const dateStr = log.createdAt.toISOString().split("T")[0];
      if (logTimeline[dateStr] !== undefined) {
        logTimeline[dateStr]++;
      }
    });

    const timeline = Object.keys(logTimeline).map((date) => ({
      date,
      count: logTimeline[date],
    }));

    return NextResponse.json({
      destinations: {
        total: totalDestinations,
        verified: verifiedDestinations,
        unverified: unverifiedDestinations,
        categories: destinationsByCategory.map((c) => ({
          category: c.category,
          count: c._count.category,
        })),
      },
      risk: {
        averageScore: avgScoreRaw._avg.safetyScore || 0,
        levels: riskLevels.map((r) => ({
          level: r.safetyLevel,
          count: r._count.safetyLevel,
        })),
      },
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: inactiveUsers,
        roles: usersByRole.map((u) => ({
          role: u.role,
          count: u._count.role,
        })),
      },
      audit: {
        timeline,
      },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
