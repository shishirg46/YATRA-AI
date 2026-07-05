export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

async function trackPopularityHandler(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { destinationId, delta } = await req.json() as { destinationId: string; delta?: number };

    if (!destinationId || typeof destinationId !== "string") {
      return NextResponse.json({ message: "destinationId is required" }, { status: 400 });
    }

    const dest = await prisma.destination.findUnique({ where: { id: destinationId } });
    if (!dest) {
      return NextResponse.json({ message: "Destination not found" }, { status: 404 });
    }

    const change = delta ?? 1;

    await prisma.destination.update({
      where: { id: destinationId },
      data: { popularityScore: { increment: change } },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[popularity/track]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export const POST = withRateLimit(trackPopularityHandler, { max: 30, windowSeconds: 60 });
