export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

// PATCH /api/friends/[id] — accept or decline a friend request
async function patchFriendHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { id }     = await params;
    const { action } = await req.json(); // "accept" | "decline"

    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship) return NextResponse.json({ message: "Request not found." }, { status: 404 });

    // Only the receiver can accept/decline
    if (friendship.receiverId !== session.user.id) {
      return NextResponse.json({ message: "Not authorized." }, { status: 403 });
    }

    if (action === "accept") {
      await prisma.friendship.update({
        where: { id },
        data:  { status: "ACCEPTED" },
      });

      // Notify the requester
      await prisma.notification.create({
        data: {
          userId:  friendship.requesterId,
          message: JSON.stringify({
            _type:    "FRIEND_ACCEPTED",
            fromId:   session.user.id,
            fromName: session.user.name,
          }),
        },
      });

      return NextResponse.json({ success: true, message: "Friend request accepted." });
    }

    if (action === "decline") {
      await prisma.friendship.update({
        where: { id },
        data:  { status: "DECLINED" },
      });
      return NextResponse.json({ success: true, message: "Request declined." });
    }

    return NextResponse.json({ message: "Invalid action." }, { status: 400 });
  } catch (err) {
    console.error("[friends/[id]]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

// DELETE /api/friends/[id] — remove a friend
async function deleteFriendHandler(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship) return NextResponse.json({ message: "Not found." }, { status: 404 });

    if (friendship.requesterId !== session.user.id && friendship.receiverId !== session.user.id) {
      return NextResponse.json({ message: "Not authorized." }, { status: 403 });
    }

    await prisma.friendship.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[friends/[id] DELETE]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export const PATCH = withRateLimit(patchFriendHandler, { max: 10, windowSeconds: 60 });
export const DELETE = withRateLimit(deleteFriendHandler, { max: 10, windowSeconds: 60 });
