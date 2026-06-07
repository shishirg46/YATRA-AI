export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getMyReportsHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const reports = await prisma.communityHazardReport.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
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
      },
    });

    return NextResponse.json(reports);
  } catch (err) {
    console.error("[hazards/reports/mine]", err);
    return NextResponse.json({ message: "Failed to fetch reports." }, { status: 500 });
  }
}

export const GET = withRateLimit(getMyReportsHandler, { max: 30, windowSeconds: 60 });
