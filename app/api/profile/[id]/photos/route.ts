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
    const setting = targetUser.privacy?.whoCanSeePhotos ?? "everyone";

    if (!isVisible(setting, isFriend)) {
      return NextResponse.json({ photos: [], total: 0 });
    }
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20")));

  const [photos, total] = await Promise.all([
    prisma.tripPhoto.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tripPhoto.count({ where: { userId: id } }),
  ]);

  return NextResponse.json({ photos, total, page, limit });
}

export const GET = withRateLimit(getHandler, { max: 60, windowSeconds: 60 });
