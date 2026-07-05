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
import { Prisma }                      from "@/app/generated/prisma/client";
import { prisma }                      from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

// ── GET — list plans ──────────────────────────────────────────────────────────

async function getTripsHandler() {
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

async function createTripHandler(req: NextRequest) {
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

  // Collect destination IDs for popularity tracking
  const originalDestinationIds: string[] = [];

  // Resolve stop location IDs — they may be Destination IDs, not Location IDs
  const resolvedStops = await Promise.all(
    stops.map(async (s) => {
      const loc = await prisma.location.findUnique({ where: { id: s.locationId } });
      if (loc) return { ...s, locationId: loc.id };

      const dest = await prisma.destination.findUnique({ where: { id: s.locationId } });
      if (dest) {
        originalDestinationIds.push(dest.id);
        const name = `Stop: ${dest.name}`;
        let newLoc = await prisma.location.findFirst({
          where: { latitude: dest.latitude, longitude: dest.longitude },
        });
        if (!newLoc) {
          const district = await prisma.district.findFirst({
            where: { name: { equals: dest.district, mode: "insensitive" } },
          });
          newLoc = await prisma.location.create({
            data: {
              name,
              latitude:  dest.latitude,
              longitude: dest.longitude,
              altitude:  dest.altitude ?? null,
              districtId: district?.id ?? (await prisma.district.findFirst())!.id,
            },
          });
        }
        return { ...s, locationId: newLoc.id };
      }

      throw new Error(`Stop location not found: ${s.locationId}`);
    })
  );

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
        create: resolvedStops.map((s) => ({
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

  // Track popularity for each destination used as a trip stop
  if (originalDestinationIds.length > 0) {
    await prisma.destination.updateMany({
      where: { id: { in: originalDestinationIds } },
      data: { popularityScore: { increment: 0.5 } },
    }).catch(() => {});
  }

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

export const GET = withRateLimit(getTripsHandler, { max: 20, windowSeconds: 60 });
export const POST = withRateLimit(createTripHandler, { max: 10, windowSeconds: 60 });
