/**
 * FILE: route.ts
 * LOCATION: /app/api/trips/[id]/invite/route.ts
 * POST /api/trips/[id]/invite
 * Body: { username: string }
 * Leader invites a traveller by username → sends notification
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { PrismaClient }              from "@/app/generated/prisma/client";
import { PrismaPg }                  from "@prisma/adapter-pg";
import { Pool }                      from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { username } = await req.json() as { username: string };
  if (!username?.trim()) return NextResponse.json({ message: "Username is required." }, { status: 400 });

  const plan = await prisma.travelPlan.findUnique({
    where:   { id },
    include: { stops: { take: 1 } },
  });
  if (!plan)                             return NextResponse.json({ message: "Plan not found." },                    { status: 404 });
  if (plan.leaderId !== session.user.id) return NextResponse.json({ message: "Only the leader can invite members." }, { status: 403 });

  // Find user by username
  const invitee = await prisma.user.findFirst({
    where:  { username: username.trim().replace(/^@/, "") },
    select: { id: true, name: true, username: true },
  });
  if (!invitee) return NextResponse.json({ message: `User @${username} not found.` }, { status: 404 });
  if (invitee.id === session.user.id) return NextResponse.json({ message: "You cannot invite yourself." }, { status: 400 });

  // Check if already a member
  const existing = await prisma.travelPlanMember.findUnique({
    where: { planId_userId: { planId: id, userId: invitee.id } },
  });
  if (existing) return NextResponse.json({ message: `@${username} has already been invited.` }, { status: 409 });

  // Create member record + notification in parallel
  const [member] = await Promise.all([
    prisma.travelPlanMember.create({
      data:    { planId: id, userId: invitee.id, status: "PENDING" },
      include: { user: { select: { id: true, name: true, username: true, image: true } } },
    }),
    prisma.notification.create({
      data: {
        userId:  invitee.id,
        message: JSON.stringify({
          _type:     "TRIP_INVITE",
          planId:    id,
          planTitle: plan.title,
          fromName:  session.user.name ?? "Someone",
          fromId:    session.user.id,
          stops:     plan.stops.length,
        }),
      },
    }),
  ]);

  return NextResponse.json(member, { status: 201 });
}
