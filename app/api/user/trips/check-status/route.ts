export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { emailTransporter } from "@/lib/auth";
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
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  for (const trip of activeTrips) {
    // ── Start notification ──
    if (!trip.startNotifiedAt) {
      const startDiff = (now.getTime() - new Date(trip.startDate).getTime());
      // Notify on start day + 1 day window
      if (startDiff >= 0 && startDiff < 48 * 60 * 60 * 1000) {
        const title = `🎒 Time to start "${trip.title}"?`;
        const body = `Your trip starts today! Did you begin your journey?`;

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

        // Send email
        if (emailTransporter && user?.email) {
          emailTransporter.sendMail({
            to: user.email,
            subject: `Your trip "${trip.title}" starts today!`,
            html: `<div style="font-family:sans-serif;padding:24px">
              <h2>🎒 Time to start "${trip.title}"?</h2>
              <p>Your trip starts today! Did you begin your journey?</p>
              <p style="margin-top:16px;color:#666">— YatraAI</p>
            </div>`,
          }).catch(() => {});
        }

        created.push({ tripId: trip.id, type: "TRIP_START", title });
      }
    }

    // ── End notification ──
    if (!trip.endNotifiedAt) {
      const endDiff = (now.getTime() - new Date(trip.endDate).getTime());
      if (endDiff >= 0 && endDiff < 48 * 60 * 60 * 1000) {
        const title = `✅ Did "${trip.title}" end?`;
        const body = `Your trip should be over now. Did you finish, or do you need to extend?`;

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

        if (emailTransporter && user?.email) {
          emailTransporter.sendMail({
            to: user.email,
            subject: `Did "${trip.title}" end?`,
            html: `<div style="font-family:sans-serif;padding:24px">
              <h2>✅ Did "${trip.title}" end?</h2>
              <p>Your trip should be over now. Log your completion or extend your journey.</p>
              <p style="margin-top:16px;color:#666">— YatraAI</p>
            </div>`,
          }).catch(() => {});
        }

        created.push({ tripId: trip.id, type: "TRIP_END", title });
      }
    }
  }

  return NextResponse.json({ created });
}

export const POST = withRateLimit(postHandler, { max: 10, windowSeconds: 60 });
