export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { externalApiCache } from "@/lib/collectors/external-api-cache";
import { computeDestinationLive } from "@/lib/destinations/live";
import { withRateLimit } from "@/lib/rate-limit";

async function getLiveHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    const cacheKey = `live:${id}:${session.user.id}`;
    const result = await externalApiCache.getOrFetch(
      cacheKey,
      5 * 60_000,
      () => computeDestinationLive(id, session.user.id, _req.signal),
      { timeoutMs: 25_000, negativeTtlMs: 30_000, signal: _req.signal },
    );

    if (!result) {
      return NextResponse.json(
        { message: "Failed to compute live destination data" },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[DESTINATION_LIVE_ERROR]", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

export const GET = withRateLimit(getLiveHandler, { max: 60, windowSeconds: 60 });
