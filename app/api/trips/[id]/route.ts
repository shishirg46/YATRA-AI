/**
 * FILE: route.ts
 * LOCATION: /app/api/trips/[id]/route.ts
 * GET /api/trips/[id] — fetch a single trip with all stops, members, analysis
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import type { Prisma }               from "@/app/generated/prisma/client";
import { prisma }                    from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const plan = await prisma.travelPlan.findUnique({
    where: { id },
    include: {
      leader: { select: { id: true, name: true, username: true, image: true } },
      stops: {
        orderBy: { stopOrder: "asc" },
        include: {
          location: { include: { district: { include: { province: true } } } },
        },
      },
      members: {
        include: {
          user: { select: { id: true, name: true, username: true, image: true } },
        },
        orderBy: { invitedAt: "asc" },
      },
    },
  });

  if (!plan) return NextResponse.json({ message: "Plan not found." }, { status: 404 });

  // Check access — must be leader or member (any status)
  const isLeader = plan.leaderId === session.user.id;
  const isMember = plan.members.some((m) => m.userId === session.user.id);
  if (!isLeader && !isMember) return NextResponse.json({ message: "Access denied." }, { status: 403 });

  return NextResponse.json({
    ...plan,
    currentUserId:  session.user.id,
    isLeader,
    myMembership:   plan.members.find((m) => m.userId === session.user.id) ?? null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const existing = await prisma.travelPlan.findUnique({
    where: { id },
    include: { members: true, stops: true },
  });
  if (!existing) return NextResponse.json({ message: "Plan not found." }, { status: 404 });
  if (existing.leaderId !== session.user.id) {
    return NextResponse.json({ message: "Only plan leader can update this plan." }, { status: 403 });
  }

  const body = await req.json() as {
    title?: string;
    tripType?: "SOLO" | "GROUP";
    startDate?: string;
    endDate?: string;
    budgetNPR?: number | null;
    stops?: Array<{
      locationId: string;
      stopOrder: number;
      arrivalDate: string;
      departureDate: string;
    }>;
    status?: "PENDING" | "ANALYZED" | "APPROVED" | "COMPLETED" | "CANCELLED";
    groupRiskResult?: unknown;
    stopRiskSnapshot?: unknown;
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (Array.isArray(body.stops) && body.stops.length > 0) {
      await tx.travelStop.deleteMany({ where: { planId: id } });
      await tx.travelStop.createMany({
        data: body.stops.map((s) => ({
          planId: id,
          locationId: s.locationId,
          stopOrder: s.stopOrder,
          arrivalDate: new Date(s.arrivalDate),
          departureDate: new Date(s.departureDate),
          riskSnapshot: (body.stopRiskSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
    }

    return tx.travelPlan.update({
      where: { id },
      data: {
        title: body.title?.trim() || existing.title,
        tripType: body.tripType ?? existing.tripType,
        startDate: body.startDate ? new Date(body.startDate) : existing.startDate,
        endDate: body.endDate ? new Date(body.endDate) : existing.endDate,
        budgetNPR: body.budgetNPR ?? existing.budgetNPR,
        status: body.status ?? existing.status,
        groupRiskResult: (body.groupRiskResult ?? existing.groupRiskResult ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      include: {
        leader: { select: { id: true, name: true, username: true, image: true } },
        stops: {
          orderBy: { stopOrder: "asc" },
          include: { location: { include: { district: { include: { province: true } } } } },
        },
        members: {
          include: { user: { select: { id: true, name: true, username: true, image: true } } },
          orderBy: { invitedAt: "asc" },
        },
      },
    });
  });

  return NextResponse.json(updated);
}
