/**
 * FILE: route.ts
 * LOCATION: /app/api/trips/[id]/respond/route.ts
 * POST /api/trips/[id]/respond
 * Body: { action: "accept" | "decline" }
 * Member accepts or declines a trip invitation
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { prisma }                    from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function respondTripHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { action } = await req.json() as { action: "accept" | "decline" };
  if (action !== "accept" && action !== "decline")
    return NextResponse.json({ message: "action must be accept or decline" }, { status: 400 });

  const membership = await prisma.travelPlanMember.findUnique({
    where:   { planId_userId: { planId: id, userId: session.user.id } },
    include: { plan: { select: { title: true, leaderId: true } } },
  });

  if (!membership) return NextResponse.json({ message: "Invitation not found." }, { status: 404 });
  if (membership.status !== "PENDING") return NextResponse.json({ message: "Invitation already responded." }, { status: 409 });

  const updated = await prisma.travelPlanMember.update({
    where: { planId_userId: { planId: id, userId: session.user.id } },
    data:  { status: action === "accept" ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
  });

  // Notify the leader of the response
  await prisma.notification.create({
    data: {
      userId:  membership.plan.leaderId,
      message: JSON.stringify({
        _type:     "TRIP_RESPONSE",
        planId:    id,
        planTitle: membership.plan.title,
        fromName:  session.user.name ?? "A member",
        fromId:    session.user.id,
        action,
      }),
    },
  });

  return NextResponse.json(updated);
}

export const POST = withRateLimit(respondTripHandler, { max: 10, windowSeconds: 60 });
