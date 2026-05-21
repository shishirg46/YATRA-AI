export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { enrichPlaceDetails } from "@/services/placeDetails.service";

export async function GET(req: NextRequest) {
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

export async function POST(req: NextRequest) {
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

