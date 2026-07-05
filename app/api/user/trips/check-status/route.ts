export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendTripEmail } from "@/lib/email";
import { withRateLimit } from "@/lib/rate-limit";

async function postHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const now = new Date();
  const created: { tripId: string; type: string; title: string }[] = [];

  const activeTrips = await prisma.travelPlan.findMany({
    where: {
      leaderId: userId,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: {
      id: true, title: true, startDate: true, endDate: true,
      startNotifiedAt: true, endNotifiedAt: true,
      reminded3dAt: true, reminded1dAt: true,
      _count: { select: { stops: true } },
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  for (const trip of activeTrips) {
    const startDiff = now.getTime() - new Date(trip.startDate).getTime();
    const endDiff   = now.getTime() - new Date(trip.endDate).getTime();
    const TWO_DAYS  = 2 * 24 * 60 * 60 * 1000;
    const FOUR_DAYS = 4 * 24 * 60 * 60 * 1000;

    // ── 3-day reminder ──
    if (!trip.reminded3dAt && startDiff > -FOUR_DAYS && startDiff <= -TWO_DAYS) {
      const title = `⏰ 3 days until "${trip.title}"`;
      const body  = `Your trip starts in 3 days. Start preparing!`;

      await prisma.notification.create({
        data: {
          userId,
          message: JSON.stringify({
            _type: "TRIP_REMINDER", planId: trip.id, tripTitle: trip.title,
            title, body, daysBefore: 3,
          }),
        },
      });

      await prisma.travelPlan.update({
        where: { id: trip.id },
        data: { reminded3dAt: now },
      });

      if (user) {
        sendTripEmail(user, {
          id: trip.id, title: trip.title,
          startDate: trip.startDate, endDate: trip.endDate,
          stops: trip._count.stops,
        }, "reminder-3d");
      }

      created.push({ tripId: trip.id, type: "TRIP_REMINDER", title });
    }

    // ── 1-day reminder ──
    if (!trip.reminded1dAt && startDiff > -TWO_DAYS && startDiff <= 0) {
      const title = `🚀 "${trip.title}" starts tomorrow!`;
      const body  = `Your trip starts tomorrow. Get ready!`;

      await prisma.notification.create({
        data: {
          userId,
          message: JSON.stringify({
            _type: "TRIP_REMINDER", planId: trip.id, tripTitle: trip.title,
            title, body, daysBefore: 1,
          }),
        },
      });

      await prisma.travelPlan.update({
        where: { id: trip.id },
        data: { reminded1dAt: now },
      });

      if (user) {
        sendTripEmail(user, {
          id: trip.id, title: trip.title,
          startDate: trip.startDate, endDate: trip.endDate,
          stops: trip._count.stops,
        }, "reminder-1d");
      }

      created.push({ tripId: trip.id, type: "TRIP_REMINDER", title });
    }

    // ── Start notification ──
    if (!trip.startNotifiedAt && startDiff >= 0 && startDiff < TWO_DAYS) {
      const title = `🎒 Time to start "${trip.title}"?`;
      const body  = `Your trip starts today! Did you begin your journey?`;

      await prisma.notification.create({
        data: {
          userId,
          message: JSON.stringify({
            _type: "TRIP_START", planId: trip.id, tripTitle: trip.title,
            title, body,
          }),
        },
      });

      await prisma.travelPlan.update({
        where: { id: trip.id },
        data: { startNotifiedAt: now },
      });

      if (user) {
        sendTripEmail(user, {
          id: trip.id, title: trip.title,
          startDate: trip.startDate, endDate: trip.endDate,
          stops: trip._count.stops,
        }, "trip-start");
      }

      created.push({ tripId: trip.id, type: "TRIP_START", title });
    }

    // ── End notification ──
    if (!trip.endNotifiedAt && endDiff >= 0 && endDiff < TWO_DAYS) {
      const title = `✅ Did "${trip.title}" end?`;
      const body  = `Your trip should be over now. Did you finish, or do you need to extend?`;

      await prisma.notification.create({
        data: {
          userId,
          message: JSON.stringify({
            _type: "TRIP_END", planId: trip.id, tripTitle: trip.title,
            title, body,
          }),
        },
      });

      await prisma.travelPlan.update({
        where: { id: trip.id },
        data: { endNotifiedAt: now },
      });

      if (user) {
        sendTripEmail(user, {
          id: trip.id, title: trip.title,
          startDate: trip.startDate, endDate: trip.endDate,
          stops: trip._count.stops,
        }, "trip-end");
      }

      created.push({ tripId: trip.id, type: "TRIP_END", title });
    }
  }

  return NextResponse.json({ created });
}

export const POST = withRateLimit(postHandler, { max: 10, windowSeconds: 60 });
