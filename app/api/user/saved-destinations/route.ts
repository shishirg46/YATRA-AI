export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function getSavedDestinationsHandler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const saved = await prisma.savedDestination.findMany({
    where: { userId: session.user.id },
    orderBy: { order: "asc" },
    include: {
      destination: true,
    },
  });

  return NextResponse.json(saved);
}

async function toggleSavedDestinationHandler(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { destinationId } = await req.json();

  if (!destinationId || typeof destinationId !== "string") {
    return NextResponse.json({ message: "destinationId is required" }, { status: 400 });
  }

  const dest = await prisma.destination.findUnique({ where: { id: destinationId } });
  if (!dest) {
    return NextResponse.json({ message: "Destination not found" }, { status: 404 });
  }

  const existing = await prisma.savedDestination.findUnique({
    where: { userId_destinationId: { userId: session.user.id, destinationId } },
  });

  if (existing) {
    await prisma.savedDestination.delete({ where: { id: existing.id } });
    return NextResponse.json({ saved: false, message: "Destination unsaved" });
  }

  const count = await prisma.savedDestination.count({
    where: { userId: session.user.id },
  });

  await prisma.savedDestination.create({
    data: {
      userId: session.user.id,
      destinationId,
      order: count,
    },
  });

  return NextResponse.json({ saved: true, message: "Destination saved" });
}

export const GET = withRateLimit(getSavedDestinationsHandler, { max: 30, windowSeconds: 60 });
export const POST = withRateLimit(toggleSavedDestinationHandler, { max: 10, windowSeconds: 60 });
