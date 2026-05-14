/**
 * FILE: route.ts
 * LOCATION: /app/api/trips/route.ts
 *
 * GET  /api/trips  — list all plans the user is leader of or member of
 * POST /api/trips  — create a new multi-stop trip plan
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse }   from "next/server";
import { auth }                        from "@/lib/auth";
import { headers }                     from "next/headers";
import { PrismaClient, Prisma }        from "@/app/generated/prisma/client";
import { PrismaPg }                    from "@prisma/adapter-pg";
import { Pool }                        from "pg";

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── GET — list plans ──────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Plans where user is leader
  const led = await prisma.travelPlan.findMany({
    where:   { leaderId: userId },
    include: planInclude(),
    orderBy: { createdAt: "desc" },
  });

  // Plans where user is an accepted member (not leader)
  const joined = await prisma.travelPlan.findMany({
    where: {
      leaderId: { not: userId },
      members:  { some: { userId, status: "ACCEPTED" } },
    },
    include: planInclude(),
    orderBy: { createdAt: "desc" },
  });

  // Plans where user has a pending invitation
  const pending = await prisma.travelPlan.findMany({
    where: {
      members: { some: { userId, status: "PENDING" } },
    },
    include: planInclude(),
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ led, joined, pending });
}

// ── POST — create plan ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    title:     string;
    tripType:  "SOLO" | "GROUP";
    startDate: string;
    endDate:   string;
    budgetNPR: number | null;
    stops: {
      locationId:    string;
      stopOrder:     number;
      arrivalDate:   string;
      departureDate: string;
    }[];
    memberUsernames: string[]; // usernames to invite (group only)
    status?: "PENDING" | "ANALYZED" | "APPROVED" | "COMPLETED" | "CANCELLED";
    groupRiskResult?: unknown;
    stopRiskSnapshot?: unknown;
  };

  const { title, tripType, startDate, endDate, budgetNPR, stops, memberUsernames = [], status, groupRiskResult, stopRiskSnapshot } = body;

  if (!title?.trim())    return NextResponse.json({ message: "Title is required." },             { status: 400 });
  if (!startDate)        return NextResponse.json({ message: "Start date is required." },        { status: 400 });
  if (!endDate)          return NextResponse.json({ message: "End date is required." },          { status: 400 });
  if (!stops?.length)    return NextResponse.json({ message: "At least one stop is required." }, { status: 400 });

  // Resolve member usernames to user IDs
  const invitedUsers = memberUsernames.length > 0
    ? await prisma.user.findMany({
        where:  { username: { in: memberUsernames } },
        select: { id: true, username: true, name: true },
      })
    : [];

  // Create plan + stops + members in one transaction
  const plan = await prisma.travelPlan.create({
    data: {
      title:     title.trim(),
      leaderId:  session.user.id,
      tripType:  tripType as "SOLO" | "GROUP",
      status:    status ?? "PENDING",
      startDate: new Date(startDate),
      endDate:   new Date(endDate),
      budgetNPR,
      groupRiskResult: groupRiskResult as Prisma.InputJsonValue | undefined,
      stops: {
        create: stops.map((s) => ({
          locationId:    s.locationId,
          stopOrder:     s.stopOrder,
          arrivalDate:   new Date(s.arrivalDate),
          departureDate: new Date(s.departureDate),
          riskSnapshot:  stopRiskSnapshot as Prisma.InputJsonValue | undefined,
        })),
      },
      members: {
        create: invitedUsers.map((u) => ({
          userId: u.id,
          status: "PENDING" as const,
        })),
      },
    },
    include: planInclude(),
  });

  // Send notifications to invited members
  if (invitedUsers.length > 0) {
    const leader = await prisma.user.findUnique({
      where: { id: session.user.id }, select: { name: true },
    });

    await prisma.notification.createMany({
      data: invitedUsers.map((u) => ({
        userId:  u.id,
        message: JSON.stringify({
          _type:    "TRIP_INVITE",
          planId:   plan.id,
          planTitle: title.trim(),
          fromName: leader?.name ?? "Someone",
          fromId:   session.user.id,
          stops:    stops.length,
        }),
      })),
    });
  }

  return NextResponse.json(plan, { status: 201 });
}

// ── Shared include ────────────────────────────────────────────────────────────

function planInclude() {
  return {
    leader: { select: { id: true, name: true, username: true, image: true } },
    stops: {
      orderBy: { stopOrder: "asc" as const },
      include: {
        location: {
          include: { district: { include: { province: true } } },
        },
      },
    },
    members: {
      include: {
        user: { select: { id: true, name: true, username: true, image: true } },
      },
    },
  };
}
