export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { enrichPlaceDetails } from "@/services/placeDetails.service";
import { withRateLimit } from "@/lib/rate-limit";

async function getPlaceDetailsHandler(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ message: "Missing place name" }, { status: 400 });
  }

  try {
    const result = await enrichPlaceDetails(name);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[place-details/get]", err);
    return NextResponse.json({ message: "Failed to enrich place details" }, { status: 500 });
  }
}

async function postPlaceDetailsHandler(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string };
    const name = body?.name?.trim();
    if (!name) {
      return NextResponse.json({ message: "Missing place name" }, { status: 400 });
    }
    const result = await enrichPlaceDetails(name);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[place-details/post]", err);
    return NextResponse.json({ message: "Failed to enrich place details" }, { status: 500 });
  }
}

export const GET = withRateLimit(getPlaceDetailsHandler, { max: 30, windowSeconds: 60 });
export const POST = withRateLimit(postPlaceDetailsHandler, { max: 10, windowSeconds: 60 });

