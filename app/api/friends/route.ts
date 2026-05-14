/**
 * FILE: route.ts
 * LOCATION: /app/api/friends/route.ts
 * PURPOSE: Returns the current user's friends list
 *          Includes accepted friends, sent-pending, and received-pending
 * CALLED BY: FriendsSidebar on open
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  const userId = session.user.id;

  // Fetch all friendship rows where user is either the requester or receiver
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: userId },
        { receiverId:  userId },
      ],
      status: { in: ["ACCEPTED", "PENDING"] },
    },
    include: {
      requester: { select: { id: true, name: true, email: true, image: true, username: true } },
      receiver:  { select: { id: true, name: true, email: true, image: true, username: true } },
    },
  });

  // Shape results from the perspective of the current user
  const friends = friendships.map((f) => {
    const isSender = f.requesterId === userId;
    const other    = isSender ? f.receiver : f.requester;

    let status: "ACCEPTED" | "PENDING_SENT" | "PENDING_RECEIVED";
    if (f.status === "ACCEPTED") {
      status = "ACCEPTED";
    } else if (isSender) {
      status = "PENDING_SENT";      // current user sent the request
    } else {
      status = "PENDING_RECEIVED";  // current user received the request
    }

    return {
      id:           other.id,
      name:         other.name,
      email:        other.email,
      image:        other.image,
      username:     other.username ?? null,
      status,
      friendshipId: f.id,
    };
  });

  return NextResponse.json(friends);
}
