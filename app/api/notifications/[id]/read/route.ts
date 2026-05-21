/**
 * FILE: route.ts
 * LOCATION: /app/api/notifications/[id]/read/route.ts
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { headers }                   from "next/headers";
import { prisma }                    from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // All notifications are now persisted to DB — just update isRead
  await prisma.notification.updateMany({
    where: { id, userId: session.user.id },
    data:  { isRead: true },
  });

  return NextResponse.json({ success: true });
}
