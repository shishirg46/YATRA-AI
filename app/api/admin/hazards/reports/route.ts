export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, handleAdminError } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getHazardReportsHandler(req: NextRequest) {
  try {
    await verifyAdmin();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const skip = (page - 1) * limit;
    const hazardType = searchParams.get("type") || "";

    const where: any = {};
    if (status) where.status = status;
    if (hazardType) where.hazardType = hazardType;

    const [reports, total] = await Promise.all([
      prisma.communityHazardReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          hazardType: true,
          severity: true,
          title: true,
          description: true,
          lat: true,
          lng: true,
          imageUrl: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          moderator: { select: { id: true, name: true } },
          moderatedAt: true,
        },
      }),
      prisma.communityHazardReport.count({ where }),
    ]);

    return NextResponse.json({
      reports,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

export const GET = withRateLimit(getHazardReportsHandler, { max: 60, windowSeconds: 60 });
