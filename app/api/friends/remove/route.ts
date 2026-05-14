/**
 * FILE: route.ts
 * LOCATION: /app/api/friends/remove/route.ts
 * PURPOSE: Removes an accepted friendship (unfriend)
 * BODY: { friendshipId: string }
 * CALLED BY: FriendsSidebar "Friends" tab — remove icon button
 * NOTE: Only allowed if the current user is the requester OR receiver
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

  const { friendshipId } = await req.json();
  if (!friendshipId) return NextResponse.json({ message: "friendshipId is required." }, { status: 400 });

  const userId = session.user.id;

  // Verify the current user is part of this friendship before deleting
  const friendship = await prisma.friendship.findFirst({
    where: {
      id: friendshipId,
      OR: [
        { requesterId: userId },
        { receiverId:  userId },
      ],
    },
  });

  if (!friendship) {
    return NextResponse.json({ message: "Friendship not found." }, { status: 404 });
  }

  await prisma.friendship.delete({ where: { id: friendshipId } });

  return NextResponse.json({ success: true });
}
