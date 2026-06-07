export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [completedTrips, wishlist] = await Promise.all([
    prisma.travelPlan.findMany({
      where: {
        status: "COMPLETED",
        OR: [
          { leaderId: userId },
          { members: { some: { userId, status: "ACCEPTED" } } },
        ],
      },
      orderBy: { endDate: "desc" },
      include: {
        stops: { orderBy: { stopOrder: "asc" }, take: 3 },
        _count: { select: { members: true, stops: true } },
      },
    }),
    prisma.savedDestination.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        destination: {
          select: {
            id: true, name: true, district: true, province: true,
            category: true, image: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({ completedTrips, wishlist });
}

export const GET = withRateLimit(getHandler, { max: 30, windowSeconds: 60 });
