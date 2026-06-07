export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

function isVisible(setting: string, viewerIsFriend: boolean): boolean {
  if (setting === "everyone") return true;
  if (setting === "friends_only") return viewerIsFriend;
  return false;
}

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  const viewerId = session?.user?.id;

  if (!viewerId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const isOwn = viewerId === id;

  if (!isOwn) {
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { privacy: true },
    });

    if (!targetUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, receiverId: id, status: "ACCEPTED" },
          { requesterId: id, receiverId: viewerId, status: "ACCEPTED" },
        ],
      },
    });

    const isFriend = !!friendship;
    const setting = targetUser.privacy?.whoCanSeeTrips ?? "everyone";

    if (!isVisible(setting, isFriend)) {
      return NextResponse.json({ completedTrips: [], wishlist: [] });
    }
  }

  const [completedTrips, wishlist] = await Promise.all([
    prisma.travelPlan.findMany({
      where: {
        status: "COMPLETED",
        OR: [
          { leaderId: id },
          { members: { some: { userId: id, status: "ACCEPTED" } } },
        ],
      },
      orderBy: { endDate: "desc" },
      include: {
        stops: { orderBy: { stopOrder: "asc" }, take: 3 },
        leader: { select: { id: true, name: true, image: true } },
        _count: { select: { members: true, stops: true } },
      },
    }),
    prisma.savedDestination.findMany({
      where: { userId: id },
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

export const GET = withRateLimit(getHandler, { max: 60, windowSeconds: 60 });
