export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

const CAN_SEE: Record<string, string[]> = {
  everyone: ["everyone", "friends_only", "nobody"],
  friends_only: ["friends_only", "nobody"],
  nobody: ["nobody"],
};

function isVisible(setting: string, viewerIsFriend: boolean): boolean {
  if (setting === "everyone") return true;
  if (setting === "friends_only") return viewerIsFriend;
  return false;
}

function fieldOrDefault(privacy: any, fieldName: string): string {
  return privacy?.[fieldName] ?? "everyone";
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

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, username: true, image: true,
      homeLocationId: true, homeLocation: {
        select: { name: true, district: { select: { name: true, province: { select: { name: true } } } } },
      },
      privacy: true,
      _count: { select: { tripPhotos: true, travelPlans: true } },
    },
  });

  if (!targetUser) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  const friendship = viewerId !== id
    ? await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: viewerId, receiverId: id, status: "ACCEPTED" },
            { requesterId: id, receiverId: viewerId, status: "ACCEPTED" },
          ],
        },
      })
    : null;
  const isFriend = !!friendship;
  const isOwn = viewerId === id;

  const privacy = targetUser.privacy;
  const result: Record<string, any> = { id: targetUser.id, isOwn, isFriend };

  if (isVisible(fieldOrDefault(privacy, "whoCanSeeName"), isFriend) || isOwn) {
    result.name = targetUser.name;
  }
  if (isVisible(fieldOrDefault(privacy, "whoCanSeeUsername"), isFriend) || isOwn) {
    result.username = targetUser.username;
  }
  if (isVisible(fieldOrDefault(privacy, "whoCanSeeLocation"), isFriend) || isOwn) {
    result.homeLocation = targetUser.homeLocation;
  }
  result.image = targetUser.image;
  result.stats = targetUser._count;

  return NextResponse.json(result);
}

export const GET = withRateLimit(getHandler, { max: 60, windowSeconds: 60 });
