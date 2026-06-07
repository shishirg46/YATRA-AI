export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLatestLocation } from "@/lib/location/store";
import { withRateLimit } from "@/lib/rate-limit";

async function getLocationDataHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ shareLink: string }> },
) {
  const { shareLink } = await params;

  const session_ = await prisma.locationShareSession.findUnique({
    where: { shareLink },
    select: { isActive: true, expiresAt: true },
  });

  if (!session_ || !session_.isActive) {
    return NextResponse.json({ message: "Not found or inactive" }, { status: 404 });
  }

  if (session_.expiresAt && new Date() > session_.expiresAt) {
    return NextResponse.json({ message: "Expired" }, { status: 410 });
  }

  const location = getLatestLocation(shareLink);
  if (!location) {
    return NextResponse.json({ message: "No location data yet" }, { status: 404 });
  }

  return NextResponse.json(location);
}

export const GET = withRateLimit(getLocationDataHandler, { max: 60, windowSeconds: 60 });
