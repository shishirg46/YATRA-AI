export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth, emailTransporter } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { generateShareLink, clearLocation } from "@/lib/location/store";

async function startSharingHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { tripId?: string } | undefined;

  // Deactivate any existing active sessions
  await prisma.locationShareSession.updateMany({
    where: { userId: session.user.id, isActive: true },
    data: { isActive: false },
  });

  const shareLink = generateShareLink();

  let tripTitle: string | null = null;
  let expiresAt: Date | null = null;

  if (body?.tripId) {
    const trip = await prisma.travelPlan.findUnique({
      where: { id: body.tripId },
      select: { title: true, endDate: true },
    });
    if (trip) {
      tripTitle = trip.title;
      expiresAt = new Date(trip.endDate.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  if (!expiresAt) {
    expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  const share = await prisma.locationShareSession.create({
    data: {
      userId: session.user.id,
      userName: session.user.name || session.user.email || "Unknown",
      tripId: body?.tripId ?? null,
      tripTitle,
      shareLink,
      isActive: true,
      expiresAt,
    },
  });

  const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/location/view/${shareLink}`;

  // Notify trip members via email (fire-and-forget)
  if (body?.tripId && emailTransporter) {
    console.log("[location-share] emailTransporter is defined, querying trip members...");
    prisma.travelPlan
      .findUnique({
        where: { id: body.tripId },
        select: {
          title: true,
          members: {
            where: { status: "ACCEPTED" },
            select: { user: { select: { name: true, email: true } } },
          },
        },
      })
      .then((trip) => {
        if (!trip) { console.warn("[location-share] Trip not found for id:", body?.tripId); return; }
        console.log("[location-share] Found trip:", trip.title, "with", trip.members.length, "ACCEPTED members");
        for (const member of trip.members) {
          if (!member.user.email) { console.warn("[location-share] Member has no email"); continue; }
          console.log("[location-share] Sending email to", member.user.email);
          emailTransporter!
            .sendMail({
              from: `YatraAI <${process.env.GMAIL_USER ?? "noreply@yatraai.com"}>`,
              to: member.user.email,
              subject: `${session.user.name ?? "Someone"} shared their live location`,
              html: buildShareEmailHtml({
                sharerName: session.user.name ?? "Someone",
                tripTitle: trip.title,
                shareUrl,
              }),
            })
            .then((info) => console.log("[location-share] Email sent to", member.user.email, info.messageId))
            .catch((err) => console.warn("[location-share] Failed to email member", member.user.email, err));
        }
      })
      .catch((err) => console.warn("[location-share] Failed to fetch trip members", err));
  } else {
    console.log("[location-share] Skipping email notification:", {
      hasTripId: !!body?.tripId,
      hasTransporter: !!emailTransporter,
    });
  }

  return NextResponse.json({
    shareLink: share.shareLink,
    shareUrl,
    expiresAt: share.expiresAt,
  }, { status: 201 });
}

async function stopSharingHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Get all active sessions to clear in-memory store
  const activeSessions = await prisma.locationShareSession.findMany({
    where: { userId: session.user.id, isActive: true },
  });

  await prisma.locationShareSession.updateMany({
    where: { userId: session.user.id, isActive: true },
    data: { isActive: false },
  });

  for (const s of activeSessions) {
    clearLocation(s.shareLink);
  }

  return NextResponse.json({ message: "Sharing stopped" });
}

function buildShareEmailHtml({
  sharerName,
  tripTitle,
  shareUrl,
}: {
  sharerName: string;
  tripTitle: string;
  shareUrl: string;
}) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;">
        <tr>
          <td style="padding:28px;text-align:center;border-radius:16px 16px 0 0;border-bottom:1px solid #e2e8f0;">
            <span style="font-size:32px;">📍</span>
            <h1 style="margin:8px 0 0;font-size:18px;color:#f59e0b;">${sharerName} shared their live location</h1>
          </td>
        </tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
            <strong>${sharerName}</strong> is sharing their live location for the trip
            <strong>${tripTitle}</strong>.
          </p>
          <p style="margin:0 0 24px;font-size:13px;color:#64748b;">
            Click the button below to view their location in real time.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr>
              <td style="background:#f59e0b;border-radius:10px;text-align:center;">
                <a href="${shareUrl}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;">
                  View Live Location
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;color:#94a3b8;word-break:break-all;">${shareUrl}</p>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">This link will expire when the trip ends. Shared via YatraAI.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const POST = withRateLimit(startSharingHandler, { max: 10, windowSeconds: 60 });
export const DELETE = withRateLimit(stopSharingHandler, { max: 10, windowSeconds: 60 });
