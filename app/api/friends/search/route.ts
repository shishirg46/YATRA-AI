/**
 * FILE: route.ts
 * LOCATION: /app/api/friends/search/route.ts
 * PURPOSE: Searches users by username (case-insensitive partial match)
 *          Returns relationship status for each result so the UI can
 *          show the right button (Add / Sent / Respond / Friends)
 * CALLED BY: FriendsSidebar "Find" tab — debounced 400ms after keystroke
 * QUERY: ?q=searchterm
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  const userId = session.user.id;

  // Search by username, exclude self, limit to 20 results
  const users = await prisma.user.findMany({
    where: {
      username: { contains: q.replace(/^@/, ""), mode: "insensitive" },
      id:       { not: userId },
    },
    select: { id: true, name: true, email: true, image: true, username: true },
    take:   20,
  });

  if (users.length === 0) return NextResponse.json([]);

  // Fetch any existing friendships between current user and the results
  const userIds = users.map((u) => u.id);
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: userId, receiverId:  { in: userIds } },
        { receiverId:  userId, requesterId: { in: userIds } },
      ],
    },
    select: { id: true, requesterId: true, receiverId: true, status: true },
  });

  // Build a map: otherUserId → friendship
  const friendMap = new Map(
    friendships.map((f) => {
      const otherId = f.requesterId === userId ? f.receiverId : f.requesterId;
      return [otherId, f];
    })
  );

  // Annotate each user with their relationship status
  const results = users.map((u) => {
    const friendship = friendMap.get(u.id);
    let status: "NONE" | "ACCEPTED" | "PENDING_SENT" | "PENDING_RECEIVED" = "NONE";

    if (friendship) {
      if (friendship.status === "ACCEPTED") {
        status = "ACCEPTED";
      } else if (friendship.requesterId === userId) {
        status = "PENDING_SENT";
      } else {
        status = "PENDING_RECEIVED";
      }
    }

    return { id: u.id, name: u.name, email: u.email, image: u.image, username: u.username ?? null, status };
  });

  return NextResponse.json(results);
}
