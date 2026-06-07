export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { dispatchSosNotifications } from "@/lib/notifications/dispatch";

async function sosHandler(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Please sign in to send an SOS." }, { status: 401 });
    }

    let body: { tripId?: string; latitude?: number; longitude?: number; message?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
    }

    const alert = await prisma.emergencyAlert.create({
      data: {
        userId: session.user.id,
        tripId: body.tripId,
        latitude: body.latitude,
        longitude: body.longitude,
        message: body.message || "SOS! I need help.",
        status: "ACTIVE",
      },
    });

    const health = await prisma.userHealth.findUnique({
      where: { userId: session.user.id },
    });

    const contacts = await prisma.emergencyContact.findMany({
      where: { userId: session.user.id },
    });

    if (contacts.length === 0) {
      return NextResponse.json(
        { message: "No emergency contacts found. Add contacts in Settings → Emergency before sending an SOS." },
        { status: 400 },
      );
    }

    const userName = session.user.name || session.user.email || "Unknown";
    const locationStr = body.latitude && body.longitude
      ? `https://www.google.com/maps?q=${body.latitude},${body.longitude}`
      : "Location not available";

    // Look for an active location share session
    let shareLink: string | null = null;
    try {
      const activeShare = await prisma.locationShareSession.findFirst({
        where: { userId: session.user.id, isActive: true },
      });
      if (activeShare) {
        shareLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/location/view/${activeShare.shareLink}`;
      }
    } catch {
      // Ignore — share link is best-effort
    }

    // Create notification for the user
    prisma.notification.create({
      data: {
        userId: session.user.id,
        message: JSON.stringify({
          _type: "SOS",
          title: "SOS Alert Sent",
          body: `Your SOS alert has been triggered. ${contacts.length} contact(s) notified.`,
          alertId: alert.id,
        }),
      },
    }).catch((err) => console.error("[sos] Failed to create user notification:", err));

    // Notify emergency contacts via in-app notifications
    for (const contact of contacts) {
      if (contact.relation === "self") continue;
      prisma.notification.create({
        data: {
          userId: session.user.id,
          message: JSON.stringify({
            _type: "SOS_CONTACT",
            title: `SOS: ${userName} needs help!`,
            body: body.message || "SOS! I need help.",
            alertId: alert.id,
            contactName: contact.name,
            location: locationStr,
            shareLink,
            healthInfo: health
              ? {
                  bloodType: health.bloodType,
                  allergies: health.allergies,
                  conditions: health.chronicConditions,
                }
              : null,
          }),
        },
      }).catch((err) => console.error("[sos] Failed to notify contact:", contact.name, err));
    }

    // Dispatch email to contacts (blocking — the user needs to know it worked)
    let emailed = 0;
    try {
      const result = await dispatchSosNotifications(
        {
          alertId: alert.id,
          userName,
          message: body.message || "SOS! I need help.",
          locationStr,
          shareLink,
          healthInfo: health
            ? {
                bloodType: health.bloodType,
                allergies: health.allergies,
                conditions: health.chronicConditions,
              }
            : null,
        },
        contacts.map((c) => ({ name: c.name, phone: c.phone, email: c.email })),
      );
      emailed = result.emailed;
    } catch (dispatchErr) {
      console.error("[sos] Dispatch error:", dispatchErr);
    }

    return NextResponse.json({ alertId: alert.id, status: "ACTIVE", emailed, contactsWithEmail: contacts.filter((c) => c.email).length }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[sos] Route error:", message);
    return NextResponse.json({ message }, { status: 500 });
  }
}

async function getSosAlertsHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");

  const alerts = await prisma.emergencyAlert.findMany({
    where: {
      userId: session.user.id,
      ...(status ? { status: status as any } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(alerts);
}

export const POST = withRateLimit(sosHandler, { max: 10, windowSeconds: 60 });
export const GET = withRateLimit(getSosAlertsHandler, { max: 20, windowSeconds: 60 });
