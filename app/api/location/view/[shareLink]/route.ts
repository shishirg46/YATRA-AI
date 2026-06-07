export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getShareSessionHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ shareLink: string }> },
) {
  const { shareLink } = await params;

  const session_ = await prisma.locationShareSession.findUnique({
    where: { shareLink },
    select: {
      id: true,
      userName: true,
      tripTitle: true,
      isActive: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  if (!session_) {
    return NextResponse.json({ message: "Share link not found" }, { status: 404 });
  }

  if (!session_.isActive) {
    return NextResponse.json({ message: "This location share is no longer active" }, { status: 410 });
  }

  if (session_.expiresAt && new Date() > session_.expiresAt) {
    return NextResponse.json({ message: "This location share has expired" }, { status: 410 });
  }

  return NextResponse.json(session_);
}

export const GET = withRateLimit(getShareSessionHandler, { max: 60, windowSeconds: 60 });
