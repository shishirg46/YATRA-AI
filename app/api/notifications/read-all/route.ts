/**
 * FILE: route.ts
 * LOCATION: /app/api/notifications/read-all/route.ts
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth }         from "@/lib/auth";
import { headers }      from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function readAllNotificationsHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await prisma.notification.updateMany({
    where: {
      userId:  session.user.id,
      isRead:  false,
      message: { not: { contains: '"_type":"PROFILE"' } },
    },
    data: { isRead: true },
  });

  return NextResponse.json({ success: true });
}

export const POST = withRateLimit(readAllNotificationsHandler, { max: 10, windowSeconds: 60 });
