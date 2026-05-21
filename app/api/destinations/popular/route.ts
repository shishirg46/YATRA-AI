import { NextRequest, NextResponse } from "next/server";
import { getPopularDestinations } from "@/lib/destinations/pipeline";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);
    const minTier = searchParams.get("minTier") ? parseInt(searchParams.get("minTier")!, 10) : undefined;
    const category = searchParams.get("category") ?? undefined;

    const destinations = await getPopularDestinations(limit, {
      minTier,
      category: category as any,
    });

    return NextResponse.json({ destinations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[destinations/popular]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
