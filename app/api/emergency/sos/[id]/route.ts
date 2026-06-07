export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function resolveSosHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json()) as { status: "RESOLVED" | "FALSE_ALARM" };

  const alert = await prisma.emergencyAlert.findUnique({ where: { id } });
  if (!alert || alert.userId !== session.user.id) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const updated = await prisma.emergencyAlert.update({
    where: { id },
    data: {
      status: body.status,
      resolvedAt: new Date(),
    },
  });

  // Notify user that SOS was resolved
  prisma.notification.create({
    data: {
      userId: session.user.id,
      message: JSON.stringify({
        _type: "SOS",
        title: "SOS Resolved",
        body: body.status === "RESOLVED"
          ? "Your SOS alert has been marked as resolved. Stay safe!"
          : "SOS alert marked as false alarm.",
        alertId: id,
        status: body.status,
      }),
    },
  }).catch((err) => console.error("[sos] Failed to create resolution notification:", err));

  return NextResponse.json(updated);
}

export const PATCH = withRateLimit(resolveSosHandler, { max: 10, windowSeconds: 60 });
