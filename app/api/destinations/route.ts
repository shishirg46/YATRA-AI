import { NextRequest, NextResponse } from "next/server";
import { getDestinations } from "@/lib/destinations";
import { withRateLimit } from "@/lib/rate-limit";

async function getDestinationsHandler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") ?? undefined;
    const minScore = searchParams.get("minScore") ? parseInt(searchParams.get("minScore")!, 10) : undefined;
    const minTier = searchParams.get("minTier") ? parseInt(searchParams.get("minTier")!, 10) : undefined;
    const minPopularity = searchParams.get("minPopularity") ? parseInt(searchParams.get("minPopularity")!, 10) : undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;
    const orderBy = (searchParams.get("orderBy") ?? undefined) as
      | "popularityScore"
      | "confidenceScore"
      | "destinationTier"
      | "dataQualityScore"
      | undefined;

    const destinations = await getDestinations({
      category,
      minScore,
      minTier,
      minPopularity,
      limit,
      offset,
      orderBy,
    });

    return NextResponse.json({ destinations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[destinations]", err);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export const GET = withRateLimit(getDestinationsHandler, { max: 30, windowSeconds: 60 });
