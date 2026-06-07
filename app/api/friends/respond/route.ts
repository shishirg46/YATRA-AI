/**
 * FILE: route.ts
 * LOCATION: /app/api/friends/respond/route.ts
 * PURPOSE: Accepts or declines an incoming friend request
 * BODY: { friendshipId: string, action: "accept" | "decline" }
 * CALLED BY: FriendsSidebar "Requests" tab — Accept / Decline buttons
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function respondFriendRequestHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { friendshipId, action } = await req.json() as { friendshipId: string; action: "accept" | "decline" };
  if (!friendshipId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const userId = session.user.id;

  // Verify the current user is the RECEIVER of this request
  const friendship = await prisma.friendship.findFirst({
    where: { id: friendshipId, receiverId: userId, status: "PENDING" },
  });

  if (!friendship) {
    return NextResponse.json({ message: "Request not found." }, { status: 404 });
  }

  if (action === "accept") {
    await prisma.friendship.update({
      where: { id: friendshipId },
      data:  { status: "ACCEPTED" },
    });
    // Notify the requester that their request was accepted
    await prisma.notification.create({
      data: {
        userId:  friendship.requesterId,
        message: JSON.stringify({
          _type:    "FRIEND_ACCEPTED",
          byId:     userId,
          byName:   session.user.name,
          message:  `${session.user.name} accepted your friend request`,
        }),
        isRead: false,
      },
    });
  } else {
    // Decline → delete the friendship row entirely
    await prisma.friendship.delete({ where: { id: friendshipId } });
  }

  return NextResponse.json({ success: true });
}

export const POST = withRateLimit(respondFriendRequestHandler, { max: 10, windowSeconds: 60 });
