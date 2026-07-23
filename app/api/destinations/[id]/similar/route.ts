export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findSimilarDestinationIds } from "@/lib/recommendations/embedding-similarity";
import { withRateLimit } from "@/lib/rate-limit";

async function getSimilarHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const destination = await prisma.destination.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!destination) {
      return NextResponse.json({ message: "Destination not found" }, { status: 404 });
    }

    const similarIds = await findSimilarDestinationIds(id, 6);
    if (similarIds.length === 0) {
      return NextResponse.json({ destinations: [] });
    }

    const destinations = await prisma.destination.findMany({
      where: { id: { in: similarIds } },
      select: {
        id: true,
        name: true,
        district: true,
        province: true,
        category: true,
        altitude: true,
        image: true,
        tags: true,
      },
    });

    const idOrder = new Map(similarIds.map((sid, i) => [sid, i]));
    destinations.sort((a, b) => (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99));

    return NextResponse.json({ destinations });
  } catch (err) {
    console.error("[destinations/similar]", err);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export const GET = withRateLimit(getSimilarHandler, { max: 30, windowSeconds: 60 });
