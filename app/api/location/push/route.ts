export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { pushLocation, getLatestLocation } from "@/lib/location/store";

async function pushLocationHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    latitude: number;
    longitude: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    altitude?: number;
    batteryLevel?: number;
  };

  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    return NextResponse.json({ message: "latitude and longitude are required." }, { status: 400 });
  }

  // Find user's active share session
  const activeShare = await prisma.locationShareSession.findFirst({
    where: { userId: session.user.id, isActive: true },
  });

  if (!activeShare) {
    return NextResponse.json({ message: "No active share session" }, { status: 404 });
  }

  // Store in-memory
  pushLocation(activeShare.shareLink, {
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy: body.accuracy ?? null,
    speed: body.speed ?? null,
    heading: body.heading ?? null,
    altitude: body.altitude ?? null,
    batteryLevel: body.batteryLevel ?? null,
  });

  return NextResponse.json({ status: "ok" });
}

async function getLocationHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const activeShare = await prisma.locationShareSession.findFirst({
    where: { userId: session.user.id, isActive: true },
  });

  if (!activeShare) {
    return NextResponse.json({ message: "No active share session" }, { status: 404 });
  }

  const location = getLatestLocation(activeShare.shareLink);
  if (!location) {
    return NextResponse.json({ message: "No location data yet" }, { status: 404 });
  }

  return NextResponse.json(location);
}

export const POST = withRateLimit(pushLocationHandler, { max: 30, windowSeconds: 60 });
export const GET = withRateLimit(getLocationHandler, { max: 30, windowSeconds: 60 });
