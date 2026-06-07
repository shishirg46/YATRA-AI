/**
 * FILE: route.ts
 * LOCATION: /app/api/friends/search/route.ts
 * PURPOSE: Searches users by username or searches friends by name
 *          Returns relationship status for each result so the UI can
 *          show the right button (Add / Sent / Respond / Friends)
 * CALLED BY: FriendsSidebar "Find" tab — debounced 400ms after keystroke
 *            Plan page MemberSearch — with ?scope=friends
 * QUERY: ?q=searchterm  or  ?scope=friends&q=name
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function searchFriendsHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  const q     = req.nextUrl.searchParams.get("q")?.trim();
  const scope = req.nextUrl.searchParams.get("scope");
  const userId = session.user.id;

  // ── scope=friends: search accepted friends by name ──────────────────────
  if (scope === "friends") {
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { receiverId: userId }],
        status: "ACCEPTED",
      },
      select: { requesterId: true, receiverId: true },
    });

    const friendIds = friendships.map((f) =>
      f.requesterId === userId ? f.receiverId : f.requesterId
    );

    if (friendIds.length === 0) return NextResponse.json([]);

    const where: Record<string, unknown> = {
      id: { in: friendIds },
      username: { not: null },
    };

    if (q && q.length >= 2) {
      where.name = { contains: q, mode: "insensitive" };
    }

    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, image: true, username: true },
      take: 20,
    });

    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.image,
        username: u.username ?? null,
        status: "ACCEPTED",
      }))
    );
  }

  // ── Default: search all users by username ───────────────────────────────
  if (!q || q.length < 2) return NextResponse.json([]);

  const users = await prisma.user.findMany({
    where: {
      username: { contains: q.replace(/^@/, ""), mode: "insensitive" },
      id:       { not: userId },
    },
    select: { id: true, name: true, email: true, image: true, username: true },
    take:   20,
  });

  if (users.length === 0) return NextResponse.json([]);

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

  const friendMap = new Map(
    friendships.map((f) => {
      const otherId = f.requesterId === userId ? f.receiverId : f.requesterId;
      return [otherId, f];
    })
  );

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

export const GET = withRateLimit(searchFriendsHandler, { max: 30, windowSeconds: 60 });
