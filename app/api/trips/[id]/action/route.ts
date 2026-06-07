export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const trip = await prisma.travelPlan.findUnique({
    where: { id },
    select: { id: true, leaderId: true, startDate: true, endDate: true },
  });

  if (!trip) {
    return NextResponse.json({ message: "Trip not found" }, { status: 404 });
  }
  if (trip.leaderId !== session.user.id) {
    return NextResponse.json({ message: "Only the trip leader can perform this action" }, { status: 403 });
  }

  const body = await req.json();
  const { action, newDate } = body;

  switch (action) {
    case "start":
      await prisma.travelPlan.update({
        where: { id },
        data: { startNotifiedAt: new Date() },
      });
      return NextResponse.json({ status: "started" });

    case "end":
      await prisma.travelPlan.update({
        where: { id },
        data: { status: "COMPLETED", endNotifiedAt: new Date() },
      });
      return NextResponse.json({ status: "completed" });

    case "extend":
      if (!newDate) {
        return NextResponse.json({ message: "newDate is required for extend" }, { status: 400 });
      }
      await prisma.travelPlan.update({
        where: { id },
        data: { endDate: new Date(newDate), endNotifiedAt: null },
      });
      return NextResponse.json({ status: "extended", endDate: newDate });

    case "change-date":
      if (!newDate) {
        return NextResponse.json({ message: "newDate is required for change-date" }, { status: 400 });
      }
      const startDate = new Date(newDate);
      // Set endDate to same day if original was same, otherwise keep original
      const originalEnd = new Date(trip.endDate);
      const originalStart = new Date(trip.startDate);
      const diff = originalEnd.getTime() - originalStart.getTime();
      const newEnd = new Date(startDate.getTime() + diff);

      await prisma.travelPlan.update({
        where: { id },
        data: {
          startDate,
          endDate: newEnd,
          startNotifiedAt: null,
        },
      });
      return NextResponse.json({ status: "date-changed", startDate: newDate, endDate: newEnd.toISOString() });

    default:
      return NextResponse.json({ message: `Unknown action: ${action}` }, { status: 400 });
  }
}

export const PATCH = withRateLimit(patchHandler, { max: 20, windowSeconds: 60 });
