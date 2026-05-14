/**
 * FILE: route.ts
 * LOCATION: /app/api/friends/request/route.ts
 * PURPOSE: Sends a friend request from the current user to another user
 * BODY: { toUserId: string }
 * CALLED BY: FriendsSidebar "Find" tab — Add button
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { toUserId } = await req.json();
  if (!toUserId) return NextResponse.json({ message: "toUserId is required." }, { status: 400 });

  const userId = session.user.id;
  if (toUserId === userId) return NextResponse.json({ message: "Cannot add yourself." }, { status: 400 });

  // Check if friendship already exists in either direction
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId,   receiverId: toUserId },
        { requesterId: toUserId, receiverId: userId },
      ],
    },
  });

  if (existing) {
    return NextResponse.json({ message: "Friendship already exists." }, { status: 409 });
  }

  // Create PENDING friendship
  const friendship = await prisma.friendship.create({
    data: {
      requesterId: userId,
      receiverId:  toUserId,
      status:      "PENDING",
    },
  });

  // Notify the receiver
  await prisma.notification.create({
    data: {
      userId:  toUserId,
      message: JSON.stringify({
        _type:    "FRIEND_REQUEST",
        fromId:   userId,
        fromName: session.user.name,
        message:  `${session.user.name} sent you a friend request`,
      }),
      isRead: false,
    },
  });

  return NextResponse.json({ friendshipId: friendship.id });
}
